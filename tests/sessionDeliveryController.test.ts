import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ApiError,
  registerAccessTokenGetter,
} from '../src/infrastructure/api/httpClient.ts';
import { telemetryApi } from '../src/infrastructure/api/telemetryApi.ts';
import {
  analyticsApi,
  type AnyTrialBody,
} from '../src/infrastructure/api/analyticsApi.ts';
import type {
  AnalyticsExerciseSlug,
  AnalyticsTrialReceipt,
  VisualSearchTrialBody,
} from '../src/infrastructure/api/contracts/analytics.contracts.ts';
import type {
  TelemetryBatchAcceptedResponse,
  TelemetryBatchBody,
} from '../src/infrastructure/api/contracts/telemetry.contracts.ts';
import {
  SessionDeliveryController,
  type SessionSyncSummary,
} from '../src/infrastructure/telemetry/sessionDeliveryController.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  registerAccessTokenGetter(() => null);
});

function createDeterministicUuid(prefix = 'ctrl'): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `${prefix}-${String(counter).padStart(4, '0')}`;
  };
}

function makeTrialBody(trialId: string, searchDurationMs = 1000): VisualSearchTrialBody {
  return {
    schemaVersion: 1,
    trialId,
    dataOrigin: 'PRODUCER_REPORTED',
    outcome: 'SUCCESS',
    confirmedDwellMs: 400,
    searchDurationMs,
  };
}

describe('SessionDeliveryController', () => {
  it('1. syncSession is a strict no-op when sessionId is unchanged and isolates disposed session callbacks on switch', async () => {
    const summaries: SessionSyncSummary[] = [];
    let wallMs = 1_700_001_000_000;
    let perfMs = 100;

    let resolveSession1Telemetry!: (res: TelemetryBatchAcceptedResponse) => void;
    let resolveSession1Trial!: (receipt: AnalyticsTrialReceipt) => void;
    const telemetrySessionCalls: string[] = [];
    const trialSessionCalls: string[] = [];

    const controller = new SessionDeliveryController({
      maxAttemptsPerFlush: 1,
      retryBackoffMs: 0,
      nowMs: () => wallMs,
      perfNowMs: () => perfMs,
      sleep: async () => undefined,
      uuid: createDeterministicUuid('s1'),
      onSyncSummaryChange: (summary) => summaries.push(summary),
      sendTelemetryBatch: (body) => {
        telemetrySessionCalls.push(body.therapySessionId);
        if (body.therapySessionId === 'session-1') {
          return new Promise<TelemetryBatchAcceptedResponse>((resolve) => {
            resolveSession1Telemetry = resolve;
          });
        }
        return Promise.resolve({ code: 'BROKER_ACCEPTED' });
      },
      sendTrialResult: (therapySessionId) => {
        trialSessionCalls.push(therapySessionId);
        if (therapySessionId === 'session-1') {
          return new Promise<AnalyticsTrialReceipt>((resolve) => {
            resolveSession1Trial = resolve;
          });
        }
        return Promise.resolve({ status: 'CREATED' });
      },
    });

    assert.equal(controller.syncSession('session-1', false), true);
    assert.equal(controller.getActiveSessionId(), 'session-1');

    const telemetryQueue1 = controller.getTelemetryQueue();
    const trialQueue1 = controller.getTrialQueue();
    assert.ok(telemetryQueue1 !== null);
    assert.ok(trialQueue1 !== null);

    controller.recordTelemetrySample({ gaze: { x: 0.2, y: 0.3, confidence: 0.95 } });
    const s1Flush = controller.flushTelemetry();
    const s1Trial = controller.submitTrial('visual-search', makeTrialBody('t-s1-1'));
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(controller.getSyncSummary().inFlightTelemetryBatches, 1);
    assert.equal(controller.getSyncSummary().inFlightTrials, 1);

    // Repeating syncSession with identical sessionId (even with different initialMouseFallback) MUST be a strict NO-OP
    const summaryCountBeforeNoop = summaries.length;
    assert.equal(controller.syncSession('session-1', true), false);
    assert.equal(controller.getTelemetryQueue(), telemetryQueue1);
    assert.equal(controller.getTrialQueue(), trialQueue1);
    assert.equal(summaries.length, summaryCountBeforeNoop);
    assert.equal(controller.getSyncSummary().inFlightTelemetryBatches, 1);
    assert.equal(controller.getSyncSummary().inFlightTrials, 1);

    // Switching to session-2 disposes session-1 queues and resets controller summary cleanly
    assert.equal(controller.syncSession('session-2', false), true);
    assert.equal(controller.getActiveSessionId(), 'session-2');
    assert.notEqual(controller.getTelemetryQueue(), telemetryQueue1);
    assert.notEqual(controller.getTrialQueue(), trialQueue1);

    const s2InitialSummary = controller.getSyncSummary();
    assert.equal(s2InitialSummary.sessionId, 'session-2');
    assert.equal(s2InitialSummary.confirmedTrials, 0);
    assert.equal(s2InitialSummary.pendingTrials, 0);
    assert.equal(s2InitialSummary.inFlightTrials, 0);
    assert.equal(s2InitialSummary.pendingTelemetryBatches, 0);
    assert.equal(s2InitialSummary.inFlightTelemetryBatches, 0);
    assert.equal(s2InitialSummary.bufferedTelemetrySamples, 0);

    // Late settlement of session-1 requests MUST NOT mutate session-2 or emit stale counts
    const summaryCountBeforeLateSettle = summaries.length;
    resolveSession1Telemetry({ code: 'BROKER_ACCEPTED' });
    resolveSession1Trial({ status: 'CREATED' });
    await Promise.all([s1Flush, s1Trial]);
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(summaries.length, summaryCountBeforeLateSettle);
    assert.deepEqual(controller.getSyncSummary(), s2InitialSummary);
    assert.deepEqual(telemetrySessionCalls, ['session-1']);
    assert.deepEqual(trialSessionCalls, ['session-1']);

    // Switching to null disposes session-2 queues cleanly
    assert.equal(controller.syncSession(null), true);
    assert.equal(controller.getActiveSessionId(), null);
    assert.equal(controller.getTelemetryQueue(), null);
    assert.equal(controller.getTrialQueue(), null);
    assert.equal(controller.syncSession(null), false);
  });

  it('2. handleInputOriginChange (webcam -> mouse -> webcam) rotates only telemetry streamId while preserving queued/in-flight telemetry and trial analytics', async () => {
    let wallMs = 1_700_001_100_000;
    let perfMs = 1000;
    const sentBatches: TelemetryBatchBody[] = [];
    const deferredBatches: Array<(res: TelemetryBatchAcceptedResponse) => void> = [];
    const sentTrialPayloads: Array<{ slug: AnalyticsExerciseSlug; body: AnyTrialBody }> = [];
    let resolveInFlightTrial!: (receipt: AnalyticsTrialReceipt) => void;
    let uncertainTrialCalls = 0;

    const controller = new SessionDeliveryController({
      maxAttemptsPerFlush: 1,
      retryBackoffMs: 0,
      nowMs: () => wallMs,
      perfNowMs: () => perfMs,
      sleep: async () => undefined,
      uuid: createDeterministicUuid('orig'),
      sendTelemetryBatch: (body) => {
        sentBatches.push(JSON.parse(JSON.stringify(body)) as TelemetryBatchBody);
        return new Promise<TelemetryBatchAcceptedResponse>((resolve) => {
          deferredBatches.push(resolve);
        });
      },
      sendTrialResult: (_sessionId, slug, body) => {
        sentTrialPayloads.push({
          slug,
          body: JSON.parse(JSON.stringify(body)) as AnyTrialBody,
        });
        if (body.trialId === 't-orig-uncertain') {
          uncertainTrialCalls += 1;
          if (uncertainTrialCalls <= 2) {
            return Promise.reject(
              new ApiError(503, 'WRITE_OUTCOME_UNKNOWN', 'Transient uncertainty')
            );
          }
          return Promise.resolve({ status: 'ALREADY_STORED' });
        }
        return new Promise<AnalyticsTrialReceipt>((resolve) => {
          resolveInFlightTrial = resolve;
        });
      },
    });

    controller.syncSession('session-origin', false);
    const telemetryQueueRef = controller.getTelemetryQueue()!;
    const trialQueueRef = controller.getTrialQueue()!;
    const stream0 = telemetryQueueRef.getSnapshot().streamId;

    // 1. Seed an UNCERTAIN trial (PRODUCER_REPORTED) before toggling origin
    const uncertainBody = makeTrialBody('t-orig-uncertain', 1400);
    const uncertainEntry = await controller.submitTrial('visual-search', uncertainBody);
    assert.equal(uncertainEntry?.status, 'UNCERTAIN');
    const uncertainTrialSnapshot = JSON.parse(
      JSON.stringify(trialQueueRef.getSummary().entries[0].body)
    ) as VisualSearchTrialBody;
    assert.equal(uncertainTrialSnapshot.dataOrigin, 'PRODUCER_REPORTED');

    // 2. Submit an in-flight trial (PRODUCER_REPORTED)
    const inFlightTrialBody = makeTrialBody('t-orig-inflight', 1650);
    const inFlightTrialPromise = controller.submitTrial('visual-search', inFlightTrialBody);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(controller.getSyncSummary().inFlightTrials, 1);
    assert.equal(controller.getSyncSummary().uncertainTrials, 1);
    const inFlightTrialSnapshot = JSON.parse(
      JSON.stringify(trialQueueRef.getSummary().entries[1].body)
    ) as VisualSearchTrialBody;
    assert.equal(inFlightTrialSnapshot.dataOrigin, 'PRODUCER_REPORTED');

    // 3. Start telemetry batch 0 (in-flight on stream0, seq 0) and enqueue batch 1 (queued on stream0, seq 1)
    controller.recordTelemetrySample({ gaze: { x: 0.1, y: 0.1, confidence: 0.9 } });
    const flush0 = controller.flushTelemetry();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(sentBatches.length, 1);
    assert.equal(controller.getSyncSummary().inFlightTelemetryBatches, 1);

    wallMs += 40;
    perfMs += 40;
    controller.recordTelemetrySample({ gaze: { x: 0.2, y: 0.2, confidence: 0.91 } });
    assert.equal(telemetryQueueRef.enqueueBuffers(), 1);

    // Detached deep copies of in-flight batch 0 and queued batch 1 before any origin toggle
    const batch0Snapshot = JSON.parse(
      JSON.stringify(telemetryQueueRef.getPendingBatches()[0].body)
    ) as TelemetryBatchBody;
    const batch1Snapshot = JSON.parse(
      JSON.stringify(telemetryQueueRef.getPendingBatches()[1].body)
    ) as TelemetryBatchBody;

    // Also leave one sample buffered on stream0 so handleInputOriginChange(true) flushes it onto stream0 seq 2
    wallMs += 40;
    perfMs += 40;
    controller.recordTelemetrySample({ gaze: { x: 0.25, y: 0.25, confidence: 0.92 } });

    // Same origin (false -> false) is a strict no-op
    await controller.handleInputOriginChange(false);
    assert.equal(telemetryQueueRef.getSnapshot().streamId, stream0);

    // Toggle 1: webcam -> mouse (false -> true)
    const rotateToMousePromise = controller.handleInputOriginChange(true);
    const stream1 = telemetryQueueRef.getSnapshot().streamId;
    assert.notEqual(stream1, stream0);
    assert.equal(telemetryQueueRef.getSnapshot().nextSequence, 0);
    assert.equal(controller.getTelemetryQueue(), telemetryQueueRef);
    assert.equal(controller.getTrialQueue(), trialQueueRef);
    assert.equal(controller.getSyncSummary().pendingTelemetryBatches, 3);
    assert.equal(controller.getSyncSummary().inFlightTrials, 1);
    assert.equal(controller.getSyncSummary().uncertainTrials, 1);

    // Record sample under mouse fallback -> rotates to webcam on Toggle 2
    wallMs += 40;
    perfMs += 40;
    controller.recordTelemetrySample({ gaze: { x: 0.3, y: 0.3, confidence: 0.93 } });

    // Toggle 2: mouse -> webcam (true -> false)
    const rotateToWebcamPromise = controller.handleInputOriginChange(false);
    const stream2 = telemetryQueueRef.getSnapshot().streamId;
    assert.notEqual(stream2, stream0);
    assert.notEqual(stream2, stream1);
    assert.equal(telemetryQueueRef.getSnapshot().nextSequence, 0);
    assert.equal(controller.getTelemetryQueue(), telemetryQueueRef);
    assert.equal(controller.getTrialQueue(), trialQueueRef);

    // Record subsequent sample under restored webcam stream2
    wallMs += 40;
    perfMs += 40;
    controller.recordTelemetrySample({ gaze: { x: 0.4, y: 0.4, confidence: 0.94 } });
    const flushWebcam2 = controller.flushTelemetry();

    // Verify all preserved queued/in-flight bodies remain byte-for-byte identical after false -> true -> false
    const currentPending = telemetryQueueRef.getPendingBatches();
    assert.equal(currentPending.length, 5);
    assert.deepEqual(currentPending[0].body, batch0Snapshot);
    assert.deepEqual(currentPending[1].body, batch1Snapshot);
    assert.equal(currentPending[2].body.streamId, stream0);
    assert.equal(currentPending[2].body.sequence, 2);
    assert.equal(currentPending[3].body.streamId, stream1);
    assert.equal(currentPending[3].body.sequence, 0);
    assert.equal(currentPending[4].body.streamId, stream2);
    assert.equal(currentPending[4].body.sequence, 0);

    const currentTrials = trialQueueRef.getSummary().entries;
    assert.equal(currentTrials.length, 2);
    assert.deepEqual(currentTrials[0].body, uncertainTrialSnapshot);
    assert.deepEqual(currentTrials[1].body, inFlightTrialSnapshot);

    // Settle all 5 telemetry batches sequentially and resolve the in-flight trial
    for (let i = 0; i < 5; i++) {
      deferredBatches[i]({ code: 'BROKER_ACCEPTED' });
      await new Promise((r) => setTimeout(r, 0));
    }
    resolveInFlightTrial({ status: 'CREATED' });
    await Promise.all([
      flush0,
      rotateToMousePromise,
      rotateToWebcamPromise,
      flushWebcam2,
      inFlightTrialPromise,
    ]);

    assert.equal(sentBatches.length, 5);
    assert.deepEqual(sentBatches[0], batch0Snapshot);
    assert.deepEqual(sentBatches[1], batch1Snapshot);
    assert.equal(sentBatches[2].streamId, stream0);
    assert.equal(sentBatches[2].sequence, 2);
    assert.equal(sentBatches[3].streamId, stream1);
    assert.equal(sentBatches[3].sequence, 0);
    assert.equal(sentBatches[4].streamId, stream2);
    assert.equal(sentBatches[4].sequence, 0);

    // prepareClosure drains the preserved UNCERTAIN trial (with identical payload/dataOrigin) and reaches READY
    const closure = await controller.prepareClosure(false);
    assert.equal(closure.allowedToClose, true);
    assert.equal(closure.reason, 'READY');
    assert.equal(closure.summary.confirmedTrials, 2);
    assert.equal(closure.summary.brokerAcceptedTelemetryBatches, 5);
    assert.equal(closure.summary.isSyncComplete, true);

    const retriedUncertain = sentTrialPayloads[sentTrialPayloads.length - 1];
    assert.equal(retriedUncertain.slug, 'visual-search');
    assert.deepEqual(retriedUncertain.body, uncertainTrialSnapshot);
    const inFlightSent = sentTrialPayloads.find(
      (p) => p.body.trialId === 't-orig-inflight'
    );
    assert.deepEqual(inFlightSent?.body, inFlightTrialSnapshot);
  });

  it('3. prepareClosure enforces PENDING_SYNC, FORCED_CLOSE, COMPLETED_WITH_PERMANENT_LOSS, and READY gates', async () => {
    let wallMs = 1_700_001_200_000;
    let perfMs = 2000;
    let mode: 'TRANSIENT' | 'PERMANENT' | 'OK' = 'TRANSIENT';

    const controller = new SessionDeliveryController({
      maxAttemptsPerFlush: 1,
      retryBackoffMs: 0,
      nowMs: () => wallMs,
      perfNowMs: () => perfMs,
      sleep: async () => undefined,
      uuid: createDeterministicUuid('gate'),
      sendTelemetryBatch: async () => {
        if (mode === 'TRANSIENT') {
          throw new ApiError(503, 'TELEMETRY_INGESTION_UNAVAILABLE', 'Broker down');
        }
        if (mode === 'PERMANENT') {
          throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Telemetry batch too large');
        }
        return { code: 'BROKER_ACCEPTED' };
      },
      sendTrialResult: async () => {
        if (mode === 'TRANSIENT') {
          throw new ApiError(503, 'WRITE_OUTCOME_UNKNOWN', 'Trial write uncertain');
        }
        if (mode === 'PERMANENT') {
          throw new ApiError(400, 'INVALID_RESULT', 'Trial validation failed');
        }
        return { status: 'CREATED' };
      },
    });

    // Gate A & B: PENDING_SYNC and FORCED_CLOSE on transient errors
    controller.syncSession('session-gate-transient');
    controller.recordTelemetrySample({ gaze: { x: 0.1, y: 0.1, confidence: 0.9 } });
    await controller.submitTrial('visual-search', makeTrialBody('t-gate-503'));

    const pendingResult = await controller.prepareClosure(false);
    assert.equal(pendingResult.allowedToClose, false);
    assert.equal(pendingResult.reason, 'PENDING_SYNC');
    assert.equal(pendingResult.summary.hasPendingOrUncertainDelivery, true);
    assert.equal(pendingResult.summary.uncertainTrials, 1);
    assert.equal(pendingResult.summary.pendingTelemetryBatches, 1);
    assert.equal(pendingResult.summary.isSyncComplete, false);

    const forcedResult = await controller.prepareClosure(true);
    assert.equal(forcedResult.allowedToClose, true);
    assert.equal(forcedResult.reason, 'FORCED_CLOSE');
    assert.equal(forcedResult.summary.hasPendingOrUncertainDelivery, true);

    // Gate C: COMPLETED_WITH_PERMANENT_LOSS does not block ordinary closure but surfaces permanent loss visibly
    mode = 'PERMANENT';
    controller.syncSession('session-gate-permanent');
    controller.recordTelemetrySample({ gaze: { x: 0.2, y: 0.2, confidence: 0.9 } });
    await controller.submitTrial('visual-search', makeTrialBody('t-gate-400'));

    const permLossResult = await controller.prepareClosure(false);
    assert.equal(permLossResult.allowedToClose, true);
    assert.equal(permLossResult.reason, 'COMPLETED_WITH_PERMANENT_LOSS');
    assert.equal(permLossResult.summary.hasPendingOrUncertainDelivery, false);
    assert.equal(permLossResult.summary.hasPermanentDataLoss, true);
    assert.equal(permLossResult.summary.failedPermanentTrials, 1);
    assert.equal(permLossResult.summary.permanentRejectedTelemetryBatches, 1);
    assert.equal(permLossResult.summary.isSyncComplete, false);
    assert.ok(permLossResult.summary.lastWarning !== null);

    // Gate D: READY when all items succeed
    mode = 'OK';
    controller.syncSession('session-gate-ready');
    controller.recordTelemetrySample({ gaze: { x: 0.3, y: 0.3, confidence: 0.9 } });
    await controller.submitTrial('visual-search', makeTrialBody('t-gate-ok'));

    const readyResult = await controller.prepareClosure(false);
    assert.equal(readyResult.allowedToClose, true);
    assert.equal(readyResult.reason, 'READY');
    assert.equal(readyResult.summary.hasPendingOrUncertainDelivery, false);
    assert.equal(readyResult.summary.hasPermanentDataLoss, false);
    assert.equal(readyResult.summary.isSyncComplete, true);
    assert.equal(readyResult.summary.confirmedTrials, 1);
    assert.equal(readyResult.summary.brokerAcceptedTelemetryBatches, 1);
  });

  it('4. Integrates end-to-end with real telemetryApi + analyticsApi + httpClient across buffered samples, conflicts, and closure', async () => {
    registerAccessTokenGetter(() => 'token-e2e');
    const summaryHistory: SessionSyncSummary[] = [];
    const urls: string[] = [];
    let resolveDeferredTelemetry!: (res: Response) => void;
    let resolveDeferredTrial!: (res: Response) => void;
    let holdFirstRequests = true;

    globalThis.fetch = async (url, init) => {
      const urlStr = String(url);
      urls.push(urlStr);
      if (holdFirstRequests && urlStr.includes('/api/v1/telemetry/batches')) {
        return new Promise<Response>((resolve) => {
          resolveDeferredTelemetry = resolve;
        });
      }
      if (holdFirstRequests && urlStr.includes('/trial-results')) {
        return new Promise<Response>((resolve) => {
          resolveDeferredTrial = resolve;
        });
      }
      if (urlStr.includes('/api/v1/telemetry/batches')) {
        return new Response(JSON.stringify({ code: 'BROKER_ACCEPTED' }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      assert.equal(init?.method, 'POST');
      return new Response(JSON.stringify({ status: 'CREATED' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const controller = new SessionDeliveryController({
      maxAttemptsPerFlush: 1,
      retryBackoffMs: 0,
      sleep: async () => undefined,
      uuid: createDeterministicUuid('e2e'),
      onSyncSummaryChange: (summary) => summaryHistory.push(summary),
      sendTelemetryBatch: (body) => telemetryApi.sendTelemetryBatch(body),
      sendTrialResult: (sessionId, slug: AnalyticsExerciseSlug, body: AnyTrialBody) =>
        analyticsApi.submitTrialResult(sessionId, slug, body),
    });

    controller.syncSession('session-e2e');

    // Record sample -> immediately visible in bufferedTelemetrySamples before flush
    controller.recordTelemetrySample({ gaze: { x: 0.4, y: 0.5, confidence: 0.96 } });
    const bufferedSummary = controller.getSyncSummary();
    assert.equal(bufferedSummary.bufferedTelemetrySamples, 1);
    assert.equal(bufferedSummary.hasPendingOrUncertainDelivery, true);
    assert.equal(bufferedSummary.isSyncComplete, false);

    // Start flush + trial submission while fetch promises are held open
    const flushPromise = controller.flushTelemetry();
    const trialPromise = controller.submitTrial(
      'visual-search',
      makeTrialBody('t-e2e-1', 1200)
    );
    await new Promise((r) => setTimeout(r, 0));

    const inFlightSummary = controller.getSyncSummary();
    assert.equal(inFlightSummary.inFlightTelemetryBatches, 1);
    assert.equal(inFlightSummary.inFlightTrials, 1);
    assert.equal(inFlightSummary.hasPendingOrUncertainDelivery, true);

    // Settle initial telemetry + trial requests
    holdFirstRequests = false;
    resolveDeferredTelemetry(
      new Response(JSON.stringify({ code: 'BROKER_ACCEPTED' }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    resolveDeferredTrial(
      new Response(JSON.stringify({ status: 'CREATED' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    await Promise.all([flushPromise, trialPromise]);

    // Conflicting duplicate trialId surfaces lastWarning without sending another HTTP call
    const urlsBeforeConflict = urls.length;
    await controller.submitTrial('visual-search', makeTrialBody('t-e2e-1', 2500));
    assert.equal(urls.length, urlsBeforeConflict);
    assert.ok(controller.getSyncSummary().lastWarning?.includes('t-e2e-1'));

    // Buffer one final sample before prepareClosure(false) -> prepareClosure flushes it and returns READY
    controller.recordTelemetrySample({ gaze: { x: 0.6, y: 0.7, confidence: 0.98 } });
    const closure = await controller.prepareClosure(false);

    assert.equal(closure.allowedToClose, true);
    assert.equal(closure.reason, 'READY');
    assert.equal(closure.summary.confirmedTrials, 1);
    assert.equal(closure.summary.brokerAcceptedTelemetryBatches, 2);
    assert.equal(closure.summary.bufferedTelemetrySamples, 0);
    assert.equal(closure.summary.hasPendingOrUncertainDelivery, false);
    assert.equal(closure.summary.hasPermanentDataLoss, false);
    assert.equal(closure.summary.isSyncComplete, true);
    assert.ok(summaryHistory.length >= 4);

    controller.dispose();
    assert.equal(controller.getActiveSessionId(), null);
    assert.equal(controller.getTelemetryQueue(), null);
    assert.equal(controller.getTrialQueue(), null);
  });

  it('5. Never-settling Telemetry or Trial Analytics HTTP promise prevents prepareClosure(false) from resolving or calling completeSession', async () => {
    // (a) Never-settling Telemetry HTTP promise
    let completeSessionCallsA = 0;
    const telemetryHangController = new SessionDeliveryController({
      maxAttemptsPerFlush: 1,
      retryBackoffMs: 0,
      sleep: async () => undefined,
      uuid: createDeterministicUuid('hangT'),
      sendTelemetryBatch: () => new Promise<TelemetryBatchAcceptedResponse>(() => undefined),
      sendTrialResult: async () => ({ status: 'CREATED' }),
    });

    telemetryHangController.syncSession('session-hang-telemetry');
    telemetryHangController.recordTelemetrySample({
      gaze: { x: 0.25, y: 0.25, confidence: 0.9 },
    });

    const telemetryClosurePromise = telemetryHangController
      .prepareClosure(false)
      .then((res) => {
        if (res.allowedToClose) {
          completeSessionCallsA += 1;
        }
        return res;
      });

    const telemetryRace = await Promise.race([
      telemetryClosurePromise,
      new Promise<'TIMED_OUT'>((resolve) => setTimeout(() => resolve('TIMED_OUT'), 25)),
    ]);

    assert.equal(telemetryRace, 'TIMED_OUT');
    assert.equal(completeSessionCallsA, 0);
    const telemetryHangSummary = telemetryHangController.getSyncSummary();
    assert.equal(telemetryHangSummary.hasPendingOrUncertainDelivery, true);
    assert.equal(telemetryHangSummary.isSyncComplete, false);
    assert.equal(telemetryHangSummary.inFlightTelemetryBatches, 1);
    telemetryHangController.dispose();

    // (b) Never-settling Trial Analytics HTTP promise
    let completeSessionCallsB = 0;
    const trialHangController = new SessionDeliveryController({
      maxAttemptsPerFlush: 1,
      retryBackoffMs: 0,
      sleep: async () => undefined,
      uuid: createDeterministicUuid('hangA'),
      sendTelemetryBatch: async () => ({ code: 'BROKER_ACCEPTED' }),
      sendTrialResult: () => new Promise<AnalyticsTrialReceipt>(() => undefined),
    });

    trialHangController.syncSession('session-hang-trial');
    void trialHangController.submitTrial('visual-search', makeTrialBody('t-hang-1'));

    const trialClosurePromise = trialHangController
      .prepareClosure(false)
      .then((res) => {
        if (res.allowedToClose) {
          completeSessionCallsB += 1;
        }
        return res;
      });

    const trialRace = await Promise.race([
      trialClosurePromise,
      new Promise<'TIMED_OUT'>((resolve) => setTimeout(() => resolve('TIMED_OUT'), 25)),
    ]);

    assert.equal(trialRace, 'TIMED_OUT');
    assert.equal(completeSessionCallsB, 0);
    const trialHangSummary = trialHangController.getSyncSummary();
    assert.equal(trialHangSummary.hasPendingOrUncertainDelivery, true);
    assert.equal(trialHangSummary.isSyncComplete, false);
    assert.equal(trialHangSummary.inFlightTrials, 1);
    trialHangController.dispose();
  });
});
