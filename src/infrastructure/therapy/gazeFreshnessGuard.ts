export const MAX_GAZE_STALENESS_MS = 150;
export const MAX_DWELL_PER_REUSED_SAMPLE_MS = 100;
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
