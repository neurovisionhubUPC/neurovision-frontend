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
import type { AnyTrialBody } from '../api/analyticsApi.ts';
import type {
  AnalyticsExerciseSlug,
  AnalyticsTrialReceipt,
} from '../api/contracts/analytics.contracts.ts';

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

    this.telemetryQueue?.dispose();
    this.trialQueue?.dispose();
    this.telemetryQueue = null;
    this.trialQueue = null;

    this.activeSessionId = sessionId;
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

    await Promise.all([
      this.drainPendingTrials(2).catch(() => null),
      this.flushTelemetry().catch(() => undefined),
    ]);

    const summary = this.getSyncSummary();

    if (targetSessionId !== this.activeSessionId) {
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
    this.telemetryQueue?.dispose();
    this.trialQueue?.dispose();
    this.telemetryQueue = null;
    this.trialQueue = null;
    this.activeSessionId = null;
    this.isMouseFallback = false;
    this.lastWarningSource = null;
    this.lastObservedTrialWarning = null;
    this.lastObservedTelemetryWarning = null;
  }

  private notifySyncSummaryChange(): void {
    this.options.onSyncSummaryChange?.(this.getSyncSummary());
  }
}
