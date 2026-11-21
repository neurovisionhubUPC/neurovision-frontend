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
  PatientSessionCompletionBody,
  PatientSessionProgressResponse,
} from '../src/infrastructure/api/contracts/clinical.contracts.ts';
import type {
  TelemetryBatchAcceptedResponse,
  TelemetryBatchBody,
} from '../src/infrastructure/api/contracts/telemetry.contracts.ts';
import {
  SessionDeliveryController,
  type ClinicalClosureOutcome,
  type ClinicalClosureUiState,
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

function makeProgress(
  therapySessionId: string,
  overrides: Partial<PatientSessionProgressResponse> = {}
): PatientSessionProgressResponse {
  return {
    therapySessionId,
    status: 'ACTIVE',
    nextSequence: 4,
    activityState: 'ACTIVE',
    endedAt: null,
    criterion: 'REPETITIONS',
    target: 4,
    activeMilliseconds: 12000,
    completedRepetitions: 4,
    targetReached: true,
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('SessionDeliveryController — LIFE-POST-GATE clinical closure lifecycle', () => {
  function createHarness(options?: {
    sendTelemetryBatch?: (
      body: TelemetryBatchBody
    ) => Promise<TelemetryBatchAcceptedResponse>;
    sendTrialResult?: (
      therapySessionId: string,
      slug: AnalyticsExerciseSlug,
      body: AnyTrialBody
    ) => Promise<AnalyticsTrialReceipt>;
  }) {
    let mounted = true;
    let cachedProgress: PatientSessionProgressResponse | null = null;
    let completionState: ClinicalClosureUiState | 'IDLE' = 'IDLE';
    let backendWarning: string | null = null;
    let lastSyncSummary: SessionSyncSummary | null = null;
    let waitForEventsFn: () => Promise<void> = () => Promise.resolve();

    const progressUpdates: PatientSessionProgressResponse[] = [];
    const completedCalls: Array<{
      progress: PatientSessionProgressResponse;
      action: 'FINISHED' | 'ABANDONED';
    }> = [];
    const progressCalls: string[] = [];
    const completionCalls: Array<{
      sessionId: string;
      body: PatientSessionCompletionBody;
      idempotencyKey: string;
    }> = [];

    const controller = new SessionDeliveryController({
      maxAttemptsPerFlush: 1,
      retryBackoffMs: 0,
      sleep: async () => undefined,
      uuid: createDeterministicUuid('life'),
      sendTelemetryBatch:
        options?.sendTelemetryBatch ?? (async () => ({ code: 'BROKER_ACCEPTED' })),
      sendTrialResult:
        options?.sendTrialResult ?? (async () => ({ status: 'CREATED' })),
      onSyncSummaryChange: (summary) => {
        lastSyncSummary = summary;
      },
    });

    const adapter = {
      isMounted: () => mounted,
      waitForActivityEvents: () => waitForEventsFn(),
      getCachedProgress: () => cachedProgress,
      setCachedProgress: (progress: PatientSessionProgressResponse) => {
        cachedProgress = progress;
      },
      setSyncSummary: (summary: SessionSyncSummary) => {
        lastSyncSummary = summary;
      },
      setCompletionState: (state: ClinicalClosureUiState) => {
        completionState = state;
      },
      setBackendWarning: (message: string) => {
        backendWarning = message;
      },
      onSessionProgressUpdate: (progress: PatientSessionProgressResponse) => {
        progressUpdates.push(progress);
      },
      onSessionCompleted: (
        progress: PatientSessionProgressResponse,
        action: 'FINISHED' | 'ABANDONED'
      ) => {
        completedCalls.push({ progress, action });
      },
    };

    const apis = {
      getSessionProgressImpl: async (sessionId: string) => makeProgress(sessionId),
      completeSessionImpl: async (
        sessionId: string,
        body: PatientSessionCompletionBody
      ) => makeProgress(sessionId, { status: body.action === 'FINISHED' ? 'COMPLETED' : 'ABANDONED' }),
    };

    function runClose(forceCloseWithoutSync = false): Promise<ClinicalClosureOutcome> {
      return controller.closeClinicalSession({
        forceCloseWithoutSync,
        apis: {
          getSessionProgress: (sessionId) => {
            progressCalls.push(sessionId);
            return apis.getSessionProgressImpl(sessionId);
          },
          completeSession: (sessionId, body, idempotencyKey) => {
            completionCalls.push({ sessionId, body, idempotencyKey });
            return apis.completeSessionImpl(sessionId, body);
          },
        },
        adapter,
      });
    }

    function switchTo(sessionId: string | null): boolean {
      const changed = controller.syncSession(sessionId, false);
      if (changed && sessionId !== null) {
        cachedProgress = makeProgress(sessionId, {
          completedRepetitions: 0,
          targetReached: false,
        });
        completionState = 'IDLE';
        backendWarning = null;
      }
      return changed;
    }

    return {
      controller,
      apis,
      runClose,
      switchTo,
      setMounted: (next: boolean) => {
        mounted = next;
      },
      setWaitForEvents: (fn: () => Promise<void>) => {
        waitForEventsFn = fn;
      },
      setCachedProgress: (p: PatientSessionProgressResponse | null) => {
        cachedProgress = p;
      },
      setCompletionState: (st: ClinicalClosureUiState | 'IDLE') => {
        completionState = st;
      },
      getState: () => ({
        cachedProgress,
        completionState,
        backendWarning,
        lastSyncSummary,
        progressUpdates,
        completedCalls,
        progressCalls,
        completionCalls,
      }),
    };
  }

  it('1. A passes gate -> getSessionProgress(A) waits -> switch to B -> stale A does NOT dispatch completeSession or overwrite B', async () => {
    const h = createHarness();
    const progressA = createDeferred<PatientSessionProgressResponse>();

    h.apis.getSessionProgressImpl = (sessionId) => {
      if (sessionId === 'session-A') {
        return progressA.promise;
      }
      return Promise.resolve(makeProgress(sessionId));
    };

    h.switchTo('session-A');
    const closeA = h.runClose(false);
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(h.getState().progressCalls, ['session-A']);

    // Switch to session B while A is awaiting getSessionProgress(A)
    h.switchTo('session-B');
    const bProgressBefore = makeProgress('session-B', {
      completedRepetitions: 1,
      targetReached: false,
    });
    h.setCachedProgress(bProgressBefore);
    const bKeyBefore = h.controller.getLifecycleContext()!.completionKey;
    assert.notEqual(bKeyBefore, null);

    // Late resolution of A's getSessionProgress
    progressA.resolve(makeProgress('session-A', { targetReached: true }));
    const outcomeA = await closeA;

    assert.deepEqual(outcomeA, { status: 'STALE_IGNORED' });
    assert.equal(h.getState().completionCalls.length, 0);
    assert.equal(h.getState().completionState, 'IDLE');
    assert.equal(h.getState().cachedProgress?.therapySessionId, 'session-B');
    assert.equal(h.getState().cachedProgress?.completedRepetitions, 1);
    assert.equal(h.controller.getLifecycleContext()?.completionKey, bKeyBefore);
    assert.equal(h.getState().progressUpdates.length, 0);
    assert.equal(h.getState().completedCalls.length, 0);
    h.controller.dispose();
  });

  it('2. Switch to B during waitForActivityEvents or teardown during delivery gate aborts old operation cleanly', async () => {
    // 2a: Switch to B while waiting for activity events
    const hEvents = createHarness();
    const pendingEventsA = createDeferred<void>();
    hEvents.switchTo('session-A');
    hEvents.setWaitForEvents(() => pendingEventsA.promise);

    const closeDuringEvents = hEvents.runClose(false);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(hEvents.getState().completionState, 'SAVING');

    hEvents.switchTo('session-B');
    hEvents.setWaitForEvents(() => Promise.resolve());
    pendingEventsA.resolve();

    const outcomeA = await closeDuringEvents;
    assert.deepEqual(outcomeA, { status: 'STALE_IGNORED' });
    assert.equal(hEvents.getState().progressCalls.length, 0);
    assert.equal(hEvents.getState().completionCalls.length, 0);
    assert.equal(hEvents.getState().completionState, 'IDLE');
    assert.equal(hEvents.controller.getActiveSessionId(), 'session-B');
    hEvents.controller.dispose();

    // 2b: Teardown (syncSession(null)) while awaiting delivery gate (telemetry flush)
    const deferredFlushA = createDeferred<TelemetryBatchAcceptedResponse>();
    const hGate = createHarness({
      sendTelemetryBatch: () => deferredFlushA.promise,
    });
    hGate.switchTo('session-A-gate');
    hGate.controller.recordTelemetrySample({
      gaze: { x: 0.4, y: 0.5, confidence: 0.9 },
    });

    const closeDuringGate = hGate.runClose(false);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(hGate.getState().completionState, 'SAVING');

    // Explicit teardown before telemetry flush settles
    hGate.switchTo(null);
    hGate.setCompletionState('IDLE');
    deferredFlushA.resolve({ code: 'BROKER_ACCEPTED' });

    const outcomeGate = await closeDuringGate;
    assert.deepEqual(outcomeGate, { status: 'STALE_IGNORED' });
    assert.equal(hGate.getState().progressCalls.length, 0);
    assert.equal(hGate.getState().completionCalls.length, 0);
    assert.equal(hGate.getState().completionState, 'IDLE');
    hGate.controller.dispose();
  });

  it('3. Teardown and recreate of the SAME session ID rejects the old generation even though sessionId matches', async () => {
    const h = createHarness();
    const progressGen1 = createDeferred<PatientSessionProgressResponse>();
    let callNum = 0;

    h.apis.getSessionProgressImpl = (sessionId) => {
      callNum += 1;
      if (callNum === 1) {
        return progressGen1.promise;
      }
      return Promise.resolve(makeProgress(sessionId, { targetReached: true }));
    };

    h.switchTo('session-same');
    const ctxGen1 = h.controller.getLifecycleContext()!;
    const closeGen1 = h.runClose(false);
    await new Promise((r) => setTimeout(r, 0));

    // Teardown then recreate same sessionId
    h.switchTo(null);
    h.switchTo('session-same');
    const ctxGen2 = h.controller.getLifecycleContext()!;
    assert.notEqual(ctxGen2.generation, ctxGen1.generation);
    assert.notEqual(ctxGen2.completionKey, ctxGen1.completionKey);

    // Late settlement from generation 1 must be rejected even though activeSessionId is still 'session-same'
    progressGen1.resolve(makeProgress('session-same', { targetReached: true }));
    const outcomeGen1 = await closeGen1;
    assert.deepEqual(outcomeGen1, { status: 'STALE_IGNORED' });
    assert.equal(h.getState().completionCalls.length, 0);
    assert.equal(h.getState().completionState, 'IDLE');

    // Generation 2 can subsequently close normally with its own key
    const outcomeGen2 = await h.runClose(false);
    assert.equal(outcomeGen2.status, 'FINISHED');
    assert.equal(h.getState().completionCalls.length, 1);
    assert.equal(h.getState().completionCalls[0].idempotencyKey, ctxGen2.completionKey);
    h.controller.dispose();
  });

  it('4. completeSession(A) already dispatched -> switch to B -> A settlement or error cannot mutate B UI, key, or SAVING lock', async () => {
    // 4a: A's completeSession settles successfully after B starts saving
    const hSuccess = createHarness();
    const completeA = createDeferred<PatientSessionProgressResponse>();
    const progressB = createDeferred<PatientSessionProgressResponse>();

    hSuccess.apis.getSessionProgressImpl = (sessionId) => {
      if (sessionId === 'session-B') return progressB.promise;
      return Promise.resolve(makeProgress(sessionId, { targetReached: true }));
    };
    hSuccess.apis.completeSessionImpl = (sessionId, body) => {
      if (sessionId === 'session-A') return completeA.promise;
      return Promise.resolve(
        makeProgress(sessionId, {
          status: body.action === 'FINISHED' ? 'COMPLETED' : 'ABANDONED',
        })
      );
    };

    hSuccess.switchTo('session-A');
    const keyA = hSuccess.controller.getLifecycleContext()!.completionKey;
    const closeA = hSuccess.runClose(false);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(hSuccess.getState().completionCalls.length, 1);
    assert.equal(hSuccess.getState().completionCalls[0].idempotencyKey, keyA);

    // Switch to B and begin B's closure (B enters SAVING)
    hSuccess.switchTo('session-B');
    const keyB = hSuccess.controller.getLifecycleContext()!.completionKey;
    const closeB = hSuccess.runClose(false);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(hSuccess.getState().completionState, 'SAVING');

    // Settle stale completeSession(A) with COMPLETED -> must be ignored without clearing B's SAVING state or callbacks
    completeA.resolve(makeProgress('session-A', { status: 'COMPLETED' }));
    const outcomeA = await closeA;
    assert.deepEqual(outcomeA, { status: 'STALE_IGNORED', dispatchedWithKey: keyA });
    assert.equal(hSuccess.getState().completionState, 'SAVING');
    assert.equal(hSuccess.getState().cachedProgress?.therapySessionId, 'session-B');
    assert.equal(hSuccess.getState().completedCalls.length, 0);
    assert.equal(hSuccess.getState().progressUpdates.length, 0);

    // B continues and finishes cleanly with B's own key
    progressB.resolve(makeProgress('session-B', { targetReached: true }));
    const outcomeB = await closeB;
    assert.equal(outcomeB.status, 'FINISHED');
    assert.equal(hSuccess.getState().completionCalls.length, 2);
    assert.equal(hSuccess.getState().completionCalls[1].sessionId, 'session-B');
    assert.equal(hSuccess.getState().completionCalls[1].idempotencyKey, keyB);
    assert.equal(hSuccess.getState().completedCalls.length, 1);
    assert.equal(
      hSuccess.getState().completedCalls[0].progress.therapySessionId,
      'session-B'
    );
    hSuccess.controller.dispose();

    // 4b: A's completeSession fails with 500 after B starts saving -> stale catch/finally cannot touch B
    const hErr = createHarness();
    const failA = createDeferred<PatientSessionProgressResponse>();
    const progressB2 = createDeferred<PatientSessionProgressResponse>();

    hErr.apis.getSessionProgressImpl = (sessionId) => {
      if (sessionId === 'session-B2') return progressB2.promise;
      return Promise.resolve(makeProgress(sessionId, { targetReached: true }));
    };
    hErr.apis.completeSessionImpl = (sessionId) => {
      if (sessionId === 'session-A2') return failA.promise;
      return Promise.resolve(makeProgress(sessionId, { status: 'COMPLETED' }));
    };

    hErr.switchTo('session-A2');
    const keyA2 = hErr.controller.getLifecycleContext()!.completionKey;
    const closeA2 = hErr.runClose(false);
    await new Promise((r) => setTimeout(r, 0));

    hErr.switchTo('session-B2');
    const closeB2 = hErr.runClose(false);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(hErr.getState().completionState, 'SAVING');

    failA.reject(new ApiError(500, 'SERVER_ERROR', 'Late failure from A2'));
    const outcomeA2 = await closeA2;
    assert.deepEqual(outcomeA2, { status: 'STALE_IGNORED', dispatchedWithKey: keyA2 });
    assert.equal(hErr.getState().completionState, 'SAVING');
    assert.equal(hErr.getState().backendWarning, null);

    progressB2.resolve(makeProgress('session-B2', { targetReached: true }));
    const outcomeB2 = await closeB2;
    assert.equal(outcomeB2.status, 'FINISHED');
    hErr.controller.dispose();
  });

  it('5. Current session completion and retry paths (PENDING_SYNC / ERROR) keep the exact same original completionKey', async () => {
    let failTelemetryOnce = true;
    let failCompleteOnce = true;
    const h = createHarness({
      sendTelemetryBatch: async () => {
        if (failTelemetryOnce) {
          throw new ApiError(503, 'TELEMETRY_INGESTION_UNAVAILABLE', 'Retry telemetry');
        }
        return { code: 'BROKER_ACCEPTED' };
      },
    });
    h.apis.getSessionProgressImpl = async (sessionId) =>
      makeProgress(sessionId, { targetReached: true });
    h.apis.completeSessionImpl = async (sessionId) => {
      if (failCompleteOnce) {
        failCompleteOnce = false;
        throw new ApiError(503, 'COMPLETION_UNCERTAIN', 'Timeout on completion');
      }
      return makeProgress(sessionId, { status: 'COMPLETED', targetReached: true });
    };

    h.switchTo('session-retry-key');
    const originalKey = h.controller.getLifecycleContext()!.completionKey;
    h.controller.recordTelemetrySample({
      gaze: { x: 0.5, y: 0.5, confidence: 0.9 },
    });

    // Attempt 1: hits PENDING_SYNC on telemetry gate
    const first = await h.runClose(false);
    assert.equal(first.status, 'PENDING_SYNC');
    assert.equal(h.getState().completionCalls.length, 0);

    // Attempt 2: telemetry now succeeds, completeSession fails transiently -> ERROR
    failTelemetryOnce = false;
    const second = await h.runClose(false);
    assert.equal(second.status, 'ERROR');
    assert.equal(h.getState().completionCalls.length, 1);
    assert.equal(h.getState().completionCalls[0].idempotencyKey, originalKey);

    // Attempt 3: retry completeSession reuses the EXACT same original completionKey
    const third = await h.runClose(true);
    assert.equal(third.status, 'FINISHED');
    assert.equal(h.getState().completionCalls.length, 2);
    assert.equal(h.getState().completionCalls[1].idempotencyKey, originalKey);
    assert.equal(h.getState().completedCalls.length, 1);
    h.controller.dispose();
  });

  it('6. Repeated close clicks while A closure is pending coalesce into one active operation with one completion call', async () => {
    const h = createHarness();
    const progressGate = createDeferred<PatientSessionProgressResponse>();
    const completeGate = createDeferred<PatientSessionProgressResponse>();

    h.apis.getSessionProgressImpl = () => progressGate.promise;
    h.apis.completeSessionImpl = () => completeGate.promise;

    h.switchTo('session-coalesce');
    const originalKey = h.controller.getLifecycleContext()!.completionKey;

    const click1 = h.runClose(false);
    const click2 = h.runClose(false);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(h.getState().progressCalls.length, 1);

    progressGate.resolve(makeProgress('session-coalesce', { targetReached: true }));
    await new Promise((r) => setTimeout(r, 0));

    // Third click while completeSession is in flight
    const click3 = h.runClose(false);
    assert.equal(h.getState().completionCalls.length, 1);
    assert.equal(h.getState().completionCalls[0].idempotencyKey, originalKey);

    completeGate.resolve(
      makeProgress('session-coalesce', { status: 'COMPLETED', targetReached: true })
    );
    const [res1, res2, res3] = await Promise.all([click1, click2, click3]);

    assert.equal(res1.status, 'FINISHED');
    assert.deepEqual(res2, res1);
    assert.deepEqual(res3, res1);
    assert.equal(h.getState().progressCalls.length, 1);
    assert.equal(h.getState().completionCalls.length, 1);
    assert.equal(h.getState().completedCalls.length, 1);
    h.controller.dispose();
  });
});
