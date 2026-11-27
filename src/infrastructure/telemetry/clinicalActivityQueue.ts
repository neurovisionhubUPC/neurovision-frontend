import { ApiError } from '../api/httpClient.ts';
import type {
  PatientActivityEventBody,
  PatientSessionProgressResponse,
} from '../api/contracts/clinical.contracts.ts';

export const DEFAULT_ACTIVITY_REQUEST_TIMEOUT_MS = 15_000;

export class ClinicalActivityTimeoutError extends Error {
  readonly timeoutMs: number;
  readonly eventId: string;

  constructor(eventId: string, timeoutMs: number) {
    super(
      `Tiempo de espera agotado (${timeoutMs} ms) al enviar evento de actividad clínica (${eventId}).`
    );
    this.name = 'ClinicalActivityTimeoutError';
    this.eventId = eventId;
    this.timeoutMs = timeoutMs;
  }
}

export type ClinicalActivityEntryState =
  | 'PENDING'
  | 'IN_FLIGHT'
  | 'UNCERTAIN'
  | 'CONFLICT'
  | 'AUTH_ERROR';

export interface RetainedClinicalActivityEntry {
  readonly body: Readonly<PatientActivityEventBody>;
  readonly sessionId: string;
  readonly accountKey: string | null;
  readonly generation: number;
  state: ClinicalActivityEntryState;
  attempts: number;
  attemptSeq: number;
  lastStatusCode: number | null;
  lastError: string | null;
}

export interface ClinicalActivityQueueSummary {
  confirmedCount: number;
  pendingCount: number;
  uncertainCount: number;
  conflictCount: number;
  inFlightCount: number;
  nextSequence: number;
  hasUnresolved: boolean;
  hasRecoverablePending: boolean;
  hasConflict: boolean;
  headEventId: string | null;
  headSequence: number | null;
  headState: ClinicalActivityEntryState | null;
  lastWarning: string | null;
}

export type ClinicalActivitySendFn = (
  therapySessionId: string,
  body: PatientActivityEventBody,
  options?: { signal?: AbortSignal }
) => Promise<PatientSessionProgressResponse>;

export type ClinicalProgressReadFn = (
  therapySessionId: string,
  options?: { signal?: AbortSignal }
) => Promise<PatientSessionProgressResponse>;

export interface ClinicalActivityQueueOptions {
  readonly therapySessionId: string;
  readonly accountKey: string | null;
  readonly generation: number;
  readonly initialNextSequence?: number;
  readonly requestTimeoutMs?: number;
  readonly sendActivityEvent: ClinicalActivitySendFn;
  readonly getSessionProgress?: ClinicalProgressReadFn;
  readonly onStateChange?: (summary: ClinicalActivityQueueSummary) => void;
  readonly onEventAcknowledged?: (
    entry: RetainedClinicalActivityEntry,
    progress: PatientSessionProgressResponse
  ) => void;
  readonly onProgressObserved?: (progress: PatientSessionProgressResponse) => void;
}

function isValidMatchingProgress(
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

function extractStatusCode(err: unknown): number | null {
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

function formatActivityError(err: unknown): string {
  if (err instanceof ClinicalActivityTimeoutError) {
    return err.message;
  }
  if (err instanceof ApiError) {
    return `[${err.status}] ${err.code}: ${err.message}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

export function cloneAndFreezeActivityBody(
  body: PatientActivityEventBody
): Readonly<PatientActivityEventBody> {
  if (body.type === 'REPETITION_STARTED' || body.type === 'REPETITION_FINISHED') {
    return Object.freeze({
      schemaVersion: 1,
      eventId: body.eventId,
      sequence: body.sequence,
      type: body.type,
      repetitionId: body.repetitionId,
      repetitionIndex: body.repetitionIndex,
    });
  }

  return Object.freeze({
    schemaVersion: 1,
    eventId: body.eventId,
    sequence: body.sequence,
    type: body.type,
  });
}

/**
 * Serialized, in-memory retained queue for Clinical `POST /activity-events` (POST-REP-01).
 *
 * Guarantees:
 * 1. Retains the complete immutable event body (`schemaVersion`, `eventId`, `sequence`, `type`,
 *    and `repetitionId`/`repetitionIndex`) bound to `(accountKey, sessionId, generation)` BEFORE dispatch.
 * 2. Strict FIFO serialization: assigns contiguous sequences (`0, 1, 2, ...`) and NEVER dispatches
 *    a later event past an unresolved predecessor or reuses/skips its sequence.
 * 3. Timeout, network failure, `503`, or `401/403` keeps the original event retained as unresolved
 *    and blocks normal session closure until explicitly retried and acknowledged.
 * 4. `409` marks the head entry as `CONFLICT`, halts automatic progression without mutating or
 *    renumbering the retained body, and performs a bounded `GET /progress` refresh for the original session.
 * 5. Single-flight execution with finite per-request deadlines; late responses from timed-out attempts
 *    can acknowledge only the exact matching head event within its still-admitted lifecycle.
 */
export class ClinicalActivityQueue {
  private readonly therapySessionId: string;
  private readonly accountKey: string | null;
  private readonly generation: number;
  private readonly requestTimeoutMs: number;
  private readonly sendActivityEvent: ClinicalActivitySendFn;
  private readonly getSessionProgress?: ClinicalProgressReadFn;
  private readonly onStateChange?: (summary: ClinicalActivityQueueSummary) => void;
  private readonly onEventAcknowledged?: (
    entry: RetainedClinicalActivityEntry,
    progress: PatientSessionProgressResponse
  ) => void;
  private readonly onProgressObserved?: (progress: PatientSessionProgressResponse) => void;

  private readonly entries: RetainedClinicalActivityEntry[] = [];
  private nextSequence: number;
  private confirmedCount = 0;
  private lastWarning: string | null = null;
  private activeDrainPromise: Promise<PatientSessionProgressResponse | null> | null = null;
  private activeInFlightAbort: AbortController | null = null;
  private followUpDrainRequested = false;
  private disposed = false;

  constructor(options: ClinicalActivityQueueOptions) {
    this.therapySessionId = options.therapySessionId;
    this.accountKey = options.accountKey;
    this.generation = options.generation;
    this.nextSequence =
      options.initialNextSequence !== undefined &&
      Number.isInteger(options.initialNextSequence) &&
      options.initialNextSequence >= 0
        ? options.initialNextSequence
        : 0;
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_ACTIVITY_REQUEST_TIMEOUT_MS;
    this.sendActivityEvent = options.sendActivityEvent;
    this.getSessionProgress = options.getSessionProgress;
    this.onStateChange = options.onStateChange;
    this.onEventAcknowledged = options.onEventAcknowledged;
    this.onProgressObserved = options.onProgressObserved;
  }

  /**
   * Seeds initial sequence from authoritative `GET /progress` during session bootstrap
   * ONLY before any events have been retained in this lifecycle.
   */
  seedNextSequence(nextSequence: number): boolean {
    if (
      this.disposed ||
      this.entries.length > 0 ||
      this.confirmedCount > 0 ||
      !Number.isInteger(nextSequence) ||
      nextSequence < 0
    ) {
      return false;
    }
    this.nextSequence = nextSequence;
    this.notifyStateChange();
    return true;
  }

  getNextSequence(): number {
    return this.nextSequence;
  }

  /**
   * Retains a complete activity event body synchronously before dispatch and starts
   * serialized delivery if no unresolved predecessor blocks the head of the queue.
   */
  enqueue(
    buildOrBody:
      | PatientActivityEventBody
      | ((sequence: number) => PatientActivityEventBody)
  ): {
    entry: RetainedClinicalActivityEntry;
    settlement: Promise<PatientSessionProgressResponse | null>;
  } | null {
    if (this.disposed) {
      return null;
    }

    const allocatedSequence = this.nextSequence;
    const rawBody =
      typeof buildOrBody === 'function' ? buildOrBody(allocatedSequence) : buildOrBody;
    const frozenBody = cloneAndFreezeActivityBody(rawBody);
    this.nextSequence = Math.max(this.nextSequence + 1, frozenBody.sequence + 1);

    const entry: RetainedClinicalActivityEntry = {
      body: frozenBody,
      sessionId: this.therapySessionId,
      accountKey: this.accountKey,
      generation: this.generation,
      state: 'PENDING',
      attempts: 0,
      attemptSeq: 0,
      lastStatusCode: null,
      lastError: null,
    };

    this.entries.push(entry);
    this.notifyStateChange();

    const head = this.entries[0];
    if (
      head &&
      (head.state === 'UNCERTAIN' ||
        head.state === 'CONFLICT' ||
        head.state === 'AUTH_ERROR')
    ) {
      // Do not overtake or silently re-dispatch an unresolved predecessor;
      // wait for explicit retryPending() recovery.
      return {
        entry,
        settlement: Promise.resolve(null),
      };
    }

    const settlement = this.startDrain(false);
    return { entry, settlement };
  }

  /**
   * Waits for any currently running or queued `PENDING` drain to finish, without
   * automatically retrying entries that already failed into `UNCERTAIN`/`AUTH_ERROR`/`CONFLICT`.
   */
  async waitForCurrentDrain(): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (this.activeDrainPromise) {
      await this.activeDrainPromise.catch(() => null);
      return;
    }
    if (this.entries.length > 0 && this.entries[0].state === 'PENDING') {
      await this.startDrain(false).catch(() => null);
    }
  }

  /**
   * Bounded explicit retry of the retained head event with its exact original body.
   * Coalesces concurrent retry calls into the active single-flight drain.
   * Never retries or mutates a `409 CONFLICT` entry.
   */
  async retryPending(): Promise<PatientSessionProgressResponse | null> {
    if (this.disposed) {
      return null;
    }

    if (this.activeDrainPromise) {
      return this.activeDrainPromise;
    }

    if (this.entries.length === 0) {
      return null;
    }

    const head = this.entries[0];
    if (head.state === 'CONFLICT') {
      await this.refreshObservedProgressAfterConflict();
      return null;
    }

    if (head.state === 'UNCERTAIN' || head.state === 'AUTH_ERROR') {
      head.state = 'PENDING';
      this.notifyStateChange();
    }

    return this.startDrain(true);
  }

  /**
   * Marks any stuck in-flight head entry as UNCERTAIN when an external gate deadline
   * expires, keeping the entry retained and preserving its late-acknowledgement guard.
   */
  abortInFlightAsUncertain(reasonMessage?: string): void {
    if (this.disposed) return;
    const head = this.entries[0];
    if (head && head.state === 'IN_FLIGHT') {
      head.state = 'UNCERTAIN';
      head.lastError =
        reasonMessage ??
        `Tiempo de espera agotado (${this.requestTimeoutMs} ms) en envío de actividad clínica.`;
      this.lastWarning = `Sincronización clínica pendiente (${head.body.type} seq=${head.body.sequence}): ${head.lastError}`;
      if (this.activeInFlightAbort) {
        try {
          this.activeInFlightAbort.abort();
        } catch {
          // Ignore strict AbortController environments
        }
      }
      this.notifyStateChange();
    }
  }

  getRetainedEntriesSnapshot(): ReadonlyArray<{
    readonly body: Readonly<PatientActivityEventBody>;
    readonly sessionId: string;
    readonly accountKey: string | null;
    readonly generation: number;
    readonly state: ClinicalActivityEntryState;
    readonly attempts: number;
    readonly lastStatusCode: number | null;
    readonly lastError: string | null;
  }> {
    return this.entries.map((e) =>
      Object.freeze({
        body: e.body,
        sessionId: e.sessionId,
        accountKey: e.accountKey,
        generation: e.generation,
        state: e.state,
        attempts: e.attempts,
        lastStatusCode: e.lastStatusCode,
        lastError: e.lastError,
      })
    );
  }

  getSummary(): ClinicalActivityQueueSummary {
    let pendingCount = 0;
    let uncertainCount = 0;
    let conflictCount = 0;
    let inFlightCount = 0;

    for (const entry of this.entries) {
      if (entry.state === 'PENDING') {
        pendingCount += 1;
      } else if (entry.state === 'IN_FLIGHT') {
        pendingCount += 1;
        inFlightCount += 1;
      } else if (entry.state === 'UNCERTAIN' || entry.state === 'AUTH_ERROR') {
        uncertainCount += 1;
      } else if (entry.state === 'CONFLICT') {
        conflictCount += 1;
      }
    }

    const head = this.entries[0] ?? null;
    const hasRecoverablePending = pendingCount > 0 || uncertainCount > 0;
    const hasConflict = conflictCount > 0;

    return {
      confirmedCount: this.confirmedCount,
      pendingCount,
      uncertainCount,
      conflictCount,
      inFlightCount,
      nextSequence: this.nextSequence,
      hasUnresolved: hasRecoverablePending || hasConflict,
      hasRecoverablePending,
      hasConflict,
      headEventId: head ? head.body.eventId : null,
      headSequence: head ? head.body.sequence : null,
      headState: head ? head.state : null,
      lastWarning: this.lastWarning,
    };
  }

  dispose(): void {
    this.disposed = true;
    if (this.activeInFlightAbort) {
      try {
        this.activeInFlightAbort.abort();
      } catch {
        // Ignore abort errors on disposal
      }
      this.activeInFlightAbort = null;
    }
    this.activeDrainPromise = null;
    this.followUpDrainRequested = false;
    this.entries.length = 0;
  }

  private startDrain(_isExplicitRetry: boolean): Promise<PatientSessionProgressResponse | null> {
    if (this.activeDrainPromise) {
      this.followUpDrainRequested = true;
      return this.activeDrainPromise;
    }

    const promise = this.drainLoop();
    this.activeDrainPromise = promise;
    return promise;
  }

  private async drainLoop(): Promise<PatientSessionProgressResponse | null> {
    let latestProgress: PatientSessionProgressResponse | null = null;
    try {
      while (!this.disposed && this.entries.length > 0) {
        this.followUpDrainRequested = false;
        const head = this.entries[0];

        if (head.state !== 'PENDING') {
          // Blocked by UNCERTAIN, AUTH_ERROR, or CONFLICT predecessor
          break;
        }

        head.state = 'IN_FLIGHT';
        head.attempts += 1;
        head.attemptSeq += 1;
        const capturedAttemptSeq = head.attemptSeq;
        this.notifyStateChange();

        const attempt = this.executeWithDeadline(head.body.eventId, (signal) =>
          this.sendActivityEvent(this.therapySessionId, head.body, { signal })
        );
        this.activeInFlightAbort = attempt.abortController;

        // Late-settlement handler: if local timeout expired yet the underlying request
        // later resolves with a valid receipt for this exact still-admitted head event,
        // acknowledge it at most once without mutating any replacement lifecycle.
        void attempt.rawPromise
          .then((lateProgress) => {
            if (this.disposed) return;
            if (this.entries[0] !== head) return;
            if (head.state === 'CONFLICT') return;
            if (!isValidMatchingProgress(lateProgress, this.therapySessionId)) return;
            this.acknowledgeHeadEntry(head, lateProgress);
          })
          .catch(() => undefined);

        try {
          const progress = await attempt.promise;
          this.activeInFlightAbort = null;

          if (this.disposed) {
            return null;
          }

          if (!isValidMatchingProgress(progress, this.therapySessionId)) {
            if (this.entries[0] === head && head.attemptSeq === capturedAttemptSeq) {
              head.state = 'UNCERTAIN';
              head.lastStatusCode = null;
              head.lastError =
                'Respuesta de actividad clínica con therapySessionId distinto al esperado.';
              this.lastWarning = `Sincronización clínica pendiente: ${head.lastError}`;
              this.notifyStateChange();
            }
            break;
          }

          if (this.entries[0] === head) {
            this.acknowledgeHeadEntry(head, progress);
          }
          latestProgress = progress;
        } catch (err) {
          this.activeInFlightAbort = null;

          if (this.disposed) {
            return null;
          }

          // Already acknowledged by a late resolution from an earlier attempt
          if (this.entries[0] !== head) {
            continue;
          }

          if (head.attemptSeq !== capturedAttemptSeq) {
            break;
          }

          const status = extractStatusCode(err);
          const errMsg = formatActivityError(err);
          head.lastStatusCode = status;
          head.lastError = errMsg;

          if (status === 409) {
            head.state = 'CONFLICT';
            this.lastWarning = `Conflicto clínico (409) en evento ${head.body.type} (seq=${head.body.sequence}): ${errMsg}`;
            this.notifyStateChange();
            await this.refreshObservedProgressAfterConflict();
            break;
          }

          if (status === 401 || status === 403) {
            head.state = 'AUTH_ERROR';
            this.lastWarning = `Autorización requerida (${status}) al sincronizar actividad clínica (${head.body.type}): ${errMsg}`;
            this.notifyStateChange();
            break;
          }

          head.state = 'UNCERTAIN';
          this.lastWarning = `Sincronización clínica pendiente (${head.body.type} seq=${head.body.sequence}): ${errMsg}`;
          this.notifyStateChange();
          break;
        }

        if (
          !this.followUpDrainRequested &&
          (this.entries.length === 0 || this.entries[0].state !== 'PENDING')
        ) {
          break;
        }
      }

      return latestProgress;
    } finally {
      this.activeInFlightAbort = null;
      this.activeDrainPromise = null;
      this.followUpDrainRequested = false;
    }
  }

  private acknowledgeHeadEntry(
    entry: RetainedClinicalActivityEntry,
    progress: PatientSessionProgressResponse
  ): void {
    if (this.disposed || this.entries[0] !== entry) {
      return;
    }

    this.entries.shift();
    this.confirmedCount += 1;
    if (
      this.entries.length === 0 &&
      Number.isInteger(progress.nextSequence) &&
      progress.nextSequence > this.nextSequence
    ) {
      this.nextSequence = progress.nextSequence;
    }
    this.lastWarning = null;
    this.onEventAcknowledged?.(entry, progress);
    this.notifyStateChange();
  }

  private async refreshObservedProgressAfterConflict(): Promise<void> {
    if (this.disposed || !this.getSessionProgress) {
      return;
    }

    const readAttempt = this.executeWithDeadline('conflict-progress-read', (signal) =>
      this.getSessionProgress!(this.therapySessionId, { signal })
    );

    try {
      const progress = await readAttempt.promise;
      if (this.disposed) return;
      if (!isValidMatchingProgress(progress, this.therapySessionId)) return;
      this.onProgressObserved?.(progress);
    } catch {
      // Remain unresolved on progress read failure
    }
  }

  private executeWithDeadline<T>(
    eventId: string,
    fn: (signal: AbortSignal) => Promise<T>
  ): { promise: Promise<T>; rawPromise: Promise<T>; abortController: AbortController } {
    const abortController = new AbortController();
    let rawPromise: Promise<T>;
    try {
      rawPromise = fn(abortController.signal);
    } catch (syncErr) {
      rawPromise = Promise.reject(syncErr);
    }

    rawPromise.catch(() => undefined);

    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const timeoutErr = new ClinicalActivityTimeoutError(eventId, this.requestTimeoutMs);
        try {
          abortController.abort(timeoutErr);
        } catch {
          // Ignore strict AbortSignal environments
        }
        reject(timeoutErr);
      }, this.requestTimeoutMs);
    });

    const promise = Promise.race([rawPromise, timeoutPromise]).finally(() => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    });

    return { promise, rawPromise, abortController };
  }

  private notifyStateChange(): void {
    if (this.disposed) return;
    this.onStateChange?.(this.getSummary());
  }
}
