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
import {
  ClinicalActivityQueue,
  type ClinicalActivityEntryState,
  type ClinicalActivityQueueSummary,
  type ClinicalActivitySendFn,
  type ClinicalProgressReadFn,
  type RetainedClinicalActivityEntry,
} from './clinicalActivityQueue.ts';
import { ApiError, createUuid } from '../api/httpClient.ts';
import type { AnyTrialBody } from '../api/analyticsApi.ts';
import type {
  AnalyticsExerciseSlug,
  AnalyticsTrialReceipt,
} from '../api/contracts/analytics.contracts.ts';
import type {
  PatientActivityEventBody,
  PatientSessionCompletionBody,
  PatientSessionProgressResponse,
  PatientTherapySessionStatus,
} from '../api/contracts/clinical.contracts.ts';

export type {
  ClinicalActivityEntryState,
  ClinicalActivityQueueSummary,
  ClinicalActivitySendFn,
  ClinicalProgressReadFn,
  RetainedClinicalActivityEntry,
};

export const DEFAULT_CLINICAL_REQUEST_TIMEOUT_MS = 15_000;
export const DEFAULT_CLOSURE_GATE_TIMEOUT_MS = 15_000;

export type ClinicalDeadlineStage =
  | 'WAIT_EVENTS'
  | 'SEND_ACTIVITY'
  | 'DELIVERY_GATE'
  | 'GET_PROGRESS'
  | 'COMPLETE_SESSION'
  | 'RECOVERY_PROGRESS';

export class ClinicalRequestTimeoutError extends Error {
  readonly stage: ClinicalDeadlineStage;
  readonly timeoutMs: number;

  constructor(stage: ClinicalDeadlineStage, timeoutMs: number, message?: string) {
    super(
      message ??
        `Tiempo de espera agotado (${timeoutMs} ms) en operación clínica (${stage}).`
    );
    this.name = 'ClinicalRequestTimeoutError';
    this.stage = stage;
    this.timeoutMs = timeoutMs;
  }
}

export interface SessionLifecycleContext {
  readonly sessionId: string;
  readonly accountKey: string | null;
  readonly completionKey: string;
  readonly generation: number;
}

export type ClinicalClosureUiState =
  | 'SAVING'
  | 'PENDING_SYNC'
  | 'FINISHED'
  | 'ABANDONED'
  | 'ERROR';

export type SessionTransitionPolicy = 'EXPLICIT_DISCARD' | 'BLOCK_IF_PENDING';

export interface SyncSessionOptions {
  initialMouseFallback?: boolean;
  accountKey?: string | null;
  policy?: SessionTransitionPolicy;
}

export interface PendingCriticalWorkSnapshot {
  sessionId: string | null;
  accountKey: string | null;
  pendingActivityEvents: number;
  uncertainActivityEvents: number;
  conflictActivityEvents: number;
  inFlightActivityEvents: number;
  pendingTelemetryBatches: number;
  inFlightTelemetryBatches: number;
  bufferedTelemetrySamples: number;
  pendingTrials: number;
  uncertainTrials: number;
  inFlightTrials: number;
  hasActiveClosure: boolean;
  hasUncertainClosure: boolean;
  hasPendingCriticalWork: boolean;
  isInMemoryOnly: true;
}

export interface DiscardedSessionWorkNotice {
  discardedSessionId: string;
  discardedAccountKey: string | null;
  nextSessionId: string | null;
  nextAccountKey: string | null;
  reason: 'SESSION_SWITCH' | 'ACCOUNT_CHANGE' | 'TEARDOWN' | 'DISPOSE';
  snapshot: PendingCriticalWorkSnapshot;
}

export interface SessionTransitionResult {
  switched: boolean;
  blockedByPendingWork: boolean;
  pendingWork: PendingCriticalWorkSnapshot;
  discardedNotice: DiscardedSessionWorkNotice | null;
}

export type ClinicalClosureDetailKind =
  | 'IDLE'
  | 'SAVING'
  | 'PENDING_SYNC'
  | 'PROGRESS_UNAVAILABLE'
  | 'TARGET_NOT_REACHED'
  | 'UNCERTAIN_COMPLETION'
  | 'CONFLICT'
  | 'AUTH_ERROR'
  | 'OBSERVED_SERVER_STATE'
  | 'COMPLETED'
  | 'ABANDONED';

export interface ClinicalClosureStateDetail {
  kind: ClinicalClosureDetailKind;
  sessionId: string | null;
  action: 'FINISHED' | 'ABANDONED' | null;
  observedServerStatus: PatientTherapySessionStatus | null;
  receiptAcknowledged: boolean;
  canRetryProgressRead: boolean;
  canRecoverWithSameKey: boolean;
  hasRetainedCompletionIdentity: boolean;
  message: string;
}

export type ClinicalClosureErrorReason =
  | 'PROGRESS_UNAVAILABLE'
  | 'PROGRESS_TIMEOUT'
  | 'PROGRESS_SESSION_MISMATCH'
  | 'ACTIVITY_CONFLICT'
  | 'TARGET_NOT_REACHED'
  | 'SESSION_EXPIRED'
  | 'COMPLETION_UNCERTAIN'
  | 'COMPLETION_TIMEOUT'
  | 'COMPLETION_CONFLICT'
  | 'COMPLETION_AUTH_ERROR'
  | 'COMPLETION_RESPONSE_MISMATCH'
  | 'RECOVERY_PROGRESS_FAILED'
  | 'DELIVERY_WAIT_TIMEOUT'
  | 'COMPLETION_FAILED';

export interface PostReloadObservedState {
  sessionId: string;
  valid: boolean;
  observedStatus: PatientTherapySessionStatus | null;
  targetReached: boolean;
  originalOperationContextAvailable: false;
  canReplayOriginalKey: false;
  disclosureMessage: string;
}

export interface ClinicalClosureApis {
  getSessionProgress: (
    therapySessionId: string,
    options?: { signal?: AbortSignal }
  ) => Promise<PatientSessionProgressResponse>;
  completeSession: (
    therapySessionId: string,
    body: PatientSessionCompletionBody,
    idempotencyKey: string,
    options?: { signal?: AbortSignal }
  ) => Promise<PatientSessionProgressResponse>;
}

export interface ClinicalClosureStateAdapter {
  isMounted: () => boolean;
  waitForActivityEvents: () => Promise<void>;
  getCachedProgress: () => PatientSessionProgressResponse | null;
  setCachedProgress: (progress: PatientSessionProgressResponse) => void;
  clearCachedProgress?: () => void;
  setSyncSummary: (summary: SessionSyncSummary) => void;
  setCompletionState: (state: ClinicalClosureUiState) => void;
  setBackendWarning: (message: string) => void;
  onClosureStateDetail?: (detail: ClinicalClosureStateDetail) => void;
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
      receiptAcknowledged?: boolean;
    }
  | {
      status: 'ERROR';
      errorMessage: string;
      gate: ClosureGateResult;
      reason?: ClinicalClosureErrorReason;
      uncertain?: boolean;
      dispatchedWithKey?: string;
      dispatchedAction?: 'FINISHED' | 'ABANDONED';
      observedServerStatus?: PatientTherapySessionStatus | null;
      receiptAcknowledged?: boolean;
    };

export interface SessionSyncSummary {
  sessionId: string | null;
  confirmedActivityEvents: number;
  pendingActivityEvents: number;
  uncertainActivityEvents: number;
  conflictActivityEvents: number;
  inFlightActivityEvents: number;
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
  sendActivityEvent?: ClinicalActivitySendFn;
  getSessionProgress?: ClinicalProgressReadFn;
  onActivityEventAcknowledged?: (
    entry: RetainedClinicalActivityEntry,
    progress: PatientSessionProgressResponse,
    context: SessionLifecycleContext
  ) => void;
  onActivityProgressObserved?: (
    progress: PatientSessionProgressResponse,
    context: SessionLifecycleContext
  ) => void;
  onSyncSummaryChange?: (summary: SessionSyncSummary) => void;
  onPendingWorkDiscarded?: (notice: DiscardedSessionWorkNotice) => void;
  clinicalRequestTimeoutMs?: number;
  closureGateTimeoutMs?: number;
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

interface RetainedClosureOperation {
  readonly context: SessionLifecycleContext;
  readonly action: 'FINISHED' | 'ABANDONED';
  attemptSeq: number;
  receiptApplied: boolean;
  conflictDetected: boolean;
  observedServerStatus: PatientTherapySessionStatus | null;
  lastProgress: PatientSessionProgressResponse | null;
}

export function isMatchingSessionProgress(
  progress: PatientSessionProgressResponse | null | undefined,
  expectedSessionId: string
): progress is PatientSessionProgressResponse {
  return (
    progress !== null &&
    progress !== undefined &&
    typeof progress.therapySessionId === 'string' &&
    progress.therapySessionId.length > 0 &&
    progress.therapySessionId === expectedSessionId
  );
}

/**
 * Evaluates server progress read on a fresh post-reload instance.
 * Never fabricates an idempotent completion key or resends PUT without original in-memory context.
 */
export function evaluateObservedStateAfterReload(
  progress: PatientSessionProgressResponse | null | undefined,
  expectedSessionId: string
): PostReloadObservedState {
  if (!progress) {
    return {
      sessionId: expectedSessionId,
      valid: false,
      observedStatus: null,
      targetReached: false,
      originalOperationContextAvailable: false,
      canReplayOriginalKey: false,
      disclosureMessage:
        'No se pudo leer el estado de la sesión tras la recarga; no existe clave original en memoria para reenviar un cierre idempotente.',
    };
  }

  if (!isMatchingSessionProgress(progress, expectedSessionId)) {
    return {
      sessionId: expectedSessionId,
      valid: false,
      observedStatus: null,
      targetReached: false,
      originalOperationContextAvailable: false,
      canReplayOriginalKey: false,
      disclosureMessage:
        'La lectura de progreso recibida no coincide con el therapySessionId esperado y fue descartada.',
    };
  }

  return {
    sessionId: expectedSessionId,
    valid: true,
    observedStatus: progress.status,
    targetReached: progress.targetReached,
    originalOperationContextAvailable: false,
    canReplayOriginalKey: false,
    disclosureMessage:
      progress.status === 'ACTIVE'
        ? 'Estado observado en servidor: ACTIVE. Tras una recarga o pérdida de contexto no se conserva la clave original para reintentar un cierre previo.'
        : `Estado observado en servidor: ${progress.status}. Tras una recarga no está disponible el contexto ni el comprobante idempotente de una operación previa en memoria.`,
  };
}

function extractHttpStatus(err: unknown): number | null {
  if (err instanceof ApiError) {
    return err.status;
  }
  if (
    err !== null &&
    typeof err === 'object' &&
    'status' in err &&
    typeof (err as { status: unknown }).status === 'number'
  ) {
    return (err as { status: number }).status;
  }
  return null;
}

function formatClosureError(
  err: unknown,
  adapterFormatError?: (err: unknown) => string
): string {
  if (err instanceof ClinicalRequestTimeoutError) {
    return err.message;
  }
  if (adapterFormatError) {
    return adapterFormatError(err);
  }
  if (err instanceof ApiError) {
    return `[${err.status}] ${err.code}: ${err.message}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/**
 * Coordinates per-session TelemetryBatchQueue and TrialAnalyticsQueue lifecycles,
 * isolating session/account transitions, progress caches, input stream rotations,
 * bounded Clinical waits, and single-key closure recovery.
 */
export class SessionDeliveryController {
  private readonly options: SessionDeliveryControllerOptions;
  private readonly clinicalRequestTimeoutMs: number;
  private readonly closureGateTimeoutMs: number;

  private activeSessionId: string | null = null;
  private activeAccountKey: string | null = null;
  private lifecycleGeneration = 0;
  private completionKey: string | null = null;
  private activeClosure: {
    generation: number;
    promise: Promise<ClinicalClosureOutcome>;
  } | null = null;
  private uncertainClosure: RetainedClosureOperation | null = null;
  private cachedProgress: PatientSessionProgressResponse | null = null;
  private cachedProgressGeneration: number | null = null;
  private lastClosureDetail: ClinicalClosureStateDetail | null = null;
  private lastDiscardedWorkNotice: DiscardedSessionWorkNotice | null = null;
  private isMouseFallback = false;
  private activityQueue: ClinicalActivityQueue | null = null;
  private telemetryQueue: TelemetryBatchQueue | null = null;
  private trialQueue: TrialAnalyticsQueue | null = null;
  private lastWarningSource: 'activity' | 'trial' | 'telemetry' | null = null;
  private lastObservedActivityWarning: string | null = null;
  private lastObservedTrialWarning: string | null = null;
  private lastObservedTelemetryWarning: string | null = null;

  constructor(options: SessionDeliveryControllerOptions) {
    this.options = options;
    this.clinicalRequestTimeoutMs =
      options.clinicalRequestTimeoutMs ?? DEFAULT_CLINICAL_REQUEST_TIMEOUT_MS;
    this.closureGateTimeoutMs =
      options.closureGateTimeoutMs ?? DEFAULT_CLOSURE_GATE_TIMEOUT_MS;
  }

  /**
   * Aligns controller queues and caches with the active therapy session ID and account.
   * Returns false as a strict no-op when sessionId and accountKey have not changed.
   */
  syncSession(
    sessionId: string | null,
    initialMouseFallbackOrOptions: boolean | SyncSessionOptions = false
  ): boolean {
    const normalizedOptions: SyncSessionOptions =
      typeof initialMouseFallbackOrOptions === 'boolean'
        ? { initialMouseFallback: initialMouseFallbackOrOptions }
        : initialMouseFallbackOrOptions;
    return this.requestSessionTransition(sessionId, {
      ...normalizedOptions,
      policy: normalizedOptions.policy ?? 'EXPLICIT_DISCARD',
    }).switched;
  }

  /**
   * Transitions or blocks session switching according to the explicit policy.
   * Account changes always override BLOCK_IF_PENDING so work is never carried across users.
   */
  requestSessionTransition(
    sessionId: string | null,
    options: SyncSessionOptions = {}
  ): SessionTransitionResult {
    const nextAccountKey =
      options.accountKey !== undefined ? options.accountKey : this.activeAccountKey;
    const accountChanged = nextAccountKey !== this.activeAccountKey;
    const sessionChanged = sessionId !== this.activeSessionId;

    if (!sessionChanged && !accountChanged) {
      return {
        switched: false,
        blockedByPendingWork: false,
        pendingWork: this.getPendingCriticalWorkSnapshot(),
        discardedNotice: null,
      };
    }

    const pendingBefore = this.getPendingCriticalWorkSnapshot();
    const policy = options.policy ?? 'EXPLICIT_DISCARD';

    if (
      policy === 'BLOCK_IF_PENDING' &&
      !accountChanged &&
      pendingBefore.hasPendingCriticalWork
    ) {
      return {
        switched: false,
        blockedByPendingWork: true,
        pendingWork: pendingBefore,
        discardedNotice: null,
      };
    }

    let discardedNotice: DiscardedSessionWorkNotice | null = null;
    if (this.activeSessionId !== null && pendingBefore.hasPendingCriticalWork) {
      const reason: DiscardedSessionWorkNotice['reason'] = accountChanged
        ? 'ACCOUNT_CHANGE'
        : sessionId === null
        ? 'TEARDOWN'
        : 'SESSION_SWITCH';
      discardedNotice = {
        discardedSessionId: this.activeSessionId,
        discardedAccountKey: this.activeAccountKey,
        nextSessionId: sessionId,
        nextAccountKey,
        reason,
        snapshot: pendingBefore,
      };
      this.lastDiscardedWorkNotice = discardedNotice;
      this.options.onPendingWorkDiscarded?.(discardedNotice);
    }

    this.lifecycleGeneration += 1;
    const capturedGeneration = this.lifecycleGeneration;
    this.activeClosure = null;
    this.uncertainClosure = null;
    this.cachedProgress = null;
    this.cachedProgressGeneration = null;
    this.lastClosureDetail = null;

    this.activityQueue?.dispose();
    this.telemetryQueue?.dispose();
    this.trialQueue?.dispose();
    this.activityQueue = null;
    this.telemetryQueue = null;
    this.trialQueue = null;

    this.activeSessionId = sessionId;
    this.activeAccountKey = nextAccountKey;
    const nextCompletionKey =
      sessionId !== null ? (this.options.uuid ?? createUuid)() : null;
    this.completionKey = nextCompletionKey;
    this.isMouseFallback = options.initialMouseFallback ?? false;
    this.lastWarningSource = null;
    this.lastObservedActivityWarning = null;
    this.lastObservedTrialWarning = null;
    this.lastObservedTelemetryWarning = null;

    if (sessionId === null) {
      this.notifySyncSummaryChange();
      return {
        switched: true,
        blockedByPendingWork: false,
        pendingWork: this.getPendingCriticalWorkSnapshot(),
        discardedNotice,
      };
    }

    const capturedSessionId = sessionId;
    const capturedAccountKey = nextAccountKey;
    const capturedContext: SessionLifecycleContext = Object.freeze({
      sessionId: capturedSessionId,
      accountKey: capturedAccountKey,
      completionKey: nextCompletionKey!,
      generation: capturedGeneration,
    });

    const activityQueue = this.options.sendActivityEvent
      ? new ClinicalActivityQueue({
          therapySessionId: capturedSessionId,
          accountKey: capturedAccountKey,
          generation: capturedGeneration,
          requestTimeoutMs: this.clinicalRequestTimeoutMs,
          sendActivityEvent: this.options.sendActivityEvent,
          getSessionProgress: this.options.getSessionProgress,
          onStateChange: (summary) => {
            if (
              this.activeSessionId !== capturedSessionId ||
              this.activeAccountKey !== capturedAccountKey ||
              this.lifecycleGeneration !== capturedGeneration ||
              this.activityQueue !== activityQueue
            ) {
              return;
            }
            if (summary.lastWarning !== this.lastObservedActivityWarning) {
              this.lastObservedActivityWarning = summary.lastWarning;
              if (summary.lastWarning !== null) {
                this.lastWarningSource = 'activity';
              }
            }
            this.notifySyncSummaryChange();
          },
          onEventAcknowledged: (entry, progress) => {
            if (!this.isLifecycleAdmitted(capturedContext) || this.activityQueue !== activityQueue) {
              return;
            }
            this.setCachedProgress(progress, capturedContext);
            this.options.onActivityEventAcknowledged?.(entry, progress, capturedContext);
          },
          onProgressObserved: (progress) => {
            if (!this.isLifecycleAdmitted(capturedContext) || this.activityQueue !== activityQueue) {
              return;
            }
            this.setCachedProgress(progress, capturedContext);
            this.options.onActivityProgressObserved?.(progress, capturedContext);
          },
        })
      : null;

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
          this.activeAccountKey !== capturedAccountKey ||
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
          this.activeAccountKey !== capturedAccountKey ||
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

    this.activityQueue = activityQueue;
    this.telemetryQueue = telemetryQueue;
    this.trialQueue = trialQueue;
    this.notifySyncSummaryChange();
    return {
      switched: true,
      blockedByPendingWork: false,
      pendingWork: this.getPendingCriticalWorkSnapshot(),
      discardedNotice,
    };
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
      accountKey: this.activeAccountKey,
      completionKey: this.completionKey,
      generation: this.lifecycleGeneration,
    });
  }

  /**
   * Verifies synchronously that the given captured lifecycle context still matches
   * the currently active session ID, account, lifecycle generation, and completion key.
   */
  isLifecycleAdmitted(context: SessionLifecycleContext | null): boolean {
    return (
      context !== null &&
      this.activeSessionId === context.sessionId &&
      this.activeAccountKey === context.accountKey &&
      this.lifecycleGeneration === context.generation &&
      this.completionKey === context.completionKey
    );
  }

  /**
   * Reads cached progress ONLY if it belongs to the active generation and matching sessionId.
   */
  getCachedProgress(expectedSessionId?: string): PatientSessionProgressResponse | null {
    const targetSessionId = expectedSessionId ?? this.activeSessionId;
    if (
      targetSessionId === null ||
      this.cachedProgress === null ||
      this.cachedProgressGeneration !== this.lifecycleGeneration
    ) {
      return null;
    }
    if (!isMatchingSessionProgress(this.cachedProgress, targetSessionId)) {
      return null;
    }
    return this.cachedProgress;
  }

  /**
   * Binds progress to the active (or explicitly provided admitted) session lifecycle.
   * Rejects cross-session or stale progress objects cleanly without storing them.
   */
  setCachedProgress(
    progress: PatientSessionProgressResponse | null,
    context?: SessionLifecycleContext | null
  ): boolean {
    if (progress === null) {
      if (!context || this.isLifecycleAdmitted(context)) {
        this.cachedProgress = null;
        this.cachedProgressGeneration = null;
      }
      return true;
    }

    const expectedContext = context !== undefined ? context : this.getLifecycleContext();
    if (!expectedContext || !this.isLifecycleAdmitted(expectedContext)) {
      return false;
    }
    if (!isMatchingSessionProgress(progress, expectedContext.sessionId)) {
      return false;
    }

    this.cachedProgress = progress;
    this.cachedProgressGeneration = expectedContext.generation;
    return true;
  }

  clearCachedProgress(): void {
    this.cachedProgress = null;
    this.cachedProgressGeneration = null;
  }

  getActiveAccountKey(): string | null {
    return this.activeAccountKey;
  }

  getLastDiscardedWorkNotice(): DiscardedSessionWorkNotice | null {
    return this.lastDiscardedWorkNotice;
  }

  getClosureDetail(): ClinicalClosureStateDetail | null {
    return this.lastClosureDetail;
  }

  getPendingCriticalWorkSnapshot(): PendingCriticalWorkSnapshot {
    const summary = this.getSyncSummary();
    const hasActiveClosure = this.activeClosure !== null;
    const hasUncertainClosure =
      this.uncertainClosure !== null &&
      this.uncertainClosure.context.generation === this.lifecycleGeneration &&
      !this.uncertainClosure.receiptApplied;
    const hasUnresolvedActivity =
      summary.pendingActivityEvents +
        summary.uncertainActivityEvents +
        summary.conflictActivityEvents +
        summary.inFlightActivityEvents >
      0;
    const hasPendingCriticalWork =
      summary.hasPendingOrUncertainDelivery ||
      hasUnresolvedActivity ||
      hasActiveClosure ||
      hasUncertainClosure;

    return {
      sessionId: this.activeSessionId,
      accountKey: this.activeAccountKey,
      pendingActivityEvents: summary.pendingActivityEvents,
      uncertainActivityEvents: summary.uncertainActivityEvents,
      conflictActivityEvents: summary.conflictActivityEvents,
      inFlightActivityEvents: summary.inFlightActivityEvents,
      pendingTelemetryBatches: summary.pendingTelemetryBatches,
      inFlightTelemetryBatches: summary.inFlightTelemetryBatches,
      bufferedTelemetrySamples: summary.bufferedTelemetrySamples,
      pendingTrials: summary.pendingTrials,
      uncertainTrials: summary.uncertainTrials,
      inFlightTrials: summary.inFlightTrials,
      hasActiveClosure,
      hasUncertainClosure,
      hasPendingCriticalWork,
      isInMemoryOnly: true,
    };
  }

  hasPendingCriticalWork(): boolean {
    return this.getPendingCriticalWorkSnapshot().hasPendingCriticalWork;
  }

  seedActivitySequence(nextSequence: number): boolean {
    if (!this.activityQueue) {
      return false;
    }
    return this.activityQueue.seedNextSequence(nextSequence);
  }

  enqueueActivityEvent(
    buildOrBody:
      | PatientActivityEventBody
      | ((sequence: number) => PatientActivityEventBody)
  ): {
    entry: RetainedClinicalActivityEntry;
    settlement: Promise<PatientSessionProgressResponse | null>;
  } | null {
    if (!this.activityQueue) {
      return null;
    }
    return this.activityQueue.enqueue(buildOrBody);
  }

  retryPendingActivity(): Promise<PatientSessionProgressResponse | null> {
    if (!this.activityQueue) {
      return Promise.resolve(null);
    }
    return this.activityQueue.retryPending();
  }

  waitForCurrentActivityDrain(): Promise<void> {
    if (!this.activityQueue) {
      return Promise.resolve();
    }
    return this.activityQueue.waitForCurrentDrain();
  }

  hasUnresolvedClinicalActivity(): boolean {
    return Boolean(this.activityQueue?.getSummary().hasUnresolved);
  }

  getActivityQueue(): ClinicalActivityQueue | null {
    return this.activityQueue;
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
    const targetAccountKey = this.activeAccountKey;
    const targetGeneration = this.lifecycleGeneration;

    await Promise.all([
      this.drainPendingTrials(2).catch(() => null),
      this.flushTelemetry().catch(() => undefined),
    ]);

    const summary = this.getSyncSummary();

    if (
      targetSessionId !== this.activeSessionId ||
      targetAccountKey !== this.activeAccountKey ||
      targetGeneration !== this.lifecycleGeneration
    ) {
      return {
        allowedToClose: false,
        reason: 'PENDING_SYNC',
        summary,
      };
    }

    return this.evaluateGateFromSummary(forceCloseWithoutSync, summary);
  }

  /**
   * Executes Clinical session closure bound strictly to the lifecycle context captured
   * at entry, enforcing finite deadlines, session-identity cache validation,
   * and single-flight execution with exact same-key/action recovery.
   */
  closeClinicalSession(params: {
    forceCloseWithoutSync: boolean;
    closeIntent?: 'TARGET_REACHED' | 'USER_EXIT';
    retryUncertainActivity?: boolean;
    apis: ClinicalClosureApis;
    adapter: ClinicalClosureStateAdapter;
  }): Promise<ClinicalClosureOutcome> {
    const {
      forceCloseWithoutSync,
      closeIntent,
      retryUncertainActivity = false,
      apis,
      adapter,
    } = params;
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

    // If this generation already retained an uncertain closure operation, preserve its exact
    // (sessionId, completionKey, action) via the explicit recovery flow instead of switching action.
    if (
      this.uncertainClosure &&
      this.uncertainClosure.context.generation === context.generation &&
      this.uncertainClosure.context.sessionId === context.sessionId &&
      this.uncertainClosure.context.completionKey === context.completionKey
    ) {
      return this.recoverClinicalClosure({
        mode: 'VERIFY_AND_RESEND',
        apis,
        adapter,
      });
    }

    const isAdmitted = (): boolean =>
      this.isLifecycleAdmitted(context) && adapter.isMounted();

    const publishDetail = (detail: ClinicalClosureStateDetail): void => {
      if (!isAdmitted()) return;
      this.lastClosureDetail = detail;
      adapter.onClosureStateDetail?.(detail);
    };

    const run = (async (): Promise<ClinicalClosureOutcome> => {
      try {
        if (!isAdmitted()) {
          return { status: 'STALE_IGNORED' };
        }
        adapter.setCompletionState('SAVING');
        publishDetail({
          kind: 'SAVING',
          sessionId: context.sessionId,
          action: null,
          observedServerStatus: null,
          receiptAcknowledged: false,
          canRetryProgressRead: false,
          canRecoverWithSameKey: false,
          hasRetainedCompletionIdentity: false,
          message: 'Sincronizando eventos, telemetría y estado clínico de sesión...',
        });

        let gate: ClosureGateResult;
        try {
          const gateWait = this.awaitWithDeadline(
            'DELIVERY_GATE',
            this.closureGateTimeoutMs,
            async () => {
              const targetSessionId = this.activeSessionId;
              const targetAccountKey = this.activeAccountKey;
              const targetGeneration = this.lifecycleGeneration;

              await Promise.all([
                adapter.waitForActivityEvents().catch(() => undefined),
                (retryUncertainActivity
                  ? this.retryPendingActivity()
                  : this.waitForCurrentActivityDrain()
                ).catch(() => null),
                this.drainPendingTrials(2).catch(() => null),
                this.flushTelemetry().catch(() => undefined),
              ]);

              const summary = this.getSyncSummary();
              if (
                targetSessionId !== this.activeSessionId ||
                targetAccountKey !== this.activeAccountKey ||
                targetGeneration !== this.lifecycleGeneration
              ) {
                return {
                  allowedToClose: false,
                  reason: 'PENDING_SYNC' as const,
                  summary,
                };
              }

              return this.evaluateGateFromSummary(forceCloseWithoutSync, summary);
            }
          );
          gate = await gateWait.promise;
        } catch (gateErr) {
          if (!isAdmitted()) {
            return { status: 'STALE_IGNORED' };
          }
          if (gateErr instanceof ClinicalRequestTimeoutError) {
            this.activityQueue?.abortInFlightAsUncertain(gateErr.message);
          }
          const summary = this.getSyncSummary();
          adapter.setSyncSummary(summary);
          if (gateErr instanceof ClinicalRequestTimeoutError) {
            if (!forceCloseWithoutSync) {
              if (summary.hasPendingOrUncertainDelivery) {
                adapter.setCompletionState('PENDING_SYNC');
                const msg =
                  'Tiempo de espera agotado al sincronizar eventos clínicos, ensayos o telemetría pendientes. Puedes reintentar conservando la identidad exacta.';
                adapter.setBackendWarning(msg);
                publishDetail({
                  kind: 'PENDING_SYNC',
                  sessionId: context.sessionId,
                  action: null,
                  observedServerStatus: null,
                  receiptAcknowledged: false,
                  canRetryProgressRead: false,
                  canRecoverWithSameKey: false,
                  hasRetainedCompletionIdentity: false,
                  message: msg,
                });
                return {
                  status: 'PENDING_SYNC',
                  gate: { allowedToClose: false, reason: 'PENDING_SYNC', summary },
                };
              }

              const msg =
                'Tiempo de espera agotado al sincronizar los eventos de actividad clínica. No se envió el cierre; puedes reintentar.';
              adapter.setCompletionState('ERROR');
              adapter.setBackendWarning(msg);
              publishDetail({
                kind: 'PROGRESS_UNAVAILABLE',
                sessionId: context.sessionId,
                action: null,
                observedServerStatus: null,
                receiptAcknowledged: false,
                canRetryProgressRead: true,
                canRecoverWithSameKey: false,
                hasRetainedCompletionIdentity: false,
                message: msg,
              });
              return {
                status: 'ERROR',
                errorMessage: msg,
                reason: 'DELIVERY_WAIT_TIMEOUT',
                uncertain: false,
                receiptAcknowledged: false,
                gate: { allowedToClose: false, reason: 'PENDING_SYNC', summary },
              };
            }
            // Forced analytics close leaves hung delivery gate cleanly, then strictly
            // proceeds into bounded Clinical progress read + completion deadlines.
            gate = this.evaluateGateFromSummary(true, summary);
          } else {
            throw gateErr;
          }
        }

        if (!isAdmitted()) {
          return { status: 'STALE_IGNORED' };
        }

        adapter.setSyncSummary(gate.summary);

        // POST-REP-01: if a Clinical activity event hit 409 Conflict, halt automatic
        // progression, read fresh progress for the original session, and surface conflict
        // without fabricating credit or auto-converting a normal completion into ABANDONED.
        if (
          !forceCloseWithoutSync &&
          gate.summary.conflictActivityEvents > 0 &&
          closeIntent !== 'USER_EXIT'
        ) {
          let conflictObservedStatus: PatientTherapySessionStatus | null = null;
          try {
            const refreshAttempt = this.awaitWithDeadline(
              'RECOVERY_PROGRESS',
              this.clinicalRequestTimeoutMs,
              (signal) => apis.getSessionProgress(context.sessionId, { signal })
            );
            const refreshed = await refreshAttempt.promise;
            if (isAdmitted() && isMatchingSessionProgress(refreshed, context.sessionId)) {
              conflictObservedStatus = refreshed.status;
              this.setCachedProgress(refreshed, context);
              adapter.setCachedProgress(refreshed);
              adapter.onSessionProgressUpdate?.(refreshed);
            }
          } catch {
            if (!isAdmitted()) {
              return { status: 'STALE_IGNORED' };
            }
          }

          if (!isAdmitted()) {
            return { status: 'STALE_IGNORED' };
          }

          const msg = `Conflicto (409) en evento de actividad clínica pendiente${
            conflictObservedStatus ? ` · Estado en servidor: ${conflictObservedStatus}` : ''
          }. Se detuvo la progresión automática sin renumerar el evento ni fabricar completitud.`;
          adapter.setCompletionState('ERROR');
          adapter.setBackendWarning(msg);
          publishDetail({
            kind: 'CONFLICT',
            sessionId: context.sessionId,
            action: null,
            observedServerStatus: conflictObservedStatus,
            receiptAcknowledged: false,
            canRetryProgressRead: true,
            canRecoverWithSameKey: false,
            hasRetainedCompletionIdentity: false,
            message: msg,
          });
          return {
            status: 'ERROR',
            errorMessage: msg,
            reason: 'ACTIVITY_CONFLICT',
            uncertain: false,
            observedServerStatus: conflictObservedStatus,
            receiptAcknowledged: false,
            gate: { allowedToClose: false, reason: 'PENDING_SYNC', summary: gate.summary },
          };
        }

        if (!gate.allowedToClose) {
          const msg =
            gate.summary.pendingActivityEvents + gate.summary.uncertainActivityEvents > 0
              ? 'Hay eventos de actividad clínica sin confirmar antes de cerrar la sesión. Reintenta para preservar las repeticiones.'
              : 'Hay ensayos o lotes de telemetría pendientes o con estado incierto antes de cerrar la sesión clínica.';
          adapter.setCompletionState('PENDING_SYNC');
          adapter.setBackendWarning(msg);
          publishDetail({
            kind: 'PENDING_SYNC',
            sessionId: context.sessionId,
            action: null,
            observedServerStatus: null,
            receiptAcknowledged: false,
            canRetryProgressRead: false,
            canRecoverWithSameKey: false,
            hasRetainedCompletionIdentity: false,
            message: msg,
          });
          return { status: 'PENDING_SYNC', gate };
        }

        // Strict LIFE-CACHE-01: clear any foreign/unvalidated adapter cache if needed,
        // and NEVER fall back to cached progress when Clinical GET /progress fails or times out.
        const currentAdapterCache = adapter.getCachedProgress();
        if (
          currentAdapterCache &&
          !isMatchingSessionProgress(currentAdapterCache, context.sessionId)
        ) {
          adapter.clearCachedProgress?.();
        }

        let fetchedProgress: PatientSessionProgressResponse;
        try {
          const progressAttempt = this.awaitWithDeadline(
            'GET_PROGRESS',
            this.clinicalRequestTimeoutMs,
            (signal) => apis.getSessionProgress(context.sessionId, { signal })
          );
          fetchedProgress = await progressAttempt.promise;
        } catch (progressErr) {
          if (!isAdmitted()) {
            return { status: 'STALE_IGNORED' };
          }
          const isTimeout = progressErr instanceof ClinicalRequestTimeoutError;
          const formatted = formatClosureError(progressErr, adapter.formatError);
          const msg = `No se pudo verificar el progreso clínico de la sesión (no se envió cierre ni se usó caché alternativo): ${formatted}`;
          adapter.setCompletionState('ERROR');
          adapter.setBackendWarning(msg);
          publishDetail({
            kind: 'PROGRESS_UNAVAILABLE',
            sessionId: context.sessionId,
            action: null,
            observedServerStatus: null,
            receiptAcknowledged: false,
            canRetryProgressRead: true,
            canRecoverWithSameKey: false,
            hasRetainedCompletionIdentity: false,
            message: msg,
          });
          return {
            status: 'ERROR',
            errorMessage: msg,
            reason: isTimeout ? 'PROGRESS_TIMEOUT' : 'PROGRESS_UNAVAILABLE',
            uncertain: false,
            receiptAcknowledged: false,
            gate,
          };
        }

        if (!isAdmitted()) {
          return { status: 'STALE_IGNORED' };
        }

        if (!isMatchingSessionProgress(fetchedProgress, context.sessionId)) {
          const msg =
            'El backend devolvió un progreso perteneciente a otra sesión distinta; se bloqueó el cierre para evitar contaminación entre sesiones.';
          adapter.setCompletionState('ERROR');
          adapter.setBackendWarning(msg);
          publishDetail({
            kind: 'PROGRESS_UNAVAILABLE',
            sessionId: context.sessionId,
            action: null,
            observedServerStatus: null,
            receiptAcknowledged: false,
            canRetryProgressRead: true,
            canRecoverWithSameKey: false,
            hasRetainedCompletionIdentity: false,
            message: msg,
          });
          return {
            status: 'ERROR',
            errorMessage: msg,
            reason: 'PROGRESS_SESSION_MISMATCH',
            uncertain: false,
            receiptAcknowledged: false,
            gate,
          };
        }

        this.setCachedProgress(fetchedProgress, context);
        adapter.setCachedProgress(fetchedProgress);

        if (fetchedProgress.status !== 'ACTIVE') {
          if (
            (fetchedProgress.status === 'FAILED_TECHNICAL' ||
              fetchedProgress.status === 'CANCELLED') &&
            closeIntent === 'TARGET_REACHED'
          ) {
            if (!isAdmitted()) {
              return { status: 'STALE_IGNORED' };
            }
            const msg = `La sesión ya figuraba cerrada/expirada en el servidor (${fetchedProgress.status}) antes de confirmar el cierre; no se fabricó completitud.`;
            adapter.setCompletionState('ERROR');
            adapter.setBackendWarning(msg);
            publishDetail({
              kind: 'OBSERVED_SERVER_STATE',
              sessionId: context.sessionId,
              action: null,
              observedServerStatus: fetchedProgress.status,
              receiptAcknowledged: false,
              canRetryProgressRead: false,
              canRecoverWithSameKey: false,
              hasRetainedCompletionIdentity: false,
              message: msg,
            });
            adapter.onSessionProgressUpdate?.(fetchedProgress);
            return {
              status: 'ERROR',
              errorMessage: msg,
              reason: 'SESSION_EXPIRED',
              uncertain: false,
              observedServerStatus: fetchedProgress.status,
              receiptAcknowledged: false,
              gate,
            };
          }

          const mapped: 'FINISHED' | 'ABANDONED' =
            fetchedProgress.status === 'COMPLETED' ? 'FINISHED' : 'ABANDONED';
          if (!isAdmitted()) {
            return { status: 'STALE_IGNORED' };
          }
          adapter.setCompletionState(mapped);
          publishDetail({
            kind: 'OBSERVED_SERVER_STATE',
            sessionId: context.sessionId,
            action: null,
            observedServerStatus: fetchedProgress.status,
            receiptAcknowledged: false,
            canRetryProgressRead: false,
            canRecoverWithSameKey: false,
            hasRetainedCompletionIdentity: false,
            message: `La sesión ya figuraba en estado terminal (${fetchedProgress.status}) en el servidor.`,
          });
          adapter.onSessionProgressUpdate?.(fetchedProgress);
          adapter.onSessionCompleted?.(fetchedProgress, mapped);
          return {
            status: mapped,
            progress: fetchedProgress,
            gate,
            receiptAcknowledged: false,
          };
        }

        // POST-REP-01 Rule 6: Never automatically convert `targetReached === false`
        // into `ABANDONED` when closure was initiated for normal target completion
        // (e.g. after a >15s RESUME_REQUIRED gap discarded an uncredited repetition).
        if (!fetchedProgress.targetReached && closeIntent === 'TARGET_REACHED') {
          if (!isAdmitted()) {
            return { status: 'STALE_IGNORED' };
          }
          adapter.onSessionProgressUpdate?.(fetchedProgress);
          const progressText =
            fetchedProgress.criterion === 'REPETITIONS'
              ? `${fetchedProgress.completedRepetitions} / ${fetchedProgress.target} repeticiones acreditadas`
              : `${Math.round(fetchedProgress.activeMilliseconds / 1000)} / ${fetchedProgress.target} s activos acreditados`;
          const gapHint =
            fetchedProgress.activityState === 'RESUME_REQUIRED'
              ? ' tras pausa por inactividad (>15s, RESUME_REQUIRED)'
              : '';
          const msg = `La meta técnica aún no figura alcanzada en el servidor (${progressText}${gapHint}). No se convirtió automáticamente en ABANDONED; puedes reanudar el ejercicio o abandonar explícitamente.`;
          adapter.setCompletionState('ERROR');
          adapter.setBackendWarning(msg);
          publishDetail({
            kind: 'TARGET_NOT_REACHED',
            sessionId: context.sessionId,
            action: null,
            observedServerStatus: fetchedProgress.status,
            receiptAcknowledged: false,
            canRetryProgressRead: true,
            canRecoverWithSameKey: false,
            hasRetainedCompletionIdentity: false,
            message: msg,
          });
          return {
            status: 'ERROR',
            errorMessage: msg,
            reason: 'TARGET_NOT_REACHED',
            uncertain: false,
            observedServerStatus: fetchedProgress.status,
            receiptAcknowledged: false,
            gate,
          };
        }

        const action: 'FINISHED' | 'ABANDONED' = fetchedProgress.targetReached
          ? 'FINISHED'
          : 'ABANDONED';

        // Synchronous admission check immediately prior to HTTP dispatch
        if (!isAdmitted()) {
          return { status: 'STALE_IGNORED' };
        }

        const op: RetainedClosureOperation = {
          context,
          action,
          attemptSeq: 1,
          receiptApplied: false,
          conflictDetected: false,
          observedServerStatus: fetchedProgress.status,
          lastProgress: fetchedProgress,
        };
        this.uncertainClosure = op;
        this.notifySyncSummaryChange();

        return await this.dispatchAndSettleCompletion({
          op,
          capturedAttemptSeq: op.attemptSeq,
          gate,
          apis,
          adapter,
          isAdmitted,
          publishDetail,
        });
      } finally {
        if (this.activeClosure?.generation === context.generation) {
          this.activeClosure = null;
          this.notifySyncSummaryChange();
        }
      }
    })();

    this.activeClosure = { generation: context.generation, promise: run };
    this.notifySyncSummaryChange();
    return run;
  }

  /**
   * Explicitly recovers or verifies an uncertain/failed completion using ONLY the
   * originally captured (sessionId, completionKey, action). Never fabricates a new key,
   * never switches FINISHED <-> ABANDONED, and coalesces concurrent recovery clicks.
   */
  recoverClinicalClosure(params: {
    mode?: 'VERIFY_ONLY' | 'VERIFY_AND_RESEND';
    apis: ClinicalClosureApis;
    adapter: ClinicalClosureStateAdapter;
  }): Promise<ClinicalClosureOutcome> {
    const { mode = 'VERIFY_AND_RESEND', apis, adapter } = params;
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

    const op = this.uncertainClosure;
    if (
      !op ||
      op.context.generation !== context.generation ||
      op.context.sessionId !== context.sessionId ||
      op.context.completionKey !== context.completionKey
    ) {
      if (mode === 'VERIFY_AND_RESEND') {
        return this.closeClinicalSession({
          forceCloseWithoutSync: false,
          apis,
          adapter,
        });
      }
    }

    const isAdmitted = (): boolean =>
      this.isLifecycleAdmitted(context) && adapter.isMounted();

    const publishDetail = (detail: ClinicalClosureStateDetail): void => {
      if (!isAdmitted()) return;
      this.lastClosureDetail = detail;
      adapter.onClosureStateDetail?.(detail);
    };

    const run = (async (): Promise<ClinicalClosureOutcome> => {
      try {
        if (!isAdmitted()) {
          return { status: 'STALE_IGNORED' };
        }

        const gate = this.evaluateGateFromSummary(true, this.getSyncSummary());
        adapter.setSyncSummary(gate.summary);

        // No prior dispatched uncertain operation: VERIFY_ONLY performs a bounded read
        // without calling completeSession or fabricating completion callbacks.
        if (
          !op ||
          op.context.generation !== context.generation ||
          op.context.sessionId !== context.sessionId
        ) {
          adapter.setCompletionState('SAVING');
          let readProgress: PatientSessionProgressResponse;
          try {
            const readAttempt = this.awaitWithDeadline(
              'RECOVERY_PROGRESS',
              this.clinicalRequestTimeoutMs,
              (signal) => apis.getSessionProgress(context.sessionId, { signal })
            );
            readProgress = await readAttempt.promise;
          } catch (err) {
            if (!isAdmitted()) {
              return { status: 'STALE_IGNORED' };
            }
            const formatted = formatClosureError(err, adapter.formatError);
            const msg = `No se pudo verificar el estado de la sesión en servidor: ${formatted}`;
            adapter.setCompletionState('ERROR');
            adapter.setBackendWarning(msg);
            publishDetail({
              kind: 'PROGRESS_UNAVAILABLE',
              sessionId: context.sessionId,
              action: null,
              observedServerStatus: null,
              receiptAcknowledged: false,
              canRetryProgressRead: true,
              canRecoverWithSameKey: false,
              hasRetainedCompletionIdentity: false,
              message: msg,
            });
            return {
              status: 'ERROR',
              errorMessage: msg,
              reason: 'RECOVERY_PROGRESS_FAILED',
              uncertain: false,
              receiptAcknowledged: false,
              gate,
            };
          }

          if (!isAdmitted()) {
            return { status: 'STALE_IGNORED' };
          }
          if (!isMatchingSessionProgress(readProgress, context.sessionId)) {
            const msg =
              'La lectura de progreso devolvió otro therapySessionId distinto; se rechazó la respuesta.';
            adapter.setCompletionState('ERROR');
            adapter.setBackendWarning(msg);
            return {
              status: 'ERROR',
              errorMessage: msg,
              reason: 'PROGRESS_SESSION_MISMATCH',
              uncertain: false,
              receiptAcknowledged: false,
              gate,
            };
          }

          this.setCachedProgress(readProgress, context);
          adapter.setCachedProgress(readProgress);
          adapter.onSessionProgressUpdate?.(readProgress);
          const msg = `Estado observado en servidor: ${readProgress.status}.`;
          publishDetail({
            kind: 'OBSERVED_SERVER_STATE',
            sessionId: context.sessionId,
            action: null,
            observedServerStatus: readProgress.status,
            receiptAcknowledged: false,
            canRetryProgressRead: true,
            canRecoverWithSameKey: false,
            hasRetainedCompletionIdentity: false,
            message: msg,
          });
          adapter.setCompletionState('ERROR');
          return {
            status: 'ERROR',
            errorMessage: msg,
            reason: 'PROGRESS_UNAVAILABLE',
            uncertain: false,
            observedServerStatus: readProgress.status,
            receiptAcknowledged: false,
            gate,
          };
        }

        if (op.receiptApplied && op.lastProgress) {
          return {
            status: op.action,
            progress: op.lastProgress,
            gate,
            receiptAcknowledged: true,
          };
        }

        adapter.setCompletionState('SAVING');
        op.attemptSeq += 1;
        const capturedAttemptSeq = op.attemptSeq;

        let readProgress: PatientSessionProgressResponse;
        try {
          const readAttempt = this.awaitWithDeadline(
            'RECOVERY_PROGRESS',
            this.clinicalRequestTimeoutMs,
            (signal) => apis.getSessionProgress(op.context.sessionId, { signal })
          );
          readProgress = await readAttempt.promise;
        } catch (err) {
          if (!isAdmitted()) {
            return { status: 'STALE_IGNORED', dispatchedWithKey: op.context.completionKey };
          }
          if (op.receiptApplied && op.lastProgress) {
            return {
              status: op.action,
              progress: op.lastProgress,
              gate,
              receiptAcknowledged: true,
            };
          }
          const formatted = formatClosureError(err, adapter.formatError);
          const msg = `No se pudo verificar el estado de la sesión original durante la recuperación (identidad conservada): ${formatted}`;
          adapter.setCompletionState('ERROR');
          adapter.setBackendWarning(msg);
          publishDetail({
            kind: op.conflictDetected ? 'CONFLICT' : 'UNCERTAIN_COMPLETION',
            sessionId: op.context.sessionId,
            action: op.action,
            observedServerStatus: op.observedServerStatus,
            receiptAcknowledged: false,
            canRetryProgressRead: true,
            canRecoverWithSameKey: !op.conflictDetected,
            hasRetainedCompletionIdentity: true,
            message: msg,
          });
          return {
            status: 'ERROR',
            errorMessage: msg,
            reason: op.conflictDetected
              ? 'COMPLETION_CONFLICT'
              : 'RECOVERY_PROGRESS_FAILED',
            uncertain: !op.conflictDetected,
            dispatchedWithKey: op.context.completionKey,
            dispatchedAction: op.action,
            observedServerStatus: op.observedServerStatus,
            receiptAcknowledged: false,
            gate,
          };
        }

        if (!isAdmitted()) {
          return { status: 'STALE_IGNORED', dispatchedWithKey: op.context.completionKey };
        }

        // If the original timed-out HTTP PUT succeeded and applied while GET was in flight:
        if (op.receiptApplied && op.lastProgress) {
          return {
            status: op.action,
            progress: op.lastProgress,
            gate,
            receiptAcknowledged: true,
          };
        }

        if (!isMatchingSessionProgress(readProgress, op.context.sessionId)) {
          const msg =
            'La lectura de recuperación devolvió un therapySessionId distinto al original; respuesta descartada sin fabricar cierre.';
          adapter.setCompletionState('ERROR');
          adapter.setBackendWarning(msg);
          publishDetail({
            kind: 'UNCERTAIN_COMPLETION',
            sessionId: op.context.sessionId,
            action: op.action,
            observedServerStatus: op.observedServerStatus,
            receiptAcknowledged: false,
            canRetryProgressRead: true,
            canRecoverWithSameKey: !op.conflictDetected,
            hasRetainedCompletionIdentity: true,
            message: msg,
          });
          return {
            status: 'ERROR',
            errorMessage: msg,
            reason: 'PROGRESS_SESSION_MISMATCH',
            uncertain: true,
            dispatchedWithKey: op.context.completionKey,
            dispatchedAction: op.action,
            observedServerStatus: op.observedServerStatus,
            receiptAcknowledged: false,
            gate,
          };
        }

        op.observedServerStatus = readProgress.status;
        op.lastProgress = readProgress;
        this.setCachedProgress(readProgress, op.context);
        adapter.setCachedProgress(readProgress);
        adapter.onSessionProgressUpdate?.(readProgress);

        if (op.conflictDetected) {
          const msg = `Conflicto (409) al confirmar el cierre con acción ${op.action}. Estado observado en servidor: ${readProgress.status}. Posibles causas: expiración previa, meta técnica no cumplida, estado terminal previo o cierre registrado con otra clave/acción.`;
          adapter.setCompletionState('ERROR');
          adapter.setBackendWarning(msg);
          publishDetail({
            kind: 'CONFLICT',
            sessionId: op.context.sessionId,
            action: op.action,
            observedServerStatus: readProgress.status,
            receiptAcknowledged: false,
            canRetryProgressRead: true,
            canRecoverWithSameKey: false,
            hasRetainedCompletionIdentity: true,
            message: msg,
          });
          return {
            status: 'ERROR',
            errorMessage: msg,
            reason: 'COMPLETION_CONFLICT',
            uncertain: false,
            dispatchedWithKey: op.context.completionKey,
            dispatchedAction: op.action,
            observedServerStatus: readProgress.status,
            receiptAcknowledged: false,
            gate,
          };
        }

        if (mode === 'VERIFY_ONLY') {
          const msg =
            readProgress.status === 'ACTIVE'
              ? `Estado observado en servidor: ACTIVE. La operación previa (${op.action}) sigue sin comprobante confirmado; puedes reenviar con la misma clave idempotente.`
              : `Estado observado en servidor: ${readProgress.status}. Este GET no confirma si el comprobante corresponde a esta solicitud; reenvía exactamente la misma clave y acción (${op.action}) para confirmar el receipt.`;
          adapter.setCompletionState('ERROR');
          adapter.setBackendWarning(msg);
          publishDetail({
            kind: 'OBSERVED_SERVER_STATE',
            sessionId: op.context.sessionId,
            action: op.action,
            observedServerStatus: readProgress.status,
            receiptAcknowledged: false,
            canRetryProgressRead: true,
            canRecoverWithSameKey: true,
            hasRetainedCompletionIdentity: true,
            message: msg,
          });
          return {
            status: 'ERROR',
            errorMessage: msg,
            reason: 'COMPLETION_UNCERTAIN',
            uncertain: true,
            dispatchedWithKey: op.context.completionKey,
            dispatchedAction: op.action,
            observedServerStatus: readProgress.status,
            receiptAcknowledged: false,
            gate,
          };
        }

        // Exact same sessionId, action, and completionKey replay
        if (!isAdmitted()) {
          return { status: 'STALE_IGNORED', dispatchedWithKey: op.context.completionKey };
        }

        return await this.dispatchAndSettleCompletion({
          op,
          capturedAttemptSeq,
          gate,
          apis,
          adapter,
          isAdmitted,
          publishDetail,
        });
      } finally {
        if (this.activeClosure?.generation === context.generation) {
          this.activeClosure = null;
          this.notifySyncSummaryChange();
        }
      }
    })();

    this.activeClosure = { generation: context.generation, promise: run };
    this.notifySyncSummaryChange();
    return run;
  }

  private async dispatchAndSettleCompletion(params: {
    op: RetainedClosureOperation;
    capturedAttemptSeq: number;
    gate: ClosureGateResult;
    apis: ClinicalClosureApis;
    adapter: ClinicalClosureStateAdapter;
    isAdmitted: () => boolean;
    publishDetail: (detail: ClinicalClosureStateDetail) => void;
  }): Promise<ClinicalClosureOutcome> {
    const {
      op,
      capturedAttemptSeq,
      gate,
      apis,
      adapter,
      isAdmitted,
      publishDetail,
    } = params;

    const applyConfirmedReceiptOnce = (
      receipt: PatientSessionProgressResponse
    ): ClinicalClosureOutcome | null => {
      if (!isAdmitted()) {
        return {
          status: 'STALE_IGNORED',
          dispatchedWithKey: op.context.completionKey,
        };
      }
      if (!isMatchingSessionProgress(receipt, op.context.sessionId)) {
        return null;
      }
      if (op.receiptApplied) {
        return {
          status: op.action,
          progress: op.lastProgress ?? receipt,
          gate,
          receiptAcknowledged: true,
        };
      }

      op.receiptApplied = true;
      op.conflictDetected = false;
      op.observedServerStatus = receipt.status;
      op.lastProgress = receipt;
      this.setCachedProgress(receipt, op.context);
      adapter.setCachedProgress(receipt);
      adapter.setCompletionState(op.action);
      publishDetail({
        kind: op.action === 'FINISHED' ? 'COMPLETED' : 'ABANDONED',
        sessionId: op.context.sessionId,
        action: op.action,
        observedServerStatus: receipt.status,
        receiptAcknowledged: true,
        canRetryProgressRead: false,
        canRecoverWithSameKey: false,
        hasRetainedCompletionIdentity: true,
        message: `Cierre confirmado (${receipt.status}) con comprobante idempotente válido.`,
      });
      adapter.onSessionProgressUpdate?.(receipt);
      adapter.onSessionCompleted?.(receipt, op.action);
      this.notifySyncSummaryChange();
      return {
        status: op.action,
        progress: receipt,
        gate,
        receiptAcknowledged: true,
      };
    };

    const completionAttempt = this.awaitWithDeadline(
      'COMPLETE_SESSION',
      this.clinicalRequestTimeoutMs,
      (signal) =>
        apis.completeSession(
          op.context.sessionId,
          { action: op.action },
          op.context.completionKey,
          { signal }
        )
    );

    // If this HTTP PUT timed out locally yet commits and resolves later while this exact lifecycle
    // is still admitted (and hasn't conflicted or already confirmed), apply its receipt at most once.
    void completionAttempt.rawPromise
      .then((lateReceipt) => {
        if (!isAdmitted()) return;
        if (this.uncertainClosure !== op) return;
        if (op.receiptApplied || op.conflictDetected) return;
        if (this.activeClosure && this.activeClosure.generation === op.context.generation) {
          // If an explicit recovery attempt is not yet resolved, let the late receipt confirm
          // idempotently only when it matches the original session.
          applyConfirmedReceiptOnce(lateReceipt);
          return;
        }
        applyConfirmedReceiptOnce(lateReceipt);
      })
      .catch(() => undefined);

    try {
      const completed = await completionAttempt.promise;
      if (!isAdmitted()) {
        return {
          status: 'STALE_IGNORED',
          dispatchedWithKey: op.context.completionKey,
        };
      }

      if (!isMatchingSessionProgress(completed, op.context.sessionId)) {
        const msg =
          'La respuesta de cierre clínico no coincide con el therapySessionId esperado; resultado tratado como incierto.';
        adapter.setCompletionState('ERROR');
        adapter.setBackendWarning(msg);
        publishDetail({
          kind: 'UNCERTAIN_COMPLETION',
          sessionId: op.context.sessionId,
          action: op.action,
          observedServerStatus: op.observedServerStatus,
          receiptAcknowledged: false,
          canRetryProgressRead: true,
          canRecoverWithSameKey: true,
          hasRetainedCompletionIdentity: true,
          message: msg,
        });
        return {
          status: 'ERROR',
          errorMessage: msg,
          reason: 'COMPLETION_RESPONSE_MISMATCH',
          uncertain: true,
          dispatchedWithKey: op.context.completionKey,
          dispatchedAction: op.action,
          observedServerStatus: op.observedServerStatus,
          receiptAcknowledged: false,
          gate,
        };
      }

      const applied = applyConfirmedReceiptOnce(completed);
      if (applied) {
        return applied;
      }
      return {
        status: op.action,
        progress: completed,
        gate,
        receiptAcknowledged: true,
      };
    } catch (err) {
      if (!isAdmitted()) {
        return {
          status: 'STALE_IGNORED',
          dispatchedWithKey: op.context.completionKey,
        };
      }

      // If an earlier timed-out attempt resolved and already confirmed the receipt, do not clobber it.
      if (op.receiptApplied && op.lastProgress) {
        return {
          status: op.action,
          progress: op.lastProgress,
          gate,
          receiptAcknowledged: true,
        };
      }

      // Guard against an older attempt settling after a newer recovery attempt superseded it.
      if (op.attemptSeq !== capturedAttemptSeq) {
        return {
          status: 'STALE_IGNORED',
          dispatchedWithKey: op.context.completionKey,
        };
      }

      const httpStatus = extractHttpStatus(err);
      const formatted = formatClosureError(err, adapter.formatError);

      if (httpStatus === 409) {
        op.conflictDetected = true;
        // Best-effort refresh of original session state without replacing key/action
        try {
          const refreshAttempt = this.awaitWithDeadline(
            'RECOVERY_PROGRESS',
            this.clinicalRequestTimeoutMs,
            (signal) => apis.getSessionProgress(op.context.sessionId, { signal })
          );
          const refreshed = await refreshAttempt.promise;
          if (
            isAdmitted() &&
            isMatchingSessionProgress(refreshed, op.context.sessionId)
          ) {
            op.observedServerStatus = refreshed.status;
            op.lastProgress = refreshed;
            this.setCachedProgress(refreshed, op.context);
            adapter.setCachedProgress(refreshed);
            adapter.onSessionProgressUpdate?.(refreshed);
          }
        } catch {
          if (!isAdmitted()) {
            return {
              status: 'STALE_IGNORED',
              dispatchedWithKey: op.context.completionKey,
            };
          }
        }

        if (!isAdmitted()) {
          return {
            status: 'STALE_IGNORED',
            dispatchedWithKey: op.context.completionKey,
          };
        }

        const msg = `Conflicto al cerrar sesión (409) con acción ${op.action}${
          op.observedServerStatus ? ` · Estado en servidor: ${op.observedServerStatus}` : ''
        }. Causas posibles: lease expirado, meta técnica no alcanzada, estado terminal previo o cierre con otra clave/acción.`;
        adapter.setCompletionState('ERROR');
        adapter.setBackendWarning(msg);
        publishDetail({
          kind: 'CONFLICT',
          sessionId: op.context.sessionId,
          action: op.action,
          observedServerStatus: op.observedServerStatus,
          receiptAcknowledged: false,
          canRetryProgressRead: true,
          canRecoverWithSameKey: false,
          hasRetainedCompletionIdentity: true,
          message: msg,
        });
        return {
          status: 'ERROR',
          errorMessage: msg,
          reason: 'COMPLETION_CONFLICT',
          uncertain: false,
          dispatchedWithKey: op.context.completionKey,
          dispatchedAction: op.action,
          observedServerStatus: op.observedServerStatus,
          receiptAcknowledged: false,
          gate,
        };
      }

      if (httpStatus === 401 || httpStatus === 403) {
        const msg = `Autenticación o permisos requeridos al confirmar cierre (${httpStatus}). Se conserva la identidad original en memoria para esta cuenta.`;
        adapter.setCompletionState('ERROR');
        adapter.setBackendWarning(msg);
        publishDetail({
          kind: 'AUTH_ERROR',
          sessionId: op.context.sessionId,
          action: op.action,
          observedServerStatus: op.observedServerStatus,
          receiptAcknowledged: false,
          canRetryProgressRead: true,
          canRecoverWithSameKey: true,
          hasRetainedCompletionIdentity: true,
          message: msg,
        });
        return {
          status: 'ERROR',
          errorMessage: msg,
          reason: 'COMPLETION_AUTH_ERROR',
          uncertain: true,
          dispatchedWithKey: op.context.completionKey,
          dispatchedAction: op.action,
          observedServerStatus: op.observedServerStatus,
          receiptAcknowledged: false,
          gate,
        };
      }

      const isTimeout = err instanceof ClinicalRequestTimeoutError;
      const msg = isTimeout
        ? `Tiempo de espera agotado al confirmar el cierre (${op.action}); la transacción remota puede haberse ejecutado. Se conserva la clave idempotente original para verificar y recuperar.`
        : `Resultado incierto al confirmar cierre (${formatted}). No se asume reversión; se conserva la clave idempotente original para verificar y recuperar.`;
      adapter.setCompletionState('ERROR');
      adapter.setBackendWarning(`Cierre de sesión: ${formatted}`);
      publishDetail({
        kind: 'UNCERTAIN_COMPLETION',
        sessionId: op.context.sessionId,
        action: op.action,
        observedServerStatus: op.observedServerStatus,
        receiptAcknowledged: false,
        canRetryProgressRead: true,
        canRecoverWithSameKey: true,
        hasRetainedCompletionIdentity: true,
        message: msg,
      });
      return {
        status: 'ERROR',
        errorMessage: formatted,
        reason: isTimeout ? 'COMPLETION_TIMEOUT' : 'COMPLETION_UNCERTAIN',
        uncertain: true,
        dispatchedWithKey: op.context.completionKey,
        dispatchedAction: op.action,
        observedServerStatus: op.observedServerStatus,
        receiptAcknowledged: false,
        gate,
      };
    }
  }

  private evaluateGateFromSummary(
    forceCloseWithoutSync: boolean,
    summary: SessionSyncSummary
  ): ClosureGateResult {
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

  private awaitWithDeadline<T>(
    stage: ClinicalDeadlineStage,
    timeoutMs: number,
    fn: (signal: AbortSignal) => Promise<T>
  ): { promise: Promise<T>; rawPromise: Promise<T>; abortController: AbortController } {
    const abortController = new AbortController();
    let rawPromise: Promise<T>;
    try {
      rawPromise = fn(abortController.signal);
    } catch (syncErr) {
      rawPromise = Promise.reject(syncErr);
    }

    // Attach silent catch so a rejection settling after local timeout never triggers unhandledRejection
    rawPromise.catch(() => undefined);

    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const timeoutErr = new ClinicalRequestTimeoutError(stage, timeoutMs);
        try {
          abortController.abort(timeoutErr);
        } catch {
          // Ignore environments with strict AbortSignal semantics
        }
        reject(timeoutErr);
      }, timeoutMs);
    });

    const promise = Promise.race([rawPromise, timeoutPromise]).finally(() => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    });

    return { promise, rawPromise, abortController };
  }

  getSyncSummary(): SessionSyncSummary {
    const activitySummary = this.activityQueue?.getSummary();
    const trialSummary = this.trialQueue?.getSummary();
    const telemetrySnap = this.telemetryQueue?.getSnapshot();

    const confirmedActivityEvents = activitySummary?.confirmedCount ?? 0;
    const pendingActivityEvents = activitySummary?.pendingCount ?? 0;
    const uncertainActivityEvents = activitySummary?.uncertainCount ?? 0;
    const conflictActivityEvents = activitySummary?.conflictCount ?? 0;
    const inFlightActivityEvents = activitySummary?.inFlightCount ?? 0;

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
      pendingActivityEvents > 0 ||
      uncertainActivityEvents > 0 ||
      inFlightActivityEvents > 0 ||
      pendingTrials > 0 ||
      uncertainTrials > 0 ||
      inFlightTrials > 0 ||
      pendingTelemetryBatches > 0 ||
      inFlightTelemetryBatches > 0 ||
      bufferedTelemetrySamples > 0;

    const hasPermanentDataLoss =
      conflictActivityEvents > 0 ||
      failedPermanentTrials > 0 ||
      permanentRejectedTelemetryBatches > 0 ||
      droppedOverflowTelemetryBatches > 0;

    const isSyncComplete =
      !hasPendingOrUncertainDelivery && !hasPermanentDataLoss;

    const activityWarning = activitySummary?.lastWarning ?? null;
    const trialWarning = trialSummary?.lastWarning ?? null;
    const telemetryWarning = telemetrySnap?.lastWarning ?? null;
    let lastWarning: string | null = null;
    if (this.lastWarningSource === 'activity' && activityWarning !== null) {
      lastWarning = activityWarning;
    } else if (this.lastWarningSource === 'telemetry' && telemetryWarning !== null) {
      lastWarning = telemetryWarning;
    } else if (this.lastWarningSource === 'trial' && trialWarning !== null) {
      lastWarning = trialWarning;
    } else {
      lastWarning = activityWarning ?? trialWarning ?? telemetryWarning;
    }

    return {
      sessionId: this.activeSessionId,
      confirmedActivityEvents,
      pendingActivityEvents,
      uncertainActivityEvents,
      conflictActivityEvents,
      inFlightActivityEvents,
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
    const pendingBefore = this.getPendingCriticalWorkSnapshot();
    if (this.activeSessionId !== null && pendingBefore.hasPendingCriticalWork) {
      const notice: DiscardedSessionWorkNotice = {
        discardedSessionId: this.activeSessionId,
        discardedAccountKey: this.activeAccountKey,
        nextSessionId: null,
        nextAccountKey: null,
        reason: 'DISPOSE',
        snapshot: pendingBefore,
      };
      this.lastDiscardedWorkNotice = notice;
      this.options.onPendingWorkDiscarded?.(notice);
    }

    this.lifecycleGeneration += 1;
    this.activeClosure = null;
    this.uncertainClosure = null;
    this.cachedProgress = null;
    this.cachedProgressGeneration = null;
    this.lastClosureDetail = null;
    this.activityQueue?.dispose();
    this.telemetryQueue?.dispose();
    this.trialQueue?.dispose();
    this.activityQueue = null;
    this.telemetryQueue = null;
    this.trialQueue = null;
    this.activeSessionId = null;
    this.activeAccountKey = null;
    this.completionKey = null;
    this.isMouseFallback = false;
    this.lastWarningSource = null;
    this.lastObservedActivityWarning = null;
    this.lastObservedTrialWarning = null;
    this.lastObservedTelemetryWarning = null;
  }

  private notifySyncSummaryChange(): void {
    this.options.onSyncSummaryChange?.(this.getSyncSummary());
  }
}
