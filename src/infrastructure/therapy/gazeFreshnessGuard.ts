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

/**
 * Guards fixation dwell accumulation and telemetry emission against frozen,
 * stale, blinking, low-confidence, or stopped webcam gaze signals.
 */
export class GazeFreshnessGuard {
  private lastSeenSampleSeq = -1;
  private creditedDwellForSampleMs = 0;
  private lastEmittedTelemetrySeq = -1;

  reset(): void {
    this.lastSeenSampleSeq = -1;
    this.creditedDwellForSampleMs = 0;
    this.lastEmittedTelemetrySeq = -1;
  }

  markTelemetrySampleEmitted(sampleSeq: number): void {
    this.lastEmittedTelemetrySeq = sampleSeq;
  }

  evaluateFrame(input: GazeFrameInput): GazeFrameEvaluation {
    const dt = Number.isFinite(input.deltaTimeMs) ? Math.max(0, input.deltaTimeMs) : 0;

    if (input.isMouseFallback) {
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
      this.lastSeenSampleSeq = input.sampleSeq;
      this.creditedDwellForSampleMs = 0;
    }

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
