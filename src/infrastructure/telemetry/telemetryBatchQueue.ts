import { ApiError, createUuid } from '../api/httpClient.ts';
import type {
  TelemetryBatchAcceptedResponse,
  TelemetryBatchBody,
  TelemetryGameplaySampleBody,
  TelemetryGazeSampleBody,
} from '../api/contracts/telemetry.contracts.ts';

export interface PendingTelemetryBatchEntry {
  readonly body: Readonly<TelemetryBatchBody>;
  attempts: number;
  inFlight: boolean;
  lastError: string | null;
  lastStatusCode: number | null;
}

export type TelemetryBatchSendFn = (
  body: TelemetryBatchBody
) => Promise<TelemetryBatchAcceptedResponse>;

export interface TelemetryQueueSnapshot {
  pendingCount: number;
  brokerAcceptedCount: number;
  permanentRejectedCount: number;
  droppedOverflowCount: number;
  streamId: string;
  nextSequence: number;
  lastWarning: string | null;
}

export interface TelemetryBatchQueueOptions {
  therapySessionId: string;
  initialStreamId?: string;
  maxSamplesPerArray?: number;
  maxQueueSize?: number;
  maxAttemptsPerFlush?: number;
  retryBackoffMs?: number;
  sendBatch: TelemetryBatchSendFn;
  nowMs?: () => number;
  perfNowMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
  uuid?: () => string;
  onStateChange?: (snapshot: TelemetryQueueSnapshot) => void;
}

export interface BuildTelemetryBatchBodyParams {
  batchId: string;
  therapySessionId: string;
  streamId: string;
  sequence: number;
  capturedAt: string;
  sentAt: string;
  gazeSamples: readonly TelemetryGazeSampleBody[];
  gameplaySamples: readonly TelemetryGameplaySampleBody[];
}

export interface RecordTelemetrySampleInput {
  gaze?: Omit<TelemetryGazeSampleBody, 'offsetMs'> | null;
  gameplay?: Omit<TelemetryGameplaySampleBody, 'offsetMs'> | null;
}

function freezeGazeSample(sample: TelemetryGazeSampleBody): TelemetryGazeSampleBody {
  return Object.freeze({
    offsetMs: sample.offsetMs,
    x: sample.x,
    y: sample.y,
    confidence: sample.confidence,
  });
}

function freezeGameplaySample(sample: TelemetryGameplaySampleBody): TelemetryGameplaySampleBody {
  return Object.freeze({
    offsetMs: sample.offsetMs,
    playerX: sample.playerX,
    playerY: sample.playerY,
    targetX: sample.targetX,
    targetY: sample.targetY,
    score: sample.score,
    speed: sample.speed,
    progress: sample.progress,
  });
}

export function buildTelemetryBatchBody(
  params: BuildTelemetryBatchBodyParams
): Readonly<TelemetryBatchBody> {
  const gazeSamples = Object.freeze(
    params.gazeSamples.map(freezeGazeSample)
  ) as TelemetryGazeSampleBody[];
  const gameplaySamples = Object.freeze(
    params.gameplaySamples.map(freezeGameplaySample)
  ) as TelemetryGameplaySampleBody[];

  return Object.freeze({
    schemaVersion: 1 as const,
    batchId: params.batchId,
    therapySessionId: params.therapySessionId,
    streamId: params.streamId,
    sequence: params.sequence,
    capturedAt: params.capturedAt,
    sentAt: params.sentAt,
    gazeSamples,
    gameplaySamples,
  });
}

function chunkArray<T>(items: readonly T[], chunkSize: number): T[][] {
  if (items.length === 0) {
    return [];
  }
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
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

export class TelemetryBatchQueue {
  private therapySessionId: string;
  private streamId: string;
  private nextSequence = 0;
  private readonly maxSamplesPerArray: number;
  private readonly maxQueueSize: number;
  private readonly maxAttemptsPerFlush: number;
  private readonly retryBackoffMs: number;
  private readonly sendBatch: TelemetryBatchSendFn;
  private readonly nowMs: () => number;
  private readonly perfNowMs: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly uuid: () => string;
  private readonly onStateChange?: (snapshot: TelemetryQueueSnapshot) => void;

  private readonly queue: PendingTelemetryBatchEntry[] = [];
  private gazeBuffer: TelemetryGazeSampleBody[] = [];
  private gameplayBuffer: TelemetryGameplaySampleBody[] = [];
  private batchCapturedAt: string | null = null;
  private batchBaseEpochMs = 0;
  private batchStartPerfMs = 0;
  private lastEffectiveSampleEpochMs = 0;
  private lastGazeOffsetMs = -1;
  private lastGameplayOffsetMs = -1;

  private brokerAcceptedCount = 0;
  private permanentRejectedCount = 0;
  private droppedOverflowCount = 0;
  private lastWarning: string | null = null;
  private activeDrainPromise: Promise<void> | null = null;

  constructor(options: TelemetryBatchQueueOptions) {
    this.therapySessionId = options.therapySessionId;
    this.maxSamplesPerArray = options.maxSamplesPerArray ?? 500;
    this.maxQueueSize = options.maxQueueSize ?? 100;
    this.maxAttemptsPerFlush = options.maxAttemptsPerFlush ?? 2;
    this.retryBackoffMs = options.retryBackoffMs ?? 300;
    this.sendBatch = options.sendBatch;
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.perfNowMs =
      options.perfNowMs ??
      (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this.sleep =
      options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.uuid = options.uuid ?? createUuid;
    this.streamId = options.initialStreamId ?? this.uuid();
    this.onStateChange = options.onStateChange;
  }

  recordSample(sample: RecordTelemetrySampleInput): void {
    const hasGaze = sample.gaze !== undefined && sample.gaze !== null;
    const hasGameplay = sample.gameplay !== undefined && sample.gameplay !== null;
    if (!hasGaze && !hasGameplay) {
      return;
    }

    if (this.batchCapturedAt === null) {
      const nowWallMs = Math.max(this.nowMs(), this.lastEffectiveSampleEpochMs + 1);
      this.batchBaseEpochMs = nowWallMs;
      this.batchCapturedAt = new Date(nowWallMs).toISOString();
      this.batchStartPerfMs = this.perfNowMs();
      this.lastGazeOffsetMs = -1;
      this.lastGameplayOffsetMs = -1;
    }

    const rawOffsetMs = Math.max(0, Math.round(this.perfNowMs() - this.batchStartPerfMs));

    if (sample.gaze) {
      const offsetMs = Math.max(rawOffsetMs, this.lastGazeOffsetMs + 1);
      this.lastGazeOffsetMs = offsetMs;
      const effectiveEpochMs = this.batchBaseEpochMs + offsetMs;
      if (effectiveEpochMs > this.lastEffectiveSampleEpochMs) {
        this.lastEffectiveSampleEpochMs = effectiveEpochMs;
      }
      this.gazeBuffer.push({
        offsetMs,
        x: sample.gaze.x,
        y: sample.gaze.y,
        confidence: sample.gaze.confidence,
      });
    }

    if (sample.gameplay) {
      const offsetMs = Math.max(rawOffsetMs, this.lastGameplayOffsetMs + 1);
      this.lastGameplayOffsetMs = offsetMs;
      const effectiveEpochMs = this.batchBaseEpochMs + offsetMs;
      if (effectiveEpochMs > this.lastEffectiveSampleEpochMs) {
        this.lastEffectiveSampleEpochMs = effectiveEpochMs;
      }
      this.gameplayBuffer.push({
        offsetMs,
        playerX: sample.gameplay.playerX,
        playerY: sample.gameplay.playerY,
        targetX: sample.gameplay.targetX,
        targetY: sample.gameplay.targetY,
        score: sample.gameplay.score,
        speed: sample.gameplay.speed,
        progress: sample.gameplay.progress,
      });
    }
  }

  enqueueBuffers(): number {
    if (this.gazeBuffer.length === 0 && this.gameplayBuffer.length === 0) {
      return 0;
    }

    const gazeSnapshot = this.gazeBuffer;
    const gameplaySnapshot = this.gameplayBuffer;
    const capturedAt =
      this.batchCapturedAt ??
      new Date(Math.max(this.nowMs(), this.lastEffectiveSampleEpochMs + 1)).toISOString();

    this.gazeBuffer = [];
    this.gameplayBuffer = [];
    this.batchCapturedAt = null;
    this.batchBaseEpochMs = 0;
    this.batchStartPerfMs = 0;
    this.lastGazeOffsetMs = -1;
    this.lastGameplayOffsetMs = -1;

    const gazeChunks = chunkArray(gazeSnapshot, this.maxSamplesPerArray);
    const gameplayChunks = chunkArray(gameplaySnapshot, this.maxSamplesPerArray);
    const totalChunks = Math.max(gazeChunks.length, gameplayChunks.length);
    const capturedAtEpochMs = Date.parse(capturedAt);

    let enqueuedCount = 0;
    for (let i = 0; i < totalChunks; i++) {
      if (this.queue.length >= this.maxQueueSize) {
        const dropped = totalChunks - i;
        this.droppedOverflowCount += dropped;
        this.lastWarning = `Telemetry queue capacity (${this.maxQueueSize}) reached; dropped ${dropped} overflow batch(es).`;
        this.notifyStateChange();
        break;
      }

      const sentAtEpochMs = Math.max(
        this.nowMs(),
        Number.isFinite(capturedAtEpochMs) ? capturedAtEpochMs : 0
      );
      const sentAt = new Date(sentAtEpochMs).toISOString();
      const sequence = this.nextSequence++;
      const batchId = this.uuid();

      const body = buildTelemetryBatchBody({
        batchId,
        therapySessionId: this.therapySessionId,
        streamId: this.streamId,
        sequence,
        capturedAt,
        sentAt,
        gazeSamples: gazeChunks[i] ?? [],
        gameplaySamples: gameplayChunks[i] ?? [],
      });

      this.queue.push({
        body,
        attempts: 0,
        inFlight: false,
        lastError: null,
        lastStatusCode: null,
      });
      enqueuedCount += 1;
    }

    if (enqueuedCount > 0) {
      this.notifyStateChange();
    }

    return enqueuedCount;
  }

  enqueueCustomBatch(
    gazeSamples: readonly TelemetryGazeSampleBody[],
    gameplaySamples: readonly TelemetryGameplaySampleBody[],
    capturedAtIso?: string
  ): PendingTelemetryBatchEntry | null {
    if (gazeSamples.length === 0 && gameplaySamples.length === 0) {
      return null;
    }

    if (this.queue.length >= this.maxQueueSize) {
      this.droppedOverflowCount += 1;
      this.lastWarning = `Telemetry queue capacity (${this.maxQueueSize}) reached; dropped overflow batch.`;
      this.notifyStateChange();
      return null;
    }

    const capturedAt =
      capturedAtIso ??
      new Date(Math.max(this.nowMs(), this.lastEffectiveSampleEpochMs + 1)).toISOString();
    const capturedAtEpochMs = Date.parse(capturedAt);
    const sentAtEpochMs = Math.max(
      this.nowMs(),
      Number.isFinite(capturedAtEpochMs) ? capturedAtEpochMs : 0
    );
    const sentAt = new Date(sentAtEpochMs).toISOString();
    const sequence = this.nextSequence++;
    const batchId = this.uuid();

    const body = buildTelemetryBatchBody({
      batchId,
      therapySessionId: this.therapySessionId,
      streamId: this.streamId,
      sequence,
      capturedAt,
      sentAt,
      gazeSamples,
      gameplaySamples,
    });

    const entry: PendingTelemetryBatchEntry = {
      body,
      attempts: 0,
      inFlight: false,
      lastError: null,
      lastStatusCode: null,
    };

    this.queue.push(entry);
    this.notifyStateChange();
    return entry;
  }

  async flush(): Promise<void> {
    this.enqueueBuffers();

    if (this.activeDrainPromise) {
      await this.activeDrainPromise;
      this.enqueueBuffers();
      if (this.queue.length === 0) {
        return;
      }
    }

    if (this.queue.length === 0) {
      return;
    }

    this.activeDrainPromise = this.drainLoop();
    await this.activeDrainPromise;
  }

  rotateStream(): Promise<void> {
    this.enqueueBuffers();
    this.streamId = this.uuid();
    this.nextSequence = 0;
    this.gazeBuffer = [];
    this.gameplayBuffer = [];
    this.batchCapturedAt = null;
    this.batchBaseEpochMs = 0;
    this.batchStartPerfMs = 0;
    this.lastGazeOffsetMs = -1;
    this.lastGameplayOffsetMs = -1;
    this.notifyStateChange();
    return this.flush();
  }

  getPendingBatches(): readonly PendingTelemetryBatchEntry[] {
    return this.queue.slice();
  }

  getSnapshot(): TelemetryQueueSnapshot {
    return {
      pendingCount: this.queue.length,
      brokerAcceptedCount: this.brokerAcceptedCount,
      permanentRejectedCount: this.permanentRejectedCount,
      droppedOverflowCount: this.droppedOverflowCount,
      streamId: this.streamId,
      nextSequence: this.nextSequence,
      lastWarning: this.lastWarning,
    };
  }

  hasPending(): boolean {
    return (
      this.queue.length > 0 || this.gazeBuffer.length > 0 || this.gameplayBuffer.length > 0
    );
  }

  reset(newTherapySessionId?: string): void {
    if (newTherapySessionId !== undefined) {
      this.therapySessionId = newTherapySessionId;
    }
    this.queue.length = 0;
    this.gazeBuffer = [];
    this.gameplayBuffer = [];
    this.streamId = this.uuid();
    this.nextSequence = 0;
    this.batchCapturedAt = null;
    this.batchBaseEpochMs = 0;
    this.batchStartPerfMs = 0;
    this.lastEffectiveSampleEpochMs = 0;
    this.lastGazeOffsetMs = -1;
    this.lastGameplayOffsetMs = -1;
    this.brokerAcceptedCount = 0;
    this.permanentRejectedCount = 0;
    this.droppedOverflowCount = 0;
    this.lastWarning = null;
    this.notifyStateChange();
  }

  private async drainLoop(): Promise<void> {
    try {
      while (this.queue.length > 0) {
        const entry = this.queue[0];
        const targetBatchId = entry.body.batchId;
        entry.inFlight = true;
        let deliveredOrDiscarded = false;

        for (let attempt = 1; attempt <= this.maxAttemptsPerFlush; attempt++) {
          entry.attempts += 1;
          try {
            await this.sendBatch(entry.body);
            const idx = this.queue.findIndex((e) => e.body.batchId === targetBatchId);
            if (idx !== -1) {
              this.queue.splice(idx, 1);
            }
            this.brokerAcceptedCount += 1;
            this.lastWarning = null;
            this.notifyStateChange();
            deliveredOrDiscarded = true;
            break;
          } catch (err) {
            const statusCode = extractStatusCode(err);
            const errorMessage = err instanceof Error ? err.message : String(err);
            entry.lastStatusCode = statusCode;
            entry.lastError = errorMessage;

            if (statusCode === 400 || statusCode === 403) {
              const idx = this.queue.findIndex((e) => e.body.batchId === targetBatchId);
              if (idx !== -1) {
                this.queue.splice(idx, 1);
              }
              this.permanentRejectedCount += 1;
              this.lastWarning = `Telemetry batch ${targetBatchId} permanently rejected (HTTP ${statusCode}): ${errorMessage}`;
              this.notifyStateChange();
              deliveredOrDiscarded = true;
              break;
            }

            if (attempt < this.maxAttemptsPerFlush && this.retryBackoffMs > 0) {
              await this.sleep(this.retryBackoffMs);
            }
          }
        }

        if (!deliveredOrDiscarded) {
          entry.inFlight = false;
          this.lastWarning = `Telemetry batch ${targetBatchId} pending retry (HTTP ${entry.lastStatusCode ?? 0}): ${entry.lastError ?? 'Unknown error'}`;
          this.notifyStateChange();
          break;
        }
      }
    } finally {
      this.activeDrainPromise = null;
    }
  }

  private notifyStateChange(): void {
    this.onStateChange?.(this.getSnapshot());
  }
}
