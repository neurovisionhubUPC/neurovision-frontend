/**
 * Minimum sustained webcam inference rate (FPS) supported without triggering
 * false staleness decay or fixation-loss penalties (`1000 / 4 = 250 ms` period).
 */
export const SUPPORTED_MIN_INFERENCE_FPS = 4;

/**
 * Maximum age (ms) of the latest valid webcam inference sample before gaze is
 * treated as stale (`STALE_SAMPLE`).
 *
 * Clinical RG-01 balance: `280 ms` supports live inference down to 4 FPS
 * (`250 ms` frame interval + `30 ms` scheduling/rAF jitter) with zero false
 * decay or `fixationLosses`, while staying strictly below both the minimum
 * clinical `minimumFixationMs` (`300 ms`) and `useMediaPipeWorker.ts`'s
 * `300 ms` backpressure timeout watchdog.
 */
export const MAX_GAZE_STALENESS_MS = 280;

/**
 * Maximum fixation dwell (ms) that a single inference `sampleSeq` may credit
 * across canvas animation frames (`REUSED_SAMPLE_CAPPED` once exhausted).
 *
 * Kept strictly below half of `300 ms` (`150 ms`):
 * - 1 frozen sample credits at most `120 ms` (`< 250 ms` Compensatory Saccade
 *   anchor / Visual Search distractor false-fixation threshold and `< 300 ms`
 *   minimum clinical `minimumFixationMs`), then stops accumulating and decays to
 *   `0` after `280 ms` (`STALE_SAMPLE`).
 * - Even 2 samples at 4 FPS followed by a permanent freeze credit at most
 *   `240 ms` (`< 250 ms < 300 ms`) before decaying to `0`, preventing any target
 *   acquisition, saccade anchor unlock, or false distractor fixation.
 */
export const MAX_DWELL_PER_REUSED_SAMPLE_MS = 120;

export const MIN_VALID_GAZE_CONFIDENCE = 0.35;

export type GazeFreshnessReason =
  | 'OK'
  | 'REUSED_SAMPLE_CAPPED'
  | 'STALE_SAMPLE'
  | 'BLINKING'
  | 'LOW_CONFIDENCE'
  | 'STREAM_STOPPED'
  | 'MOUSE_WAITING_INPUT';

export interface GazeFrameInput {
  nowPerfMs: number;
  deltaTimeMs: number;
  isMouseFallback: boolean;
  hasMousePointerMoved: boolean;
  isWebcamStreaming: boolean;
  confidence: number;
  lastValidSamplePerfMs: number;
  sampleSeq: number;
  isBlinking: boolean;
}

export interface GazeFrameEvaluation {
  isSignalFresh: boolean;
  canAccumulateDwell: boolean;
  effectiveDwellDeltaMs: number;
  shouldDecayDwell: boolean;
  isNewSampleForTelemetry: boolean;
  reason: GazeFreshnessReason;
}

export interface GazeSampleContinuity {
  readonly isLiveWebcam: boolean;
  readonly sampleSeq: number;
  readonly verifiedSampleIntervalMs: number;
  readonly previousSampleCreditedMs: number;
}

export interface EntityDwellContinuityState {
  lastSampleSeq: number;
  consecutiveSamplesOnEntity: number;
  pendingConfirmedCatchupMs: number;
  creditedOnCurrentSampleMs: number;
}

export function createEntityDwellContinuityState(): EntityDwellContinuityState {
  return {
    lastSampleSeq: -1,
    consecutiveSamplesOnEntity: 0,
    pendingConfirmedCatchupMs: 0,
    creditedOnCurrentSampleMs: 0,
  };
}

export function resetEntityDwellContinuityState(state: EntityDwellContinuityState): void {
  state.lastSampleSeq = -1;
  state.consecutiveSamplesOnEntity = 0;
  state.pendingConfirmedCatchupMs = 0;
  state.creditedOnCurrentSampleMs = 0;
}

/**
 * Credits per-frame dwell plus confirmed inter-sample live tracking intervals ONLY once a
 * 3rd consecutive fresh webcam sample is observed hovering the SAME target entity.
 *
 * Security / anti-cheat invariants:
 * - 1 frozen sample credits at most MAX_DWELL_PER_REUSED_SAMPLE_MS (120 ms).
 * - 2 frozen samples separated by 250 ms hold any uncredited gap until a 3rd fresh
 *   sample arrives, so max dwell on 2 frozen samples remains <= 240 ms (< 250 ms < 300 ms).
 * - Off-target live warm-up cannot pre-confirm continuity for a newly entered entity.
 */
export function accumulateEntityDwellWithContinuity(
  state: EntityDwellContinuityState,
  effectiveDwellDeltaMs: number,
  continuity?: GazeSampleContinuity | null
): number {
  const safeDwellDelta = Number.isFinite(effectiveDwellDeltaMs)
    ? Math.max(0, effectiveDwellDeltaMs)
    : 0;

  if (!continuity || !continuity.isLiveWebcam || continuity.sampleSeq <= 0) {
    return safeDwellDelta;
  }

  if (continuity.sampleSeq === state.lastSampleSeq) {
    state.creditedOnCurrentSampleMs += safeDwellDelta;
    return safeDwellDelta;
  }

  const isConsecutiveOnEntity =
    state.lastSampleSeq > 0 &&
    continuity.sampleSeq === state.lastSampleSeq + 1 &&
    continuity.verifiedSampleIntervalMs > 0 &&
    continuity.verifiedSampleIntervalMs <= MAX_GAZE_STALENESS_MS;

  if (!isConsecutiveOnEntity) {
    state.lastSampleSeq = continuity.sampleSeq;
    state.consecutiveSamplesOnEntity = 1;
    state.pendingConfirmedCatchupMs = 0;
    state.creditedOnCurrentSampleMs = safeDwellDelta;
    return safeDwellDelta;
  }

  const prevAlreadyCredited = Math.max(
    state.creditedOnCurrentSampleMs,
    Math.min(MAX_DWELL_PER_REUSED_SAMPLE_MS, continuity.previousSampleCreditedMs)
  );
  const uncreditedPrevIntervalMs = Math.max(
    0,
    continuity.verifiedSampleIntervalMs - prevAlreadyCredited
  );

  state.lastSampleSeq = continuity.sampleSeq;
  state.consecutiveSamplesOnEntity += 1;
  state.creditedOnCurrentSampleMs = safeDwellDelta;

  if (state.consecutiveSamplesOnEntity < 3) {
    state.pendingConfirmedCatchupMs = uncreditedPrevIntervalMs;
    return safeDwellDelta;
  }

  const confirmedCatchupMs = state.pendingConfirmedCatchupMs + uncreditedPrevIntervalMs;
  state.pendingConfirmedCatchupMs = 0;
  return confirmedCatchupMs + safeDwellDelta;
}

/**
 * Guards fixation dwell accumulation and telemetry emission against frozen,
 * stale, blinking, low-confidence, or stopped webcam gaze signals.
 */
export class GazeFreshnessGuard {
  private lastSeenSampleSeq = -1;
  private lastSamplePerfMs = 0;
  private creditedDwellForSampleMs = 0;
  private previousSampleIntervalMs = 0;
  private previousSampleCreditedMs = 0;
  private lastFrameWasFreshWebcam = false;
  private lastEmittedTelemetrySeq = -1;

  reset(): void {
    this.lastSeenSampleSeq = -1;
    this.lastSamplePerfMs = 0;
    this.creditedDwellForSampleMs = 0;
    this.previousSampleIntervalMs = 0;
    this.previousSampleCreditedMs = 0;
    this.lastFrameWasFreshWebcam = false;
    this.lastEmittedTelemetrySeq = -1;
  }

  markTelemetrySampleEmitted(sampleSeq: number): void {
    this.lastEmittedTelemetrySeq = sampleSeq;
  }

  getLatestSampleContinuity(): GazeSampleContinuity {
    if (!this.lastFrameWasFreshWebcam || this.lastSeenSampleSeq <= 0) {
      return {
        isLiveWebcam: false,
        sampleSeq: 0,
        verifiedSampleIntervalMs: 0,
        previousSampleCreditedMs: 0,
      };
    }

    return {
      isLiveWebcam: true,
      sampleSeq: this.lastSeenSampleSeq,
      verifiedSampleIntervalMs: this.previousSampleIntervalMs,
      previousSampleCreditedMs: this.previousSampleCreditedMs,
    };
  }

  private breakLiveContinuity(): void {
    this.lastFrameWasFreshWebcam = false;
    this.previousSampleIntervalMs = 0;
    this.previousSampleCreditedMs = 0;
  }

  evaluateFrame(input: GazeFrameInput): GazeFrameEvaluation {
    const dt = Number.isFinite(input.deltaTimeMs) ? Math.max(0, input.deltaTimeMs) : 0;

    if (input.isMouseFallback) {
      this.breakLiveContinuity();
      if (!input.hasMousePointerMoved) {
        return {
          isSignalFresh: false,
          canAccumulateDwell: false,
          effectiveDwellDeltaMs: 0,
          shouldDecayDwell: true,
          isNewSampleForTelemetry: false,
          reason: 'MOUSE_WAITING_INPUT',
        };
      }
      return {
        isSignalFresh: true,
        canAccumulateDwell: dt > 0,
        effectiveDwellDeltaMs: dt,
        shouldDecayDwell: false,
        isNewSampleForTelemetry: false,
        reason: 'OK',
      };
    }

    if (!input.isWebcamStreaming) {
      this.breakLiveContinuity();
      return {
        isSignalFresh: false,
        canAccumulateDwell: false,
        effectiveDwellDeltaMs: 0,
        shouldDecayDwell: true,
        isNewSampleForTelemetry: false,
        reason: 'STREAM_STOPPED',
      };
    }

    if (input.isBlinking) {
      this.breakLiveContinuity();
      return {
        isSignalFresh: false,
        canAccumulateDwell: false,
        effectiveDwellDeltaMs: 0,
        shouldDecayDwell: true,
        isNewSampleForTelemetry: false,
        reason: 'BLINKING',
      };
    }

    if (!Number.isFinite(input.confidence) || input.confidence < MIN_VALID_GAZE_CONFIDENCE) {
      this.breakLiveContinuity();
      return {
        isSignalFresh: false,
        canAccumulateDwell: false,
        effectiveDwellDeltaMs: 0,
        shouldDecayDwell: true,
        isNewSampleForTelemetry: false,
        reason: 'LOW_CONFIDENCE',
      };
    }

    if (
      !Number.isFinite(input.sampleSeq) ||
      !Number.isFinite(input.lastValidSamplePerfMs) ||
      !Number.isFinite(input.nowPerfMs) ||
      input.sampleSeq <= 0 ||
      input.lastValidSamplePerfMs <= 0 ||
      input.nowPerfMs - input.lastValidSamplePerfMs > MAX_GAZE_STALENESS_MS
    ) {
      this.breakLiveContinuity();
      return {
        isSignalFresh: false,
        canAccumulateDwell: false,
        effectiveDwellDeltaMs: 0,
        shouldDecayDwell: true,
        isNewSampleForTelemetry: false,
        reason: 'STALE_SAMPLE',
      };
    }

    if (input.sampleSeq !== this.lastSeenSampleSeq) {
      const gapMs =
        this.lastSamplePerfMs > 0
          ? input.lastValidSamplePerfMs - this.lastSamplePerfMs
          : 0;
      const isContinuousNextSample =
        this.lastFrameWasFreshWebcam &&
        this.lastSeenSampleSeq > 0 &&
        input.sampleSeq === this.lastSeenSampleSeq + 1 &&
        gapMs > 0 &&
        gapMs <= MAX_GAZE_STALENESS_MS;

      if (isContinuousNextSample) {
        this.previousSampleIntervalMs = gapMs;
        this.previousSampleCreditedMs = this.creditedDwellForSampleMs;
      } else {
        this.previousSampleIntervalMs = 0;
        this.previousSampleCreditedMs = 0;
      }

      this.lastSeenSampleSeq = input.sampleSeq;
      this.lastSamplePerfMs = input.lastValidSamplePerfMs;
      this.creditedDwellForSampleMs = 0;
    }

    this.lastFrameWasFreshWebcam = true;

    const remainingBudget = Math.max(
      0,
      MAX_DWELL_PER_REUSED_SAMPLE_MS - this.creditedDwellForSampleMs
    );
    const effectiveDwellDeltaMs = Math.min(dt, remainingBudget);
    this.creditedDwellForSampleMs += effectiveDwellDeltaMs;

    const isNewSampleForTelemetry = input.sampleSeq !== this.lastEmittedTelemetrySeq;

    return {
      isSignalFresh: true,
      canAccumulateDwell: effectiveDwellDeltaMs > 0,
      effectiveDwellDeltaMs,
      shouldDecayDwell: false,
      isNewSampleForTelemetry,
      reason: effectiveDwellDeltaMs > 0 ? 'OK' : 'REUSED_SAMPLE_CAPPED',
    };
  }
}
