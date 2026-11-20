import { ApiError } from '../api/httpClient.ts';
import type { AnyTrialBody } from '../api/analyticsApi.ts';
import type {
  AnalyticsExerciseSlug,
  AnalyticsTrialReceipt,
} from '../api/contracts/analytics.contracts.ts';

export type TrialSubmissionStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'UNCERTAIN'
  | 'FAILED_PERMANENT';

export interface QueuedTrialEntry {
  readonly slug: AnalyticsExerciseSlug;
  readonly body: Readonly<AnyTrialBody>;
  status: TrialSubmissionStatus;
  inFlight: boolean;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  receiptStatus: AnalyticsTrialReceipt['status'] | null;
}

export interface TrialAnalyticsQueueSummary {
  confirmedCount: number;
  pendingCount: number;
  uncertainCount: number;
  failedPermanentCount: number;
  inFlightCount: number;
  hasUnresolved: boolean;
  hasUncertain: boolean;
  hasPermanentFailure: boolean;
  conflictingDuplicateCount: number;
  lastWarning: string | null;
  entries: readonly QueuedTrialEntry[];
}

export type TrialAnalyticsSendFn = (
  slug: AnalyticsExerciseSlug,
  body: AnyTrialBody
) => Promise<AnalyticsTrialReceipt>;

export interface TrialAnalyticsQueueOptions {
  sendTrial: TrialAnalyticsSendFn;
  retryBackoffMs?: number;
  maxBodyBytes?: number;
  sleep?: (ms: number) => Promise<void>;
  onStateChange?: (summary: TrialAnalyticsQueueSummary) => void;
}

const PERMANENT_FAILURE_STATUS_CODES = new Set([400, 403, 409, 413, 415]);
const DEFAULT_MAX_BODY_BYTES = 8192;

function deepCloneAndFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    const clonedArr = value.map((item) => deepCloneAndFreeze(item));
    return Object.freeze(clonedArr) as unknown as T;
  }
  const clonedObj: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    clonedObj[key] = deepCloneAndFreeze(val);
  }
  return Object.freeze(clonedObj) as T;
}

function extractStatusCode(err: unknown): number {
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
  return 0;
}

export class TrialAnalyticsQueue {
  private readonly sendTrial: TrialAnalyticsSendFn;
  private readonly retryBackoffMs: number;
  private readonly maxBodyBytes: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onStateChange?: (summary: TrialAnalyticsQueueSummary) => void;

  private readonly entries: QueuedTrialEntry[] = [];
  private deliveryChain: Promise<void> = Promise.resolve();
  private readonly textEncoder = new TextEncoder();
  private lifecycleGeneration = 0;
  private disposed = false;
  private conflictingDuplicateCount = 0;
  private lastWarning: string | null = null;
  private readonly serializedByTrialId = new Map<string, string>();

  constructor(options: TrialAnalyticsQueueOptions) {
    this.sendTrial = options.sendTrial;
    this.retryBackoffMs = options.retryBackoffMs ?? 300;
    this.maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    this.sleep =
      options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.onStateChange = options.onStateChange;
  }

  submit(slug: AnalyticsExerciseSlug, body: AnyTrialBody): Promise<QueuedTrialEntry> {
    const frozenBody = deepCloneAndFreeze(body);

    if (this.disposed) {
      return Promise.resolve(
        Object.freeze({
          slug,
          body: frozenBody,
          status: 'FAILED_PERMANENT' as const,
          inFlight: false,
          attempts: 0,
          lastStatusCode: null,
          lastError: 'TrialAnalyticsQueue has been disposed.',
          receiptStatus: null,
        })
      );
    }

    const serialized = JSON.stringify(frozenBody);
    const byteLength = this.textEncoder.encode(serialized).length;

    const existing = this.entries.find((e) => e.body.trialId === frozenBody.trialId);
    if (existing) {
      const identical =
        existing.slug === slug &&
        this.serializedByTrialId.get(frozenBody.trialId) === serialized;

      if (identical) {
        if (existing.status === 'CONFIRMED' || existing.status === 'FAILED_PERMANENT') {
          return Promise.resolve(existing);
        }
        if (existing.status === 'PENDING') {
          return this.deliveryChain.then(() => existing);
        }

        const generation = this.lifecycleGeneration;
        const runRetry = this.deliveryChain.then(() =>
          this.deliverEntry(existing, 2, generation)
        );
        this.deliveryChain = runRetry.then(
          () => undefined,
          () => undefined
        );
        return runRetry.then(() => existing);
      }

      this.conflictingDuplicateCount += 1;
      this.lastWarning = `Duplicate trialId ${frozenBody.trialId} with conflicting payload was ignored.`;
      this.notifyStateChange();
      return Promise.resolve(existing);
    }

    this.serializedByTrialId.set(frozenBody.trialId, serialized);

    if (byteLength > this.maxBodyBytes) {
      const lastError = `Trial payload size (${byteLength} bytes) exceeds maximum allowed ${this.maxBodyBytes} UTF-8 bytes.`;
      const rejectedEntry: QueuedTrialEntry = {
        slug,
        body: frozenBody,
        status: 'FAILED_PERMANENT',
        inFlight: false,
        attempts: 0,
        lastStatusCode: 413,
        lastError,
        receiptStatus: null,
      };
      this.entries.push(rejectedEntry);
      this.lastWarning = lastError;
      this.notifyStateChange();
      return Promise.resolve(rejectedEntry);
    }

    const entry: QueuedTrialEntry = {
      slug,
      body: frozenBody,
      status: 'PENDING',
      inFlight: false,
      attempts: 0,
      lastStatusCode: null,
      lastError: null,
      receiptStatus: null,
    };

    const generation = this.lifecycleGeneration;
    this.entries.push(entry);
    this.notifyStateChange();

    if (this.disposed || this.lifecycleGeneration !== generation) {
      return Promise.resolve(entry);
    }

    const runDelivery = this.deliveryChain.then(() =>
      this.deliverEntry(entry, 2, generation)
    );
    this.deliveryChain = runDelivery.then(
      () => undefined,
      () => undefined
    );

    return runDelivery.then(() => entry);
  }

  async drainPending(maxAdditionalAttempts = 2): Promise<TrialAnalyticsQueueSummary> {
    if (this.disposed) {
      return this.getSummary();
    }

    const generation = this.lifecycleGeneration;
    const runDrain = this.deliveryChain.then(async () => {
      if (this.disposed || this.lifecycleGeneration !== generation) {
        return;
      }
      for (const entry of this.entries) {
        if (this.disposed || this.lifecycleGeneration !== generation) {
          return;
        }
        if (entry.status === 'PENDING' || entry.status === 'UNCERTAIN') {
          await this.deliverEntry(entry, maxAdditionalAttempts, generation);
        }
      }
    });
    this.deliveryChain = runDrain.then(
      () => undefined,
      () => undefined
    );
    await runDrain;
    return this.getSummary();
  }

  getSummary(): TrialAnalyticsQueueSummary {
    let confirmedCount = 0;
    let pendingCount = 0;
    let uncertainCount = 0;
    let failedPermanentCount = 0;
    let inFlightCount = 0;

    for (const entry of this.entries) {
      if (entry.inFlight) {
        inFlightCount += 1;
      }
      switch (entry.status) {
        case 'CONFIRMED':
          confirmedCount += 1;
          break;
        case 'PENDING':
          pendingCount += 1;
          break;
        case 'UNCERTAIN':
          uncertainCount += 1;
          break;
        case 'FAILED_PERMANENT':
          failedPermanentCount += 1;
          break;
      }
    }

    return {
      confirmedCount,
      pendingCount,
      uncertainCount,
      failedPermanentCount,
      inFlightCount,
      hasUnresolved: pendingCount > 0 || uncertainCount > 0,
      hasUncertain: uncertainCount > 0,
      hasPermanentFailure: failedPermanentCount > 0,
      conflictingDuplicateCount: this.conflictingDuplicateCount,
      lastWarning: this.lastWarning,
      entries: this.entries.slice(),
    };
  }

  dispose(): void {
    this.disposed = true;
    this.lifecycleGeneration += 1;
    this.deliveryChain = Promise.resolve();
    for (const entry of this.entries) {
      entry.inFlight = false;
    }
  }

  reset(): void {
    this.lifecycleGeneration += 1;
    this.disposed = false;
    this.entries.length = 0;
    this.serializedByTrialId.clear();
    this.conflictingDuplicateCount = 0;
    this.lastWarning = null;
    this.deliveryChain = Promise.resolve();
    this.notifyStateChange();
  }

  private async deliverEntry(
    entry: QueuedTrialEntry,
    maxAttempts: number,
    generation: number
  ): Promise<void> {
    if (this.disposed || this.lifecycleGeneration !== generation) {
      return;
    }
    if (entry.status === 'CONFIRMED' || entry.status === 'FAILED_PERMANENT') {
      return;
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (this.disposed || this.lifecycleGeneration !== generation) {
        return;
      }

      entry.attempts += 1;
      entry.inFlight = true;
      this.notifyStateChange();

      if (this.disposed || this.lifecycleGeneration !== generation) {
        entry.inFlight = false;
        return;
      }

      try {
        const receipt = await this.sendTrial(entry.slug, entry.body);
        if (this.disposed || this.lifecycleGeneration !== generation) {
          return;
        }
        entry.inFlight = false;
        entry.status = 'CONFIRMED';
        entry.receiptStatus = receipt.status;
        entry.lastStatusCode = receipt.status === 'CREATED' ? 201 : 200;
        entry.lastError = null;
        if (
          this.conflictingDuplicateCount === 0 &&
          !this.entries.some(
            (e) => e.status === 'FAILED_PERMANENT' || e.status === 'UNCERTAIN'
          )
        ) {
          this.lastWarning = null;
        }
        this.notifyStateChange();
        return;
      } catch (err) {
        if (this.disposed || this.lifecycleGeneration !== generation) {
          return;
        }
        entry.inFlight = false;
        const statusCode = extractStatusCode(err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        entry.lastStatusCode = statusCode;
        entry.lastError = errorMessage;

        if (PERMANENT_FAILURE_STATUS_CODES.has(statusCode)) {
          entry.status = 'FAILED_PERMANENT';
          this.lastWarning = `Trial ${entry.body.trialId} permanently rejected (HTTP ${statusCode}): ${errorMessage}`;
          this.notifyStateChange();
          return;
        }

        if (attempt < maxAttempts && this.retryBackoffMs > 0) {
          await this.sleep(this.retryBackoffMs);
          if (this.disposed || this.lifecycleGeneration !== generation) {
            return;
          }
        }
      }
    }

    if (this.disposed || this.lifecycleGeneration !== generation) {
      return;
    }
    entry.inFlight = false;
    entry.status = 'UNCERTAIN';
    this.lastWarning = `Trial ${entry.body.trialId} delivery uncertain (HTTP ${entry.lastStatusCode ?? 0}): ${entry.lastError ?? 'Unknown error'}`;
    this.notifyStateChange();
  }

  private notifyStateChange(): void {
    if (this.disposed) {
      return;
    }
    this.onStateChange?.(this.getSummary());
  }
}
