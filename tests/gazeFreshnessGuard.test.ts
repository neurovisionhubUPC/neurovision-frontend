import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GazeFreshnessGuard,
  MAX_DWELL_PER_REUSED_SAMPLE_MS,
  MAX_GAZE_STALENESS_MS,
  MIN_VALID_GAZE_CONFIDENCE,
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

describe('GazeFreshnessGuard', () => {
  it('exposes clinical guard thresholds strictly below 300ms minimum fixation', () => {
    assert.equal(MAX_GAZE_STALENESS_MS, 150);
    assert.equal(MAX_DWELL_PER_REUSED_SAMPLE_MS, 100);
    assert.equal(MIN_VALID_GAZE_CONFIDENCE, 0.35);
    assert.ok(MAX_GAZE_STALENESS_MS < 150 + 1 && MAX_GAZE_STALENESS_MS * 2 <= 300);
    assert.ok(MAX_DWELL_PER_REUSED_SAMPLE_MS < 300);
  });

  it('caps dwell from a frozen sampleSeq=1 over 500ms at 60fps and marks stale after 150ms', () => {
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

  it('caps a large single-frame delta spike at MAX_DWELL_PER_REUSED_SAMPLE_MS', () => {
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
    assert.equal(res.effectiveDwellDeltaMs, MAX_DWELL_PER_REUSED_SAMPLE_MS);
    assert.equal(res.reason, 'OK');
  });

  it('prevents frozen coordinates from completing SUCCESS in scanning, exploration, fixation, search, or saccade', () => {
    const dt = 16.67;
    const sampleTime = 2000;

    // 1. Standard Scanning
    {
      const guard = new GazeFreshnessGuard();
      const state = createStandardScanningTrial(SCANNING_PARAMS, 800, 600, 0);
      const cursor = { x: state.target.x, y: state.target.y };
      let maxObservedDwell = 0;
      let terminalOutcome: string | null = null;

      for (let f = 0; f < 160; f++) {
        const g = guard.evaluateFrame({
          nowPerfMs: sampleTime + (f + 1) * dt,
          deltaTimeMs: dt,
          isMouseFallback: false,
          hasMousePointerMoved: false,
          isWebcamStreaming: true,
          confidence: 0.95,
          lastValidSamplePerfMs: sampleTime,
          sampleSeq: 1,
          isBlinking: false,
        });
        const res = stepStandardScanningTrial(
          state,
          cursor,
          dt,
          SCANNING_PARAMS,
          g.isSignalFresh,
          g.effectiveDwellDeltaMs
        );
        maxObservedDwell = Math.max(maxObservedDwell, state.target.dwellTimeMs);
        if (res) {
          terminalOutcome = res.outcome;
          break;
        }
      }

      assert.ok(maxObservedDwell <= MAX_DWELL_PER_REUSED_SAMPLE_MS + 1e-6);
      assert.equal(terminalOutcome, 'TIMEOUT');
    }

    // 2. Systematic Exploration
    {
      const guard = new GazeFreshnessGuard();
      const state = createSystematicExplorationTrial(EXPLORATION_PARAMS, 800, 600, 0);
      const cursor = { x: state.waypoints[0].x, y: state.waypoints[0].y };
      let maxObservedDwell = 0;
      let terminalOutcome: string | null = null;

      for (let f = 0; f < 160; f++) {
        const g = guard.evaluateFrame({
          nowPerfMs: sampleTime + (f + 1) * dt,
          deltaTimeMs: dt,
          isMouseFallback: false,
          hasMousePointerMoved: false,
          isWebcamStreaming: true,
          confidence: 0.95,
          lastValidSamplePerfMs: sampleTime,
          sampleSeq: 1,
          isBlinking: false,
        });
        const res = stepSystematicExplorationTrial(
          state,
          cursor,
          dt,
          EXPLORATION_PARAMS,
          g.isSignalFresh,
          g.effectiveDwellDeltaMs
        );
        maxObservedDwell = Math.max(maxObservedDwell, state.waypoints[0].dwellTimeMs);
        if (res) {
          terminalOutcome = res.outcome;
          break;
        }
      }

      assert.ok(maxObservedDwell <= MAX_DWELL_PER_REUSED_SAMPLE_MS + 1e-6);
      assert.equal(state.visits.length, 0);
      assert.equal(terminalOutcome, 'TIMED_OUT');
    }

    // 3. Sustained Target Fixation
    {
      const guard = new GazeFreshnessGuard();
      const state = createSustainedFixationTrial(FIXATION_PARAMS, 800, 600, 0);
      const cursor = { x: state.x, y: state.y };
      let terminalOutcome: string | null = null;

      for (let f = 0; f < 140; f++) {
        const g = guard.evaluateFrame({
          nowPerfMs: sampleTime + (f + 1) * dt,
          deltaTimeMs: dt,
          isMouseFallback: false,
          hasMousePointerMoved: false,
          isWebcamStreaming: true,
          confidence: 0.95,
          lastValidSamplePerfMs: sampleTime,
          sampleSeq: 1,
          isBlinking: false,
        });
        const res = stepSustainedFixationTrial(
          state,
          cursor,
          dt,
          FIXATION_PARAMS,
          g.isSignalFresh,
          g.effectiveDwellDeltaMs
        );
        if (res) {
          terminalOutcome = res.outcome;
          break;
        }
      }

      assert.ok(state.longestContinuousInsideMs <= MAX_DWELL_PER_REUSED_SAMPLE_MS + 1e-6);
      assert.ok(state.fixationLosses >= 1);
      assert.equal(terminalOutcome, 'TIMEOUT');
    }

    // 4. Visual Search
    {
      const guard = new GazeFreshnessGuard();
      const state = createVisualSearchTrial(SEARCH_PARAMS, 800, 600, 0);
      const firstTarget = state.entities.find((e) => e.kind === 'TARGET')!;
      const cursor = { x: firstTarget.x, y: firstTarget.y };
      let terminalOutcome: string | null = null;

      for (let f = 0; f < 160; f++) {
        const g = guard.evaluateFrame({
          nowPerfMs: sampleTime + (f + 1) * dt,
          deltaTimeMs: dt,
          isMouseFallback: false,
          hasMousePointerMoved: false,
          isWebcamStreaming: true,
          confidence: 0.95,
          lastValidSamplePerfMs: sampleTime,
          sampleSeq: 1,
          isBlinking: false,
        });
        const res = stepVisualSearchTrial(
          state,
          cursor,
          dt,
          SEARCH_PARAMS,
          g.isSignalFresh,
          g.effectiveDwellDeltaMs
        );
        if (res) {
          terminalOutcome = res.outcome;
          break;
        }
      }

      assert.equal(firstTarget.found, false);
      assert.equal(terminalOutcome, 'TIMEOUT');
    }

    // 5. Compensatory Saccade (frozen on anchor cannot even transition out of CENTRAL_ANCHOR)
    {
      const guard = new GazeFreshnessGuard();
      const state = createCompensatorySaccadeTrial(SACCADE_PARAMS, 800, 600, 0);
      const cursor = { x: state.anchor.x, y: state.anchor.y };

      for (let f = 0; f < 40; f++) {
        const g = guard.evaluateFrame({
          nowPerfMs: sampleTime + (f + 1) * dt,
          deltaTimeMs: dt,
          isMouseFallback: false,
          hasMousePointerMoved: false,
          isWebcamStreaming: true,
          confidence: 0.95,
          lastValidSamplePerfMs: sampleTime,
          sampleSeq: 1,
          isBlinking: false,
        });
        stepCompensatorySaccadeTrial(
          state,
          cursor,
          dt,
          SACCADE_PARAMS,
          g.isSignalFresh,
          g.effectiveDwellDeltaMs
        );
      }

      assert.equal(state.phase, 'CENTRAL_ANCHOR');
      assert.ok(state.anchor.dwellTimeMs <= MAX_DWELL_PER_REUSED_SAMPLE_MS + 1e-6);
    }
  });

  it('rejects immediately at 0ms lag when webcam stops, blinking occurs, or confidence drops', () => {
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

  it('allows normal 30 FPS gaze stream to accumulate full deltaTimeMs and complete 300ms fixation', () => {
    const guard = new GazeFreshnessGuard();
    const state = createStandardScanningTrial(SCANNING_PARAMS, 800, 600, 0);
    const cursor = { x: state.target.x, y: state.target.y };
    const dt = 33;
    let body = null;

    for (let seq = 1; seq <= 15; seq++) {
      const now = 1000 + seq * dt;
      const g = guard.evaluateFrame({
        nowPerfMs: now,
        deltaTimeMs: dt,
        isMouseFallback: false,
        hasMousePointerMoved: false,
        isWebcamStreaming: true,
        confidence: 0.88,
        lastValidSamplePerfMs: now,
        sampleSeq: seq,
        isBlinking: false,
      });

      assert.equal(g.isSignalFresh, true);
      assert.equal(g.canAccumulateDwell, true);
      assert.equal(g.effectiveDwellDeltaMs, dt);
      assert.equal(g.shouldDecayDwell, false);
      assert.equal(g.reason, 'OK');

      body = stepStandardScanningTrial(
        state,
        cursor,
        dt,
        SCANNING_PARAMS,
        g.isSignalFresh,
        g.effectiveDwellDeltaMs
      );
      if (body) break;
    }

    assert.ok(body !== null);
    assert.equal(body.outcome, 'SUCCESS');
    assert.ok(body.confirmedDwellMs !== null && body.confirmedDwellMs >= 300);
  });

  it('tracks isNewSampleForTelemetry once per emitted sampleSeq and resets cleanly', () => {
    const guard = new GazeFreshnessGuard();
    const baseInput = {
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

    // Still true until explicitly marked emitted
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
