import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ApiError,
  registerAccessTokenGetter,
  registerAccessTokenRefresher,
} from '../src/infrastructure/api/httpClient.ts';
import { telemetryApi } from '../src/infrastructure/api/telemetryApi.ts';
import type { TelemetryBatchBody } from '../src/infrastructure/api/contracts/telemetry.contracts.ts';
import {
  TelemetryBatchQueue,
  type TelemetryQueueSnapshot,
} from '../src/infrastructure/telemetry/telemetryBatchQueue.ts';

interface CapturedRequest {
  url: string;
  authorization: string | null;
  body: TelemetryBatchBody;
  rawKeys: string[];
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  registerAccessTokenGetter(() => null);
  registerAccessTokenRefresher(async () => null);
});

function createDeterministicUuid(prefix = 'id'): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `${prefix}-${String(counter).padStart(4, '0')}`;
  };
}

function makeJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function captureRequest(url: RequestInfo | URL, init?: RequestInit): CapturedRequest {
  const headers = new Headers(init?.headers);
  const parsed = JSON.parse(String(init?.body)) as TelemetryBatchBody;
  return {
    url: String(url),
    authorization: headers.get('Authorization'),
    body: parsed,
    rawKeys: Object.keys(parsed),
  };
}

const EXPECTED_BATCH_KEYS = [
  'schemaVersion',
  'batchId',
  'therapySessionId',
  'streamId',
  'sequence',
  'capturedAt',
  'sentAt',
  'gazeSamples',
  'gameplaySamples',
].sort();

describe('TelemetryBatchQueue (real telemetryApi + httpClient)', () => {
  it('1. Network error -> +15,000 ms clock advance -> retry -> 202 preserves exact body & 9 keys', async () => {
    let wallMs = 1_700_000_000_000;
    let perfMs = 100;
    const captured: CapturedRequest[] = [];
    let attempt = 0;

    registerAccessTokenGetter(() => 'token-initial');
    globalThis.fetch = async (url, init) => {
      captured.push(captureRequest(url, init));
      attempt += 1;
      if (attempt === 1) {
        throw new TypeError('Failed to fetch');
      }
      return makeJsonResponse(202, { code: 'BROKER_ACCEPTED' });
    };

    const queue = new TelemetryBatchQueue({
      therapySessionId: 'session-1',
      initialStreamId: 'stream-1',
      maxAttemptsPerFlush: 1,
      retryBackoffMs: 0,
      sendBatch: (body) => telemetryApi.sendTelemetryBatch(body),
      nowMs: () => wallMs,
      perfNowMs: () => perfMs,
      sleep: async () => undefined,
      uuid: createDeterministicUuid('batch'),
    });

    queue.recordSample({
      gaze: { x: 0.25, y: 0.5, confidence: 0.92 },
      gameplay: {
        playerX: 10,
        playerY: 20,
        targetX: 30,
        targetY: 40,
        score: 1,
        speed: 2,
        progress: 0.1,
      },
    });
    perfMs += 16;
    queue.recordSample({
      gaze: { x: 0.3, y: 0.55, confidence: 0.95 },
      gameplay: null,
    });

    // First flush fails with network error; unconfirmed batch must be retained
    await queue.flush();
    assert.equal(captured.length, 1);
    assert.equal(queue.getPendingBatches().length, 1, 'unconfirmedBatchRetained');
    assert.equal(queue.getSnapshot().brokerAcceptedCount, 0);

    // Advance wall clock by +15,000 ms before retry
    wallMs += 15_000;
    perfMs += 15_000;

    await queue.flush();
    assert.equal(captured.length, 2);
    assert.equal(queue.getPendingBatches().length, 0, 'onlyAcknowledgedBatchHandled');
    assert.equal(queue.getSnapshot().brokerAcceptedCount, 1);

    const first = captured[0].body;
    const second = captured[1].body;

    assert.deepEqual(captured[0].rawKeys.slice().sort(), EXPECTED_BATCH_KEYS);
    assert.deepEqual(captured[1].rawKeys.slice().sort(), EXPECTED_BATCH_KEYS);

    // sameLogicalIdentity
    assert.equal(second.batchId, first.batchId);
    assert.equal(second.streamId, first.streamId);
    assert.equal(second.sequence, first.sequence);
    assert.equal(second.therapySessionId, first.therapySessionId);

    // sameCapturedAt & sameSentAt (NOT regenerated on retry)
    assert.equal(second.capturedAt, first.capturedAt);
    assert.equal(second.sentAt, first.sentAt);

    // sameSamplesAndOrder & sameCompleteBody
    assert.deepEqual(second.gazeSamples, first.gazeSamples);
    assert.deepEqual(second.gameplaySamples, first.gameplaySamples);
    assert.deepEqual(second, first);
  });

  it('2. 503 TELEMETRY_INGESTION_UNAVAILABLE -> +clock -> retry -> 202 (exact body + sentAt)', async () => {
    let wallMs = 1_700_000_100_000;
    let perfMs = 500;
    const captured: CapturedRequest[] = [];
    let attempt = 0;

    registerAccessTokenGetter(() => 'token-503');
    globalThis.fetch = async (url, init) => {
      captured.push(captureRequest(url, init));
      attempt += 1;
      if (attempt === 1) {
        return makeJsonResponse(503, { code: 'TELEMETRY_INGESTION_UNAVAILABLE' });
      }
      return makeJsonResponse(202, { code: 'BROKER_ACCEPTED' });
    };

    const queue = new TelemetryBatchQueue({
      therapySessionId: 'session-503',
      initialStreamId: 'stream-503',
      maxAttemptsPerFlush: 1,
      retryBackoffMs: 0,
      sendBatch: (body) => telemetryApi.sendTelemetryBatch(body),
      nowMs: () => wallMs,
      perfNowMs: () => perfMs,
      sleep: async () => undefined,
      uuid: createDeterministicUuid('b503'),
    });

    queue.recordSample({ gaze: { x: 0.4, y: 0.6, confidence: 0.88 } });
    await queue.flush();

    assert.equal(queue.getPendingBatches().length, 1);
    assert.equal(queue.getPendingBatches()[0].lastStatusCode, 503);

    wallMs += 8_000;
    await queue.flush();

    assert.equal(captured.length, 2);
    assert.equal(queue.getPendingBatches().length, 0);
    assert.equal(queue.getSnapshot().brokerAcceptedCount, 1);
    assert.deepEqual(captured[1].body, captured[0].body);
    assert.equal(captured[1].body.sentAt, captured[0].body.sentAt);
  });

  it('3. Source buffer mutation + new samples while batch 0 is pending -> batch 0 unchanged, batch 1 gets new batchId & sequence 1', async () => {
    let wallMs = 1_700_000_200_000;
    let perfMs = 1000;
    const captured: CapturedRequest[] = [];
    let callCount = 0;

    registerAccessTokenGetter(() => 'token-mut');
    globalThis.fetch = async (url, init) => {
      captured.push(captureRequest(url, init));
      callCount += 1;
      if (callCount === 1) {
        return makeJsonResponse(503, { code: 'TELEMETRY_INGESTION_UNAVAILABLE' });
      }
      return makeJsonResponse(202, { code: 'BROKER_ACCEPTED' });
    };

    const queue = new TelemetryBatchQueue({
      therapySessionId: 'session-mut',
      initialStreamId: 'stream-mut',
      maxAttemptsPerFlush: 1,
      retryBackoffMs: 0,
      sendBatch: (body) => telemetryApi.sendTelemetryBatch(body),
      nowMs: () => wallMs,
      perfNowMs: () => perfMs,
      sleep: async () => undefined,
      uuid: createDeterministicUuid('bmut'),
    });

    const mutableGazeInput = { x: 0.1, y: 0.2, confidence: 0.9 };
    queue.recordSample({ gaze: mutableGazeInput });
    await queue.flush();

    // Mutate caller's object after flush
    mutableGazeInput.x = 0.999;
    mutableGazeInput.y = 0.999;

    // Record new samples for batch 1
    wallMs += 1_000;
    perfMs += 1_000;
    queue.recordSample({ gaze: { x: 0.5, y: 0.5, confidence: 0.95 } });

    await queue.flush();

    assert.equal(captured.length, 3);
    // Attempt 1 (batch 0) and Attempt 2 (batch 0 retry) must be identical and unaffected by mutation
    assert.deepEqual(captured[1].body, captured[0].body);
    assert.equal(captured[1].body.gazeSamples[0].x, 0.1);
    assert.equal(captured[1].body.sequence, 0);

    // Batch 1 must have a new batchId and sequence 1
    assert.notEqual(captured[2].body.batchId, captured[0].body.batchId);
    assert.equal(captured[2].body.sequence, 1);
    assert.equal(captured[2].body.gazeSamples[0].x, 0.5);
  });

  it('4. Full queue (maxQueueSize: 2) + overlapping flush() while batch 0 is inFlight -> batch 0 202 removes ONLY batch 0, unsent batch 1 delivers with sequence 1', async () => {
    let wallMs = 1_700_000_300_000;
    let perfMs = 2000;
    const captured: CapturedRequest[] = [];

    let resolveBatch0!: (res: Response) => void;
    const batch0InFlightPromise = new Promise<Response>((resolve) => {
      resolveBatch0 = resolve;
    });

    let callIndex = 0;
    registerAccessTokenGetter(() => 'token-overlap');
    globalThis.fetch = async (url, init) => {
      captured.push(captureRequest(url, init));
      callIndex += 1;
      if (callIndex === 1) {
        return batch0InFlightPromise;
      }
      return makeJsonResponse(202, { code: 'BROKER_ACCEPTED' });
    };

    const queue = new TelemetryBatchQueue({
      therapySessionId: 'session-full',
      initialStreamId: 'stream-full',
      maxQueueSize: 2,
      maxAttemptsPerFlush: 1,
      retryBackoffMs: 0,
      sendBatch: (body) => telemetryApi.sendTelemetryBatch(body),
      nowMs: () => wallMs,
      perfNowMs: () => perfMs,
      sleep: async () => undefined,
      uuid: createDeterministicUuid('bfull'),
    });

    // Enqueue batch 0 and batch 1 (queue is now at capacity 2)
    queue.recordSample({ gaze: { x: 0.1, y: 0.1, confidence: 0.9 } });
    queue.enqueueBuffers();
    wallMs += 100;
    perfMs += 100;
    queue.recordSample({ gaze: { x: 0.2, y: 0.2, confidence: 0.9 } });
    queue.enqueueBuffers();

    // Attempt to enqueue a 3rd batch while queue is full -> must be dropped without evicting batch 0
    wallMs += 100;
    perfMs += 100;
    queue.recordSample({ gaze: { x: 0.3, y: 0.3, confidence: 0.9 } });
    const enqueuedOverflow = queue.enqueueBuffers();
    assert.equal(enqueuedOverflow, 0);
    assert.equal(queue.getSnapshot().droppedOverflowCount, 1);
    assert.equal(queue.getPendingBatches().length, 2);
    assert.equal(queue.getPendingBatches()[0].body.sequence, 0);
    assert.equal(queue.getPendingBatches()[1].body.sequence, 1);

    // Start flush 1 (batch 0 goes inFlight)
    const flush1 = queue.flush();
    // Yield microtask so fetch for batch 0 is invoked and batch 0 is inFlight
    await Promise.resolve();
    assert.equal(captured.length, 1);
    assert.equal(queue.getPendingBatches()[0].inFlight, true);

    // Overlapping flush 2 while batch 0 is inFlight
    const flush2 = queue.flush();

    // Resolve batch 0 with 202
    resolveBatch0(makeJsonResponse(202, { code: 'BROKER_ACCEPTED' }));

    await Promise.all([flush1, flush2]);

    assert.equal(captured.length, 2);
    assert.equal(captured[0].body.sequence, 0);
    assert.equal(captured[1].body.sequence, 1);
    assert.equal(queue.getPendingBatches().length, 0);
    assert.equal(queue.getSnapshot().brokerAcceptedCount, 2);
  });

  it('5. 401 token refresh between attempts -> Authorization updates while JSON body including sentAt stays identical', async () => {
    let wallMs = 1_700_000_400_000;
    let perfMs = 3000;
    const captured: CapturedRequest[] = [];
    let currentToken = 'expired-token';
    let attempt = 0;

    registerAccessTokenGetter(() => currentToken);
    registerAccessTokenRefresher(async () => {
      currentToken = 'fresh-token-401';
      return currentToken;
    });

    globalThis.fetch = async (url, init) => {
      captured.push(captureRequest(url, init));
      attempt += 1;
      if (attempt === 1) {
        return makeJsonResponse(401, { code: 'TOKEN_EXPIRED' });
      }
      return makeJsonResponse(202, { code: 'BROKER_ACCEPTED' });
    };

    const queue = new TelemetryBatchQueue({
      therapySessionId: 'session-401',
      initialStreamId: 'stream-401',
      maxAttemptsPerFlush: 1,
      retryBackoffMs: 0,
      sendBatch: (body) => telemetryApi.sendTelemetryBatch(body),
      nowMs: () => wallMs,
      perfNowMs: () => perfMs,
      sleep: async () => undefined,
      uuid: createDeterministicUuid('b401'),
    });

    queue.recordSample({ gaze: { x: 0.7, y: 0.3, confidence: 0.99 } });
    await queue.flush();

    assert.equal(captured.length, 2);
    assert.equal(captured[0].authorization, 'Bearer expired-token');
    assert.equal(captured[1].authorization, 'Bearer fresh-token-401');
    assert.deepEqual(captured[1].body, captured[0].body);
    assert.equal(captured[1].body.sentAt, captured[0].body.sentAt);
    assert.equal(queue.getPendingBatches().length, 0);
    assert.equal(queue.getSnapshot().brokerAcceptedCount, 1);
  });

  it('6. Multi-batch capturedAt + offsetMs strictly monotonic across 3 batches (no 2x drift)', async () => {
    let wallMs = 1_700_000_500_000;
    let perfMs = 10_000;
    const captured: CapturedRequest[] = [];

    registerAccessTokenGetter(() => 'token-mono');
    globalThis.fetch = async (url, init) => {
      captured.push(captureRequest(url, init));
      return makeJsonResponse(202, { code: 'BROKER_ACCEPTED' });
    };

    const queue = new TelemetryBatchQueue({
      therapySessionId: 'session-mono',
      initialStreamId: 'stream-mono',
      sendBatch: (body) => telemetryApi.sendTelemetryBatch(body),
      nowMs: () => wallMs,
      perfNowMs: () => perfMs,
      sleep: async () => undefined,
      uuid: createDeterministicUuid('bmono'),
    });

    // Batch 0: 2 samples at perf +0ms, +20ms
    queue.recordSample({ gaze: { x: 0.1, y: 0.1, confidence: 0.9 } });
    wallMs += 20;
    perfMs += 20;
    queue.recordSample({ gaze: { x: 0.2, y: 0.2, confidence: 0.9 } });
    await queue.flush();

    // Batch 1: wall clock didn't advance (or even stalled), perf advances +20ms between samples
    perfMs += 30;
    queue.recordSample({ gaze: { x: 0.3, y: 0.3, confidence: 0.9 } });
    wallMs += 20;
    perfMs += 20;
    queue.recordSample({ gaze: { x: 0.4, y: 0.4, confidence: 0.9 } });
    await queue.flush();

    // Batch 2: another 2 samples
    wallMs += 50;
    perfMs += 50;
    queue.recordSample({ gaze: { x: 0.5, y: 0.5, confidence: 0.9 } });
    wallMs += 20;
    perfMs += 20;
    queue.recordSample({ gaze: { x: 0.6, y: 0.6, confidence: 0.9 } });
    await queue.flush();

    assert.equal(captured.length, 3);

    const effectiveTimestamps: number[] = [];
    for (const req of captured) {
      const baseMs = Date.parse(req.body.capturedAt);
      // Each batch's first gaze sample starts at offsetMs 0 (no 2x global drift)
      assert.equal(req.body.gazeSamples[0].offsetMs, 0);
      assert.equal(req.body.gazeSamples[1].offsetMs, 20);
      for (const sample of req.body.gazeSamples) {
        effectiveTimestamps.push(baseMs + sample.offsetMs);
      }
    }

    assert.equal(effectiveTimestamps.length, 6);
    for (let i = 1; i < effectiveTimestamps.length; i++) {
      assert.ok(
        effectiveTimestamps[i] > effectiveTimestamps[i - 1],
        `Expected strictly monotonic timestamp at index ${i}: ${effectiveTimestamps[i]} > ${effectiveTimestamps[i - 1]}`
      );
    }
  });

  it('7. RG-03: 4 overlapping flush() calls with newly recorded samples serialize into a single drain with zero duplicate sends', async () => {
    let wallMs = 1_700_000_600_000;
    let perfMs = 20_000;
    const captured: CapturedRequest[] = [];

    const deferredResponses: Array<(res: Response) => void> = [];
    registerAccessTokenGetter(() => 'token-rg03');
    globalThis.fetch = (url, init) => {
      captured.push(captureRequest(url, init));
      return new Promise<Response>((resolve) => {
        deferredResponses.push(resolve);
      });
    };

    const queue = new TelemetryBatchQueue({
      therapySessionId: 'session-rg03',
      initialStreamId: 'stream-rg03',
      maxAttemptsPerFlush: 1,
      retryBackoffMs: 0,
      sendBatch: (body) => telemetryApi.sendTelemetryBatch(body),
      nowMs: () => wallMs,
      perfNowMs: () => perfMs,
      sleep: async () => undefined,
      uuid: createDeterministicUuid('brg03'),
    });

    // Batch 0 starts flushing and holds in-flight
    queue.recordSample({ gaze: { x: 0.1, y: 0.1, confidence: 0.9 } });
    const flush1 = queue.flush();
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(captured.length, 1);
    assert.equal(queue.getSnapshot().inFlightCount, 1);
    assert.equal(queue.getSnapshot().pendingCount, 1);
    assert.equal(queue.getSnapshot().bufferedSampleCount, 0);

    // Record new sample -> overlap flush2, flush3, then another sample + flush4, flush5
    wallMs += 50;
    perfMs += 50;
    queue.recordSample({ gaze: { x: 0.2, y: 0.2, confidence: 0.9 } });
    assert.equal(queue.getSnapshot().bufferedSampleCount, 1);

    const flush2 = queue.flush();
    const flush3 = queue.flush();

    wallMs += 50;
    perfMs += 50;
    queue.recordSample({ gaze: { x: 0.3, y: 0.3, confidence: 0.9 } });
    const flush4 = queue.flush();
    const flush5 = queue.flush();

    await new Promise((r) => setTimeout(r, 0));
    // Must still have ONLY batch 0 in-flight (never a second concurrent drain)
    assert.equal(captured.length, 1);
    assert.equal(deferredResponses.length, 1);
    assert.equal(queue.getSnapshot().pendingCount, 3);
    assert.equal(queue.getSnapshot().inFlightCount, 1);
    assert.equal(queue.getSnapshot().bufferedSampleCount, 0);

    // Settle batch 0 -> single drain owner advances to batch 1
    deferredResponses[0](makeJsonResponse(202, { code: 'BROKER_ACCEPTED' }));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(captured.length, 2);
    assert.equal(captured[1].body.sequence, 1);
    assert.equal(queue.getSnapshot().brokerAcceptedCount, 1);
    assert.equal(queue.getSnapshot().inFlightCount, 1);

    // Settle batch 1 -> single drain owner advances to batch 2
    deferredResponses[1](makeJsonResponse(202, { code: 'BROKER_ACCEPTED' }));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(captured.length, 3);
    assert.equal(captured[2].body.sequence, 2);

    // Settle batch 2
    deferredResponses[2](makeJsonResponse(202, { code: 'BROKER_ACCEPTED' }));
    await Promise.all([flush1, flush2, flush3, flush4, flush5]);

    assert.equal(captured.length, 3);
    assert.deepEqual(
      captured.map((req) => req.body.sequence),
      [0, 1, 2]
    );
    assert.equal(queue.getSnapshot().brokerAcceptedCount, 3);
    assert.equal(queue.getSnapshot().pendingCount, 0);
    assert.equal(queue.getSnapshot().inFlightCount, 0);
    assert.equal(queue.getSnapshot().bufferedSampleCount, 0);
    assert.equal(queue.hasPending(), false);
  });

  it('8. HTTP 413/415 permanent rejections and queue overflow surface hasPermanentDataLoss without retry', async () => {
    let wallMs = 1_700_000_700_000;
    let perfMs = 30_000;
    const captured: CapturedRequest[] = [];

    registerAccessTokenGetter(() => 'token-perm');
    let callIdx = 0;
    globalThis.fetch = async (url, init) => {
      captured.push(captureRequest(url, init));
      callIdx += 1;
      if (callIdx === 1) {
        return makeJsonResponse(413, { code: 'PAYLOAD_TOO_LARGE', message: 'Batch too big' });
      }
      if (callIdx === 2) {
        return makeJsonResponse(415, {
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: 'Bad media type',
        });
      }
      return makeJsonResponse(202, { code: 'BROKER_ACCEPTED' });
    };

    const queue = new TelemetryBatchQueue({
      therapySessionId: 'session-perm',
      initialStreamId: 'stream-perm',
      maxAttemptsPerFlush: 3,
      retryBackoffMs: 0,
      sendBatch: (body) => telemetryApi.sendTelemetryBatch(body),
      nowMs: () => wallMs,
      perfNowMs: () => perfMs,
      sleep: async () => undefined,
      uuid: createDeterministicUuid('bperm'),
    });

    queue.recordSample({ gaze: { x: 0.1, y: 0.1, confidence: 0.9 } });
    await queue.flush();
    assert.equal(captured.length, 1);
    assert.equal(queue.getSnapshot().permanentRejectedCount, 1);
    assert.equal(queue.getSnapshot().hasPermanentDataLoss, true);
    assert.equal(queue.getSnapshot().pendingCount, 0);
    assert.equal(queue.getSnapshot().inFlightCount, 0);
    assert.equal(queue.hasPending(), false);
    assert.ok(queue.getSnapshot().lastWarning?.includes('413'));

    wallMs += 100;
    perfMs += 100;
    queue.recordSample({ gaze: { x: 0.2, y: 0.2, confidence: 0.9 } });
    await queue.flush();
    assert.equal(captured.length, 2);
    assert.equal(queue.getSnapshot().permanentRejectedCount, 2);
    assert.equal(queue.getSnapshot().hasPermanentDataLoss, true);
    assert.ok(queue.getSnapshot().lastWarning?.includes('415'));

    // Subsequent accepted batch still retains hasPermanentDataLoss = true
    wallMs += 100;
    perfMs += 100;
    queue.recordSample({ gaze: { x: 0.3, y: 0.3, confidence: 0.9 } });
    await queue.flush();
    assert.equal(captured.length, 3);
    assert.equal(queue.getSnapshot().brokerAcceptedCount, 1);
    assert.equal(queue.getSnapshot().permanentRejectedCount, 2);
    assert.equal(queue.getSnapshot().hasPermanentDataLoss, true);

    // Overflow alone also sets hasPermanentDataLoss = true
    const overflowQueue = new TelemetryBatchQueue({
      therapySessionId: 'session-overflow',
      maxQueueSize: 1,
      sendBatch: (body) => telemetryApi.sendTelemetryBatch(body),
      nowMs: () => wallMs,
      perfNowMs: () => perfMs,
      uuid: createDeterministicUuid('bovf'),
    });
    overflowQueue.recordSample({ gaze: { x: 0.1, y: 0.1, confidence: 0.9 } });
    overflowQueue.enqueueBuffers();
    overflowQueue.recordSample({ gaze: { x: 0.2, y: 0.2, confidence: 0.9 } });
    assert.equal(overflowQueue.enqueueBuffers(), 0);
    assert.equal(overflowQueue.getSnapshot().droppedOverflowCount, 1);
    assert.equal(overflowQueue.getSnapshot().hasPermanentDataLoss, true);
  });

  it('9. rotateStream() while batch 0 is inFlight preserves old-stream batches and starts new stream at sequence 0', async () => {
    let wallMs = 1_700_000_800_000;
    let perfMs = 40_000;
    const captured: CapturedRequest[] = [];
    const deferredResponses: Array<(res: Response) => void> = [];

    registerAccessTokenGetter(() => 'token-rotate');
    globalThis.fetch = (url, init) => {
      captured.push(captureRequest(url, init));
      return new Promise<Response>((resolve) => {
        deferredResponses.push(resolve);
      });
    };

    const queue = new TelemetryBatchQueue({
      therapySessionId: 'session-rotate',
      initialStreamId: 'stream-rot-0',
      maxAttemptsPerFlush: 1,
      retryBackoffMs: 0,
      sendBatch: (body) => telemetryApi.sendTelemetryBatch(body),
      nowMs: () => wallMs,
      perfNowMs: () => perfMs,
      sleep: async () => undefined,
      uuid: createDeterministicUuid('rot'),
    });

    // Batch 0 on stream-rot-0 goes inFlight
    queue.recordSample({ gaze: { x: 0.1, y: 0.1, confidence: 0.9 } });
    const flush1 = queue.flush();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(captured.length, 1);
    assert.equal(queue.getSnapshot().inFlightCount, 1);

    // Sample 1 buffered on stream-rot-0 before rotation
    wallMs += 50;
    perfMs += 50;
    queue.recordSample({ gaze: { x: 0.2, y: 0.2, confidence: 0.9 } });

    const rotatePromise = queue.rotateStream();
    const rotatedStreamId = queue.getSnapshot().streamId;
    assert.notEqual(rotatedStreamId, 'stream-rot-0');
    assert.equal(queue.getSnapshot().nextSequence, 0);
    assert.equal(queue.getSnapshot().pendingCount, 2);
    assert.equal(queue.getSnapshot().bufferedSampleCount, 0);
    assert.equal(captured.length, 1);

    // Sample 2 recorded on rotated stream
    wallMs += 50;
    perfMs += 50;
    queue.recordSample({ gaze: { x: 0.3, y: 0.3, confidence: 0.9 } });
    const flush2 = queue.flush();

    // Settle batch 0, batch 1, batch 2 sequentially
    deferredResponses[0](makeJsonResponse(202, { code: 'BROKER_ACCEPTED' }));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(captured.length, 2);

    deferredResponses[1](makeJsonResponse(202, { code: 'BROKER_ACCEPTED' }));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(captured.length, 3);

    deferredResponses[2](makeJsonResponse(202, { code: 'BROKER_ACCEPTED' }));
    await Promise.all([flush1, rotatePromise, flush2]);

    assert.equal(captured.length, 3);
    assert.equal(captured[0].body.streamId, 'stream-rot-0');
    assert.equal(captured[0].body.sequence, 0);
    assert.equal(captured[0].body.gazeSamples[0].x, 0.1);

    assert.equal(captured[1].body.streamId, 'stream-rot-0');
    assert.equal(captured[1].body.sequence, 1);
    assert.equal(captured[1].body.gazeSamples[0].x, 0.2);

    assert.equal(captured[2].body.streamId, rotatedStreamId);
    assert.equal(captured[2].body.sequence, 0);
    assert.equal(captured[2].body.gazeSamples[0].x, 0.3);

    assert.ok(Date.parse(captured[2].body.capturedAt) > Date.parse(captured[1].body.capturedAt));
    assert.equal(queue.getSnapshot().brokerAcceptedCount, 3);
    assert.equal(queue.getSnapshot().pendingCount, 0);
  });

  it('10. dispose() and reset() isolate in-flight HTTP settlements without post-disposal callbacks or cross-session corruption', async () => {
    let wallMs = 1_700_000_900_000;
    let perfMs = 50_000;

    // Part A: dispose() suppresses late 202 and late 400 callbacks/mutations
    const snapshotsA: TelemetryQueueSnapshot[] = [];
    let resolveInFlightA!: (res: { code: 'BROKER_ACCEPTED' }) => void;
    let sendCountA = 0;

    const queueA = new TelemetryBatchQueue({
      therapySessionId: 'session-disp-a',
      initialStreamId: 'stream-disp-a',
      maxAttemptsPerFlush: 1,
      retryBackoffMs: 0,
      sendBatch: () => {
        sendCountA += 1;
        return new Promise((resolve) => {
          resolveInFlightA = resolve;
        });
      },
      nowMs: () => wallMs,
      perfNowMs: () => perfMs,
      sleep: async () => undefined,
      uuid: createDeterministicUuid('dispA'),
      onStateChange: (snap) => snapshotsA.push(snap),
    });

    queueA.recordSample({ gaze: { x: 0.1, y: 0.1, confidence: 0.9 } });
    const flushA = queueA.flush();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(queueA.getSnapshot().inFlightCount, 1);

    queueA.dispose();
    const callbackCountAtDispose = snapshotsA.length;
    const snapAtDispose = queueA.getSnapshot();

    // Post-disposal mutations and drains must be no-ops
    queueA.recordSample({ gaze: { x: 0.2, y: 0.2, confidence: 0.9 } });
    assert.equal(queueA.enqueueBuffers(), 0);
    assert.equal(
      queueA.enqueueCustomBatch([{ offsetMs: 0, x: 0.2, y: 0.2, confidence: 0.9 }], []),
      null
    );
    await queueA.flush();
    await queueA.rotateStream();
    assert.equal(sendCountA, 1);

    resolveInFlightA({ code: 'BROKER_ACCEPTED' });
    await flushA;
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(snapshotsA.length, callbackCountAtDispose);
    assert.deepEqual(queueA.getSnapshot(), snapAtDispose);
    assert.equal(queueA.getSnapshot().brokerAcceptedCount, 0);

    // Part B: reset() while old session batch is in-flight prevents late 400 from corrupting new session
    let rejectOldSession!: (err: unknown) => void;
    let resolveNewSession!: (res: { code: 'BROKER_ACCEPTED' }) => void;
    const sentSessions: string[] = [];

    const queueB = new TelemetryBatchQueue({
      therapySessionId: 'session-old',
      initialStreamId: 'stream-old',
      maxAttemptsPerFlush: 1,
      retryBackoffMs: 0,
      sendBatch: (body) => {
        sentSessions.push(body.therapySessionId);
        if (body.therapySessionId === 'session-old') {
          return new Promise((_, reject) => {
            rejectOldSession = reject;
          });
        }
        return new Promise((resolve) => {
          resolveNewSession = resolve;
        });
      },
      nowMs: () => wallMs,
      perfNowMs: () => perfMs,
      sleep: async () => undefined,
      uuid: createDeterministicUuid('rst'),
    });

    queueB.recordSample({ gaze: { x: 0.1, y: 0.1, confidence: 0.9 } });
    const flushOld = queueB.flush();
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(sentSessions, ['session-old']);

    queueB.reset('session-new');
    wallMs += 100;
    perfMs += 100;
    queueB.recordSample({ gaze: { x: 0.4, y: 0.4, confidence: 0.9 } });
    const flushNew = queueB.flush();
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(sentSessions, ['session-old', 'session-new']);

    resolveNewSession({ code: 'BROKER_ACCEPTED' });
    await flushNew;

    rejectOldSession(new ApiError(400, 'INVALID_SESSION', 'Old session rejected'));
    await flushOld;

    const finalSnap = queueB.getSnapshot();
    assert.equal(finalSnap.brokerAcceptedCount, 1);
    assert.equal(finalSnap.permanentRejectedCount, 0);
    assert.equal(finalSnap.pendingCount, 0);
    assert.equal(finalSnap.inFlightCount, 0);
    assert.equal(finalSnap.lastWarning, null);
    assert.equal(finalSnap.hasPermanentDataLoss, false);
  });

  it('11. 5 simultaneous flush() calls after a failed 503 drain keep max concurrency 1 per batchId and preserve exact Batch 0 body', async () => {
    let wallMs = 1_700_000_950_000;
    let perfMs = 60_000;

    registerAccessTokenGetter(() => 'token-post503-concurrent');
    globalThis.fetch = async () =>
      makeJsonResponse(503, { code: 'TELEMETRY_INGESTION_UNAVAILABLE' });

    const queue = new TelemetryBatchQueue({
      therapySessionId: 'session-503-concurrent',
      initialStreamId: 'stream-503-concurrent',
      maxAttemptsPerFlush: 1,
      retryBackoffMs: 0,
      sendBatch: (body) => telemetryApi.sendTelemetryBatch(body),
      nowMs: () => wallMs,
      perfNowMs: () => perfMs,
      sleep: async () => undefined,
      uuid: createDeterministicUuid('b503c'),
    });

    queue.recordSample({ gaze: { x: 0.15, y: 0.25, confidence: 0.9 } });
    assert.equal(queue.enqueueBuffers(), 1);
    wallMs += 100;
    perfMs += 100;
    queue.recordSample({ gaze: { x: 0.35, y: 0.45, confidence: 0.92 } });
    assert.equal(queue.enqueueBuffers(), 1);

    // Initial drain fails Batch 0 with 503, leaving both Batch 0 and Batch 1 pending
    await queue.flush();
    assert.equal(queue.getPendingBatches().length, 2);
    assert.equal(queue.getPendingBatches()[0].lastStatusCode, 503);
    assert.equal(queue.getSnapshot().pendingCount, 2);
    assert.equal(queue.getSnapshot().brokerAcceptedCount, 0);

    const batch0Snapshot = JSON.parse(
      JSON.stringify(queue.getPendingBatches()[0].body)
    ) as TelemetryBatchBody;
    const batch1Id = queue.getPendingBatches()[1].body.batchId;

    const retriedRequests: CapturedRequest[] = [];
    const inFlightByBatchId = new Map<string, number>();
    const maxConcurrencyByBatchId = new Map<string, number>();
    const deferredResolvers: Array<(res: Response) => void> = [];

    globalThis.fetch = async (url, init) => {
      const req = captureRequest(url, init);
      retriedRequests.push(req);
      const batchId = req.body.batchId;
      const active = (inFlightByBatchId.get(batchId) ?? 0) + 1;
      inFlightByBatchId.set(batchId, active);
      maxConcurrencyByBatchId.set(
        batchId,
        Math.max(maxConcurrencyByBatchId.get(batchId) ?? 0, active)
      );
      try {
        return await new Promise<Response>((resolve) => {
          deferredResolvers.push(resolve);
        });
      } finally {
        inFlightByBatchId.set(batchId, (inFlightByBatchId.get(batchId) ?? 1) - 1);
      }
    };

    // Fire 5 simultaneous flush() calls while Batch 0's retry HTTP promise is held open
    wallMs += 5_000;
    const simultaneousFlushes = Promise.all([
      queue.flush(),
      queue.flush(),
      queue.flush(),
      queue.flush(),
      queue.flush(),
    ]);

    await new Promise((r) => setTimeout(r, 0));
    assert.equal(retriedRequests.length, 1);
    assert.deepEqual(retriedRequests[0].body, batch0Snapshot);
    assert.equal(retriedRequests[0].body.sentAt, batch0Snapshot.sentAt);
    assert.equal(maxConcurrencyByBatchId.get(batch0Snapshot.batchId), 1);
    assert.equal(maxConcurrencyByBatchId.get(batch1Id) ?? 0, 0);
    assert.equal(queue.getSnapshot().inFlightCount, 1);
    assert.equal(queue.getSnapshot().pendingCount, 2);

    // Resolve Batch 0 (202) -> advances to Batch 1
    deferredResolvers[0](makeJsonResponse(202, { code: 'BROKER_ACCEPTED' }));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(retriedRequests.length, 2);
    assert.equal(retriedRequests[1].body.batchId, batch1Id);
    assert.equal(maxConcurrencyByBatchId.get(batch1Id), 1);

    // Resolve Batch 1 (202)
    deferredResolvers[1](makeJsonResponse(202, { code: 'BROKER_ACCEPTED' }));
    await simultaneousFlushes;

    assert.equal(retriedRequests.length, 2);
    assert.equal(maxConcurrencyByBatchId.get(batch0Snapshot.batchId), 1);
    assert.equal(maxConcurrencyByBatchId.get(batch1Id), 1);
    assert.equal(queue.getSnapshot().brokerAcceptedCount, 2);
    assert.equal(queue.getSnapshot().pendingCount, 0);
    assert.equal(queue.getSnapshot().inFlightCount, 0);
  });
});
