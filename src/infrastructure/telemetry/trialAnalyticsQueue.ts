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
  hasUnresolved: boolean;
  hasUncertain: boolean;
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
    const serialized = JSON.stringify(frozenBody);
    const byteLength = this.textEncoder.encode(serialized).length;

    if (byteLength > this.maxBodyBytes) {
      const rejectedEntry: QueuedTrialEntry = {
        slug,
        body: frozenBody,
        status: 'FAILED_PERMANENT',
        attempts: 0,
        lastStatusCode: 413,
        lastError: `Trial payload size (${byteLength} bytes) exceeds maximum allowed ${this.maxBodyBytes} UTF-8 bytes.`,
        receiptStatus: null,
      };
      this.entries.push(rejectedEntry);
      this.notifyStateChange();
      return Promise.resolve(rejectedEntry);
    }

    const entry: QueuedTrialEntry = {
      slug,
      body: frozenBody,
      status: 'PENDING',
      attempts: 0,
      lastStatusCode: null,
      lastError: null,
      receiptStatus: null,
    };

    this.entries.push(entry);
    this.notifyStateChange();

    const runDelivery = this.deliveryChain.then(() => this.deliverEntry(entry, 2));
    this.deliveryChain = runDelivery.then(
      () => undefined,
      () => undefined
    );

    return runDelivery.then(() => entry);
  }

  async drainPending(maxAdditionalAttempts = 2): Promise<TrialAnalyticsQueueSummary> {
    const runDrain = this.deliveryChain.then(async () => {
      for (const entry of this.entries) {
        if (entry.status === 'PENDING' || entry.status === 'UNCERTAIN') {
          await this.deliverEntry(entry, maxAdditionalAttempts);
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

    for (const entry of this.entries) {
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
      hasUnresolved: pendingCount > 0 || uncertainCount > 0,
      hasUncertain: uncertainCount > 0,
      entries: this.entries.slice(),
    };
  }

  reset(): void {
    this.entries.length = 0;
    this.deliveryChain = Promise.resolve();
    this.notifyStateChange();
  }

  private async deliverEntry(entry: QueuedTrialEntry, maxAttempts: number): Promise<void> {
    if (entry.status === 'CONFIRMED' || entry.status === 'FAILED_PERMANENT') {
      return;
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      entry.attempts += 1;
      try {
        const receipt = await this.sendTrial(entry.slug, entry.body);
        entry.status = 'CONFIRMED';
        entry.receiptStatus = receipt.status;
        entry.lastStatusCode = receipt.status === 'CREATED' ? 201 : 200;
        entry.lastError = null;
        this.notifyStateChange();
        return;
      } catch (err) {
        const statusCode = extractStatusCode(err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        entry.lastStatusCode = statusCode;
        entry.lastError = errorMessage;

        if (PERMANENT_FAILURE_STATUS_CODES.has(statusCode)) {
          entry.status = 'FAILED_PERMANENT';
          this.notifyStateChange();
          return;
        }

        if (attempt < maxAttempts && this.retryBackoffMs > 0) {
          await this.sleep(this.retryBackoffMs);
        }
      }
    }

    entry.status = 'UNCERTAIN';
    this.notifyStateChange();
  }

  private notifyStateChange(): void {
    this.onStateChange?.(this.getSummary());
  }
}
