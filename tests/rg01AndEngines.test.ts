import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  GazeFreshnessGuard,
  MAX_DWELL_PER_REUSED_SAMPLE_MS,
} from '../src/infrastructure/therapy/gazeFreshnessGuard.ts';
import {
  InferenceRateMonitor,
  computeVisualSearchActiveTargetCount,
  validateExerciseCaptureCompatibility,
} from '../src/infrastructure/therapy/captureCompatibility.ts';
import {
  DEFAULT_MIN_ANCHOR_TIMEOUT_MS,
  createCompensatorySaccadeTrial,
  createStandardScanningTrial,
  createSystematicExplorationTrial,
  stepCompensatorySaccadeTrial,
  stepStandardScanningTrial,
  stepSystematicExplorationTrial,
} from '../src/infrastructure/therapy/modules/visualScanningEngine.ts';
import {
  createSustainedFixationTrial,
  createVisualSearchTrial,
  stepSustainedFixationTrial,
  stepVisualSearchTrial,
} from '../src/infrastructure/therapy/modules/visualSearchAndFixationEngine.ts';
import type {
  FixationParameters,
  VisualScanningParameters,
  VisualSearchParameters,
} from '../src/infrastructure/api/contracts/clinical.contracts.ts';

const BASE_SCANNING_SLOW: VisualScanningParameters = {
  mode: 'STANDARD_SCANNING',
  affectedHemifield: 'LEFT',
  minimumFixationMs: 2000,
  maximumStimulusDurationMs: 2500,
  eccentricityDegrees: 18,
  targetSizePx: 68,
  repetitions: 6,
  interStimulusIntervalMs: 750,
  difficultyLevel: 2,
};

const BASE_SEARCH_SLOW: VisualSearchParameters = {
  mode: 'TARGET_SEARCH_WITH_DISTRACTORS',
  affectedHemifield: 'LEFT',
  targetCount: 5,
  distractorCount: 4,
  minimumFixationMs: 2000,
  maximumSearchTimeMs: 2500,
  affectedHemifieldBias: 0.75,
  targetSizePx: 64,
  difficultyLevel: 5,
};

const BASE_FIXATION_SLOW: FixationParameters = {
  mode: 'SUSTAINED_TARGET_FIXATION',
  targetPosition: 'CENTER',
  minimumFixationMs: 2000,
  maximumFixationMs: 2500,
  targetSizePx: 72,
  repetitions: 5,
  restBetweenRepetitionsMs: 1000,
  difficultyLevel: 2,
};

type ModeName =
  | 'STANDARD_SCANNING'
  | 'SYSTEMATIC_EXPLORATION'
  | 'COMPENSATORY_SACCADE'
  | 'TARGET_SEARCH_WITH_DISTRACTORS'
  | 'SUSTAINED_TARGET_FIXATION';

const ALL_MODES: readonly ModeName[] = [
  'STANDARD_SCANNING',
  'SYSTEMATIC_EXPLORATION',
  'COMPENSATORY_SACCADE',
  'TARGET_SEARCH_WITH_DISTRACTORS',
  'SUSTAINED_TARGET_FIXATION',
];

function buildContinuityHarness(
  mode: ModeName,
  overrides?: { minimumFixationMs?: number; maximumMs?: number }
) {
  const minFix = overrides?.minimumFixationMs ?? 2000;
  const maxMs = overrides?.maximumMs ?? 2500;

  if (mode === 'STANDARD_SCANNING') {
    const params: VisualScanningParameters = {
      ...BASE_SCANNING_SLOW,
      mode,
      minimumFixationMs: minFix,
      maximumStimulusDurationMs: maxMs,
    };
    const state = createStandardScanningTrial(params, 800, 600, 0);
    return {
      expectedSuccess: 'SUCCESS',
      getTargetCursor: () => ({ x: state.target.x, y: state.target.y }),
      step: (
        cursor: { x: number; y: number },
        dt: number,
        evalRes: ReturnType<GazeFreshnessGuard['evaluateFrame']>,
        continuity: ReturnType<GazeFreshnessGuard['getLatestSampleContinuity']>
      ) =>
        stepStandardScanningTrial(
          state,
          cursor,
          dt,
          params,
          evalRes.isSignalFresh,
          evalRes.effectiveDwellDeltaMs,
          'PRODUCER_REPORTED',
          continuity
        ),
      hasAcquired: () => state.target.found,
      getDwell: () => state.target.dwellTimeMs,
      getFixationLosses: () => 0,
    };
  }

  if (mode === 'SYSTEMATIC_EXPLORATION') {
    const params: VisualScanningParameters = {
      ...BASE_SCANNING_SLOW,
      mode,
      minimumFixationMs: minFix,
      maximumStimulusDurationMs: maxMs,
    };
    const state = createSystematicExplorationTrial(params, 800, 600, 0);
    return {
      expectedSuccess: 'COMPLETED',
      getTargetCursor: () => {
        const wp = state.waypoints[state.currentStepIndex] ?? state.waypoints[0];
        return { x: wp.x, y: wp.y };
      },
      step: (
        cursor: { x: number; y: number },
        dt: number,
        evalRes: ReturnType<GazeFreshnessGuard['evaluateFrame']>,
        continuity: ReturnType<GazeFreshnessGuard['getLatestSampleContinuity']>
      ) =>
        stepSystematicExplorationTrial(
          state,
          cursor,
          dt,
          params,
          evalRes.isSignalFresh,
          evalRes.effectiveDwellDeltaMs,
          'PRODUCER_REPORTED',
          continuity
        ),
      hasAcquired: () => state.visits.length > 0,
      getDwell: () => Math.max(0, ...state.waypoints.map((wp) => wp.dwellTimeMs)),
      getFixationLosses: () => 0,
    };
  }

  if (mode === 'COMPENSATORY_SACCADE') {
    const params: VisualScanningParameters = {
      ...BASE_SCANNING_SLOW,
      mode,
      minimumFixationMs: minFix,
      maximumStimulusDurationMs: maxMs,
    };
    const state = createCompensatorySaccadeTrial(params, 800, 600, 0);
    return {
      expectedSuccess: 'SUCCESS',
      getTargetCursor: () =>
        state.phase === 'CENTRAL_ANCHOR'
          ? { x: state.anchor.x, y: state.anchor.y }
          : { x: state.peripheralTarget.x, y: state.peripheralTarget.y },
      step: (
        cursor: { x: number; y: number },
        dt: number,
        evalRes: ReturnType<GazeFreshnessGuard['evaluateFrame']>,
        continuity: ReturnType<GazeFreshnessGuard['getLatestSampleContinuity']>
      ) =>
        stepCompensatorySaccadeTrial(
          state,
          cursor,
          dt,
          params,
          evalRes.isSignalFresh,
          evalRes.effectiveDwellDeltaMs,
          'PRODUCER_REPORTED',
          continuity
        ),
      hasAcquired: () =>
        state.anchor.found ||
        state.phase !== 'CENTRAL_ANCHOR' ||
        state.peripheralTarget.found,
      getDwell: () =>
        Math.max(state.anchor.dwellTimeMs, state.peripheralTarget.dwellTimeMs),
      getFixationLosses: () => 0,
    };
  }

  if (mode === 'TARGET_SEARCH_WITH_DISTRACTORS') {
    const params: VisualSearchParameters = {
      ...BASE_SEARCH_SLOW,
      minimumFixationMs: minFix,
      maximumSearchTimeMs: maxMs,
    };
    const state = createVisualSearchTrial(params, 800, 600, 0);
    return {
      expectedSuccess: 'SUCCESS',
      getTargetCursor: () => {
        const next =
          state.entities.find((e) => e.kind === 'TARGET' && !e.found) ?? state.entities[0];
        return { x: next.x, y: next.y };
      },
      step: (
        cursor: { x: number; y: number },
        dt: number,
        evalRes: ReturnType<GazeFreshnessGuard['evaluateFrame']>,
        continuity: ReturnType<GazeFreshnessGuard['getLatestSampleContinuity']>
      ) =>
        stepVisualSearchTrial(
          state,
          cursor,
          dt,
          params,
          evalRes.isSignalFresh,
          evalRes.effectiveDwellDeltaMs,
          'PRODUCER_REPORTED',
          continuity
        ),
      hasAcquired: () => state.entities.some((e) => e.kind === 'TARGET' && e.found),
      getDwell: () =>
        Math.max(
          0,
          ...state.entities.filter((e) => e.kind === 'TARGET').map((e) => e.dwellTimeMs)
        ),
      getFixationLosses: () => 0,
    };
  }

  const params: FixationParameters = {
    ...BASE_FIXATION_SLOW,
    minimumFixationMs: minFix,
    maximumFixationMs: maxMs,
  };
  const state = createSustainedFixationTrial(params, 800, 600, 0);
  return {
    expectedSuccess: 'SUCCESS',
    getTargetCursor: () => ({ x: state.x, y: state.y }),
    step: (
      cursor: { x: number; y: number },
      dt: number,
      evalRes: ReturnType<GazeFreshnessGuard['evaluateFrame']>,
      continuity: ReturnType<GazeFreshnessGuard['getLatestSampleContinuity']>
    ) =>
      stepSustainedFixationTrial(
        state,
        cursor,
        dt,
        params,
        evalRes.isSignalFresh,
        evalRes.effectiveDwellDeltaMs,
        'PRODUCER_REPORTED',
        continuity
      ),
    hasAcquired: () => state.completed === true && state.outcome === 'SUCCESS',
    getDwell: () => state.longestContinuousInsideMs,
    getFixationLosses: () => state.fixationLosses,
  };
}

describe('Priority 2 (RG-01 slow dwell + 4Hz/2Hz capture + COMPENSATORY_SACCADE anchor timeout)', () => {
  for (const freq of [
    { label: '4 Hz (250ms)', intervalMs: 250 },
    { label: '4 Hz + 20ms jitter (270ms)', intervalMs: 270 },
    { label: '10 Hz (100ms)', intervalMs: 100 },
  ]) {
    it(`1. All 5 engines complete (2000ms dwell / 2500ms max) cleanly at ${freq.label}`, () => {
      const dt = 16.67;
      for (const mode of ALL_MODES) {
        const guard = new GazeFreshnessGuard();
        const h = buildContinuityHarness(mode, {
          minimumFixationMs: 2000,
          maximumMs: 2500,
        });

        let sampleSeq = 1;
        let lastValidSamplePerfMs = 1000;
        let nextSampleAtMs = 1000 + freq.intervalMs;
        let terminalResult: Record<string, unknown> | null = null;
        let staleFrames = 0;

        for (let f = 0; f < 900; f++) {
          const nowPerfMs = 1000 + (f + 1) * dt;
          while (nowPerfMs >= nextSampleAtMs) {
            sampleSeq += 1;
            lastValidSamplePerfMs = nextSampleAtMs;
            nextSampleAtMs += freq.intervalMs;
          }

          const evalRes = guard.evaluateFrame({
            nowPerfMs,
            deltaTimeMs: dt,
            isMouseFallback: false,
            hasMousePointerMoved: false,
            isWebcamStreaming: true,
            confidence: 0.92,
            lastValidSamplePerfMs,
            sampleSeq,
            isBlinking: false,
          });
          if (evalRes.reason === 'STALE_SAMPLE') staleFrames += 1;

          const body = h.step(
            h.getTargetCursor(),
            dt,
            evalRes,
            guard.getLatestSampleContinuity()
          );
          if (body) {
            terminalResult = body as unknown as Record<string, unknown>;
            break;
          }
        }

        assert.equal(staleFrames, 0, `${mode} hit STALE_SAMPLE at ${freq.label}`);
        assert.ok(terminalResult !== null, `${mode} did not finish at ${freq.label}`);
        assert.equal(
          terminalResult.outcome,
          h.expectedSuccess,
          `${mode} failed outcome at ${freq.label}: ${JSON.stringify(terminalResult)}`
        );

        if (mode === 'SUSTAINED_TARGET_FIXATION') {
          assert.equal(h.getFixationLosses(), 0);
          const longest = terminalResult.longestContinuousInsideMs as number;
          const inside = terminalResult.insideTargetMs as number;
          const elapsed = terminalResult.elapsedMs as number;
          assert.ok(longest >= 2000 && longest <= inside && inside <= elapsed && elapsed <= 2500);
        }
      }
    });
  }

  it('2. Off-target 4 Hz warm-up followed by 1 or 2 frozen on-target samples CANNOT acquire targets or distractors', () => {
    const dt = 16.67;

    for (const freezeAfterSamples of [1, 2] as const) {
      for (const mode of ALL_MODES) {
        const guard = new GazeFreshnessGuard();
        const h = buildContinuityHarness(mode, { minimumFixationMs: 300, maximumMs: 2500 });

        let sampleSeq = 1;
        let lastValidSamplePerfMs = 1000;
        let nextSampleAtMs = 1250;
        const onTargetFrameStart = 120; // 2000ms (8 samples off-target at 4 Hz)
        let freezeAtSeq: number | null = null;
        let maxOnTargetDwell = 0;

        for (let f = 0; f < 320; f++) {
          const nowPerfMs = 1000 + (f + 1) * dt;
          while (nowPerfMs >= nextSampleAtMs) {
            if (freezeAtSeq === null || sampleSeq < freezeAtSeq) {
              sampleSeq += 1;
              lastValidSamplePerfMs = nextSampleAtMs;
            }
            nextSampleAtMs += 250;
          }

          if (f === onTargetFrameStart && freezeAtSeq === null) {
            // Freeze cleanly on the current or next sample
            freezeAtSeq = sampleSeq + (freezeAfterSamples - 1);
          }

          const cursor =
            f >= onTargetFrameStart ? h.getTargetCursor() : { x: 5, y: 5 };

          const evalRes = guard.evaluateFrame({
            nowPerfMs,
            deltaTimeMs: dt,
            isMouseFallback: false,
            hasMousePointerMoved: false,
            isWebcamStreaming: true,
            confidence: 0.95,
            lastValidSamplePerfMs,
            sampleSeq,
            isBlinking: false,
          });
          const res = h.step(cursor, dt, evalRes, guard.getLatestSampleContinuity());
          maxOnTargetDwell = Math.max(maxOnTargetDwell, h.getDwell());
          if (res) break;
        }

        const expectedMax = MAX_DWELL_PER_REUSED_SAMPLE_MS * freezeAfterSamples;
        assert.ok(
          maxOnTargetDwell <= expectedMax + 1e-6,
          `${mode} (${freezeAfterSamples} frozen after warmup) exceeded dwell cap: ${maxOnTargetDwell}`
        );
        assert.ok(maxOnTargetDwell < 250);
        assert.equal(h.hasAcquired(), false, `${mode} acquired despite freeze!`);
      }
    }
  });

  it('3. 2 Hz inference fails honestly without fake dwell simulation and is flagged by InferenceRateMonitor & validator', () => {
    const dt = 16.67;
    const intervalMs = 500; // 2 Hz (< 4 Hz clinical minimum)
    const monitor = new InferenceRateMonitor();
    let nextSampleAtMs = 1500;
    monitor.recordSample(1000);

    for (let f = 0; f < 180; f++) {
      const nowPerfMs = 1000 + (f + 1) * dt;
      while (nowPerfMs >= nextSampleAtMs) {
        monitor.recordSample(nextSampleAtMs);
        nextSampleAtMs += intervalMs;
      }
    }

    const rateSnap = monitor.getSnapshot(1000 + 180 * dt);
    assert.ok(rateSnap.measuredFps !== null && rateSnap.measuredFps < 2.5);
    assert.equal(rateSnap.status, 'BELOW_MIN_FPS');

    const compat = validateExerciseCaptureCompatibility(BASE_SCANNING_SLOW, {
      isMouseFallback: false,
      measuredFps: rateSnap.measuredFps,
    });
    assert.equal(compat.compatible, false);
    assert.ok(
      compat.issues.some((i) => i.code === 'INFERENCE_RATE_BELOW_MINIMUM'),
      'Expected INFERENCE_RATE_BELOW_MINIMUM error at 2 Hz'
    );

    // Engines must NOT complete under 2 Hz
    for (const mode of ALL_MODES) {
      const guard = new GazeFreshnessGuard();
      const h = buildContinuityHarness(mode, { minimumFixationMs: 2000, maximumMs: 2500 });
      let sSeq = 1;
      let lastTs = 1000;
      let nextTs = 1500;

      for (let f = 0; f < 300; f++) {
        const nowPerfMs = 1000 + (f + 1) * dt;
        while (nowPerfMs >= nextTs) {
          sSeq += 1;
          lastTs = nextTs;
          nextTs += intervalMs;
        }
        const evalRes = guard.evaluateFrame({
          nowPerfMs,
          deltaTimeMs: dt,
          isMouseFallback: false,
          hasMousePointerMoved: false,
          isWebcamStreaming: true,
          confidence: 0.95,
          lastValidSamplePerfMs: lastTs,
          sampleSeq: sSeq,
          isBlinking: false,
        });
        const res = h.step(
          h.getTargetCursor(),
          dt,
          evalRes,
          guard.getLatestSampleContinuity()
        );
        if (res) {
          assert.notEqual(res.outcome, h.expectedSuccess);
          break;
        }
      }
      assert.equal(h.hasAcquired(), false, `${mode} falsely acquired at 2 Hz!`);
    }
  });

  it('4. COMPENSATORY_SACCADE central anchor times out cleanly at anchorTimeoutMs with valid 6-key Java contract', () => {
    const params: VisualScanningParameters = {
      ...BASE_SCANNING_SLOW,
      mode: 'COMPENSATORY_SACCADE',
      minimumFixationMs: 600,
      maximumStimulusDurationMs: 2500,
    };
    const state = createCompensatorySaccadeTrial(params, 800, 600, 0);
    assert.equal(state.anchorTimeoutMs, DEFAULT_MIN_ANCHOR_TIMEOUT_MS);
    assert.equal(state.timedOutOnAnchor, false);

    let terminalBody: ReturnType<typeof stepCompensatorySaccadeTrial> = null;
    for (let t = 0; t < 260; t++) {
      const body = stepCompensatorySaccadeTrial(
        state,
        { x: 10, y: 10 }, // never looks at central anchor
        20,
        params,
        true,
        20,
        'PRODUCER_REPORTED'
      );
      if (body) {
        terminalBody = body;
        break;
      }
    }

    assert.ok(terminalBody !== null, 'Anchor timeout did not fire');
    assert.equal(terminalBody.outcome, 'TIMEOUT');
    assert.equal(terminalBody.confirmedDwellMs, null);
    assert.ok(terminalBody.elapsedMs >= params.maximumStimulusDurationMs);
    assert.equal(state.timedOutOnAnchor, true);
    assert.deepEqual(
      Object.keys(terminalBody).sort(),
      ['confirmedDwellMs', 'dataOrigin', 'elapsedMs', 'outcome', 'schemaVersion', 'trialId']
    );
  });

  it('5. Parameter & capture compatibility validator rejects uncompletable search/min>max and warns low headroom', () => {
    assert.equal(computeVisualSearchActiveTargetCount(16, 2), 4);

    // 4 active targets * 2000ms = 8000ms > 3000ms -> uncompletable
    const invalidSearch = validateExerciseCaptureCompatibility({
      ...BASE_SEARCH_SLOW,
      targetCount: 16,
      difficultyLevel: 2,
      minimumFixationMs: 2000,
      maximumSearchTimeMs: 3000,
    });
    assert.equal(invalidSearch.compatible, false);
    assert.ok(invalidSearch.issues.some((i) => i.code === 'UNCOMPLETABLE_SEARCH_TARGETS'));

    // minimumFixationMs > maximumFixationMs -> rejected
    const minOverMax = validateExerciseCaptureCompatibility({
      ...BASE_FIXATION_SLOW,
      minimumFixationMs: 2800,
      maximumFixationMs: 2000,
    });
    assert.equal(minOverMax.compatible, false);
    assert.ok(minOverMax.issues.some((i) => i.code === 'MIN_EXCEEDS_MAX'));

    // 2000/2000 Scanning -> warns low headroom (< 250ms)
    const zeroHeadroom = validateExerciseCaptureCompatibility({
      ...BASE_SCANNING_SLOW,
      minimumFixationMs: 2000,
      maximumStimulusDurationMs: 2000,
    });
    assert.equal(zeroHeadroom.compatible, true);
    assert.ok(zeroHeadroom.issues.some((i) => i.code === 'LOW_REACTION_HEADROOM'));

    // 2000/2500 at 4.0 Hz -> compatible!
    const valid4Hz = validateExerciseCaptureCompatibility(BASE_SCANNING_SLOW, {
      isMouseFallback: false,
      measuredFps: 4.0,
    });
    assert.equal(valid4Hz.compatible, true);
  });
});
