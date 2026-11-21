import {
  TelemetryBatchQueue,
  type RecordTelemetrySampleInput,
  type TelemetryBatchSendFn,
} from './telemetryBatchQueue.ts';
import {
  TrialAnalyticsQueue,
  type QueuedTrialEntry,
  type TrialAnalyticsQueueSummary,
} from './trialAnalyticsQueue.ts';
import { createUuid } from '../api/httpClient.ts';
import type { AnyTrialBody } from '../api/analyticsApi.ts';
import type {
  AnalyticsExerciseSlug,
  AnalyticsTrialReceipt,
} from '../api/contracts/analytics.contracts.ts';
import type {
  PatientSessionCompletionBody,
  PatientSessionProgressResponse,
} from '../api/contracts/clinical.contracts.ts';

export interface SessionLifecycleContext {
  readonly sessionId: string;
  readonly completionKey: string;
  readonly generation: number;
}

export type ClinicalClosureUiState =
  | 'SAVING'
  | 'PENDING_SYNC'
  | 'FINISHED'
  | 'ABANDONED'
  | 'ERROR';

export interface ClinicalClosureApis {
  getSessionProgress: (
    therapySessionId: string
  ) => Promise<PatientSessionProgressResponse>;
  completeSession: (
    therapySessionId: string,
    body: PatientSessionCompletionBody,
    idempotencyKey: string
  ) => Promise<PatientSessionProgressResponse>;
}

export interface ClinicalClosureStateAdapter {
  isMounted: () => boolean;
  waitForActivityEvents: () => Promise<void>;
  getCachedProgress: () => PatientSessionProgressResponse | null;
  setCachedProgress: (progress: PatientSessionProgressResponse) => void;
  setSyncSummary: (summary: SessionSyncSummary) => void;
  setCompletionState: (state: ClinicalClosureUiState) => void;
  setBackendWarning: (message: string) => void;
  onSessionProgressUpdate?: (progress: PatientSessionProgressResponse) => void;
  onSessionCompleted?: (
    progress: PatientSessionProgressResponse,
    action: 'FINISHED' | 'ABANDONED'
  ) => void;
  formatError?: (err: unknown) => string;
}

export type ClinicalClosureOutcome =
  | { status: 'STALE_IGNORED'; dispatchedWithKey?: string }
  | { status: 'PENDING_SYNC'; gate: ClosureGateResult }
  | {
      status: 'FINISHED' | 'ABANDONED';
      progress: PatientSessionProgressResponse;
      gate: ClosureGateResult;
    }
  | { status: 'ERROR'; errorMessage: string; gate: ClosureGateResult };

export interface SessionSyncSummary {
  sessionId: string | null;
  confirmedTrials: number;
  pendingTrials: number;
  uncertainTrials: number;
  failedPermanentTrials: number;
  inFlightTrials: number;
  pendingTelemetryBatches: number;
  inFlightTelemetryBatches: number;
  bufferedTelemetrySamples: number;
  brokerAcceptedTelemetryBatches: number;
  permanentRejectedTelemetryBatches: number;
  droppedOverflowTelemetryBatches: number;
  hasPendingOrUncertainDelivery: boolean;
  hasPermanentDataLoss: boolean;
  isSyncComplete: boolean;
  lastWarning: string | null;
}

export type ClosureGateReason =
  | 'READY'
  | 'PENDING_SYNC'
  | 'FORCED_CLOSE'
  | 'COMPLETED_WITH_PERMANENT_LOSS';

export interface ClosureGateResult {
  allowedToClose: boolean;
  reason: ClosureGateReason;
  summary: SessionSyncSummary;
}

export interface SessionDeliveryControllerOptions {
  sendTelemetryBatch: TelemetryBatchSendFn;
  sendTrialResult: (
    therapySessionId: string,
    slug: AnalyticsExerciseSlug,
    body: AnyTrialBody
  ) => Promise<AnalyticsTrialReceipt>;
  onSyncSummaryChange?: (summary: SessionSyncSummary) => void;
  maxSamplesPerArray?: number;
  maxQueueSize?: number;
  maxAttemptsPerFlush?: number;
  retryBackoffMs?: number;
  maxBodyBytes?: number;
  nowMs?: () => number;
  perfNowMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
  uuid?: () => string;
}

/**
 * Coordinates per-session TelemetryBatchQueue and TrialAnalyticsQueue lifecycles,
 * isolating session transitions, input-origin stream rotations, and closure gating.
 */
export class SessionDeliveryController {
  private readonly options: SessionDeliveryControllerOptions;
  private activeSessionId: string | null = null;
  private lifecycleGeneration = 0;
  private completionKey: string | null = null;
  private activeClosure: {
    generation: number;
    promise: Promise<ClinicalClosureOutcome>;
  } | null = null;
  private isMouseFallback = false;
  private telemetryQueue: TelemetryBatchQueue | null = null;
  private trialQueue: TrialAnalyticsQueue | null = null;
  private lastWarningSource: 'trial' | 'telemetry' | null = null;
  private lastObservedTrialWarning: string | null = null;
  private lastObservedTelemetryWarning: string | null = null;

  constructor(options: SessionDeliveryControllerOptions) {
    this.options = options;
  }

  /**
   * Aligns controller queues with the active therapy session ID.
   * Returns false as a strict no-op when sessionId has not changed.
   */
  syncSession(sessionId: string | null, initialMouseFallback = false): boolean {
    if (sessionId === this.activeSessionId) {
      return false;
    }

    this.lifecycleGeneration += 1;
    const capturedGeneration = this.lifecycleGeneration;
    this.activeClosure = null;

    this.telemetryQueue?.dispose();
    this.trialQueue?.dispose();
    this.telemetryQueue = null;
    this.trialQueue = null;

    this.activeSessionId = sessionId;
    this.completionKey =
      sessionId !== null ? (this.options.uuid ?? createUuid)() : null;
    this.isMouseFallback = initialMouseFallback;
    this.lastWarningSource = null;
    this.lastObservedTrialWarning = null;
    this.lastObservedTelemetryWarning = null;

    if (sessionId === null) {
      this.notifySyncSummaryChange();
      return true;
    }

    const capturedSessionId = sessionId;

    const telemetryQueue = new TelemetryBatchQueue({
      therapySessionId: capturedSessionId,
      maxSamplesPerArray: this.options.maxSamplesPerArray,
      maxQueueSize: this.options.maxQueueSize,
      maxAttemptsPerFlush: this.options.maxAttemptsPerFlush,
      retryBackoffMs: this.options.retryBackoffMs,
      nowMs: this.options.nowMs,
      perfNowMs: this.options.perfNowMs,
      sleep: this.options.sleep,
      uuid: this.options.uuid,
      sendBatch: this.options.sendTelemetryBatch,
      onStateChange: (snapshot) => {
        if (
          this.activeSessionId !== capturedSessionId ||
          this.lifecycleGeneration !== capturedGeneration ||
          this.telemetryQueue !== telemetryQueue
        ) {
          return;
        }
        if (snapshot.lastWarning !== this.lastObservedTelemetryWarning) {
          this.lastObservedTelemetryWarning = snapshot.lastWarning;
          if (snapshot.lastWarning !== null) {
            this.lastWarningSource = 'telemetry';
          }
        }
        this.notifySyncSummaryChange();
      },
    });

    const trialQueue = new TrialAnalyticsQueue({
      sendTrial: (slug, body) =>
        this.options.sendTrialResult(capturedSessionId, slug, body),
      retryBackoffMs: this.options.retryBackoffMs,
      maxBodyBytes: this.options.maxBodyBytes,
      sleep: this.options.sleep,
      onStateChange: (summary) => {
        if (
          this.activeSessionId !== capturedSessionId ||
          this.lifecycleGeneration !== capturedGeneration ||
          this.trialQueue !== trialQueue
        ) {
          return;
        }
        if (summary.lastWarning !== this.lastObservedTrialWarning) {
          this.lastObservedTrialWarning = summary.lastWarning;
          if (summary.lastWarning !== null) {
            this.lastWarningSource = 'trial';
          }
        }
        this.notifySyncSummaryChange();
      },
    });

    this.telemetryQueue = telemetryQueue;
    this.trialQueue = trialQueue;
    this.notifySyncSummaryChange();
    return true;
  }

  /**
   * Returns an immutable admission token bound to the current active session lifecycle,
   * or null when no Clinical session is currently active.
   */
  getLifecycleContext(): SessionLifecycleContext | null {
    if (this.activeSessionId === null || this.completionKey === null) {
      return null;
    }
    return Object.freeze({
      sessionId: this.activeSessionId,
      completionKey: this.completionKey,
      generation: this.lifecycleGeneration,
    });
  }

  /**
   * Verifies synchronously that the given captured lifecycle context still matches
   * the currently active session ID, lifecycle generation, and completion key.
   */
  isLifecycleAdmitted(context: SessionLifecycleContext | null): boolean {
    return (
      context !== null &&
      this.activeSessionId === context.sessionId &&
      this.lifecycleGeneration === context.generation &&
      this.completionKey === context.completionKey
    );
  }

  /**
   * Rotates only the telemetry stream when input origin changes, preserving
   * all queued/in-flight telemetry batches and trial analytics entries.
   */
  handleInputOriginChange(isMouseFallback: boolean): Promise<void> {
    if (this.isMouseFallback === isMouseFallback) {
      return Promise.resolve();
    }

    this.isMouseFallback = isMouseFallback;
    if (!this.telemetryQueue) {
      return Promise.resolve();
    }

    return this.telemetryQueue.rotateStream();
  }

  recordTelemetrySample(sample: RecordTelemetrySampleInput): void {
    this.telemetryQueue?.recordSample(sample);
  }

  flushTelemetry(): Promise<void> {
    if (!this.telemetryQueue) {
      return Promise.resolve();
    }
    return this.telemetryQueue.flush();
  }

  submitTrial(
    slug: AnalyticsExerciseSlug,
    body: AnyTrialBody
  ): Promise<QueuedTrialEntry | null> {
    if (!this.trialQueue) {
      return Promise.resolve(null);
    }
    return this.trialQueue.submit(slug, body);
  }

  drainPendingTrials(
    maxAdditionalAttempts = 2
  ): Promise<TrialAnalyticsQueueSummary | null> {
    if (!this.trialQueue) {
      return Promise.resolve(null);
    }
    return this.trialQueue.drainPending(maxAdditionalAttempts);
  }

  /**
   * Flushes telemetry and drains pending/uncertain trials before evaluating
   * whether the clinical session is safe to close.
   */
  async prepareClosure(
    forceCloseWithoutSync = false
  ): Promise<ClosureGateResult> {
    const targetSessionId = this.activeSessionId;
    const targetGeneration = this.lifecycleGeneration;

    await Promise.all([
      this.drainPendingTrials(2).catch(() => null),
      this.flushTelemetry().catch(() => undefined),
    ]);

    const summary = this.getSyncSummary();

    if (
      targetSessionId !== this.activeSessionId ||
      targetGeneration !== this.lifecycleGeneration
    ) {
      return {
        allowedToClose: false,
        reason: 'PENDING_SYNC',
        summary,
      };
    }

    if (!forceCloseWithoutSync && summary.hasPendingOrUncertainDelivery) {
      return {
        allowedToClose: false,
        reason: 'PENDING_SYNC',
        summary,
      };
    }

    if (forceCloseWithoutSync && summary.hasPendingOrUncertainDelivery) {
      return {
        allowedToClose: true,
        reason: 'FORCED_CLOSE',
        summary,
      };
    }

    if (summary.hasPermanentDataLoss) {
      return {
        allowedToClose: true,
        reason: 'COMPLETED_WITH_PERMANENT_LOSS',
        summary,
      };
    }

    return {
      allowedToClose: true,
      reason: 'READY',
      summary,
    };
  }

  /**
   * Executes Clinical session closure bound strictly to the lifecycle context captured
   * at entry, enforcing single-flight execution and post-await admission checks (LIFE-POST-GATE).
   */
  closeClinicalSession(params: {
    forceCloseWithoutSync: boolean;
    apis: ClinicalClosureApis;
    adapter: ClinicalClosureStateAdapter;
  }): Promise<ClinicalClosureOutcome> {
    const { forceCloseWithoutSync, apis, adapter } = params;
    const context = this.getLifecycleContext();
    if (!context || !adapter.isMounted()) {
      return Promise.resolve({ status: 'STALE_IGNORED' });
    }

    if (
      this.activeClosure &&
      this.activeClosure.generation === context.generation
    ) {
      return this.activeClosure.promise;
    }

    const isAdmitted = (): boolean =>
      this.isLifecycleAdmitted(context) && adapter.isMounted();

    const run = (async (): Promise<ClinicalClosureOutcome> => {
      let dispatchedWithKey: string | undefined;
      try {
        if (!isAdmitted()) {
          return { status: 'STALE_IGNORED' };
        }
        adapter.setCompletionState('SAVING');

        const [, gate] = await Promise.all([
          adapter.waitForActivityEvents().catch(() => undefined),
          this.prepareClosure(forceCloseWithoutSync),
        ]);

        if (!isAdmitted()) {
          return { status: 'STALE_IGNORED' };
        }

        adapter.setSyncSummary(gate.summary);

        if (!gate.allowedToClose) {
          adapter.setCompletionState('PENDING_SYNC');
          adapter.setBackendWarning(
            'Hay ensayos o lotes de telemetría pendientes o con estado incierto antes de cerrar la sesión clínica.'
          );
          return { status: 'PENDING_SYNC', gate };
        }

        let latestProg = adapter.getCachedProgress();
        try {
          const fetched = await apis.getSessionProgress(context.sessionId);
          if (!isAdmitted()) {
            return { status: 'STALE_IGNORED' };
          }
          latestProg = fetched;
          adapter.setCachedProgress(fetched);
        } catch {
          if (!isAdmitted()) {
            return { status: 'STALE_IGNORED' };
          }
          // Fallback to cached progress only when still admitted
        }

        if (!isAdmitted()) {
          return { status: 'STALE_IGNORED' };
        }

        const canFinish = Boolean(latestProg?.targetReached);
        const action: 'FINISHED' | 'ABANDONED' = canFinish
          ? 'FINISHED'
          : 'ABANDONED';

        if (latestProg && latestProg.status !== 'ACTIVE') {
          const mapped: 'FINISHED' | 'ABANDONED' =
            latestProg.status === 'COMPLETED' ? 'FINISHED' : 'ABANDONED';
          if (!isAdmitted()) {
            return { status: 'STALE_IGNORED' };
          }
          adapter.setCompletionState(mapped);
          adapter.onSessionProgressUpdate?.(latestProg);
          adapter.onSessionCompleted?.(latestProg, mapped);
          return { status: mapped, progress: latestProg, gate };
        }

        // Synchronous admission check immediately prior to HTTP dispatch
        if (!isAdmitted()) {
          return { status: 'STALE_IGNORED' };
        }

        dispatchedWithKey = context.completionKey;
        try {
          const completed = await apis.completeSession(
            context.sessionId,
            { action },
            context.completionKey
          );
          if (!isAdmitted()) {
            return { status: 'STALE_IGNORED', dispatchedWithKey };
          }
          adapter.setCachedProgress(completed);
          adapter.setCompletionState(action);
          adapter.onSessionProgressUpdate?.(completed);
          adapter.onSessionCompleted?.(completed, action);
          return { status: action, progress: completed, gate };
        } catch (err) {
          if (!isAdmitted()) {
            return { status: 'STALE_IGNORED', dispatchedWithKey };
          }
          const formatted = adapter.formatError
            ? adapter.formatError(err)
            : err instanceof Error
            ? err.message
            : String(err);
          adapter.setCompletionState('ERROR');
          adapter.setBackendWarning(`Cierre de sesión: ${formatted}`);
          return { status: 'ERROR', errorMessage: formatted, gate };
        }
      } finally {
        if (this.activeClosure?.generation === context.generation) {
          this.activeClosure = null;
        }
      }
    })();

    this.activeClosure = { generation: context.generation, promise: run };
    return run;
  }

  getSyncSummary(): SessionSyncSummary {
    const trialSummary = this.trialQueue?.getSummary();
    const telemetrySnap = this.telemetryQueue?.getSnapshot();

    const confirmedTrials = trialSummary?.confirmedCount ?? 0;
    const pendingTrials = trialSummary?.pendingCount ?? 0;
    const uncertainTrials = trialSummary?.uncertainCount ?? 0;
    const failedPermanentTrials = trialSummary?.failedPermanentCount ?? 0;
    const inFlightTrials = trialSummary?.inFlightCount ?? 0;

    const pendingTelemetryBatches = telemetrySnap?.pendingCount ?? 0;
    const inFlightTelemetryBatches = telemetrySnap?.inFlightCount ?? 0;
    const bufferedTelemetrySamples = telemetrySnap?.bufferedSampleCount ?? 0;
    const brokerAcceptedTelemetryBatches =
      telemetrySnap?.brokerAcceptedCount ?? 0;
    const permanentRejectedTelemetryBatches =
      telemetrySnap?.permanentRejectedCount ?? 0;
    const droppedOverflowTelemetryBatches =
      telemetrySnap?.droppedOverflowCount ?? 0;

    const hasPendingOrUncertainDelivery =
      pendingTrials > 0 ||
      uncertainTrials > 0 ||
      inFlightTrials > 0 ||
      pendingTelemetryBatches > 0 ||
      inFlightTelemetryBatches > 0 ||
      bufferedTelemetrySamples > 0;

    const hasPermanentDataLoss =
      failedPermanentTrials > 0 ||
      permanentRejectedTelemetryBatches > 0 ||
      droppedOverflowTelemetryBatches > 0;

    const isSyncComplete =
      !hasPendingOrUncertainDelivery && !hasPermanentDataLoss;

    const trialWarning = trialSummary?.lastWarning ?? null;
    const telemetryWarning = telemetrySnap?.lastWarning ?? null;
    let lastWarning: string | null = null;
    if (trialWarning !== null && telemetryWarning !== null) {
      lastWarning =
        this.lastWarningSource === 'telemetry' ? telemetryWarning : trialWarning;
    } else {
      lastWarning = trialWarning ?? telemetryWarning;
    }

    return {
      sessionId: this.activeSessionId,
      confirmedTrials,
      pendingTrials,
      uncertainTrials,
      failedPermanentTrials,
      inFlightTrials,
      pendingTelemetryBatches,
      inFlightTelemetryBatches,
      bufferedTelemetrySamples,
      brokerAcceptedTelemetryBatches,
      permanentRejectedTelemetryBatches,
      droppedOverflowTelemetryBatches,
      hasPendingOrUncertainDelivery,
      hasPermanentDataLoss,
      isSyncComplete,
      lastWarning,
    };
  }

  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  getTelemetryQueue(): TelemetryBatchQueue | null {
    return this.telemetryQueue;
  }

  getTrialQueue(): TrialAnalyticsQueue | null {
    return this.trialQueue;
  }

  dispose(): void {
    this.lifecycleGeneration += 1;
    this.activeClosure = null;
    this.telemetryQueue?.dispose();
    this.trialQueue?.dispose();
    this.telemetryQueue = null;
    this.trialQueue = null;
    this.activeSessionId = null;
    this.completionKey = null;
    this.isMouseFallback = false;
    this.lastWarningSource = null;
    this.lastObservedTrialWarning = null;
    this.lastObservedTelemetryWarning = null;
  }

  private notifySyncSummaryChange(): void {
    this.options.onSyncSummaryChange?.(this.getSyncSummary());
  }
}
