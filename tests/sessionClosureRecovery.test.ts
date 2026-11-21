import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { clinicalApi } from '../src/infrastructure/api/clinicalApi.ts';
import {
  ApiError,
  registerAccessTokenGetter,
} from '../src/infrastructure/api/httpClient.ts';
import type {
  PatientSessionCompletionBody,
  PatientSessionProgressResponse,
} from '../src/infrastructure/api/contracts/clinical.contracts.ts';
import {
  ClinicalRequestTimeoutError,
  SessionDeliveryController,
  evaluateObservedStateAfterReload,
  isMatchingSessionProgress,
  type ClinicalClosureOutcome,
  type ClinicalClosureStateDetail,
  type ClinicalClosureUiState,
  type DiscardedSessionWorkNotice,
} from '../src/infrastructure/telemetry/sessionDeliveryController.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  registerAccessTokenGetter(() => null);
});

function createDeterministicUuid(prefix = 'rec'): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `${prefix}-${String(counter).padStart(4, '0')}`;
  };
}

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
    activeMilliseconds: 12_000,
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

function createRecoveryHarness(options?: {
  clinicalRequestTimeoutMs?: number;
  closureGateTimeoutMs?: number;
  onPendingWorkDiscarded?: (notice: DiscardedSessionWorkNotice) => void;
  sendTelemetryBatch?: () => Promise<{ code: 'BROKER_ACCEPTED' }>;
  sendTrialResult?: () => Promise<{ status: 'CREATED' }>;
}) {
  let mounted = true;
  let waitForEventsFn: () => Promise<void> = () => Promise.resolve();
  let externalCachedProgress: PatientSessionProgressResponse | null = null;
  let completionState: ClinicalClosureUiState | 'IDLE' = 'IDLE';
  let backendWarning: string | null = null;
  let closureDetail: ClinicalClosureStateDetail | null = null;

  const progressCalls: string[] = [];
  const completionCalls: Array<{
    sessionId: string;
    body: PatientSessionCompletionBody;
    idempotencyKey: string;
    aborted?: boolean;
  }> = [];
  const progressUpdates: PatientSessionProgressResponse[] = [];
  const completedCallbacks: Array<{
    progress: PatientSessionProgressResponse;
    action: 'FINISHED' | 'ABANDONED';
  }> = [];
  const discardedNotices: DiscardedSessionWorkNotice[] = [];

  const controller = new SessionDeliveryController({
    clinicalRequestTimeoutMs: options?.clinicalRequestTimeoutMs ?? 40,
    closureGateTimeoutMs: options?.closureGateTimeoutMs ?? 40,
    maxAttemptsPerFlush: 1,
    retryBackoffMs: 0,
    sleep: async () => undefined,
    uuid: createDeterministicUuid('p1'),
    sendTelemetryBatch:
      options?.sendTelemetryBatch ?? (async () => ({ code: 'BROKER_ACCEPTED' as const })),
    sendTrialResult:
      options?.sendTrialResult ?? (async () => ({ status: 'CREATED' as const })),
    onPendingWorkDiscarded: (notice) => {
      discardedNotices.push(notice);
      options?.onPendingWorkDiscarded?.(notice);
    },
  });

  const apis = {
    getSessionProgressImpl: (
      sessionId: string,
      _opts?: { signal?: AbortSignal }
    ): Promise<PatientSessionProgressResponse> => Promise.resolve(makeProgress(sessionId)),
    completeSessionImpl: (
      sessionId: string,
      body: PatientSessionCompletionBody,
      _key: string,
      _opts?: { signal?: AbortSignal }
    ): Promise<PatientSessionProgressResponse> =>
      Promise.resolve(
        makeProgress(sessionId, {
          status: body.action === 'FINISHED' ? 'COMPLETED' : 'ABANDONED',
        })
      ),
  };

  const adapter = {
    isMounted: () => mounted,
    waitForActivityEvents: () => waitForEventsFn(),
    getCachedProgress: () => externalCachedProgress,
    setCachedProgress: (progress: PatientSessionProgressResponse) => {
      externalCachedProgress = progress;
    },
    clearCachedProgress: () => {
      externalCachedProgress = null;
    },
    setSyncSummary: () => undefined,
    setCompletionState: (state: ClinicalClosureUiState) => {
      completionState = state;
    },
    setBackendWarning: (message: string) => {
      backendWarning = message;
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

  const wrappedApis = {
    getSessionProgress: (sessionId: string, opts?: { signal?: AbortSignal }) => {
      progressCalls.push(sessionId);
      return apis.getSessionProgressImpl(sessionId, opts);
    },
    completeSession: (
      sessionId: string,
      body: PatientSessionCompletionBody,
      idempotencyKey: string,
      opts?: { signal?: AbortSignal }
    ) => {
      const record = { sessionId, body, idempotencyKey, aborted: false };
      if (opts?.signal) {
        opts.signal.addEventListener('abort', () => {
          record.aborted = true;
        });
      }
      completionCalls.push(record);
      return apis.completeSessionImpl(sessionId, body, idempotencyKey, opts);
    },
  };

  function runClose(forceCloseWithoutSync = false): Promise<ClinicalClosureOutcome> {
    return controller.closeClinicalSession({
      forceCloseWithoutSync,
      apis: wrappedApis,
      adapter,
    });
  }

  function runRecover(
    mode: 'VERIFY_ONLY' | 'VERIFY_AND_RESEND' = 'VERIFY_AND_RESEND'
  ): Promise<ClinicalClosureOutcome> {
    return controller.recoverClinicalClosure({
      mode,
      apis: wrappedApis,
      adapter,
    });
  }

  return {
    controller,
    apis,
    wrappedApis,
    adapter,
    runClose,
    runRecover,
    setMounted: (next: boolean) => {
      mounted = next;
    },
    setWaitForEvents: (fn: () => Promise<void>) => {
      waitForEventsFn = fn;
    },
    setExternalCachedProgress: (p: PatientSessionProgressResponse | null) => {
      externalCachedProgress = p;
    },
    setCompletionState: (state: ClinicalClosureUiState | 'IDLE') => {
      completionState = state;
    },
    getState: () => ({
      externalCachedProgress,
      completionState,
      backendWarning,
      closureDetail,
      progressCalls,
      completionCalls,
      progressUpdates,
      completedCallbacks,
      discardedNotices,
    }),
  };
}

describe('Priority 1 Clinical Closure Integrity (LIFE-CACHE-01, LIFE-WAIT-01, LIFE-STORE-01)', () => {
  it('1. LIFE-CACHE-01: Cached progress from session A never leaks into B and mismatched GET responses are rejected', async () => {
    const h = createRecoveryHarness();
    h.controller.syncSession('synth-session-A', { accountKey: 'synth-acct-1' });
    const progressA = makeProgress('synth-session-A', {
      status: 'ACTIVE',
      targetReached: true,
      completedRepetitions: 4,
    });
    assert.equal(h.controller.setCachedProgress(progressA), true);
    h.setExternalCachedProgress(progressA);

    // Switch to session B; controller invalidates internal cache, while simulating stale external ref still pointing to A
    h.controller.syncSession('synth-session-B', { accountKey: 'synth-acct-1' });
    assert.equal(h.controller.getCachedProgress('synth-session-B'), null);
    assert.equal(h.controller.getCachedProgress(), null);
    assert.equal(isMatchingSessionProgress(progressA, 'synth-session-B'), false);

    // Explicitly verify cross-session cache writes are rejected
    assert.equal(h.controller.setCachedProgress(progressA), false);
    assert.equal(h.controller.getCachedProgress('synth-session-B'), null);

    // If getSessionProgress(B) fails while stale external cache holds A -> NO completeSession(B), NO completion callbacks
    h.apis.getSessionProgressImpl = async () => {
      throw new ApiError(503, 'SESSION_PROGRESS_UNAVAILABLE', 'Clinical temporarily down');
    };
    const errOutcome = await h.runClose(false);
    assert.equal(errOutcome.status, 'ERROR');
    assert.equal(errOutcome.reason, 'PROGRESS_UNAVAILABLE');
    assert.equal(errOutcome.uncertain, false);
    assert.equal(h.getState().completionCalls.length, 0);
    assert.equal(h.getState().completedCallbacks.length, 0);
    assert.equal(h.getState().externalCachedProgress, null);
    assert.equal(h.getState().closureDetail?.kind, 'PROGRESS_UNAVAILABLE');
    assert.equal(h.getState().closureDetail?.canRetryProgressRead, true);

    // If getSessionProgress(B) resolves carrying A's therapySessionId -> reject without closing
    h.apis.getSessionProgressImpl = async () =>
      makeProgress('synth-session-A', { targetReached: true });
    const mismatchOutcome = await h.runClose(false);
    assert.equal(mismatchOutcome.status, 'ERROR');
    assert.equal(mismatchOutcome.reason, 'PROGRESS_SESSION_MISMATCH');
    assert.equal(h.controller.getCachedProgress('synth-session-B'), null);
    assert.equal(h.getState().completionCalls.length, 0);
    assert.equal(h.getState().completedCallbacks.length, 0);
    h.controller.dispose();
  });

  it('2. LIFE-CACHE-01 & LIFE-POST-GATE: A -> B -> A transition rejects stale generation of A even when therapySessionId matches again', async () => {
    const h = createRecoveryHarness({ clinicalRequestTimeoutMs: 200 });
    const completeAGen1 = createDeferred<PatientSessionProgressResponse>();
    const progressAGen2 = createDeferred<PatientSessionProgressResponse>();
    let completeCount = 0;
    let progressCount = 0;

    h.apis.getSessionProgressImpl = (sessionId) => {
      progressCount += 1;
      if (progressCount === 1) {
        return Promise.resolve(makeProgress(sessionId, { targetReached: true }));
      }
      return progressAGen2.promise;
    };
    h.apis.completeSessionImpl = (sessionId, body) => {
      completeCount += 1;
      if (completeCount === 1) {
        return completeAGen1.promise;
      }
      return Promise.resolve(
        makeProgress(sessionId, {
          status: body.action === 'FINISHED' ? 'COMPLETED' : 'ABANDONED',
          targetReached: false,
          completedRepetitions: 1,
        })
      );
    };

    // Lifecycle 1 of session-A enters closure and dispatches PUT /completion
    h.controller.syncSession('synth-session-A', { accountKey: 'synth-acct-1' });
    const keyGen1 = h.controller.getLifecycleContext()!.completionKey;
    const closeAGen1 = h.runClose(false);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(h.getState().completionCalls.length, 1);

    // Switch A -> B -> A before gen-1 PUT responds
    h.controller.syncSession('synth-session-B', { accountKey: 'synth-acct-1' });
    h.controller.syncSession('synth-session-A', { accountKey: 'synth-acct-1' });
    h.setExternalCachedProgress(
      makeProgress('synth-session-A', { completedRepetitions: 1, targetReached: false })
    );
    const keyGen2 = h.controller.getLifecycleContext()!.completionKey;
    assert.notEqual(keyGen2, keyGen1);

    const closeAGen2 = h.runClose(false);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(h.getState().completionState, 'SAVING');

    // Late response from A-gen1 (with identical sessionId!) resolves COMPLETED -> MUST be STALE_IGNORED
    completeAGen1.resolve(
      makeProgress('synth-session-A', { status: 'COMPLETED', targetReached: true })
    );
    const outcomeGen1 = await closeAGen1;
    assert.deepEqual(outcomeGen1, { status: 'STALE_IGNORED', dispatchedWithKey: keyGen1 });
    assert.equal(h.getState().completionState, 'SAVING');
    assert.equal(h.getState().completedCallbacks.length, 0);
    assert.equal(h.getState().externalCachedProgress?.completedRepetitions, 1);
    assert.equal(h.getState().externalCachedProgress?.targetReached, false);

    // Now gen2 continues with ABANDONED using keyGen2 cleanly
    progressAGen2.resolve(
      makeProgress('synth-session-A', { completedRepetitions: 1, targetReached: false })
    );
    const outcomeGen2 = await closeAGen2;
    assert.equal(outcomeGen2.status, 'ABANDONED');
    assert.equal(h.getState().completionCalls.length, 2);
    assert.equal(h.getState().completionCalls[1].idempotencyKey, keyGen2);
    assert.equal(h.getState().completedCallbacks.length, 1);
    assert.equal(h.getState().completedCallbacks[0].action, 'ABANDONED');
    h.controller.dispose();

    // 2b: A -> B -> A where late error/finally from A-gen1 rejects AFTER A-gen2 entered SAVING
    const hErr = createRecoveryHarness({ clinicalRequestTimeoutMs: 200 });
    const failAGen1 = createDeferred<PatientSessionProgressResponse>();
    const progressAGen2Err = createDeferred<PatientSessionProgressResponse>();
    let errProgCount = 0;
    let errCompCount = 0;

    hErr.apis.getSessionProgressImpl = (sessionId) => {
      errProgCount += 1;
      if (errProgCount === 1) return Promise.resolve(makeProgress(sessionId, { targetReached: true }));
      return progressAGen2Err.promise;
    };
    hErr.apis.completeSessionImpl = (sessionId, body) => {
      errCompCount += 1;
      if (errCompCount === 1) return failAGen1.promise;
      return Promise.resolve(
        makeProgress(sessionId, { status: body.action === 'FINISHED' ? 'COMPLETED' : 'ABANDONED' })
      );
    };

    hErr.controller.syncSession('synth-session-A', { accountKey: 'synth-acct-1' });
    const errKeyGen1 = hErr.controller.getLifecycleContext()!.completionKey;
    const closeErrGen1 = hErr.runClose(false);
    await new Promise((r) => setTimeout(r, 0));

    hErr.controller.syncSession('synth-session-B', { accountKey: 'synth-acct-1' });
    hErr.controller.syncSession('synth-session-A', { accountKey: 'synth-acct-1' });
    const closeErrGen2 = hErr.runClose(false);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(hErr.getState().completionState, 'SAVING');

    failAGen1.reject(new ApiError(500, 'SERVER_ERROR', 'Late gen-1 failure'));
    const lateErrOutcome = await closeErrGen1;
    assert.deepEqual(lateErrOutcome, {
      status: 'STALE_IGNORED',
      dispatchedWithKey: errKeyGen1,
    });
    assert.equal(hErr.getState().completionState, 'SAVING');
    assert.equal(hErr.getState().backendWarning, null);

    progressAGen2Err.resolve(makeProgress('synth-session-A', { targetReached: true }));
    const errGen2Outcome = await closeErrGen2;
    assert.equal(errGen2Outcome.status, 'FINISHED');
    hErr.controller.dispose();
  });

  it('3. LIFE-WAIT-01: Hung getSessionProgress / waitForActivityEvents never leaves SAVING hung (normal or forced close) and skips stale cache', async () => {
    const h = createRecoveryHarness({
      clinicalRequestTimeoutMs: 20,
      closureGateTimeoutMs: 20,
    });
    h.controller.syncSession('synth-session-hang-get', { accountKey: 'synth-acct-1' });

    // Even if same-session cache holds targetReached=true, timeout on GET /progress MUST NOT complete from cache
    const staleSameSession = makeProgress('synth-session-hang-get', {
      status: 'ACTIVE',
      targetReached: true,
    });
    h.controller.setCachedProgress(staleSameSession);
    h.setExternalCachedProgress(staleSameSession);

    let abortedSignals = 0;
    h.apis.getSessionProgressImpl = (_id, opts) =>
      new Promise<PatientSessionProgressResponse>((_resolve, reject) => {
        opts?.signal?.addEventListener('abort', () => {
          abortedSignals += 1;
          reject(new ClinicalRequestTimeoutError('GET_PROGRESS', 20));
        });
      });

    // Forced close still obeys the finite Clinical deadline
    const timedOut = await h.runClose(true);
    assert.equal(timedOut.status, 'ERROR');
    assert.equal(timedOut.reason, 'PROGRESS_TIMEOUT');
    assert.equal(timedOut.uncertain, false);
    assert.equal(abortedSignals, 1);
    assert.equal(h.getState().completionState, 'ERROR');
    assert.equal(h.getState().completionCalls.length, 0);
    assert.equal(h.getState().completedCallbacks.length, 0);

    // Explicit retry once GET succeeds closes cleanly
    h.apis.getSessionProgressImpl = async (id) => makeProgress(id, { targetReached: true });
    const retried = await h.runClose(false);
    assert.equal(retried.status, 'FINISHED');
    assert.equal(h.getState().completionCalls.length, 1);
    h.controller.dispose();

    // Also test hung delivery gate + waitForActivityEvents under normal vs forced close
    const hGate = createRecoveryHarness({
      clinicalRequestTimeoutMs: 25,
      closureGateTimeoutMs: 20,
    });
    hGate.controller.syncSession('synth-session-hang-events', { accountKey: 'synth-acct-1' });
    hGate.setWaitForEvents(() => new Promise<void>(() => undefined));

    const blockedByEvents = await hGate.runClose(false);
    assert.equal(blockedByEvents.status, 'ERROR');
    assert.equal(blockedByEvents.reason, 'DELIVERY_WAIT_TIMEOUT');
    assert.equal(hGate.getState().completionCalls.length, 0);

    // Forced close leaves the hung delivery gate cleanly, executes bounded GET + PUT, and closes once
    const forcedAfterHungEvents = await hGate.runClose(true);
    assert.equal(forcedAfterHungEvents.status, 'FINISHED');
    assert.equal(hGate.getState().completionCalls.length, 1);
    hGate.controller.dispose();
  });

  it('4. LIFE-WAIT-01 (real clinicalApi + httpClient HTTP double): remote commit with lost response recovers via GET + exact same key/action replay without duplicating closure', async () => {
    registerAccessTokenGetter(() => 'synthetic-token');
    let serverStatus: 'ACTIVE' | 'COMPLETED' | 'ABANDONED' = 'ACTIVE';
    let storedCompletionKey: string | null = null;
    let storedCompletionAction: 'FINISHED' | 'ABANDONED' | null = null;
    let logicalClosuresCreated = 0;
    let putAttempts = 0;
    let getAttempts = 0;
    let holdFirstPutForever = true;

    globalThis.fetch = async (url, init) => {
      const urlStr = String(url);
      if (urlStr.endsWith('/progress') && init?.method === 'GET') {
        getAttempts += 1;
        return new Response(
          JSON.stringify(
            makeProgress('synth-session-lost-ack', {
              status: serverStatus,
              targetReached: true,
              endedAt: serverStatus === 'ACTIVE' ? null : '2026-11-21T18:30:00Z',
            })
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (urlStr.endsWith('/completion') && init?.method === 'PUT') {
        putAttempts += 1;
        const headers = (init.headers ?? {}) as Record<string, string>;
        const key = headers['Idempotency-Key'];
        const body = JSON.parse(String(init.body)) as PatientSessionCompletionBody;

        // Server commits on attempt 1 synchronously before delaying response beyond frontend timeout
        if (storedCompletionKey === null) {
          storedCompletionKey = key;
          storedCompletionAction = body.action;
          serverStatus = body.action === 'FINISHED' ? 'COMPLETED' : 'ABANDONED';
          logicalClosuresCreated += 1;
        } else if (storedCompletionKey !== key || storedCompletionAction !== body.action) {
          return new Response(
            JSON.stringify({ code: 'COMPLETION_CONFLICT', message: 'Key or action mismatch' }),
            { status: 409, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (holdFirstPutForever && putAttempts === 1) {
          // Simulate lost response / hung connection after server already committed
          return new Promise<Response>(() => undefined);
        }

        return new Response(
          JSON.stringify(
            makeProgress('synth-session-lost-ack', {
              status: serverStatus,
              targetReached: true,
              endedAt: '2026-11-21T18:30:00Z',
            })
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      throw new Error(`Unexpected URL ${urlStr}`);
    };

    const completedCallbacks: string[] = [];
    const details: ClinicalClosureStateDetail[] = [];
    let uiState: ClinicalClosureUiState | 'IDLE' = 'IDLE';
    let cached: PatientSessionProgressResponse | null = null;

    const controller = new SessionDeliveryController({
      clinicalRequestTimeoutMs: 25,
      closureGateTimeoutMs: 25,
      uuid: createDeterministicUuid('http'),
      sendTelemetryBatch: async () => ({ code: 'BROKER_ACCEPTED' }),
      sendTrialResult: async () => ({ status: 'CREATED' }),
    });

    controller.syncSession('synth-session-lost-ack', { accountKey: 'synth-acct-1' });
    const originalKey = controller.getLifecycleContext()!.completionKey;

    const apis = {
      getSessionProgress: (id: string, opts?: { signal?: AbortSignal }) =>
        clinicalApi.getSessionProgress(id, opts),
      completeSession: (
        id: string,
        body: PatientSessionCompletionBody,
        key: string,
        opts?: { signal?: AbortSignal }
      ) => clinicalApi.completeSession(id, body, key, opts),
    };
    const adapter = {
      isMounted: () => true,
      waitForActivityEvents: () => Promise.resolve(),
      getCachedProgress: () => cached,
      setCachedProgress: (p: PatientSessionProgressResponse) => {
        cached = p;
      },
      clearCachedProgress: () => {
        cached = null;
      },
      setSyncSummary: () => undefined,
      setCompletionState: (s: ClinicalClosureUiState) => {
        uiState = s;
      },
      setBackendWarning: () => undefined,
      onClosureStateDetail: (d: ClinicalClosureStateDetail) => {
        details.push(d);
      },
      onSessionCompleted: (
        p: PatientSessionProgressResponse,
        action: 'FINISHED' | 'ABANDONED'
      ) => {
        completedCallbacks.push(`${p.therapySessionId}:${action}`);
      },
    };

    // Attempt 1: server commits, response never returns before 25ms deadline
    const first = await controller.closeClinicalSession({
      forceCloseWithoutSync: false,
      apis,
      adapter,
    });
    assert.equal(first.status, 'ERROR');
    assert.equal(first.reason, 'COMPLETION_TIMEOUT');
    assert.equal(first.uncertain, true);
    assert.equal(first.dispatchedWithKey, originalKey);
    assert.equal(first.receiptAcknowledged, false);
    assert.equal(uiState, 'ERROR');
    assert.equal(logicalClosuresCreated, 1);
    assert.equal(completedCallbacks.length, 0);

    // Step 2: VERIFY_ONLY observes COMPLETED on server WITHOUT fabricating receipt
    const verifyOnly = await controller.recoverClinicalClosure({
      mode: 'VERIFY_ONLY',
      apis,
      adapter,
    });
    assert.equal(verifyOnly.status, 'ERROR');
    assert.equal(verifyOnly.observedServerStatus, 'COMPLETED');
    assert.equal(verifyOnly.receiptAcknowledged, false);
    assert.equal(completedCallbacks.length, 0);
    assert.equal(details[details.length - 1].kind, 'OBSERVED_SERVER_STATE');
    assert.equal(details[details.length - 1].receiptAcknowledged, false);

    // Step 3: VERIFY_AND_RESEND replays exact same key/action -> confirms original receipt once
    holdFirstPutForever = false;
    const recovered = await controller.recoverClinicalClosure({
      mode: 'VERIFY_AND_RESEND',
      apis,
      adapter,
    });
    assert.equal(recovered.status, 'FINISHED');
    assert.equal(recovered.receiptAcknowledged, true);
    assert.equal(uiState, 'FINISHED');
    assert.equal(logicalClosuresCreated, 1);
    assert.equal(putAttempts, 2);
    assert.equal(getAttempts, 3);
    assert.deepEqual(completedCallbacks, ['synth-session-lost-ack:FINISHED']);
    controller.dispose();
  });

  it('5. LIFE-WAIT-01: Completion not stored before timeout recovers with same key; 409 conflict & 401/503 never replace key or switch action', async () => {
    // 5a: Not stored before timeout -> ACTIVE -> resend with exact same key commits cleanly
    const hNotStored = createRecoveryHarness({ clinicalRequestTimeoutMs: 20 });
    hNotStored.controller.syncSession('synth-session-not-stored', {
      accountKey: 'synth-acct-1',
    });
    const keyNotStored = hNotStored.controller.getLifecycleContext()!.completionKey;
    let allowStore = false;

    hNotStored.apis.completeSessionImpl = (id, body) => {
      if (!allowStore) {
        return new Promise<PatientSessionProgressResponse>(() => undefined);
      }
      return Promise.resolve(
        makeProgress(id, {
          status: body.action === 'FINISHED' ? 'COMPLETED' : 'ABANDONED',
        })
      );
    };

    const timedOut = await hNotStored.runClose(false);
    assert.equal(timedOut.status, 'ERROR');
    assert.equal(timedOut.reason, 'COMPLETION_TIMEOUT');
    assert.equal(hNotStored.getState().completedCallbacks.length, 0);

    allowStore = true;
    const recovered = await hNotStored.runRecover('VERIFY_AND_RESEND');
    assert.equal(recovered.status, 'FINISHED');
    assert.equal(hNotStored.getState().completionCalls.length, 2);
    assert.equal(hNotStored.getState().completionCalls[0].idempotencyKey, keyNotStored);
    assert.equal(hNotStored.getState().completionCalls[1].idempotencyKey, keyNotStored);
    assert.equal(hNotStored.getState().completionCalls[1].body.action, 'FINISHED');
    assert.equal(hNotStored.getState().completedCallbacks.length, 1);
    hNotStored.controller.dispose();

    // 5b: Expiry / conflict (409) never invents a new key or switches FINISHED -> ABANDONED
    const hConflict = createRecoveryHarness({ clinicalRequestTimeoutMs: 25 });
    hConflict.controller.syncSession('synth-session-conflict', { accountKey: 'synth-acct-1' });
    const conflictKey = hConflict.controller.getLifecycleContext()!.completionKey;

    let fail409 = false;
    hConflict.apis.getSessionProgressImpl = async (id) =>
      makeProgress(id, {
        status: fail409 ? 'CANCELLED' : 'ACTIVE',
        targetReached: true,
      });
    hConflict.apis.completeSessionImpl = () => {
      fail409 = true;
      return Promise.reject(
        new ApiError(409, 'SESSION_NOT_CLOSABLE', 'Lease expired or conflicting closure')
      );
    };

    const conflictOutcome = await hConflict.runClose(false);
    assert.equal(conflictOutcome.status, 'ERROR');
    assert.equal(conflictOutcome.reason, 'COMPLETION_CONFLICT');
    assert.equal(conflictOutcome.dispatchedWithKey, conflictKey);
    assert.equal(conflictOutcome.dispatchedAction, 'FINISHED');
    assert.equal(conflictOutcome.observedServerStatus, 'CANCELLED');
    assert.equal(hConflict.getState().completionCalls.length, 1);
    assert.equal(hConflict.controller.getLifecycleContext()?.completionKey, conflictKey);

    // Calling recover after 409 refreshes observed state without sending another PUT or changing key
    const afterConflict = await hConflict.runRecover('VERIFY_AND_RESEND');
    assert.equal(afterConflict.status, 'ERROR');
    assert.equal(afterConflict.reason, 'COMPLETION_CONFLICT');
    assert.equal(hConflict.getState().completionCalls.length, 1);
    assert.equal(hConflict.controller.getLifecycleContext()?.completionKey, conflictKey);
    hConflict.controller.dispose();

    // 5c: 401 and 503 retain exact operation identity and stay unresolved
    const hAuthAnd503 = createRecoveryHarness({ clinicalRequestTimeoutMs: 25 });
    hAuthAnd503.controller.syncSession('synth-session-auth', { accountKey: 'synth-acct-1' });
    const authKey = hAuthAnd503.controller.getLifecycleContext()!.completionKey;

    hAuthAnd503.apis.completeSessionImpl = async () => {
      throw new ApiError(401, 'UNAUTHORIZED', 'Expired access token');
    };
    const authErr = await hAuthAnd503.runClose(false);
    assert.equal(authErr.status, 'ERROR');
    assert.equal(authErr.reason, 'COMPLETION_AUTH_ERROR');
    assert.equal(authErr.uncertain, true);
    assert.equal(authErr.dispatchedWithKey, authKey);
    assert.equal(hAuthAnd503.controller.hasPendingCriticalWork(), true);

    hAuthAnd503.apis.completeSessionImpl = async () => {
      throw new ApiError(503, 'CLINICAL_UNAVAILABLE', 'Upstream timeout');
    };
    const retry503 = await hAuthAnd503.runRecover('VERIFY_AND_RESEND');
    assert.equal(retry503.status, 'ERROR');
    assert.equal(retry503.reason, 'COMPLETION_UNCERTAIN');
    assert.equal(retry503.uncertain, true);
    assert.equal(retry503.dispatchedWithKey, authKey);
    assert.equal(hAuthAnd503.getState().completedCallbacks.length, 0);
    hAuthAnd503.controller.dispose();
  });

  it('6. LIFE-WAIT-01: Concurrent recovery clicks coalesce, late original response triggers at-most-once receipt, and recovery GET failure stays unresolved', async () => {
    const h = createRecoveryHarness({ clinicalRequestTimeoutMs: 20 });
    h.controller.syncSession('synth-session-coalesce-rec', { accountKey: 'synth-acct-1' });
    const originalKey = h.controller.getLifecycleContext()!.completionKey;

    const firstPut = createDeferred<PatientSessionProgressResponse>();
    let putCall = 0;
    h.apis.completeSessionImpl = () => {
      putCall += 1;
      if (putCall === 1) return firstPut.promise;
      return Promise.resolve(
        makeProgress('synth-session-coalesce-rec', {
          status: 'COMPLETED',
          targetReached: true,
        })
      );
    };

    // Attempt 1 times out locally
    const attempt1 = await h.runClose(false);
    assert.equal(attempt1.status, 'ERROR');
    assert.equal(attempt1.reason, 'COMPLETION_TIMEOUT');

    // Failure during recovery GET keeps state unresolved without sending PUT
    let failRecoveryGet = true;
    const recoveryGetDeferred = createDeferred<PatientSessionProgressResponse>();
    h.apis.getSessionProgressImpl = () => {
      if (failRecoveryGet) {
        return Promise.reject(new ApiError(503, 'SESSION_PROGRESS_UNAVAILABLE', 'Down'));
      }
      return recoveryGetDeferred.promise;
    };
    const failedGetRec = await h.runRecover('VERIFY_AND_RESEND');
    assert.equal(failedGetRec.status, 'ERROR');
    assert.equal(failedGetRec.reason, 'RECOVERY_PROGRESS_FAILED');
    assert.equal(failedGetRec.uncertain, true);
    assert.equal(h.getState().completionCalls.length, 1);

    // Three concurrent recovery clicks while GET awaits coalesce into 1 active recovery operation
    failRecoveryGet = false;
    const rec1 = h.runRecover('VERIFY_AND_RESEND');
    const rec2 = h.runRecover('VERIFY_AND_RESEND');
    const rec3 = h.runRecover('VERIFY_AND_RESEND');
    await new Promise((r) => setTimeout(r, 0));

    // Late resolution from the original Attempt 1 PUT arrives DURING recovery GET -> applies ONCE and prevents duplicate PUT!
    firstPut.resolve(
      makeProgress('synth-session-coalesce-rec', {
        status: 'COMPLETED',
        targetReached: true,
      })
    );
    recoveryGetDeferred.resolve(
      makeProgress('synth-session-coalesce-rec', { status: 'COMPLETED', targetReached: true })
    );

    const [o1, o2, o3] = await Promise.all([rec1, rec2, rec3]);
    assert.equal(o1.status, 'FINISHED');
    assert.deepEqual(o2, o1);
    assert.deepEqual(o3, o1);
    assert.equal(h.getState().completionCalls.length, 1);
    assert.equal(h.getState().completionCalls[0].idempotencyKey, originalKey);
    assert.equal(h.getState().completedCallbacks.length, 1);
    h.controller.dispose();
  });

  it('7. LIFE-STORE-01: Pending-work policy blocks or discards explicitly, account change forces isolation, and post-reload reads never fabricate keys', async () => {
    const h = createRecoveryHarness({ clinicalRequestTimeoutMs: 25 });
    const sentBatches: string[] = [];
    const customCtrl = new SessionDeliveryController({
      clinicalRequestTimeoutMs: 25,
      uuid: createDeterministicUuid('store'),
      sendTelemetryBatch: async (body) => {
        sentBatches.push(body.therapySessionId);
        return { code: 'BROKER_ACCEPTED' };
      },
      sendTrialResult: async () => ({ status: 'CREATED' }),
      onPendingWorkDiscarded: (notice) => {
        h.getState().discardedNotices.push(notice);
      },
    });

    customCtrl.syncSession('synth-session-1', { accountKey: 'synth-acct-1' });
    customCtrl.recordTelemetrySample({ gaze: { x: 0.5, y: 0.5, confidence: 0.9 } });
    assert.equal(customCtrl.hasPendingCriticalWork(), true);

    // Same-account switch with BLOCK_IF_PENDING keeps session-1 intact
    const blocked = customCtrl.requestSessionTransition('synth-session-2', {
      accountKey: 'synth-acct-1',
      policy: 'BLOCK_IF_PENDING',
    });
    assert.equal(blocked.switched, false);
    assert.equal(blocked.blockedByPendingWork, true);
    assert.equal(blocked.pendingWork.bufferedTelemetrySamples, 1);
    assert.equal(customCtrl.getActiveSessionId(), 'synth-session-1');

    // Account change ALWAYS overrides BLOCK_IF_PENDING (even if sessionId matches) and emits discard notice
    const accountSwitch = customCtrl.requestSessionTransition('synth-session-1', {
      accountKey: 'synth-acct-2',
      policy: 'BLOCK_IF_PENDING',
    });
    assert.equal(accountSwitch.switched, true);
    assert.equal(accountSwitch.blockedByPendingWork, false);
    assert.equal(accountSwitch.discardedNotice?.reason, 'ACCOUNT_CHANGE');
    assert.equal(accountSwitch.discardedNotice?.discardedAccountKey, 'synth-acct-1');
    assert.equal(customCtrl.getActiveAccountKey(), 'synth-acct-2');
    assert.equal(customCtrl.getCachedProgress('synth-session-1'), null);
    assert.equal(customCtrl.getSyncSummary().bufferedTelemetrySamples, 0);
    assert.deepEqual(sentBatches, []);

    // Post-reload evaluation helper never fabricates keys or accepts foreign session progress
    const reloadForeign = evaluateObservedStateAfterReload(
      makeProgress('synth-session-OTHER', { status: 'COMPLETED' }),
      'synth-session-1'
    );
    assert.equal(reloadForeign.valid, false);
    assert.equal(reloadForeign.observedStatus, null);
    assert.equal(reloadForeign.originalOperationContextAvailable, false);
    assert.equal(reloadForeign.canReplayOriginalKey, false);

    const reloadValid = evaluateObservedStateAfterReload(
      makeProgress('synth-session-1', { status: 'COMPLETED' }),
      'synth-session-1'
    );
    assert.equal(reloadValid.valid, true);
    assert.equal(reloadValid.observedStatus, 'COMPLETED');
    assert.equal(reloadValid.originalOperationContextAvailable, false);
    assert.equal(reloadValid.canReplayOriginalKey, false);

    customCtrl.dispose();
    h.controller.dispose();
  });
});
