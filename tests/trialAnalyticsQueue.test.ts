import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ApiError,
  registerAccessTokenGetter,
} from '../src/infrastructure/api/httpClient.ts';
import {
  analyticsApi,
  type AnyTrialBody,
} from '../src/infrastructure/api/analyticsApi.ts';
import type {
  AnalyticsExerciseSlug,
  AnalyticsTrialReceipt,
  VisualSearchTrialBody,
} from '../src/infrastructure/api/contracts/analytics.contracts.ts';
import {
  TrialAnalyticsQueue,
  type TrialAnalyticsQueueSummary,
} from '../src/infrastructure/telemetry/trialAnalyticsQueue.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  registerAccessTokenGetter(() => null);
});

describe('TrialAnalyticsQueue', () => {
  it('503 WRITE_OUTCOME_UNKNOWN -> UNCERTAIN -> drainPending() -> 200 ALREADY_STORED -> CONFIRMED', async () => {
    const sentPayloads: { slug: AnalyticsExerciseSlug; body: AnyTrialBody }[] = [];
    let callCount = 0;

    const queue = new TrialAnalyticsQueue({
      retryBackoffMs: 0,
      sleep: async () => undefined,
      sendTrial: async (slug, body) => {
        sentPayloads.push({
          slug,
          body: JSON.parse(JSON.stringify(body)) as AnyTrialBody,
        });
        callCount += 1;
        // Initial submit does 1 initial + 1 automatic retry = 2 attempts, both 503
        if (callCount <= 2) {
          throw new ApiError(503, 'WRITE_OUTCOME_UNKNOWN', 'Write outcome unknown');
        }
        return { status: 'ALREADY_STORED' };
      },
    });

    const trialBody: VisualSearchTrialBody = {
      schemaVersion: 1,
      trialId: 'trial-503-001',
      dataOrigin: 'PRODUCER_REPORTED',
      outcome: 'SUCCESS',
      confirmedDwellMs: 450,
      searchDurationMs: 1200,
    };

    const entry = await queue.submit('visual-search', trialBody);
    assert.equal(entry.status, 'UNCERTAIN');
    assert.equal(entry.attempts, 2);
    assert.equal(entry.lastStatusCode, 503);

    const midSummary = queue.getSummary();
    assert.equal(midSummary.uncertainCount, 1);
    assert.equal(midSummary.hasUnresolved, true);
    assert.equal(midSummary.hasUncertain, true);

    const drainedSummary = await queue.drainPending();
    assert.equal(drainedSummary.confirmedCount, 1);
    assert.equal(drainedSummary.uncertainCount, 0);
    assert.equal(drainedSummary.hasUnresolved, false);
    assert.equal(drainedSummary.hasUncertain, false);
    assert.equal(drainedSummary.entries[0].receiptStatus, 'ALREADY_STORED');

    assert.equal(sentPayloads.length, 3);
    assert.deepEqual(sentPayloads[1], sentPayloads[0]);
    assert.deepEqual(sentPayloads[2], sentPayloads[0]);
    assert.equal(sentPayloads[2].body.trialId, 'trial-503-001');
  });

  it('400 and 409 -> FAILED_PERMANENT without automatic retry', async () => {
    let attempts = 0;
    const queue = new TrialAnalyticsQueue({
      retryBackoffMs: 0,
      sleep: async () => undefined,
      sendTrial: async (_slug, body) => {
        attempts += 1;
        if (body.trialId === 'trial-400') {
          throw new ApiError(400, 'INVALID_RESULT', 'Invalid trial result');
        }
        throw new ApiError(409, 'CONFLICT', 'Trial conflict');
      },
    });

    const entry400 = await queue.submit('visual-search', {
      schemaVersion: 1,
      trialId: 'trial-400',
      dataOrigin: 'PRODUCER_REPORTED',
      outcome: 'SUCCESS',
      confirmedDwellMs: 300,
      searchDurationMs: 900,
    });
    assert.equal(entry400.status, 'FAILED_PERMANENT');
    assert.equal(entry400.lastStatusCode, 400);
    assert.equal(entry400.attempts, 1);

    const entry409 = await queue.submit('standard-scanning', {
      schemaVersion: 1,
      trialId: 'trial-409',
      dataOrigin: 'PRODUCER_REPORTED',
      outcome: 'TIMEOUT',
      confirmedDwellMs: null,
      localizationDurationMs: 5000,
    });
    assert.equal(entry409.status, 'FAILED_PERMANENT');
    assert.equal(entry409.lastStatusCode, 409);
    assert.equal(entry409.attempts, 1);

    assert.equal(attempts, 2);
    const summary = queue.getSummary();
    assert.equal(summary.failedPermanentCount, 2);
    assert.equal(summary.hasUnresolved, false);
  });

  it('>8192 UTF-8 byte body -> FAILED_PERMANENT (413) without calling sendTrial', async () => {
    let sendCalled = false;
    const queue = new TrialAnalyticsQueue({
      retryBackoffMs: 0,
      sendTrial: async () => {
        sendCalled = true;
        return { status: 'CREATED' };
      },
    });

    const oversizedTrialId = 'x'.repeat(8200);
    const entry = await queue.submit('visual-search', {
      schemaVersion: 1,
      trialId: oversizedTrialId,
      dataOrigin: 'PRODUCER_REPORTED',
      outcome: 'SUCCESS',
      confirmedDwellMs: 400,
      searchDurationMs: 1100,
    });

    assert.equal(sendCalled, false);
    assert.equal(entry.status, 'FAILED_PERMANENT');
    assert.equal(entry.lastStatusCode, 413);
    assert.equal(entry.attempts, 0);
    assert.equal(queue.getSummary().failedPermanentCount, 1);
    assert.equal(queue.getSummary().hasUnresolved, false);
  });

  it('4. Deduplicates identical trialId (CONFIRMED, PENDING in-flight, UNCERTAIN retry) and ignores conflicting duplicates with warning', async () => {
    let sendCount = 0;
    let resolvePending!: (receipt: AnalyticsTrialReceipt) => void;
    let uncertainAttempt = 0;

    const queue = new TrialAnalyticsQueue({
      retryBackoffMs: 0,
      sleep: async () => undefined,
      sendTrial: async (_slug, body) => {
        sendCount += 1;
        if (body.trialId === 'trial-dup-confirmed') {
          return { status: 'CREATED' };
        }
        if (body.trialId === 'trial-dup-pending') {
          return new Promise<AnalyticsTrialReceipt>((resolve) => {
            resolvePending = resolve;
          });
        }
        if (body.trialId === 'trial-dup-uncertain') {
          uncertainAttempt += 1;
          if (uncertainAttempt <= 2) {
            throw new ApiError(503, 'WRITE_OUTCOME_UNKNOWN', 'Transient write uncertainty');
          }
          return { status: 'ALREADY_STORED' };
        }
        return { status: 'CREATED' };
      },
    });

    const confirmedBody: VisualSearchTrialBody = {
      schemaVersion: 1,
      trialId: 'trial-dup-confirmed',
      dataOrigin: 'PRODUCER_REPORTED',
      outcome: 'SUCCESS',
      confirmedDwellMs: 400,
      searchDurationMs: 1000,
    };

    // 1. Confirmed identical resubmission returns existing without re-sending
    const first = await queue.submit('visual-search', confirmedBody);
    const second = await queue.submit('visual-search', { ...confirmedBody });
    assert.equal(first, second);
    assert.equal(sendCount, 1);
    assert.equal(queue.getSummary().entries.length, 1);

    // 2. Pending in-flight identical resubmission joins chain without duplicate entry or second HTTP call
    const pendingBody: VisualSearchTrialBody = {
      schemaVersion: 1,
      trialId: 'trial-dup-pending',
      dataOrigin: 'PRODUCER_REPORTED',
      outcome: 'SUCCESS',
      confirmedDwellMs: 350,
      searchDurationMs: 950,
    };
    const pendingPromise1 = queue.submit('visual-search', pendingBody);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(queue.getSummary().inFlightCount, 1);
    assert.equal(queue.getSummary().entries[1].inFlight, true);

    const pendingPromise2 = queue.submit('visual-search', { ...pendingBody });
    assert.equal(sendCount, 2);
    assert.equal(queue.getSummary().entries.length, 2);

    resolvePending({ status: 'CREATED' });
    const [pendingRes1, pendingRes2] = await Promise.all([pendingPromise1, pendingPromise2]);
    assert.equal(pendingRes1, pendingRes2);
    assert.equal(pendingRes1.status, 'CONFIRMED');
    assert.equal(sendCount, 2);
    assert.equal(queue.getSummary().inFlightCount, 0);
    assert.equal(queue.getSummary().confirmedCount, 2);

    // 3. Uncertain identical resubmission retries existing entry in-place and clears warning once resolved
    const uncertainBody: VisualSearchTrialBody = {
      schemaVersion: 1,
      trialId: 'trial-dup-uncertain',
      dataOrigin: 'PRODUCER_REPORTED',
      outcome: 'TIMEOUT',
      confirmedDwellMs: null,
      searchDurationMs: 3000,
    };
    const uncertainEntry = await queue.submit('visual-search', uncertainBody);
    assert.equal(uncertainEntry.status, 'UNCERTAIN');
    assert.ok(queue.getSummary().lastWarning?.includes('trial-dup-uncertain'));

    const retriedEntry = await queue.submit('visual-search', { ...uncertainBody });
    assert.equal(retriedEntry, uncertainEntry);
    assert.equal(retriedEntry.status, 'CONFIRMED');
    assert.equal(retriedEntry.receiptStatus, 'ALREADY_STORED');
    assert.equal(queue.getSummary().entries.length, 3);
    assert.equal(queue.getSummary().confirmedCount, 3);
    assert.equal(queue.getSummary().uncertainCount, 0);
    assert.equal(queue.getSummary().lastWarning, null);

    // 4. Conflicting payload or slug for existing trialId is ignored with warning
    const sendCountBeforeConflict = sendCount;
    const conflictPayload = await queue.submit('visual-search', {
      ...confirmedBody,
      searchDurationMs: 9999,
    });
    assert.equal(conflictPayload, first);
    assert.equal(sendCount, sendCountBeforeConflict);

    const conflictSlug = await queue.submit('standard-scanning', {
      schemaVersion: 1,
      trialId: 'trial-dup-confirmed',
      dataOrigin: 'PRODUCER_REPORTED',
      outcome: 'SUCCESS',
      confirmedDwellMs: 400,
      localizationDurationMs: 1000,
    });
    assert.equal(conflictSlug, first);
    assert.equal(sendCount, sendCountBeforeConflict);

    const summaryAfterConflicts = queue.getSummary();
    assert.equal(summaryAfterConflicts.conflictingDuplicateCount, 2);
    assert.equal(summaryAfterConflicts.entries.length, 3);
    assert.ok(summaryAfterConflicts.lastWarning?.includes('trial-dup-confirmed'));
  });

  it('5. 413/415 via real analyticsApi + httpClient fail permanently without retry and surface visibility while keeping hasUnresolved=false', async () => {
    registerAccessTokenGetter(() => 'token-trial-perm');
    const calls: string[] = [];

    globalThis.fetch = async (url, init) => {
      const parsed = JSON.parse(String(init?.body)) as AnyTrialBody;
      calls.push(`${String(url)}::${parsed.trialId}`);
      if (parsed.trialId === 'trial-http-413') {
        return new Response(
          JSON.stringify({ status: 'PAYLOAD_TOO_LARGE', message: 'Payload too large' }),
          { status: 413, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (parsed.trialId === 'trial-http-415') {
        return new Response(
          JSON.stringify({ status: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported media type' }),
          { status: 415, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ status: 'CREATED' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const queue = new TrialAnalyticsQueue({
      retryBackoffMs: 0,
      sleep: async () => undefined,
      sendTrial: (slug, body) => analyticsApi.submitTrialResult('session-trial-http', slug, body),
    });

    const entry413 = await queue.submit('visual-search', {
      schemaVersion: 1,
      trialId: 'trial-http-413',
      dataOrigin: 'PRODUCER_REPORTED',
      outcome: 'SUCCESS',
      confirmedDwellMs: 320,
      searchDurationMs: 900,
    });
    assert.equal(entry413.status, 'FAILED_PERMANENT');
    assert.equal(entry413.attempts, 1);
    assert.equal(entry413.lastStatusCode, 413);
    assert.equal(entry413.inFlight, false);

    const entry415 = await queue.submit('visual-search', {
      schemaVersion: 1,
      trialId: 'trial-http-415',
      dataOrigin: 'PRODUCER_REPORTED',
      outcome: 'SUCCESS',
      confirmedDwellMs: 340,
      searchDurationMs: 980,
    });
    assert.equal(entry415.status, 'FAILED_PERMANENT');
    assert.equal(entry415.attempts, 1);
    assert.equal(entry415.lastStatusCode, 415);

    // Subsequent confirmed trial keeps permanent failure visibility & warning intact
    const entry201 = await queue.submit('visual-search', {
      schemaVersion: 1,
      trialId: 'trial-http-201',
      dataOrigin: 'PRODUCER_REPORTED',
      outcome: 'SUCCESS',
      confirmedDwellMs: 350,
      searchDurationMs: 1000,
    });
    assert.equal(entry201.status, 'CONFIRMED');
    assert.equal(calls.length, 3);

    const summary = queue.getSummary();
    assert.equal(summary.confirmedCount, 1);
    assert.equal(summary.failedPermanentCount, 2);
    assert.equal(summary.hasPermanentFailure, true);
    assert.equal(summary.hasUnresolved, false);
    assert.equal(summary.inFlightCount, 0);
    assert.ok(summary.lastWarning?.includes('415'));
  });

  it('6. dispose() and reset() prevent late in-flight sendTrial results from firing callbacks or mutating new session state', async () => {
    // Part A: dispose()
    const summariesA: TrialAnalyticsQueueSummary[] = [];
    let resolveInFlightA!: (receipt: AnalyticsTrialReceipt) => void;
    let sendCountA = 0;

    const queueA = new TrialAnalyticsQueue({
      retryBackoffMs: 0,
      sleep: async () => undefined,
      sendTrial: () => {
        sendCountA += 1;
        return new Promise<AnalyticsTrialReceipt>((resolve) => {
          resolveInFlightA = resolve;
        });
      },
      onStateChange: (summary) => summariesA.push(summary),
    });

    const submitA = queueA.submit('visual-search', {
      schemaVersion: 1,
      trialId: 'trial-dispose-hang',
      dataOrigin: 'PRODUCER_REPORTED',
      outcome: 'SUCCESS',
      confirmedDwellMs: 400,
      searchDurationMs: 1100,
    });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(queueA.getSummary().inFlightCount, 1);

    queueA.dispose();
    const callbackCountAtDispose = summariesA.length;
    const summaryAtDispose = queueA.getSummary();

    const postDisposeEntry = await queueA.submit('visual-search', {
      schemaVersion: 1,
      trialId: 'trial-after-dispose',
      dataOrigin: 'PRODUCER_REPORTED',
      outcome: 'SUCCESS',
      confirmedDwellMs: 400,
      searchDurationMs: 1200,
    });
    assert.equal(postDisposeEntry.inFlight, false);
    assert.equal(postDisposeEntry.attempts, 0);
    assert.equal(sendCountA, 1);

    await queueA.drainPending(2);

    resolveInFlightA({ status: 'CREATED' });
    await submitA;
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(summariesA.length, callbackCountAtDispose);
    assert.deepEqual(queueA.getSummary(), summaryAtDispose);
    assert.equal(queueA.getSummary().confirmedCount, 0);
    assert.equal(queueA.getSummary().entries.length, 1);

    // Part B: reset() while old trial is in-flight
    let rejectOldTrial!: (err: unknown) => void;
    const queueB = new TrialAnalyticsQueue({
      retryBackoffMs: 0,
      sleep: async () => undefined,
      sendTrial: (_slug, body) => {
        if (body.trialId === 'trial-before-reset') {
          return new Promise<AnalyticsTrialReceipt>((_, reject) => {
            rejectOldTrial = reject;
          });
        }
        return Promise.resolve({ status: 'CREATED' });
      },
    });

    const oldPromise = queueB.submit('visual-search', {
      schemaVersion: 1,
      trialId: 'trial-before-reset',
      dataOrigin: 'PRODUCER_REPORTED',
      outcome: 'SUCCESS',
      confirmedDwellMs: 300,
      searchDurationMs: 800,
    });
    await new Promise((r) => setTimeout(r, 0));

    queueB.reset();

    const newEntry = await queueB.submit('visual-search', {
      schemaVersion: 1,
      trialId: 'trial-after-reset',
      dataOrigin: 'PRODUCER_REPORTED',
      outcome: 'SUCCESS',
      confirmedDwellMs: 350,
      searchDurationMs: 900,
    });
    assert.equal(newEntry.status, 'CONFIRMED');

    rejectOldTrial(new ApiError(400, 'STALE_TRIAL', 'Old session rejected'));
    await oldPromise;
    await new Promise((r) => setTimeout(r, 0));

    const finalSummary = queueB.getSummary();
    assert.equal(finalSummary.confirmedCount, 1);
    assert.equal(finalSummary.failedPermanentCount, 0);
    assert.equal(finalSummary.lastWarning, null);
    assert.equal(finalSummary.entries.length, 1);
    assert.equal(finalSummary.entries[0].body.trialId, 'trial-after-reset');
  });

  it('7. Never-settling sendTrial HTTP promise keeps inFlightCount=1, pendingCount=1, hasUnresolved=true, confirmedCount=0', async () => {
    const queue = new TrialAnalyticsQueue({
      retryBackoffMs: 0,
      sleep: async () => undefined,
      sendTrial: () => new Promise<AnalyticsTrialReceipt>(() => undefined),
    });

    const submitPromise = queue.submit('visual-search', {
      schemaVersion: 1,
      trialId: 'trial-never-settles',
      dataOrigin: 'PRODUCER_REPORTED',
      outcome: 'SUCCESS',
      confirmedDwellMs: 420,
      searchDurationMs: 1150,
    });

    const outcome = await Promise.race([
      submitPromise,
      new Promise<'STILL_PENDING'>((resolve) => setTimeout(() => resolve('STILL_PENDING'), 25)),
    ]);

    assert.equal(outcome, 'STILL_PENDING');
    const summary = queue.getSummary();
    assert.equal(summary.inFlightCount, 1);
    assert.equal(summary.pendingCount, 1);
    assert.equal(summary.hasUnresolved, true);
    assert.equal(summary.confirmedCount, 0);
    assert.equal(summary.uncertainCount, 0);
    assert.equal(summary.failedPermanentCount, 0);

    queue.dispose();
  });
});
