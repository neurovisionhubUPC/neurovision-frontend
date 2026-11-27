import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { clinicalApi } from '../src/infrastructure/api/clinicalApi.ts';
import { telemetryApi } from '../src/infrastructure/api/telemetryApi.ts';
import { analyticsApi } from '../src/infrastructure/api/analyticsApi.ts';
import {
  registerAccessTokenGetter,
  registerAccessTokenRefresher,
} from '../src/infrastructure/api/httpClient.ts';
import type {
  PatientActivityEventBody,
  PatientSessionCompletionBody,
  PatientSessionProgressResponse,
} from '../src/infrastructure/api/contracts/clinical.contracts.ts';
import {
  SessionDeliveryController,
  evaluateObservedStateAfterReload,
  type ClinicalClosureOutcome,
  type ClinicalClosureStateDetail,
  type ClinicalClosureUiState,
  type DiscardedSessionWorkNotice,
  type RetainedClinicalActivityEntry,
  type SessionSyncSummary,
} from '../src/infrastructure/telemetry/sessionDeliveryController.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  registerAccessTokenGetter(() => null);
  registerAccessTokenRefresher(async () => null);
});

function createDeterministicUuid(prefix = 'act'): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `${prefix}-${String(counter).padStart(4, '0')}`;
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

function makeProgress(
  therapySessionId: string,
  overrides: Partial<PatientSessionProgressResponse> = {}
): PatientSessionProgressResponse {
  const completedRepetitions = overrides.completedRepetitions ?? 10;
  const target = overrides.target ?? 10;
  return {
    therapySessionId,
    status: 'ACTIVE',
    nextSequence: 20,
    activityState: 'ACTIVE',
    endedAt: null,
    criterion: 'REPETITIONS',
    target,
    activeMilliseconds: 25_000,
    completedRepetitions,
    targetReached: overrides.targetReached ?? completedRepetitions >= target,
    ...overrides,
  };
}

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createPostRepHarness(options?: {
  clinicalRequestTimeoutMs?: number;
  closureGateTimeoutMs?: number;
}) {
  let mounted = true;
  let externalCachedProgress: PatientSessionProgressResponse | null = null;
  let completionState: ClinicalClosureUiState | 'IDLE' = 'IDLE';
  let backendWarning: string | null = null;
  let closureDetail: ClinicalClosureStateDetail | null = null;
  let latestSyncSummary: SessionSyncSummary | null = null;

  const acknowledgedEvents: Array<{
    entry: RetainedClinicalActivityEntry;
    progress: PatientSessionProgressResponse;
  }> = [];
  const observedConflictProgress: PatientSessionProgressResponse[] = [];
  const progressUpdates: PatientSessionProgressResponse[] = [];
  const completedCallbacks: Array<{
    progress: PatientSessionProgressResponse;
    action: 'FINISHED' | 'ABANDONED';
  }> = [];
  const discardedNotices: DiscardedSessionWorkNotice[] = [];

  const controller = new SessionDeliveryController({
    clinicalRequestTimeoutMs: options?.clinicalRequestTimeoutMs ?? 45,
    closureGateTimeoutMs: options?.closureGateTimeoutMs ?? 45,
    maxAttemptsPerFlush: 1,
    retryBackoffMs: 0,
    sleep: async () => undefined,
    uuid: createDeterministicUuid('ctrl'),
    sendTelemetryBatch: (body) => telemetryApi.sendTelemetryBatch(body),
    sendTrialResult: (sessionId, slug, body) =>
      analyticsApi.submitTrialResult(sessionId, slug, body),
    sendActivityEvent: (sessionId, body, opts) =>
      clinicalApi.sendActivityEvent(sessionId, body, opts),
    getSessionProgress: (sessionId, opts) =>
      clinicalApi.getSessionProgress(sessionId, opts),
    onActivityEventAcknowledged: (entry, progress) => {
      externalCachedProgress = progress;
      acknowledgedEvents.push({ entry, progress });
      progressUpdates.push(progress);
    },
    onActivityProgressObserved: (progress) => {
      externalCachedProgress = progress;
      observedConflictProgress.push(progress);
      progressUpdates.push(progress);
    },
    onSyncSummaryChange: (summary) => {
      latestSyncSummary = summary;
    },
    onPendingWorkDiscarded: (notice) => {
      discardedNotices.push(notice);
    },
  });

  const apis = {
    getSessionProgress: (sessionId: string, opts?: { signal?: AbortSignal }) =>
      clinicalApi.getSessionProgress(sessionId, opts),
    completeSession: (
      sessionId: string,
      body: PatientSessionCompletionBody,
      idempotencyKey: string,
      opts?: { signal?: AbortSignal }
    ) => clinicalApi.completeSession(sessionId, body, idempotencyKey, opts),
  };

  const adapter = {
    isMounted: () => mounted,
    waitForActivityEvents: () => Promise.resolve(),
    getCachedProgress: () => externalCachedProgress,
    setCachedProgress: (progress: PatientSessionProgressResponse) => {
      externalCachedProgress = progress;
    },
    clearCachedProgress: () => {
      externalCachedProgress = null;
    },
    setSyncSummary: (summary: SessionSyncSummary) => {
      latestSyncSummary = summary;
    },
    setCompletionState: (state: ClinicalClosureUiState) => {
      completionState = state;
    },
    setBackendWarning: (msg: string) => {
      backendWarning = msg;
    },
    onClosureStateDetail: (detail: ClinicalClosureStateDetail) => {
      closureDetail = detail;
    },
    onSessionProgressUpdate: (progress: PatientSessionProgressResponse) => {
      progressUpdates.push(progress);
    },
    onSessionCompleted: (
      progress: PatientSessionProgressResponse,
      action: 'FINISHED' | 'ABANDONED'
    ) => {
      completedCallbacks.push({ progress, action });
    },
  };

  function runClose(params?: {
    forceCloseWithoutSync?: boolean;
    closeIntent?: 'TARGET_REACHED' | 'USER_EXIT';
    retryUncertainActivity?: boolean;
  }): Promise<ClinicalClosureOutcome> {
    return controller.closeClinicalSession({
      forceCloseWithoutSync: params?.forceCloseWithoutSync ?? false,
      closeIntent: params?.closeIntent ?? 'TARGET_REACHED',
      retryUncertainActivity: params?.retryUncertainActivity ?? false,
      apis,
      adapter,
    });
  }

  return {
    controller,
    apis,
    adapter,
    runClose,
    setMounted: (next: boolean) => {
      mounted = next;
    },
    getState: () => ({
      externalCachedProgress,
      completionState,
      backendWarning,
      closureDetail,
      latestSyncSummary,
      acknowledgedEvents,
      observedConflictProgress,
      progressUpdates,
      completedCallbacks,
      discardedNotices,
    }),
  };
}

describe('Clinical Pending Activity Recovery — POST-REP-01', () => {
  it('1. Last REPETITION_FINISHED returns 503: event remains pending, normal close is blocked, and no automatic ABANDONED request occurs', async () => {
    const h = createPostRepHarness({ clinicalRequestTimeoutMs: 200, closureGateTimeoutMs: 200 });
    registerAccessTokenGetter(() => 'synth-token-1');

    const activityBodies: string[] = [];
    const completionRequests: Array<{ url: string; body: string }> = [];

    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/activity-events')) {
        activityBodies.push(String(init?.body ?? ''));
        return jsonResponse(503, {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Temporary Clinical persistence outage',
        });
      }
      if (url.endsWith('/progress')) {
        return jsonResponse(
          200,
          makeProgress('synth-sess-503', {
            completedRepetitions: 9,
            target: 10,
            targetReached: false,
            nextSequence: 19,
          })
        );
      }
      if (url.endsWith('/completion')) {
        completionRequests.push({ url, body: String(init?.body ?? '') });
        return jsonResponse(200, makeProgress('synth-sess-503', { status: 'ABANDONED' }));
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    h.controller.syncSession('synth-sess-503', { accountKey: 'synth-patient-1' });
    h.controller.seedActivitySequence(19);

    const enqueued = h.controller.enqueueActivityEvent((seq) => ({
      schemaVersion: 1,
      eventId: 'evt-rep10-finish',
      sequence: seq,
      type: 'REPETITION_FINISHED',
      repetitionId: 'rep-10',
      repetitionIndex: 10,
    }));
    assert.ok(enqueued);

    const closeOutcome = await h.runClose({
      forceCloseWithoutSync: false,
      closeIntent: 'TARGET_REACHED',
      retryUncertainActivity: false,
    });

    assert.equal(closeOutcome.status, 'PENDING_SYNC');
    assert.equal(h.getState().completionState, 'PENDING_SYNC');
    assert.equal(completionRequests.length, 0, 'Must NOT send automatic ABANDONED or FINISHED');
    assert.equal(activityBodies.length, 1);

    const summary = h.controller.getSyncSummary();
    assert.equal(summary.uncertainActivityEvents, 1);
    assert.equal(summary.hasPendingOrUncertainDelivery, true);

    const retained = h.controller.getActivityQueue()!.getRetainedEntriesSnapshot();
    assert.equal(retained.length, 1);
    assert.deepEqual(retained[0].body, {
      schemaVersion: 1,
      eventId: 'evt-rep10-finish',
      sequence: 19,
      type: 'REPETITION_FINISHED',
      repetitionId: 'rep-10',
      repetitionIndex: 10,
    });
    h.controller.dispose();
  });

  it('2. Server double commits but loses the response: exact retry confirms the same event once; no second logical repetition is credited', async () => {
    const h = createPostRepHarness({ clinicalRequestTimeoutMs: 200, closureGateTimeoutMs: 200 });
    let currentToken = 'synth-token-initial';
    registerAccessTokenGetter(() => currentToken);
    registerAccessTokenRefresher(async () => {
      currentToken = 'synth-token-refreshed';
      return currentToken;
    });

    // Transactional server double with receipt map keyed by (sessionId, eventId)
    let serverCompletedReps = 9;
    let serverNextSeq = 19;
    let serverStatus: 'ACTIVE' | 'COMPLETED' | 'ABANDONED' = 'ACTIVE';
    const storedReceipts = new Map<
      string,
      { rawBody: string; receipt: PatientSessionProgressResponse }
    >();
    const receivedActivityCalls: Array<{ auth: string; rawBody: string }> = [];
    const completionCalls: Array<{ key: string; body: string }> = [];
    let dropFirstActivityResponse = true;
    let force401OnceOnRetry = true;

    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const auth = headers['Authorization'] ?? '';

      if (url.endsWith('/activity-events')) {
        const rawBody = String(init?.body ?? '');
        receivedActivityCalls.push({ auth, rawBody });

        if (!dropFirstActivityResponse && force401OnceOnRetry) {
          force401OnceOnRetry = false;
          return jsonResponse(401, { code: 'UNAUTHENTICATED' });
        }

        const parsed = JSON.parse(rawBody) as PatientActivityEventBody;
        const receiptKey = `synth-sess-commit:${parsed.eventId}`;
        const existing = storedReceipts.get(receiptKey);
        if (existing) {
          if (existing.rawBody !== rawBody) {
            return jsonResponse(409, { code: 'EVENT_CONFLICT' });
          }
          // Return original receipt without incrementing completedRepetitions a second time
          return jsonResponse(200, existing.receipt);
        }

        // First commit on server
        if (parsed.type === 'REPETITION_FINISHED') {
          serverCompletedReps += 1;
        }
        serverNextSeq = parsed.sequence + 1;
        const committedReceipt = makeProgress('synth-sess-commit', {
          completedRepetitions: serverCompletedReps,
          target: 10,
          targetReached: serverCompletedReps >= 10,
          nextSequence: serverNextSeq,
        });
        storedReceipts.set(receiptKey, { rawBody, receipt: committedReceipt });

        if (dropFirstActivityResponse) {
          dropFirstActivityResponse = false;
          throw new TypeError('Simulated network drop after server commit');
        }
        return jsonResponse(200, committedReceipt);
      }

      if (url.endsWith('/progress')) {
        return jsonResponse(
          200,
          makeProgress('synth-sess-commit', {
            status: serverStatus,
            completedRepetitions: serverCompletedReps,
            target: 10,
            targetReached: serverCompletedReps >= 10,
            nextSequence: serverNextSeq,
          })
        );
      }

      if (url.endsWith('/completion')) {
        const rawBody = String(init?.body ?? '');
        const key = headers['Idempotency-Key'] ?? '';
        completionCalls.push({ key, body: rawBody });
        const parsed = JSON.parse(rawBody) as PatientSessionCompletionBody;
        serverStatus = parsed.action === 'FINISHED' ? 'COMPLETED' : 'ABANDONED';
        return jsonResponse(
          200,
          makeProgress('synth-sess-commit', {
            status: serverStatus,
            completedRepetitions: serverCompletedReps,
            target: 10,
            targetReached: serverCompletedReps >= 10,
            nextSequence: serverNextSeq,
          })
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    };

    h.controller.syncSession('synth-sess-commit', { accountKey: 'synth-patient-1' });
    h.controller.seedActivitySequence(19);

    h.controller.enqueueActivityEvent((seq) => ({
      schemaVersion: 1,
      eventId: 'evt-commit-lost',
      sequence: seq,
      type: 'REPETITION_FINISHED',
      repetitionId: 'rep-10',
      repetitionIndex: 10,
    }));

    // Initial close blocks because response was lost (even though server committed)
    const firstClose = await h.runClose({
      forceCloseWithoutSync: false,
      closeIntent: 'TARGET_REACHED',
      retryUncertainActivity: false,
    });
    assert.equal(firstClose.status, 'PENDING_SYNC');
    assert.equal(completionCalls.length, 0);
    assert.equal(serverCompletedReps, 10);

    // Explicit retry refreshes 401 token independently while preserving exact JSON body
    const retryClose = await h.runClose({
      forceCloseWithoutSync: false,
      closeIntent: 'TARGET_REACHED',
      retryUncertainActivity: true,
    });

    assert.equal(retryClose.status, 'FINISHED');
    assert.equal(serverCompletedReps, 10, 'Must NOT credit a second logical repetition');
    assert.equal(receivedActivityCalls.length, 3); // 1st dropped + 401 + refreshed 200
    assert.equal(receivedActivityCalls[0].rawBody, receivedActivityCalls[1].rawBody);
    assert.equal(receivedActivityCalls[0].rawBody, receivedActivityCalls[2].rawBody);
    assert.equal(receivedActivityCalls[2].auth, 'Bearer synth-token-refreshed');
    assert.equal(completionCalls.length, 1);
    assert.deepEqual(JSON.parse(completionCalls[0].body), { action: 'FINISHED' });
    h.controller.dispose();
  });

  it('3. Server double never accepted the request: retry preserves entire body and later events cannot overtake it', async () => {
    const h = createPostRepHarness({ clinicalRequestTimeoutMs: 200, closureGateTimeoutMs: 200 });
    registerAccessTokenGetter(() => 'synth-token-seq');

    let failFirstStartedAttempt = true;
    const acceptedOnServer: PatientActivityEventBody[] = [];
    const wireAttempts: PatientActivityEventBody[] = [];

    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/activity-events')) {
        const parsed = JSON.parse(String(init?.body ?? '')) as PatientActivityEventBody;
        wireAttempts.push(parsed);

        if (failFirstStartedAttempt && parsed.eventId === 'evt-seq-0') {
          failFirstStartedAttempt = false;
          return jsonResponse(503, { code: 'UNAVAILABLE' });
        }

        const expectedSeq = acceptedOnServer.length;
        if (parsed.sequence !== expectedSeq) {
          return jsonResponse(409, {
            code: 'SEQUENCE_MISMATCH',
            message: `Expected ${expectedSeq}, got ${parsed.sequence}`,
          });
        }
        acceptedOnServer.push(parsed);
        const reps = acceptedOnServer.filter((e) => e.type === 'REPETITION_FINISHED').length;
        return jsonResponse(
          200,
          makeProgress('synth-sess-order', {
            completedRepetitions: reps,
            target: 1,
            targetReached: reps >= 1,
            nextSequence: acceptedOnServer.length,
          })
        );
      }
      if (url.endsWith('/progress')) {
        const reps = acceptedOnServer.filter((e) => e.type === 'REPETITION_FINISHED').length;
        return jsonResponse(
          200,
          makeProgress('synth-sess-order', {
            completedRepetitions: reps,
            target: 1,
            targetReached: reps >= 1,
            nextSequence: acceptedOnServer.length,
          })
        );
      }
      if (url.endsWith('/completion')) {
        return jsonResponse(
          200,
          makeProgress('synth-sess-order', {
            status: 'COMPLETED',
            completedRepetitions: 1,
            target: 1,
            targetReached: true,
          })
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    h.controller.syncSession('synth-sess-order', { accountKey: 'synth-patient-1' });

    // Enqueue event 0 (REPETITION_STARTED) -> fails with 503
    const first = h.controller.enqueueActivityEvent((seq) => ({
      schemaVersion: 1,
      eventId: 'evt-seq-0',
      sequence: seq,
      type: 'REPETITION_STARTED',
      repetitionId: 'rep-01',
      repetitionIndex: 1,
    }))!;
    await first.settlement;

    // Enqueue event 1 (REPETITION_FINISHED) while event 0 is unresolved -> gets seq 1, CANNOT overtake seq 0
    const second = h.controller.enqueueActivityEvent((seq) => ({
      schemaVersion: 1,
      eventId: 'evt-seq-1',
      sequence: seq,
      type: 'REPETITION_FINISHED',
      repetitionId: 'rep-01',
      repetitionIndex: 1,
    }))!;
    await second.settlement;

    assert.equal(wireAttempts.length, 1, 'Event 1 must NOT dispatch past unresolved Event 0');
    assert.equal(wireAttempts[0].eventId, 'evt-seq-0');
    assert.equal(wireAttempts[0].sequence, 0);
    assert.equal(second.entry.body.sequence, 1, 'Event 1 must NOT reuse Event 0 sequence');

    // Explicit retry sends exact Event 0 first, then Event 1 in strict order
    const outcome = await h.runClose({
      forceCloseWithoutSync: false,
      closeIntent: 'TARGET_REACHED',
      retryUncertainActivity: true,
    });

    assert.equal(outcome.status, 'FINISHED');
    assert.equal(wireAttempts.length, 3);
    assert.deepEqual(wireAttempts[0], wireAttempts[1], 'Retry must preserve entire Event 0 body');
    assert.deepEqual(
      acceptedOnServer.map((e) => ({ id: e.eventId, seq: e.sequence, type: e.type })),
      [
        { id: 'evt-seq-0', seq: 0, type: 'REPETITION_STARTED' },
        { id: 'evt-seq-1', seq: 1, type: 'REPETITION_FINISHED' },
      ]
    );
    h.controller.dispose();
  });

  it('4. Never-settling request: finite UI recovery, pending event survives timeout, and repeated retry clicks do not create concurrent delivery', async () => {
    const h = createPostRepHarness({ clinicalRequestTimeoutMs: 35, closureGateTimeoutMs: 60 });
    registerAccessTokenGetter(() => 'synth-token-hang');

    let retryInFlightNow = 0;
    let maxRetryConcurrency = 0;
    let attemptCount = 0;
    const retryDeferred = createDeferred<Response>();

    globalThis.fetch = async (input, _init) => {
      const url = String(input);
      if (url.endsWith('/activity-events')) {
        attemptCount += 1;
        if (attemptCount === 1) {
          // Never-settling initial request (remote request may remain open while local wait bounds out)
          return await new Promise<Response>(() => undefined);
        }
        retryInFlightNow += 1;
        maxRetryConcurrency = Math.max(maxRetryConcurrency, retryInFlightNow);
        try {
          return await retryDeferred.promise;
        } finally {
          retryInFlightNow -= 1;
        }
      }
      if (url.endsWith('/progress')) {
        return jsonResponse(200, makeProgress('synth-sess-hang', { targetReached: true }));
      }
      if (url.endsWith('/completion')) {
        return jsonResponse(
          200,
          makeProgress('synth-sess-hang', { status: 'COMPLETED', targetReached: true })
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    h.controller.syncSession('synth-sess-hang', { accountKey: 'synth-patient-1' });
    h.controller.seedActivitySequence(5);

    h.controller.enqueueActivityEvent((seq) => ({
      schemaVersion: 1,
      eventId: 'evt-hang-1',
      sequence: seq,
      type: 'REPETITION_FINISHED',
      repetitionId: 'rep-5',
      repetitionIndex: 5,
    }));

    // Initial close finishes in finite time (~35ms) and keeps event pending in PENDING_SYNC
    const firstClose = await h.runClose({
      forceCloseWithoutSync: false,
      closeIntent: 'TARGET_REACHED',
      retryUncertainActivity: false,
    });

    assert.equal(firstClose.status, 'PENDING_SYNC');
    assert.equal(h.getState().completionState, 'PENDING_SYNC');
    assert.equal(h.controller.getSyncSummary().uncertainActivityEvents, 1);
    assert.equal(attemptCount, 1);

    // 3 rapid concurrent retry clicks while attempt #2 is in flight -> coalesced into 1 HTTP call
    const p1 = h.controller.retryPendingActivity();
    const p2 = h.controller.retryPendingActivity();
    const p3 = h.controller.retryPendingActivity();
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(attemptCount, 2, 'Repeated retry clicks must NOT create parallel HTTP requests');
    assert.equal(maxRetryConcurrency, 1);

    retryDeferred.resolve(
      jsonResponse(200, makeProgress('synth-sess-hang', { targetReached: true, nextSequence: 6 }))
    );
    await Promise.all([p1, p2, p3]);

    assert.equal(h.controller.getSyncSummary().uncertainActivityEvents, 0);
    assert.equal(h.controller.getSyncSummary().confirmedActivityEvents, 1);
    h.controller.dispose();
  });

  it('5. Gap (RESUME_REQUIRED), expiry, and 409 conflict: no fabricated credit, no automatic ABANDONED, and no new identity workaround', async () => {
    // 5a: >15s activity gap returns 200 OK with RESUME_REQUIRED and uncredited repetition (9/10)
    const hGap = createPostRepHarness({ clinicalRequestTimeoutMs: 200, closureGateTimeoutMs: 200 });
    registerAccessTokenGetter(() => 'synth-token-gap');

    const gapCompletions: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/activity-events')) {
        // Acknowledged after >15s gap: activityState becomes RESUME_REQUIRED, completedRepetitions stays 9
        return jsonResponse(
          200,
          makeProgress('synth-sess-gap', {
            activityState: 'RESUME_REQUIRED',
            completedRepetitions: 9,
            target: 10,
            targetReached: false,
            nextSequence: 20,
          })
        );
      }
      if (url.endsWith('/progress')) {
        return jsonResponse(
          200,
          makeProgress('synth-sess-gap', {
            activityState: 'RESUME_REQUIRED',
            completedRepetitions: 9,
            target: 10,
            targetReached: false,
            nextSequence: 20,
          })
        );
      }
      if (url.endsWith('/completion')) {
        gapCompletions.push(String(init?.body ?? ''));
        return jsonResponse(200, makeProgress('synth-sess-gap', { status: 'ABANDONED' }));
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    hGap.controller.syncSession('synth-sess-gap', { accountKey: 'synth-patient-1' });
    hGap.controller.seedActivitySequence(19);
    const gapEnq = hGap.controller.enqueueActivityEvent((seq) => ({
      schemaVersion: 1,
      eventId: 'evt-gap-rep10',
      sequence: seq,
      type: 'REPETITION_FINISHED',
      repetitionId: 'rep-gap-10',
      repetitionIndex: 10,
    }))!;
    await gapEnq.settlement;

    assert.equal(
      hGap.getState().externalCachedProgress?.completedRepetitions,
      9,
      'RESUME_REQUIRED acknowledgement must NOT fabricate completed repetition credit'
    );

    const gapClose = await hGap.runClose({
      forceCloseWithoutSync: false,
      closeIntent: 'TARGET_REACHED',
    });
    assert.equal(gapClose.status, 'ERROR');
    if (gapClose.status === 'ERROR') {
      assert.equal(gapClose.reason, 'TARGET_NOT_REACHED');
    }
    assert.equal(hGap.getState().closureDetail?.kind, 'TARGET_NOT_REACHED');
    assert.equal(gapCompletions.length, 0, 'Must NOT automatically send ABANDONED on unmet target');

    // Explicit patient abandonment remains available as a separate explicit action
    const explicitAbandon = await hGap.runClose({
      forceCloseWithoutSync: true,
      closeIntent: 'USER_EXIT',
    });
    assert.equal(explicitAbandon.status, 'ABANDONED');
    assert.equal(gapCompletions.length, 1);
    assert.deepEqual(JSON.parse(gapCompletions[0]), { action: 'ABANDONED' });
    hGap.controller.dispose();

    // 5b: 409 Conflict / Expiry stops progression without new eventId or renumbering
    const hConflict = createPostRepHarness({
      clinicalRequestTimeoutMs: 200,
      closureGateTimeoutMs: 200,
    });
    const conflictEventIds: string[] = [];
    let conflictCompletions = 0;

    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/activity-events')) {
        const parsed = JSON.parse(String(init?.body ?? '')) as PatientActivityEventBody;
        conflictEventIds.push(`${parsed.eventId}:${parsed.sequence}`);
        return jsonResponse(409, { code: 'SESSION_EXPIRED_OR_CONFLICT' });
      }
      if (url.endsWith('/progress')) {
        return jsonResponse(
          200,
          makeProgress('synth-sess-409', {
            status: 'FAILED_TECHNICAL',
            completedRepetitions: 9,
            target: 10,
            targetReached: false,
          })
        );
      }
      if (url.endsWith('/completion')) {
        conflictCompletions += 1;
        return jsonResponse(409, { code: 'CONFLICT' });
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    hConflict.controller.syncSession('synth-sess-409', { accountKey: 'synth-patient-1' });
    hConflict.controller.seedActivitySequence(19);
    const cEnq = hConflict.controller.enqueueActivityEvent((seq) => ({
      schemaVersion: 1,
      eventId: 'evt-409-orig',
      sequence: seq,
      type: 'REPETITION_FINISHED',
      repetitionId: 'rep-10',
      repetitionIndex: 10,
    }))!;
    await cEnq.settlement;

    assert.equal(hConflict.controller.getSyncSummary().conflictActivityEvents, 1);
    assert.equal(hConflict.getState().observedConflictProgress[0]?.status, 'FAILED_TECHNICAL');

    // Explicit retry does NOT resend or mutate a 409 conflicted event
    await hConflict.controller.retryPendingActivity();
    assert.deepEqual(conflictEventIds, ['evt-409-orig:19']);

    const conflictClose = await hConflict.runClose({
      forceCloseWithoutSync: false,
      closeIntent: 'TARGET_REACHED',
      retryUncertainActivity: true,
    });
    assert.equal(conflictClose.status, 'ERROR');
    if (conflictClose.status === 'ERROR') {
      assert.equal(conflictClose.reason, 'ACTIVITY_CONFLICT');
      assert.equal(conflictClose.observedServerStatus, 'FAILED_TECHNICAL');
    }
    assert.equal(conflictCompletions, 0);
    hConflict.controller.dispose();
  });

  it('6. A -> B, A -> B -> A, account change, and late activity handlers: zero cross-session replay, cache fallback, or acknowledgement', async () => {
    const h = createPostRepHarness({ clinicalRequestTimeoutMs: 300, closureGateTimeoutMs: 300 });
    registerAccessTokenGetter(() => 'synth-token-aba');

    const slowActivityAGen1 = createDeferred<Response>();
    let activityCallIdx = 0;

    globalThis.fetch = async (input, _init) => {
      const url = String(input);
      if (url.endsWith('/activity-events')) {
        activityCallIdx += 1;
        if (activityCallIdx === 1) {
          return slowActivityAGen1.promise;
        }
        return jsonResponse(
          200,
          makeProgress('synth-sess-B', {
            completedRepetitions: 1,
            target: 5,
            targetReached: false,
            nextSequence: 1,
          })
        );
      }
      if (url.endsWith('/progress')) {
        return jsonResponse(200, makeProgress('synth-sess-A', { targetReached: true }));
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    // Start A (gen 1) and leave an activity event in flight
    h.controller.syncSession('synth-sess-A', { accountKey: 'acct-1' });
    h.controller.enqueueActivityEvent((seq) => ({
      schemaVersion: 1,
      eventId: 'evt-A-gen1',
      sequence: seq,
      type: 'REPETITION_FINISHED',
      repetitionId: 'rep-A1',
      repetitionIndex: 1,
    }));

    // Voluntary switch with BLOCK_IF_PENDING blocks while A-gen1 has pending activity
    const blockedSwitch = h.controller.requestSessionTransition('synth-sess-B', {
      accountKey: 'acct-1',
      policy: 'BLOCK_IF_PENDING',
    });
    assert.equal(blockedSwitch.switched, false);
    assert.equal(blockedSwitch.blockedByPendingWork, true);
    assert.equal(blockedSwitch.pendingWork.pendingActivityEvents, 1);

    // Explicit discard transition A -> B -> A (gen 3)
    const switchB = h.controller.requestSessionTransition('synth-sess-B', {
      accountKey: 'acct-1',
      policy: 'EXPLICIT_DISCARD',
    });
    assert.equal(switchB.switched, true);
    assert.equal(switchB.discardedNotice?.discardedSessionId, 'synth-sess-A');

    h.controller.requestSessionTransition('synth-sess-A', {
      accountKey: 'acct-1',
      policy: 'EXPLICIT_DISCARD',
    });
    assert.equal(h.controller.getSyncSummary().confirmedActivityEvents, 0);
    assert.equal(h.controller.getCachedProgress('synth-sess-A'), null);

    // Late resolution from A-gen1 MUST NOT acknowledge, cache, or fire callbacks in A-gen3
    slowActivityAGen1.resolve(
      jsonResponse(
        200,
        makeProgress('synth-sess-A', {
          completedRepetitions: 10,
          targetReached: true,
          nextSequence: 99,
        })
      )
    );
    await new Promise((r) => setTimeout(r, 10));

    assert.equal(h.controller.getSyncSummary().confirmedActivityEvents, 0);
    assert.equal(h.controller.getCachedProgress('synth-sess-A'), null);
    assert.equal(h.getState().acknowledgedEvents.length, 0);

    // Account change always isolates and clears even under BLOCK_IF_PENDING
    const acctSwitch = h.controller.requestSessionTransition('synth-sess-C', {
      accountKey: 'acct-2',
      policy: 'BLOCK_IF_PENDING',
    });
    assert.equal(acctSwitch.switched, true);
    assert.equal(h.controller.getActiveAccountKey(), 'acct-2');
    h.controller.dispose();
  });

  it('7. Telemetry 202 and Analytics trial 201 success cannot clear Clinical pending activity; post-reload empty queue makes no durable recovery claim', async () => {
    const h = createPostRepHarness({ clinicalRequestTimeoutMs: 200, closureGateTimeoutMs: 200 });
    registerAccessTokenGetter(() => 'synth-token-sep');

    let completionSent = false;
    globalThis.fetch = async (input, _init) => {
      const url = String(input);
      if (url.endsWith('/activity-events')) {
        return jsonResponse(503, { code: 'CLINICAL_UNAVAILABLE' });
      }
      if (url.includes('/telemetry/batches')) {
        return jsonResponse(202, {
          schemaVersion: 1,
          accepted: true,
          code: 'BROKER_ACCEPTED',
        });
      }
      if (url.includes('/analytics/sessions/')) {
        return jsonResponse(201, {
          schemaVersion: 1,
          status: 'CREATED',
          therapySessionId: 'synth-sess-sep',
          trialId: 'trial-10',
        });
      }
      if (url.endsWith('/completion')) {
        completionSent = true;
        return jsonResponse(200, makeProgress('synth-sess-sep', { status: 'COMPLETED' }));
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    h.controller.syncSession('synth-sess-sep', { accountKey: 'acct-1' });
    h.controller.seedActivitySequence(9);

    // Clinical REPETITION_FINISHED fails with 503
    const act = h.controller.enqueueActivityEvent((seq) => ({
      schemaVersion: 1,
      eventId: 'evt-sep-10',
      sequence: seq,
      type: 'REPETITION_FINISHED',
      repetitionId: 'rep-sep-10',
      repetitionIndex: 10,
    }))!;
    await act.settlement;

    // Telemetry batch (202) and Analytics trial (201) both succeed completely
    h.controller.recordTelemetrySample({
      gaze: { x: 0.5, y: 0.5, confidence: 0.9 },
      gameplay: {
        playerX: 0.5,
        playerY: 0.5,
        targetX: 0.5,
        targetY: 0.5,
        score: 10,
        speed: 12,
        progress: 1,
      },
    });
    await h.controller.flushTelemetry();
    await h.controller.submitTrial('sustained-fixation', {
      schemaVersion: 1,
      trialId: 'trial-10',
      dataOrigin: 'PRODUCER_REPORTED',
      outcome: 'SUCCESS',
      elapsedMs: 1200,
      insideTargetMs: 900,
      longestContinuousInsideMs: 850,
    });

    const summary = h.controller.getSyncSummary();
    assert.equal(summary.brokerAcceptedTelemetryBatches, 1);
    assert.equal(summary.confirmedTrials, 1);
    assert.equal(summary.uncertainActivityEvents, 1);
    assert.equal(summary.hasPendingOrUncertainDelivery, true);

    // Close gate MUST still block because Clinical activity is unresolved
    const closeOutcome = await h.runClose({
      forceCloseWithoutSync: false,
      closeIntent: 'TARGET_REACHED',
      retryUncertainActivity: false,
    });
    assert.equal(closeOutcome.status, 'PENDING_SYNC');
    assert.equal(completionSent, false);
    h.controller.dispose();

    // Fresh post-reload controller has empty in-memory queue and explicitly discloses non-durability
    const freshReloaded = new SessionDeliveryController({
      sendTelemetryBatch: async () => ({ code: 'BROKER_ACCEPTED' as const }),
      sendTrialResult: async () => ({ status: 'CREATED' as const }),
    });
    freshReloaded.syncSession('synth-sess-sep', { accountKey: 'acct-1' });
    assert.equal(freshReloaded.getPendingCriticalWorkSnapshot().isInMemoryOnly, true);
    const postReload = evaluateObservedStateAfterReload(
      makeProgress('synth-sess-sep', {
        status: 'ACTIVE',
        completedRepetitions: 9,
        target: 10,
        targetReached: false,
      }),
      'synth-sess-sep'
    );
    assert.equal(postReload.originalOperationContextAvailable, false);
    assert.equal(postReload.canReplayOriginalKey, false);
    assert.match(postReload.disclosureMessage, /recarga|memoria/i);
    freshReloaded.dispose();
  });
});
