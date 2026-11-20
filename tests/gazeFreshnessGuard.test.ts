import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GazeFreshnessGuard,
  MAX_DWELL_PER_REUSED_SAMPLE_MS,
  MAX_GAZE_STALENESS_MS,
  MIN_VALID_GAZE_CONFIDENCE,
  SUPPORTED_MIN_INFERENCE_FPS,
} from '../src/infrastructure/therapy/gazeFreshnessGuard.ts';
import type {
  GazeFrameEvaluation,
  GazeFrameInput,
} from '../src/infrastructure/therapy/gazeFreshnessGuard.ts';
import {
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

type TherapyEngineMode =
  | 'STANDARD_SCANNING'
  | 'SYSTEMATIC_EXPLORATION'
  | 'COMPENSATORY_SACCADE'
  | 'TARGET_SEARCH_WITH_DISTRACTORS'
  | 'SUSTAINED_TARGET_FIXATION';

const ALL_ENGINE_MODES: readonly TherapyEngineMode[] = [
  'STANDARD_SCANNING',
  'SYSTEMATIC_EXPLORATION',
  'COMPENSATORY_SACCADE',
  'TARGET_SEARCH_WITH_DISTRACTORS',
  'SUSTAINED_TARGET_FIXATION',
];

const SCANNING_PARAMS: VisualScanningParameters = {
  mode: 'STANDARD_SCANNING',
  affectedHemifield: 'LEFT',
  minimumFixationMs: 300,
  maximumStimulusDurationMs: 2500,
  eccentricityDegrees: 18,
  targetSizePx: 68,
  repetitions: 6,
  interStimulusIntervalMs: 750,
  difficultyLevel: 2,
};

const EXPLORATION_PARAMS: VisualScanningParameters = {
  ...SCANNING_PARAMS,
  mode: 'SYSTEMATIC_EXPLORATION',
  maximumStimulusDurationMs: 2500,
};

const SACCADE_PARAMS: VisualScanningParameters = {
  ...SCANNING_PARAMS,
  mode: 'COMPENSATORY_SACCADE',
  maximumStimulusDurationMs: 2500,
};

const SEARCH_PARAMS: VisualSearchParameters = {
  mode: 'TARGET_SEARCH_WITH_DISTRACTORS',
  affectedHemifield: 'LEFT',
  targetCount: 4,
  distractorCount: 4,
  minimumFixationMs: 300,
  maximumSearchTimeMs: 2500,
  affectedHemifieldBias: 0.75,
  targetSizePx: 64,
  difficultyLevel: 2,
};

const FIXATION_PARAMS: FixationParameters = {
  mode: 'SUSTAINED_TARGET_FIXATION',
  targetPosition: 'CENTER',
  minimumFixationMs: 300,
  maximumFixationMs: 2000,
  targetSizePx: 72,
  repetitions: 4,
  restBetweenRepetitionsMs: 1000,
  difficultyLevel: 2,
};

interface EngineHarness {
  mode: TherapyEngineMode;
  expectedSuccessOutcome: 'SUCCESS' | 'COMPLETED';
  expectedTimeoutOutcome: 'TIMEOUT' | 'TIMED_OUT' | 'CENTRAL_ANCHOR';
  getCursor: () => { x: number; y: number };
  step: (
    cursor: { x: number; y: number },
    dt: number,
    evalResult: GazeFrameEvaluation
  ) => { outcome: string } | null;
  getCurrentDwell: () => number;
  hasAnyAcquisition: () => boolean;
  getStateSummary: () => { outcome: string | null; phase?: string; fixationLosses?: number };
}

function createEngineHarness(
  mode: TherapyEngineMode,
  fixationOverride?: Pick<FixationParameters, 'minimumFixationMs' | 'maximumFixationMs'>
): EngineHarness {
  if (mode === 'STANDARD_SCANNING') {
    const state = createStandardScanningTrial(SCANNING_PARAMS, 800, 600, 0);
    return {
      mode,
      expectedSuccessOutcome: 'SUCCESS',
      expectedTimeoutOutcome: 'TIMEOUT',
      getCursor: () => ({ x: state.target.x, y: state.target.y }),
      step: (cursor, dt, g) =>
        stepStandardScanningTrial(
          state,
          cursor,
          dt,
          SCANNING_PARAMS,
          g.isSignalFresh,
          g.effectiveDwellDeltaMs
        ),
      getCurrentDwell: () => state.target.dwellTimeMs,
      hasAnyAcquisition: () => state.target.found,
      getStateSummary: () => ({ outcome: state.outcome }),
    };
  }

  if (mode === 'SYSTEMATIC_EXPLORATION') {
    const state = createSystematicExplorationTrial(EXPLORATION_PARAMS, 800, 600, 0);
    return {
      mode,
      expectedSuccessOutcome: 'COMPLETED',
      expectedTimeoutOutcome: 'TIMED_OUT',
      getCursor: () => {
        const wp = state.waypoints[state.currentStepIndex] ?? state.waypoints[0];
        return { x: wp.x, y: wp.y };
      },
      step: (cursor, dt, g) =>
        stepSystematicExplorationTrial(
          state,
          cursor,
          dt,
          EXPLORATION_PARAMS,
          g.isSignalFresh,
          g.effectiveDwellDeltaMs
        ),
      getCurrentDwell: () =>
        Math.max(0, ...state.waypoints.map((wp) => wp.dwellTimeMs)),
      hasAnyAcquisition: () => state.visits.length > 0,
      getStateSummary: () => ({ outcome: state.outcome }),
    };
  }

  if (mode === 'COMPENSATORY_SACCADE') {
    const state = createCompensatorySaccadeTrial(SACCADE_PARAMS, 800, 600, 0);
    return {
      mode,
      expectedSuccessOutcome: 'SUCCESS',
      expectedTimeoutOutcome: 'CENTRAL_ANCHOR',
      getCursor: () =>
        state.phase === 'CENTRAL_ANCHOR'
          ? { x: state.anchor.x, y: state.anchor.y }
          : { x: state.peripheralTarget.x, y: state.peripheralTarget.y },
      step: (cursor, dt, g) =>
        stepCompensatorySaccadeTrial(
          state,
          cursor,
          dt,
          SACCADE_PARAMS,
          g.isSignalFresh,
          g.effectiveDwellDeltaMs
        ),
      getCurrentDwell: () =>
        Math.max(state.anchor.dwellTimeMs, state.peripheralTarget.dwellTimeMs),
      hasAnyAcquisition: () =>
        state.anchor.found ||
        state.phase !== 'CENTRAL_ANCHOR' ||
        state.peripheralTarget.found,
      getStateSummary: () => ({ outcome: state.outcome, phase: state.phase }),
    };
  }

  if (mode === 'TARGET_SEARCH_WITH_DISTRACTORS') {
    const state = createVisualSearchTrial(SEARCH_PARAMS, 800, 600, 0);
    return {
      mode,
      expectedSuccessOutcome: 'SUCCESS',
      expectedTimeoutOutcome: 'TIMEOUT',
      getCursor: () => {
        const nextTarget =
          state.entities.find((e) => e.kind === 'TARGET' && !e.found) ??
          state.entities[0];
        return { x: nextTarget.x, y: nextTarget.y };
      },
      step: (cursor, dt, g) =>
        stepVisualSearchTrial(
          state,
          cursor,
          dt,
          SEARCH_PARAMS,
          g.isSignalFresh,
          g.effectiveDwellDeltaMs
        ),
      getCurrentDwell: () =>
        Math.max(
          0,
          ...state.entities
            .filter((e) => e.kind === 'TARGET')
            .map((e) => e.dwellTimeMs)
        ),
      hasAnyAcquisition: () =>
        state.entities.some((e) => e.kind === 'TARGET' && e.found),
      getStateSummary: () => ({ outcome: state.outcome }),
    };
  }

  const fixParams: FixationParameters = fixationOverride
    ? { ...FIXATION_PARAMS, ...fixationOverride }
    : FIXATION_PARAMS;
  const state = createSustainedFixationTrial(fixParams, 800, 600, 0);
  return {
    mode,
    expectedSuccessOutcome: 'SUCCESS',
    expectedTimeoutOutcome: 'TIMEOUT',
    getCursor: () => ({ x: state.x, y: state.y }),
    step: (cursor, dt, g) =>
      stepSustainedFixationTrial(
        state,
        cursor,
        dt,
        fixParams,
        g.isSignalFresh,
        g.effectiveDwellDeltaMs
      ),
    getCurrentDwell: () => state.longestContinuousInsideMs,
    hasAnyAcquisition: () => state.completed === true && state.outcome === 'SUCCESS',
    getStateSummary: () => ({
      outcome: state.outcome ?? null,
      fixationLosses: state.fixationLosses,
    }),
  };
}

function runFaultSimulation(
  mode: TherapyEngineMode,
  buildInput: (frame: number, elapsedMs: number, baseTimeMs: number, dt: number) => GazeFrameInput,
  maxFrames = 170
) {
  const guard = new GazeFreshnessGuard();
  const harness = createEngineHarness(mode);
  const dt = 16.67;
  const baseTimeMs = 2000;
  let maxObservedDwell = 0;
  let terminalOutcome: string | null = null;

  for (let f = 0; f < maxFrames; f++) {
    const elapsedMs = (f + 1) * dt;
    const g = guard.evaluateFrame(buildInput(f, elapsedMs, baseTimeMs, dt));
    const res = harness.step(harness.getCursor(), dt, g);
    maxObservedDwell = Math.max(maxObservedDwell, harness.getCurrentDwell());
    if (res) {
      terminalOutcome = res.outcome;
      break;
    }
  }

  return {
    harness,
    maxObservedDwell,
    terminalOutcome,
    summary: harness.getStateSummary(),
  };
}

function runLiveFrequencySimulation(
  harness: EngineHarness,
  intervalMs: number,
  maxFrames = 800
) {
  const guard = new GazeFreshnessGuard();
  const dt = 16.67;
  const t0 = 1000;
  let sampleSeq = 1;
  let lastValidSamplePerfMs = t0;
  let nextSampleAtMs = t0 + intervalMs;
  let staleCount = 0;
  let decayCount = 0;
  let terminalOutcome: string | null = null;

  for (let f = 0; f < maxFrames; f++) {
    const nowPerfMs = t0 + (f + 1) * dt;
    while (nowPerfMs >= nextSampleAtMs) {
      sampleSeq += 1;
      lastValidSamplePerfMs = nextSampleAtMs;
      nextSampleAtMs += intervalMs;
    }

    const g = guard.evaluateFrame({
      nowPerfMs,
      deltaTimeMs: dt,
      isMouseFallback: false,
      hasMousePointerMoved: false,
      isWebcamStreaming: true,
      confidence: 0.9,
      lastValidSamplePerfMs,
      sampleSeq,
      isBlinking: false,
    });

    if (g.reason === 'STALE_SAMPLE') staleCount += 1;
    if (g.shouldDecayDwell) decayCount += 1;

    const res = harness.step(harness.getCursor(), dt, g);
    if (res) {
      terminalOutcome = res.outcome;
      break;
    }
  }

  return {
    terminalOutcome,
    staleCount,
    decayCount,
    summary: harness.getStateSummary(),
  };
}

describe('GazeFreshnessGuard', () => {
  it('exposes RG-01 clinical thresholds supporting >= 4 FPS while remaining strictly below 300ms minimum fixation', () => {
    assert.equal(SUPPORTED_MIN_INFERENCE_FPS, 4);
    assert.equal(MAX_GAZE_STALENESS_MS, 280);
    assert.equal(MAX_DWELL_PER_REUSED_SAMPLE_MS, 120);
    assert.equal(MIN_VALID_GAZE_CONFIDENCE, 0.35);

    assert.ok(1000 / SUPPORTED_MIN_INFERENCE_FPS < MAX_GAZE_STALENESS_MS);
    assert.ok(MAX_GAZE_STALENESS_MS < 300);
    assert.ok(MAX_DWELL_PER_REUSED_SAMPLE_MS * 2 < 250);
    assert.ok(MAX_DWELL_PER_REUSED_SAMPLE_MS * 2 < 300);
  });

  it('caps dwell from a frozen sampleSeq=1 over 500ms at 60fps and marks stale after 280ms', () => {
    const guard = new GazeFreshnessGuard();
    const dt = 16.67;
    const sampleTime = 1000;
    let totalCreditedDwell = 0;
    let sawCapped = false;
    let firstStaleElapsedMs: number | null = null;

    for (let frame = 0; frame < 30; frame++) {
      const elapsed = (frame + 1) * dt;
      const evalResult = guard.evaluateFrame({
        nowPerfMs: sampleTime + elapsed,
        deltaTimeMs: dt,
        isMouseFallback: false,
        hasMousePointerMoved: false,
        isWebcamStreaming: true,
        confidence: 0.92,
        lastValidSamplePerfMs: sampleTime,
        sampleSeq: 1,
        isBlinking: false,
      });

      totalCreditedDwell += evalResult.effectiveDwellDeltaMs;

      if (elapsed <= MAX_GAZE_STALENESS_MS) {
        assert.equal(evalResult.isSignalFresh, true);
        assert.equal(evalResult.shouldDecayDwell, false);
        if (evalResult.reason === 'REUSED_SAMPLE_CAPPED') {
          sawCapped = true;
          assert.equal(evalResult.canAccumulateDwell, false);
          assert.equal(evalResult.effectiveDwellDeltaMs, 0);
        }
      } else {
        if (firstStaleElapsedMs === null) {
          firstStaleElapsedMs = elapsed;
        }
        assert.equal(evalResult.reason, 'STALE_SAMPLE');
        assert.equal(evalResult.isSignalFresh, false);
        assert.equal(evalResult.canAccumulateDwell, false);
        assert.equal(evalResult.effectiveDwellDeltaMs, 0);
        assert.equal(evalResult.shouldDecayDwell, true);
      }
    }

    assert.ok(Math.abs(totalCreditedDwell - MAX_DWELL_PER_REUSED_SAMPLE_MS) < 1e-6);
    assert.equal(sawCapped, true);
    assert.ok(firstStaleElapsedMs !== null && firstStaleElapsedMs > MAX_GAZE_STALENESS_MS);
  });

  it('caps a large single-frame deltaTimeMs=500ms spike at MAX_DWELL_PER_REUSED_SAMPLE_MS (120ms)', () => {
    const guard = new GazeFreshnessGuard();
    const res = guard.evaluateFrame({
      nowPerfMs: 1050,
      deltaTimeMs: 500,
      isMouseFallback: false,
      hasMousePointerMoved: false,
      isWebcamStreaming: true,
      confidence: 0.9,
      lastValidSamplePerfMs: 1000,
      sampleSeq: 7,
      isBlinking: false,
    });
    assert.equal(res.isSignalFresh, true);
    assert.equal(res.effectiveDwellDeltaMs, 120);
    assert.equal(res.reason, 'OK');
  });

  it('rejects immediately at 0ms lag on STREAM_STOPPED, BLINKING, LOW_CONFIDENCE, and MOUSE_WAITING_INPUT', () => {
    const guard = new GazeFreshnessGuard();

    const stopped = guard.evaluateFrame({
      nowPerfMs: 1000,
      deltaTimeMs: 16.67,
      isMouseFallback: false,
      hasMousePointerMoved: false,
      isWebcamStreaming: false,
      confidence: 0.99,
      lastValidSamplePerfMs: 1000,
      sampleSeq: 1,
      isBlinking: false,
    });
    assert.deepEqual(stopped, {
      isSignalFresh: false,
      canAccumulateDwell: false,
      effectiveDwellDeltaMs: 0,
      shouldDecayDwell: true,
      isNewSampleForTelemetry: false,
      reason: 'STREAM_STOPPED',
    });

    const blinking = guard.evaluateFrame({
      nowPerfMs: 1000,
      deltaTimeMs: 16.67,
      isMouseFallback: false,
      hasMousePointerMoved: false,
      isWebcamStreaming: true,
      confidence: 0.99,
      lastValidSamplePerfMs: 1000,
      sampleSeq: 2,
      isBlinking: true,
    });
    assert.deepEqual(blinking, {
      isSignalFresh: false,
      canAccumulateDwell: false,
      effectiveDwellDeltaMs: 0,
      shouldDecayDwell: true,
      isNewSampleForTelemetry: false,
      reason: 'BLINKING',
    });

    const lowConf = guard.evaluateFrame({
      nowPerfMs: 1000,
      deltaTimeMs: 16.67,
      isMouseFallback: false,
      hasMousePointerMoved: false,
      isWebcamStreaming: true,
      confidence: 0.34,
      lastValidSamplePerfMs: 1000,
      sampleSeq: 3,
      isBlinking: false,
    });
    assert.deepEqual(lowConf, {
      isSignalFresh: false,
      canAccumulateDwell: false,
      effectiveDwellDeltaMs: 0,
      shouldDecayDwell: true,
      isNewSampleForTelemetry: false,
      reason: 'LOW_CONFIDENCE',
    });

    const mouseWaiting = guard.evaluateFrame({
      nowPerfMs: 1000,
      deltaTimeMs: 16.67,
      isMouseFallback: true,
      hasMousePointerMoved: false,
      isWebcamStreaming: false,
      confidence: 0,
      lastValidSamplePerfMs: 0,
      sampleSeq: 0,
      isBlinking: false,
    });
    assert.equal(mouseWaiting.reason, 'MOUSE_WAITING_INPUT');
    assert.equal(mouseWaiting.isSignalFresh, false);
    assert.equal(mouseWaiting.shouldDecayDwell, true);
    assert.equal(mouseWaiting.effectiveDwellDeltaMs, 0);

    const mouseReady = guard.evaluateFrame({
      nowPerfMs: 1016,
      deltaTimeMs: 16,
      isMouseFallback: true,
      hasMousePointerMoved: true,
      isWebcamStreaming: false,
      confidence: 0,
      lastValidSamplePerfMs: 0,
      sampleSeq: 0,
      isBlinking: false,
    });
    assert.equal(mouseReady.reason, 'OK');
    assert.equal(mouseReady.isSignalFresh, true);
    assert.equal(mouseReady.effectiveDwellDeltaMs, 16);
    assert.equal(mouseReady.isNewSampleForTelemetry, false);
  });

  it('tracks isNewSampleForTelemetry once per emitted sampleSeq and resets cleanly', () => {
    const guard = new GazeFreshnessGuard();
    const baseInput: GazeFrameInput = {
      nowPerfMs: 1000,
      deltaTimeMs: 16.67,
      isMouseFallback: false,
      hasMousePointerMoved: false,
      isWebcamStreaming: true,
      confidence: 0.9,
      lastValidSamplePerfMs: 1000,
      sampleSeq: 10,
      isBlinking: false,
    };

    const first = guard.evaluateFrame(baseInput);
    assert.equal(first.isNewSampleForTelemetry, true);

    const beforeEmit = guard.evaluateFrame({ ...baseInput, nowPerfMs: 1016 });
    assert.equal(beforeEmit.isNewSampleForTelemetry, true);

    guard.markTelemetrySampleEmitted(10);

    const afterEmit = guard.evaluateFrame({ ...baseInput, nowPerfMs: 1032 });
    assert.equal(afterEmit.isNewSampleForTelemetry, false);

    const nextSeq = guard.evaluateFrame({
      ...baseInput,
      nowPerfMs: 1050,
      lastValidSamplePerfMs: 1050,
      sampleSeq: 11,
    });
    assert.equal(nextSeq.isNewSampleForTelemetry, true);

    guard.reset();
    const afterReset = guard.evaluateFrame(baseInput);
    assert.equal(afterReset.isNewSampleForTelemetry, true);
    assert.equal(afterReset.effectiveDwellDeltaMs, 16.67);
  });
});

describe('Held-observation protection matrix (>= 25 distinct scenarios)', () => {
  for (const mode of ALL_ENGINE_MODES) {
    it(`[${mode}] 1 frozen sample (sampleSeq=1) caps dwell <= 120ms and blocks acquisition`, () => {
      const { harness, maxObservedDwell, terminalOutcome, summary } = runFaultSimulation(
        mode,
        (_f, elapsedMs, baseTimeMs, dt) => ({
          nowPerfMs: baseTimeMs + elapsedMs,
          deltaTimeMs: dt,
          isMouseFallback: false,
          hasMousePointerMoved: false,
          isWebcamStreaming: true,
          confidence: 0.95,
          lastValidSamplePerfMs: baseTimeMs,
          sampleSeq: 1,
          isBlinking: false,
        })
      );

      assert.ok(maxObservedDwell <= MAX_DWELL_PER_REUSED_SAMPLE_MS + 1e-6);
      assert.equal(harness.hasAnyAcquisition(), false);
      if (mode === 'COMPENSATORY_SACCADE') {
        assert.equal(summary.phase, 'CENTRAL_ANCHOR');
        assert.equal(terminalOutcome, null);
      } else {
        assert.equal(terminalOutcome, harness.expectedTimeoutOutcome);
      }
      if (mode === 'SUSTAINED_TARGET_FIXATION') {
        assert.ok((summary.fixationLosses ?? 0) >= 1);
      }
    });

    it(`[${mode}] 2 frozen samples separated by 250ms then frozen forever stays <= 240ms < 250ms < 300ms and blocks acquisition`, () => {
      const { harness, maxObservedDwell, terminalOutcome, summary } = runFaultSimulation(
        mode,
        (_f, elapsedMs, baseTimeMs, dt) => {
          const hasSecondSample = elapsedMs >= 250;
          return {
            nowPerfMs: baseTimeMs + elapsedMs,
            deltaTimeMs: dt,
            isMouseFallback: false,
            hasMousePointerMoved: false,
            isWebcamStreaming: true,
            confidence: 0.95,
            lastValidSamplePerfMs: hasSecondSample ? baseTimeMs + 250 : baseTimeMs,
            sampleSeq: hasSecondSample ? 2 : 1,
            isBlinking: false,
          };
        }
      );

      assert.ok(maxObservedDwell <= MAX_DWELL_PER_REUSED_SAMPLE_MS * 2 + 1e-6);
      assert.ok(maxObservedDwell < 250);
      assert.ok(maxObservedDwell < 300);
      assert.equal(harness.hasAnyAcquisition(), false);
      if (mode === 'COMPENSATORY_SACCADE') {
        assert.equal(summary.phase, 'CENTRAL_ANCHOR');
        assert.equal(terminalOutcome, null);
      } else {
        assert.equal(terminalOutcome, harness.expectedTimeoutOutcome);
      }
      if (mode === 'SUSTAINED_TARGET_FIXATION') {
        assert.ok((summary.fixationLosses ?? 0) >= 1);
      }
    });

    it(`[${mode}] live blinking (isBlinking=true) on target accumulates 0ms dwell and blocks acquisition`, () => {
      const { harness, maxObservedDwell, terminalOutcome, summary } = runFaultSimulation(
        mode,
        (f, elapsedMs, baseTimeMs, dt) => ({
          nowPerfMs: baseTimeMs + elapsedMs,
          deltaTimeMs: dt,
          isMouseFallback: false,
          hasMousePointerMoved: false,
          isWebcamStreaming: true,
          confidence: 0.95,
          lastValidSamplePerfMs: baseTimeMs + elapsedMs,
          sampleSeq: f + 1,
          isBlinking: true,
        })
      );

      assert.equal(maxObservedDwell, 0);
      assert.equal(harness.hasAnyAcquisition(), false);
      if (mode === 'COMPENSATORY_SACCADE') {
        assert.equal(summary.phase, 'CENTRAL_ANCHOR');
      } else {
        assert.equal(terminalOutcome, harness.expectedTimeoutOutcome);
      }
    });

    it(`[${mode}] low confidence (0.34 < 0.35) on target accumulates 0ms dwell and blocks acquisition`, () => {
      const { harness, maxObservedDwell, terminalOutcome, summary } = runFaultSimulation(
        mode,
        (f, elapsedMs, baseTimeMs, dt) => ({
          nowPerfMs: baseTimeMs + elapsedMs,
          deltaTimeMs: dt,
          isMouseFallback: false,
          hasMousePointerMoved: false,
          isWebcamStreaming: true,
          confidence: 0.34,
          lastValidSamplePerfMs: baseTimeMs + elapsedMs,
          sampleSeq: f + 1,
          isBlinking: false,
        })
      );

      assert.equal(maxObservedDwell, 0);
      assert.equal(harness.hasAnyAcquisition(), false);
      if (mode === 'COMPENSATORY_SACCADE') {
        assert.equal(summary.phase, 'CENTRAL_ANCHOR');
      } else {
        assert.equal(terminalOutcome, harness.expectedTimeoutOutcome);
      }
    });

    it(`[${mode}] webcam stream stopped (isWebcamStreaming=false) on target accumulates 0ms dwell and blocks acquisition`, () => {
      const { harness, maxObservedDwell, terminalOutcome, summary } = runFaultSimulation(
        mode,
        (f, elapsedMs, baseTimeMs, dt) => ({
          nowPerfMs: baseTimeMs + elapsedMs,
          deltaTimeMs: dt,
          isMouseFallback: false,
          hasMousePointerMoved: false,
          isWebcamStreaming: false,
          confidence: 0.99,
          lastValidSamplePerfMs: baseTimeMs + elapsedMs,
          sampleSeq: f + 1,
          isBlinking: false,
        })
      );

      assert.equal(maxObservedDwell, 0);
      assert.equal(harness.hasAnyAcquisition(), false);
      if (mode === 'COMPENSATORY_SACCADE') {
        assert.equal(summary.phase, 'CENTRAL_ANCHOR');
      } else {
        assert.equal(terminalOutcome, harness.expectedTimeoutOutcome);
      }
    });
  }

  it('[TARGET_SEARCH_WITH_DISTRACTORS] 1 frozen sample on distractor cannot reach 250ms falseFixations threshold', () => {
    const guard = new GazeFreshnessGuard();
    const state = createVisualSearchTrial(SEARCH_PARAMS, 800, 600, 0);
    const targets = state.entities.filter((e) => e.kind === 'TARGET');
    const distractor = state.entities.find(
      (e) =>
        e.kind === 'DISTRACTOR' &&
        targets.every((t) => Math.hypot(e.x - t.x, e.y - t.y) > t.acceptanceRadius)
    );
    assert.ok(distractor);

    const dt = 16.67;
    const baseTimeMs = 2000;
    let maxDistractorDwell = 0;
    let terminalOutcome: string | null = null;

    for (let f = 0; f < 170; f++) {
      const elapsedMs = (f + 1) * dt;
      const g = guard.evaluateFrame({
        nowPerfMs: baseTimeMs + elapsedMs,
        deltaTimeMs: dt,
        isMouseFallback: false,
        hasMousePointerMoved: false,
        isWebcamStreaming: true,
        confidence: 0.95,
        lastValidSamplePerfMs: baseTimeMs,
        sampleSeq: 1,
        isBlinking: false,
      });
      const res = stepVisualSearchTrial(
        state,
        { x: distractor.x, y: distractor.y },
        dt,
        SEARCH_PARAMS,
        g.isSignalFresh,
        g.effectiveDwellDeltaMs
      );
      maxDistractorDwell = Math.max(maxDistractorDwell, distractor.dwellTimeMs);
      if (res) {
        terminalOutcome = res.outcome;
        break;
      }
    }

    assert.ok(maxDistractorDwell <= MAX_DWELL_PER_REUSED_SAMPLE_MS + 1e-6);
    assert.equal(state.falseFixations, 0);
    assert.equal(terminalOutcome, 'TIMEOUT');
  });

  it('[TARGET_SEARCH_WITH_DISTRACTORS] 2 frozen samples separated by 250ms on distractor cannot reach 250ms falseFixations threshold', () => {
    const guard = new GazeFreshnessGuard();
    const state = createVisualSearchTrial(SEARCH_PARAMS, 800, 600, 1);
    const targets = state.entities.filter((e) => e.kind === 'TARGET');
    const distractor = state.entities.find(
      (e) =>
        e.kind === 'DISTRACTOR' &&
        targets.every((t) => Math.hypot(e.x - t.x, e.y - t.y) > t.acceptanceRadius)
    );
    assert.ok(distractor);

    const dt = 16.67;
    const baseTimeMs = 2000;
    let maxDistractorDwell = 0;
    let terminalOutcome: string | null = null;

    for (let f = 0; f < 170; f++) {
      const elapsedMs = (f + 1) * dt;
      const hasSecondSample = elapsedMs >= 250;
      const g = guard.evaluateFrame({
        nowPerfMs: baseTimeMs + elapsedMs,
        deltaTimeMs: dt,
        isMouseFallback: false,
        hasMousePointerMoved: false,
        isWebcamStreaming: true,
        confidence: 0.95,
        lastValidSamplePerfMs: hasSecondSample ? baseTimeMs + 250 : baseTimeMs,
        sampleSeq: hasSecondSample ? 2 : 1,
        isBlinking: false,
      });
      const res = stepVisualSearchTrial(
        state,
        { x: distractor.x, y: distractor.y },
        dt,
        SEARCH_PARAMS,
        g.isSignalFresh,
        g.effectiveDwellDeltaMs
      );
      maxDistractorDwell = Math.max(maxDistractorDwell, distractor.dwellTimeMs);
      if (res) {
        terminalOutcome = res.outcome;
        break;
      }
    }

    assert.ok(maxDistractorDwell <= MAX_DWELL_PER_REUSED_SAMPLE_MS * 2 + 1e-6);
    assert.ok(maxDistractorDwell < 250);
    assert.equal(state.falseFixations, 0);
    assert.equal(terminalOutcome, 'TIMEOUT');
  });
});

describe('Low-frequency live inference compatibility (4..30 FPS on 60 FPS canvas loop)', () => {
  const SUPPORTED_FREQUENCIES: readonly { label: string; intervalMs: number }[] = [
    { label: '4 FPS (250ms)', intervalMs: 250 },
    { label: '4 FPS + 20ms jitter (270ms)', intervalMs: 270 },
    { label: '5 FPS (200ms)', intervalMs: 200 },
    { label: '6 FPS (167ms)', intervalMs: 167 },
    { label: '8 FPS (125ms)', intervalMs: 125 },
    { label: '10 FPS (100ms)', intervalMs: 100 },
    { label: '15 FPS (67ms)', intervalMs: 67 },
    { label: '30 FPS (33ms)', intervalMs: 33 },
  ];

  for (const { label, intervalMs } of SUPPORTED_FREQUENCIES) {
    it(`${label}: zero STALE_SAMPLE/decay frames and all 5 engines complete SUCCESS/COMPLETED`, () => {
      for (const mode of ALL_ENGINE_MODES) {
        const harness = createEngineHarness(mode);
        const sim = runLiveFrequencySimulation(harness, intervalMs);
        assert.equal(sim.staleCount, 0, `${mode} reported STALE_SAMPLE at ${label}`);
        assert.equal(sim.decayCount, 0, `${mode} reported shouldDecayDwell at ${label}`);
        assert.equal(
          sim.terminalOutcome,
          harness.expectedSuccessOutcome,
          `${mode} failed to complete at ${label}`
        );
      }
    });

    it(`${label}: SUSTAINED_TARGET_FIXATION preserves fixationLosses === 0 for (600/2000) and (1200/2400)`, () => {
      // Clinical config A: minimumFixationMs=600, maximumFixationMs=2000 -> SUCCESS & 0 losses at 4..30 FPS
      const sim600 = runLiveFrequencySimulation(
        createEngineHarness('SUSTAINED_TARGET_FIXATION', {
          minimumFixationMs: 600,
          maximumFixationMs: 2000,
        }),
        intervalMs
      );
      assert.equal(sim600.staleCount, 0);
      assert.equal(sim600.decayCount, 0);
      assert.equal(sim600.summary.fixationLosses, 0);
      assert.equal(sim600.terminalOutcome, 'SUCCESS');

      // Clinical config B: minimumFixationMs=1200, maximumFixationMs=2400 -> 0 losses across 4..30 FPS
      const sim1200 = runLiveFrequencySimulation(
        createEngineHarness('SUSTAINED_TARGET_FIXATION', {
          minimumFixationMs: 1200,
          maximumFixationMs: 2400,
        }),
        intervalMs
      );
      assert.equal(sim1200.staleCount, 0);
      assert.equal(sim1200.decayCount, 0);
      assert.equal(sim1200.summary.fixationLosses, 0);
      if (intervalMs <= 200) {
        assert.equal(sim1200.terminalOutcome, 'SUCCESS');
      }
    });
  }
});
