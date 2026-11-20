import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ApiError } from '../src/infrastructure/api/httpClient.ts';
import type { AnyTrialBody } from '../src/infrastructure/api/analyticsApi.ts';
import type {
  AnalyticsExerciseSlug,
  VisualSearchTrialBody,
} from '../src/infrastructure/api/contracts/analytics.contracts.ts';
import { TrialAnalyticsQueue } from '../src/infrastructure/telemetry/trialAnalyticsQueue.ts';

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
});
