import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  registerAccessTokenGetter,
  registerAccessTokenRefresher,
} from '../src/infrastructure/api/httpClient.ts';
import { telemetryApi } from '../src/infrastructure/api/telemetryApi.ts';
import type { TelemetryBatchBody } from '../src/infrastructure/api/contracts/telemetry.contracts.ts';
import { TelemetryBatchQueue } from '../src/infrastructure/telemetry/telemetryBatchQueue.ts';

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
});
