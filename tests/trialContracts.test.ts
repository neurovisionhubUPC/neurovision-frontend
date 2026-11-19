import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CANONICAL_EXPLORATION_QUADRANTS,
  createCompensatorySaccadeTrial,
  createStandardScanningTrial,
  createSystematicExplorationTrial,
  interruptCompensatorySaccadeTrial,
  interruptStandardScanningTrial,
  interruptSystematicExplorationTrial,
  stepCompensatorySaccadeTrial,
  stepStandardScanningTrial,
  stepSystematicExplorationTrial,
} from '../src/infrastructure/therapy/modules/visualScanningEngine.ts';
import {
  createSustainedFixationTrial,
  createVisualSearchTrial,
  interruptSustainedFixationTrial,
  interruptVisualSearchTrial,
  stepSustainedFixationTrial,
  stepVisualSearchTrial,
} from '../src/infrastructure/therapy/modules/visualSearchAndFixationEngine.ts';
import type { AnalyticsDataOrigin } from '../src/infrastructure/api/contracts/analytics.contracts.ts';
import type {
  FixationParameters,
  VisualScanningParameters,
  VisualSearchParameters,
} from '../src/infrastructure/api/contracts/clinical.contracts.ts';

const MAX_WIRE_BYTES = 8192;
const DATA_ORIGINS: readonly AnalyticsDataOrigin[] = ['PRODUCER_REPORTED', 'SYNTHETIC'];

function assertInteger(value: unknown, label: string): asserts value is number {
  assert.equal(typeof value, 'number', `${label} must be a number`);
  assert.ok(Number.isInteger(value), `${label} must be an integer, got ${String(value)}`);
  assert.ok(Number.isSafeInteger(value), `${label} must be a safe integer`);
}

function decodeAndCheckEnvelope(
  body: unknown,
  expectedFields: readonly string[],
  expectedOrigin: AnalyticsDataOrigin
): Record<string, unknown> {
  const serialized = JSON.stringify(body);
  assert.ok(
    Buffer.byteLength(serialized, 'utf8') <= MAX_WIRE_BYTES,
    `Serialized payload exceeds ${MAX_WIRE_BYTES} bytes`
  );
  const parsed: unknown = JSON.parse(serialized);
  assert.ok(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed));

  const record = parsed as Record<string, unknown>;
  const actualKeys = Object.keys(record).sort();
  const sortedExpected = [...expectedFields].sort();
  assert.deepEqual(actualKeys, sortedExpected, 'JSON root keys must match decoder FIELDS exactly');

  assertInteger(record.schemaVersion, 'schemaVersion');
  assert.equal(record.schemaVersion, 1);
  assert.equal(typeof record.trialId, 'string');
  assert.ok((record.trialId as string).trim().length > 0, 'trialId must not be blank');
  assert.equal(record.dataOrigin, expectedOrigin);

  return record;
}

function validateSystematicExplorationContract(
  body: unknown,
  params: VisualScanningParameters,
  expectedOrigin: AnalyticsDataOrigin
): void {
  const root = decodeAndCheckEnvelope(
    body,
    ['schemaVersion', 'trialId', 'outcome', 'elapsedMs', 'visits', 'dataOrigin'],
    expectedOrigin
  );

  // SystematicExplorationTrialContext invariants
  assertInteger(params.minimumFixationMs, 'params.minimumFixationMs');
  assertInteger(params.maximumStimulusDurationMs, 'params.maximumStimulusDurationMs');
  assert.ok(params.minimumFixationMs >= 300 && params.minimumFixationMs <= 2000);
  assert.ok(params.maximumStimulusDurationMs >= 2000 && params.maximumStimulusDurationMs <= 10000);
  assert.ok(params.minimumFixationMs <= params.maximumStimulusDurationMs);

  assert.ok(
    root.outcome === 'COMPLETED' || root.outcome === 'TIMED_OUT' || root.outcome === 'INTERRUPTED',
    `Invalid SystematicExploration outcome: ${String(root.outcome)}`
  );
  assertInteger(root.elapsedMs, 'elapsedMs');
  assert.ok(root.elapsedMs >= 0);

  assert.ok(Array.isArray(root.visits), 'visits must be an array');
  assert.ok(root.visits.length <= 4, 'visits length must be <= 4');

  let confirmedDuration = 0;
  for (let i = 0; i < root.visits.length; i++) {
    const rawVisit: unknown = root.visits[i];
    assert.ok(rawVisit !== null && typeof rawVisit === 'object' && !Array.isArray(rawVisit));
    const visit = rawVisit as Record<string, unknown>;
    assert.deepEqual(
      Object.keys(visit).sort(),
      ['confirmedDwellMs', 'quadrant', 'timeToVisitMs'],
      'visit keys must match VISIT_FIELDS exactly'
    );
    assert.equal(visit.quadrant, CANONICAL_EXPLORATION_QUADRANTS[i]);
    assertInteger(visit.timeToVisitMs, `visits[${i}].timeToVisitMs`);
    assertInteger(visit.confirmedDwellMs, `visits[${i}].confirmedDwellMs`);
    assert.ok(visit.timeToVisitMs >= 0);
    assert.ok(visit.confirmedDwellMs >= 0);
    assert.ok(visit.confirmedDwellMs <= visit.timeToVisitMs);
    assert.ok(visit.confirmedDwellMs >= params.minimumFixationMs);
    assert.ok(visit.timeToVisitMs <= params.maximumStimulusDurationMs);
    confirmedDuration += visit.timeToVisitMs;
  }

  assert.ok(root.elapsedMs >= confirmedDuration);
  const remaining = root.elapsedMs - confirmedDuration;

  if (root.outcome === 'COMPLETED') {
    assert.equal(root.visits.length, 4);
    assert.equal(remaining, 0);
  } else if (root.outcome === 'TIMED_OUT') {
    assert.ok(root.visits.length < 4);
    assert.equal(remaining, params.maximumStimulusDurationMs);
  } else {
    assert.ok(root.visits.length < 4);
    assert.ok(remaining >= 0 && remaining < params.maximumStimulusDurationMs);
  }
}

function validateVisualSearchFamilyContract(
  body: unknown,
  durationField: 'localizationDurationMs' | 'elapsedMs' | 'searchDurationMs',
  minimumFixationMs: number,
  maximumDurationMs: number,
  expectedOrigin: AnalyticsDataOrigin
): void {
  const root = decodeAndCheckEnvelope(
    body,
    ['schemaVersion', 'trialId', 'outcome', durationField, 'confirmedDwellMs', 'dataOrigin'],
    expectedOrigin
  );

  assertInteger(minimumFixationMs, 'minimumFixationMs');
  assertInteger(maximumDurationMs, 'maximumDurationMs');
  assert.ok(minimumFixationMs >= 1 && maximumDurationMs >= minimumFixationMs);

  assert.ok(
    root.outcome === 'SUCCESS' || root.outcome === 'TIMEOUT' || root.outcome === 'INTERRUPTED',
    `Invalid outcome: ${String(root.outcome)}`
  );

  const duration = root[durationField];
  assertInteger(duration, durationField);
  assert.ok(duration >= 0);

  if (root.outcome === 'SUCCESS') {
    assertInteger(root.confirmedDwellMs, 'confirmedDwellMs');
    assert.ok(root.confirmedDwellMs >= 0);
    assert.ok(root.confirmedDwellMs <= duration);
    assert.ok(root.confirmedDwellMs >= minimumFixationMs);
    assert.ok(duration <= maximumDurationMs);
  } else if (root.outcome === 'TIMEOUT') {
    assert.equal(root.confirmedDwellMs, null);
    assert.ok(duration >= maximumDurationMs);
  } else {
    assert.equal(root.confirmedDwellMs, null);
    assert.ok(duration < maximumDurationMs);
  }
}

function validateSustainedFixationContract(
  body: unknown,
  params: FixationParameters,
  expectedOrigin: AnalyticsDataOrigin
): void {
  const root = decodeAndCheckEnvelope(
    body,
    [
      'schemaVersion',
      'trialId',
      'outcome',
      'elapsedMs',
      'insideTargetMs',
      'longestContinuousInsideMs',
      'dataOrigin',
    ],
    expectedOrigin
  );

  assertInteger(params.minimumFixationMs, 'params.minimumFixationMs');
  assertInteger(params.maximumFixationMs, 'params.maximumFixationMs');
  assert.ok(params.minimumFixationMs >= 300 && params.minimumFixationMs <= 3000);
  assert.ok(params.maximumFixationMs >= 500 && params.maximumFixationMs <= 5000);
  assert.ok(params.maximumFixationMs >= params.minimumFixationMs);

  assert.ok(
    root.outcome === 'SUCCESS' || root.outcome === 'TIMEOUT' || root.outcome === 'INTERRUPTED'
  );
  assertInteger(root.elapsedMs, 'elapsedMs');
  assertInteger(root.insideTargetMs, 'insideTargetMs');
  assertInteger(root.longestContinuousInsideMs, 'longestContinuousInsideMs');

  assert.ok(root.longestContinuousInsideMs >= 0);
  assert.ok(root.longestContinuousInsideMs <= root.insideTargetMs);
  assert.ok(root.insideTargetMs <= root.elapsedMs);
  assert.ok(root.elapsedMs <= params.maximumFixationMs);

  const completed = root.longestContinuousInsideMs >= params.minimumFixationMs;
  const atDeadline = root.elapsedMs === params.maximumFixationMs;

  if (root.outcome === 'SUCCESS') {
    assert.equal(completed, true);
  } else if (root.outcome === 'TIMEOUT') {
    assert.equal(completed, false);
    assert.equal(atDeadline, true);
  } else {
    assert.equal(completed, false);
    assert.equal(atDeadline, false);
  }
}

describe('Trial Contracts (Java backend decoder + domain mirror)', () => {
  it('SYSTEMATIC_EXPLORATION satisfies decoder & context for COMPLETED, TIMED_OUT(0..3), INTERRUPTED(0..3)', () => {
    const params: VisualScanningParameters = {
      mode: 'SYSTEMATIC_EXPLORATION',
      affectedHemifield: 'LEFT',
      minimumFixationMs: 450,
      maximumStimulusDurationMs: 2500,
      eccentricityDegrees: 20,
      targetSizePx: 68,
      repetitions: 4,
      interStimulusIntervalMs: 750,
      difficultyLevel: 2,
    };
    const dt = 16.67;

    for (const origin of DATA_ORIGINS) {
      // COMPLETED (4 quadrants)
      {
        const state = createSystematicExplorationTrial(params, 800, 600, 0);
        let result = null;
        for (let step = 0; step < 300 && !result; step++) {
          const wp = state.waypoints[state.currentStepIndex];
          result = stepSystematicExplorationTrial(
            state,
            { x: wp.x, y: wp.y },
            dt,
            params,
            true,
            dt,
            origin
          );
        }
        assert.ok(result !== null);
        assert.equal(result.outcome, 'COMPLETED');
        validateSystematicExplorationContract(result, params, origin);
      }

      // TIMED_OUT after 0, 1, 2, 3 quadrants
      for (const targetVisits of [0, 1, 2, 3]) {
        const state = createSystematicExplorationTrial(params, 800, 600, targetVisits);
        let result = null;
        for (let step = 0; step < 500 && !result; step++) {
          const visitCount = state.visits.length;
          const cursor =
            visitCount < targetVisits
              ? { x: state.waypoints[visitCount].x, y: state.waypoints[visitCount].y }
              : { x: -100, y: -100 };
          result = stepSystematicExplorationTrial(state, cursor, dt, params, true, dt, origin);
        }
        assert.ok(result !== null);
        assert.equal(result.outcome, 'TIMED_OUT');
        assert.equal(result.visits.length, targetVisits);
        validateSystematicExplorationContract(result, params, origin);
      }

      // INTERRUPTED after 0, 1, 2, 3 quadrants (including 0ms elapsed and mid-quadrant)
      for (const targetVisits of [0, 1, 2, 3]) {
        // 0ms into current quadrant
        {
          const state = createSystematicExplorationTrial(params, 800, 600, targetVisits);
          while (state.visits.length < targetVisits) {
            const wp = state.waypoints[state.currentStepIndex];
            const res = stepSystematicExplorationTrial(
              state,
              { x: wp.x, y: wp.y },
              dt,
              params,
              true,
              dt,
              origin
            );
            assert.equal(res, null);
          }
          const interrupted = interruptSystematicExplorationTrial(state, params, origin);
          assert.equal(interrupted.outcome, 'INTERRUPTED');
          assert.equal(interrupted.visits.length, targetVisits);
          validateSystematicExplorationContract(interrupted, params, origin);
        }

        // Mid-quadrant (including near timeout boundary)
        {
          const state = createSystematicExplorationTrial(params, 800, 600, targetVisits);
          while (state.visits.length < targetVisits) {
            const wp = state.waypoints[state.currentStepIndex];
            stepSystematicExplorationTrial(state, { x: wp.x, y: wp.y }, dt, params, true, dt, origin);
          }
          // Advance partial time off-target without timing out
          for (let f = 0; f < 10; f++) {
            const res = stepSystematicExplorationTrial(
              state,
              { x: -100, y: -100 },
              dt,
              params,
              true,
              dt,
              origin
            );
            assert.equal(res, null);
          }
          const interrupted = interruptSystematicExplorationTrial(state, params, origin);
          assert.equal(interrupted.outcome, 'INTERRUPTED');
          assert.equal(interrupted.visits.length, targetVisits);
          validateSystematicExplorationContract(interrupted, params, origin);
        }
      }
    }
  });

  it('STANDARD_SCANNING satisfies decoder & context for SUCCESS, TIMEOUT, and INTERRUPTED', () => {
    const params: VisualScanningParameters = {
      mode: 'STANDARD_SCANNING',
      affectedHemifield: 'RIGHT',
      minimumFixationMs: 400,
      maximumStimulusDurationMs: 2500,
      eccentricityDegrees: 18,
      targetSizePx: 68,
      repetitions: 6,
      interStimulusIntervalMs: 750,
      difficultyLevel: 2,
    };
    const dt = 16.67;

    for (const origin of DATA_ORIGINS) {
      // SUCCESS
      {
        const state = createStandardScanningTrial(params, 800, 600, 0);
        let result = null;
        for (let f = 0; f < 100 && !result; f++) {
          result = stepStandardScanningTrial(
            state,
            { x: state.target.x, y: state.target.y },
            dt,
            params,
            true,
            dt,
            origin
          );
        }
        assert.ok(result !== null);
        assert.equal(result.outcome, 'SUCCESS');
        validateVisualSearchFamilyContract(
          result,
          'localizationDurationMs',
          params.minimumFixationMs,
          params.maximumStimulusDurationMs,
          origin
        );
      }

      // TIMEOUT
      {
        const state = createStandardScanningTrial(params, 800, 600, 1);
        let result = null;
        for (let f = 0; f < 200 && !result; f++) {
          result = stepStandardScanningTrial(
            state,
            { x: -500, y: -500 },
            dt,
            params,
            true,
            dt,
            origin
          );
        }
        assert.ok(result !== null);
        assert.equal(result.outcome, 'TIMEOUT');
        validateVisualSearchFamilyContract(
          result,
          'localizationDurationMs',
          params.minimumFixationMs,
          params.maximumStimulusDurationMs,
          origin
        );
      }

      // INTERRUPTED at 0ms & mid-trial
      {
        const s0 = createStandardScanningTrial(params, 800, 600, 2);
        const r0 = interruptStandardScanningTrial(s0, params, origin);
        assert.equal(r0.outcome, 'INTERRUPTED');
        validateVisualSearchFamilyContract(
          r0,
          'localizationDurationMs',
          params.minimumFixationMs,
          params.maximumStimulusDurationMs,
          origin
        );

        const sMid = createStandardScanningTrial(params, 800, 600, 3);
        stepStandardScanningTrial(sMid, { x: -500, y: -500 }, 500, params, true, 500, origin);
        const rMid = interruptStandardScanningTrial(sMid, params, origin);
        assert.equal(rMid.outcome, 'INTERRUPTED');
        validateVisualSearchFamilyContract(
          rMid,
          'localizationDurationMs',
          params.minimumFixationMs,
          params.maximumStimulusDurationMs,
          origin
        );
      }
    }
  });

  it('COMPENSATORY_SACCADE satisfies decoder & context for SUCCESS, TIMEOUT, and INTERRUPTED', () => {
    const params: VisualScanningParameters = {
      mode: 'COMPENSATORY_SACCADE',
      affectedHemifield: 'LEFT',
      minimumFixationMs: 600,
      maximumStimulusDurationMs: 2500,
      eccentricityDegrees: 20,
      targetSizePx: 68,
      repetitions: 6,
      interStimulusIntervalMs: 750,
      difficultyLevel: 2,
    };
    const dt = 16.67;

    for (const origin of DATA_ORIGINS) {
      // SUCCESS
      {
        const state = createCompensatorySaccadeTrial(params, 800, 600, 0);
        let result = null;
        for (let f = 0; f < 120 && !result; f++) {
          const targetPt =
            state.phase === 'CENTRAL_ANCHOR' ? state.anchor : state.peripheralTarget;
          result = stepCompensatorySaccadeTrial(
            state,
            { x: targetPt.x, y: targetPt.y },
            dt,
            params,
            true,
            dt,
            origin
          );
        }
        assert.ok(result !== null);
        assert.equal(result.outcome, 'SUCCESS');
        validateVisualSearchFamilyContract(
          result,
          'elapsedMs',
          params.minimumFixationMs,
          params.maximumStimulusDurationMs,
          origin
        );
      }

      // TIMEOUT
      {
        const state = createCompensatorySaccadeTrial(params, 800, 600, 1);
        let result = null;
        for (let f = 0; f < 250 && !result; f++) {
          const cursor =
            state.phase === 'CENTRAL_ANCHOR'
              ? { x: state.anchor.x, y: state.anchor.y }
              : { x: -500, y: -500 };
          result = stepCompensatorySaccadeTrial(state, cursor, dt, params, true, dt, origin);
        }
        assert.ok(result !== null);
        assert.equal(result.outcome, 'TIMEOUT');
        validateVisualSearchFamilyContract(
          result,
          'elapsedMs',
          params.minimumFixationMs,
          params.maximumStimulusDurationMs,
          origin
        );
      }

      // INTERRUPTED in CENTRAL_ANCHOR & PERIPHERAL_TARGET
      {
        const sAnchor = createCompensatorySaccadeTrial(params, 800, 600, 2);
        const rAnchor = interruptCompensatorySaccadeTrial(sAnchor, params, origin);
        assert.equal(rAnchor.outcome, 'INTERRUPTED');
        validateVisualSearchFamilyContract(
          rAnchor,
          'elapsedMs',
          params.minimumFixationMs,
          params.maximumStimulusDurationMs,
          origin
        );

        const sPeriph = createCompensatorySaccadeTrial(params, 800, 600, 3);
        while (sPeriph.phase === 'CENTRAL_ANCHOR') {
          stepCompensatorySaccadeTrial(
            sPeriph,
            { x: sPeriph.anchor.x, y: sPeriph.anchor.y },
            dt,
            params,
            true,
            dt,
            origin
          );
        }
        stepCompensatorySaccadeTrial(sPeriph, { x: -500, y: -500 }, 400, params, true, 400, origin);
        const rPeriph = interruptCompensatorySaccadeTrial(sPeriph, params, origin);
        assert.equal(rPeriph.outcome, 'INTERRUPTED');
        validateVisualSearchFamilyContract(
          rPeriph,
          'elapsedMs',
          params.minimumFixationMs,
          params.maximumStimulusDurationMs,
          origin
        );
      }
    }
  });

  it('TARGET_SEARCH_WITH_DISTRACTORS satisfies decoder & context for SUCCESS, TIMEOUT, and INTERRUPTED', () => {
    const params: VisualSearchParameters = {
      mode: 'TARGET_SEARCH_WITH_DISTRACTORS',
      affectedHemifield: 'LEFT',
      targetCount: 8,
      distractorCount: 4,
      minimumFixationMs: 350,
      maximumSearchTimeMs: 4000,
      affectedHemifieldBias: 0.75,
      targetSizePx: 64,
      difficultyLevel: 2,
    };
    const dt = 16.67;

    for (const origin of DATA_ORIGINS) {
      // SUCCESS across multiple targets
      {
        const state = createVisualSearchTrial(params, 800, 600, 0);
        let result = null;
        for (let f = 0; f < 300 && !result; f++) {
          const nextTarget = state.entities.find((e) => e.kind === 'TARGET' && !e.found);
          assert.ok(nextTarget);
          result = stepVisualSearchTrial(
            state,
            { x: nextTarget.x, y: nextTarget.y },
            dt,
            params,
            true,
            dt,
            origin
          );
        }
        assert.ok(result !== null);
        assert.equal(result.outcome, 'SUCCESS');
        validateVisualSearchFamilyContract(
          result,
          'searchDurationMs',
          params.minimumFixationMs,
          params.maximumSearchTimeMs,
          origin
        );
      }

      // TIMEOUT
      {
        const state = createVisualSearchTrial(params, 800, 600, 1);
        let result = null;
        for (let f = 0; f < 300 && !result; f++) {
          result = stepVisualSearchTrial(
            state,
            { x: -1000, y: -1000 },
            dt,
            params,
            true,
            dt,
            origin
          );
        }
        assert.ok(result !== null);
        assert.equal(result.outcome, 'TIMEOUT');
        validateVisualSearchFamilyContract(
          result,
          'searchDurationMs',
          params.minimumFixationMs,
          params.maximumSearchTimeMs,
          origin
        );
      }

      // INTERRUPTED at 0ms & mid-trial
      {
        const s0 = createVisualSearchTrial(params, 800, 600, 2);
        const r0 = interruptVisualSearchTrial(s0, params, origin);
        assert.equal(r0.outcome, 'INTERRUPTED');
        validateVisualSearchFamilyContract(
          r0,
          'searchDurationMs',
          params.minimumFixationMs,
          params.maximumSearchTimeMs,
          origin
        );

        const sMid = createVisualSearchTrial(params, 800, 600, 3);
        stepVisualSearchTrial(sMid, { x: -1000, y: -1000 }, 750, params, true, 750, origin);
        const rMid = interruptVisualSearchTrial(sMid, params, origin);
        assert.equal(rMid.outcome, 'INTERRUPTED');
        validateVisualSearchFamilyContract(
          rMid,
          'searchDurationMs',
          params.minimumFixationMs,
          params.maximumSearchTimeMs,
          origin
        );
      }
    }
  });

  it('SUSTAINED_TARGET_FIXATION satisfies decoder & context for SUCCESS, TIMEOUT, and INTERRUPTED edge cases', () => {
    const params: FixationParameters = {
      mode: 'SUSTAINED_TARGET_FIXATION',
      targetPosition: 'RANDOM',
      minimumFixationMs: 600,
      maximumFixationMs: 2000,
      targetSizePx: 72,
      repetitions: 4,
      restBetweenRepetitionsMs: 1000,
      difficultyLevel: 2,
    };
    const dt = 16.67;

    for (const origin of DATA_ORIGINS) {
      // SUCCESS
      {
        const state = createSustainedFixationTrial(params, 800, 600, 0);
        let result = null;
        for (let f = 0; f < 80 && !result; f++) {
          result = stepSustainedFixationTrial(
            state,
            { x: state.x, y: state.y },
            dt,
            params,
            true,
            dt,
            origin
          );
        }
        assert.ok(result !== null);
        assert.equal(result.outcome, 'SUCCESS');
        validateSustainedFixationContract(result, params, origin);
      }

      // TIMEOUT (including near-success inside time that loses fixation before 600ms)
      {
        const state = createSustainedFixationTrial(params, 800, 600, 1);
        let result = null;
        // Hover for 500ms (< 600ms), then move outside until timeout at 2000ms
        for (let f = 0; f < 30; f++) {
          result = stepSustainedFixationTrial(
            state,
            { x: state.x, y: state.y },
            dt,
            params,
            true,
            dt,
            origin
          );
          assert.equal(result, null);
        }
        for (let f = 0; f < 120 && !result; f++) {
          result = stepSustainedFixationTrial(
            state,
            { x: -500, y: -500 },
            dt,
            params,
            true,
            dt,
            origin
          );
        }
        assert.ok(result !== null);
        assert.equal(result.outcome, 'TIMEOUT');
        validateSustainedFixationContract(result, params, origin);
      }

      // INTERRUPTED at 0ms
      {
        const state = createSustainedFixationTrial(params, 800, 600, 2);
        const result = interruptSustainedFixationTrial(state, params, origin);
        assert.equal(result.outcome, 'INTERRUPTED');
        validateSustainedFixationContract(result, params, origin);
      }

      // INTERRUPTED mid-trial
      {
        const state = createSustainedFixationTrial(params, 800, 600, 3);
        stepSustainedFixationTrial(state, { x: state.x, y: state.y }, 250, params, true, 250, origin);
        stepSustainedFixationTrial(state, { x: -500, y: -500 }, 400, params, true, 400, origin);
        const result = interruptSustainedFixationTrial(state, params, origin);
        assert.equal(result.outcome, 'INTERRUPTED');
        validateSustainedFixationContract(result, params, origin);
      }

      // INTERRUPTED right before TIMEOUT boundary (e.g. elapsedMs = maximumFixationMs - 0.2ms -> rounds to max)
      {
        const state = createSustainedFixationTrial(params, 800, 600, 4);
        const res = stepSustainedFixationTrial(
          state,
          { x: -500, y: -500 },
          params.maximumFixationMs - 0.2,
          params,
          true,
          0,
          origin
        );
        assert.equal(res, null);
        const result = interruptSustainedFixationTrial(state, params, origin);
        assert.equal(result.outcome, 'INTERRUPTED');
        assert.ok(result.elapsedMs < params.maximumFixationMs);
        validateSustainedFixationContract(result, params, origin);
      }
    }
  });
});
