import type { AffectedHemifield } from '../api/contracts/clinical.contracts';

/**
 * Optical and Retinotopic Geometry Constants
 */
export const DEFAULT_VIEWING_DISTANCE_CM = 55;
export const DEFAULT_PX_PER_CM = 37.8; // Standard 96 DPI screen: 96 / 2.54 = ~37.795 px/cm
export const MIN_ECCENTRICITY_DEG = 5;
export const MAX_ECCENTRICITY_DEG = 30;
export const MIN_TARGET_SIZE_PX = 30;
export const MAX_TARGET_SIZE_PX = 150;
export const MIN_DIFFICULTY_LEVEL = 1;
export const MAX_DIFFICULTY_LEVEL = 5;
export const MIN_CONFIDENCE_THRESHOLD = 0.35;
export const DEFAULT_MAX_FIXATION_VELOCITY_DEG_PER_SEC = 40;

/**
 * Common 2D coordinate representation
 */
export interface RetinotopicPoint2D {
  x: number;
  y: number;
}

/**
 * Retinotopic position parameters
 */
export interface RetinotopicPositionParams {
  eccentricityDegrees: number;
  polarAngleRad: number;
  canvasWidth: number;
  canvasHeight: number;
  marginPx?: number;
  viewingDistanceCm?: number;
  pxPerCm?: number;
  center?: RetinotopicPoint2D;
}

/**
 * Retinotopic point result in pixel and normalized coordinates
 */
export interface RetinotopicPointResult {
  x: number;
  y: number;
  xNorm: number;
  yNorm: number;
  displacementPx: number;
  displacementCm: number;
  eccentricityDegrees: number;
  polarAngleRad: number;
  scaleFactor: number;
}

/**
 * Converts visual degrees to centimeters on the physical display using optical trigonometry:
 * displacementCm = viewingDistanceCm * Math.tan((degrees * Math.PI) / 180)
 */
export function degreesToCm(
  degrees: number,
  viewingDistanceCm: number = DEFAULT_VIEWING_DISTANCE_CM
): number {
  const rad = (degrees * Math.PI) / 180;
  return viewingDistanceCm * Math.tan(rad);
}

/**
 * Converts physical centimeters on screen to visual angle in degrees.
 */
export function cmToDegrees(
  displacementCm: number,
  viewingDistanceCm: number = DEFAULT_VIEWING_DISTANCE_CM
): number {
  return (Math.atan(displacementCm / viewingDistanceCm) * 180) / Math.PI;
}

/**
 * Converts visual degrees to pixels at the given viewing distance and pixel density.
 */
export function degreesToPixels(
  degrees: number,
  viewingDistanceCm: number = DEFAULT_VIEWING_DISTANCE_CM,
  pxPerCm: number = DEFAULT_PX_PER_CM
): number {
  return degreesToCm(degrees, viewingDistanceCm) * pxPerCm;
}

/**
 * Converts pixel displacement to visual degrees.
 */
export function pixelsToDegrees(
  pixels: number,
  viewingDistanceCm: number = DEFAULT_VIEWING_DISTANCE_CM,
  pxPerCm: number = DEFAULT_PX_PER_CM
): number {
  const displacementCm = pixels / pxPerCm;
  return cmToDegrees(displacementCm, viewingDistanceCm);
}

/**
 * Computes a safe isotropic scale factor so that maximum visual eccentricity (30°)
 * never exceeds available canvas radius within margins, strictly preserving
 * angular proportions tan(theta1) / tan(theta2) for all degrees in [5..30°].
 */
export function computeRetinotopicSafeScaleFactor(
  canvasWidth: number,
  canvasHeight: number,
  marginPx: number = 40,
  viewingDistanceCm: number = DEFAULT_VIEWING_DISTANCE_CM,
  pxPerCm: number = DEFAULT_PX_PER_CM
): number {
  const maxAllowedRadiusPx = Math.max(
    10,
    Math.min(canvasWidth / 2 - marginPx, canvasHeight / 2 - marginPx)
  );
  const maxTheoreticalPx = degreesToPixels(MAX_ECCENTRICITY_DEG, viewingDistanceCm, pxPerCm);

  if (maxTheoreticalPx > maxAllowedRadiusPx && maxTheoreticalPx > 0) {
    return maxAllowedRadiusPx / maxTheoreticalPx;
  }
  return 1.0;
}

/**
 * Calculates retinotopic position in pixel and normalized [0, 1] coordinates
 * from visual eccentricity degrees (5..30°) and polar angle (radians).
 * Applies optical trigonometry and safe margin scaling.
 */
export function calculateRetinotopicPosition(
  params: RetinotopicPositionParams
): RetinotopicPointResult {
  const {
    eccentricityDegrees,
    polarAngleRad,
    canvasWidth,
    canvasHeight,
    marginPx = 40,
    viewingDistanceCm = DEFAULT_VIEWING_DISTANCE_CM,
    pxPerCm = DEFAULT_PX_PER_CM,
    center = { x: canvasWidth / 2, y: canvasHeight / 2 }
  } = params;

  const clampedDegrees = Math.max(
    MIN_ECCENTRICITY_DEG,
    Math.min(MAX_ECCENTRICITY_DEG, eccentricityDegrees)
  );

  const rawDisplacementCm = degreesToCm(clampedDegrees, viewingDistanceCm);
  const rawDisplacementPx = rawDisplacementCm * pxPerCm;

  const scaleFactor = computeRetinotopicSafeScaleFactor(
    canvasWidth,
    canvasHeight,
    marginPx,
    viewingDistanceCm,
    pxPerCm
  );

  const safeDisplacementPx = rawDisplacementPx * scaleFactor;

  const unconstrainedX = center.x + safeDisplacementPx * Math.cos(polarAngleRad);
  const unconstrainedY = center.y + safeDisplacementPx * Math.sin(polarAngleRad);

  const clampedX = Math.max(marginPx, Math.min(canvasWidth - marginPx, unconstrainedX));
  const clampedY = Math.max(marginPx, Math.min(canvasHeight - marginPx, unconstrainedY));

  return {
    x: clampedX,
    y: clampedY,
    xNorm: canvasWidth > 0 ? clampedX / canvasWidth : 0.5,
    yNorm: canvasHeight > 0 ? clampedY / canvasHeight : 0.5,
    displacementPx: safeDisplacementPx,
    displacementCm: rawDisplacementCm,
    eccentricityDegrees: clampedDegrees,
    polarAngleRad,
    scaleFactor
  };
}

/**
 * Computes acceptance radius in pixels for gaze fixation tolerance.
 * - targetSizePx está en [30..150], radio visual base = clamp(targetSizePx / 2, 15, 75).
 * - El radio de tolerancia de fijación aplica un factor según difficultyLevel (1..5):
 *   factor = 1.45 - (clamp(difficultyLevel, 1, 5) - 1) * 0.08 (nivel 1 más permisivo, nivel 5 más estricto).
 */
export function computeAcceptanceRadiusPx(
  targetSizePx: number,
  difficultyLevel: number
): number {
  const clampedSize = Math.max(MIN_TARGET_SIZE_PX, Math.min(MAX_TARGET_SIZE_PX, targetSizePx));
  const baseVisualRadius = Math.max(15, Math.min(75, clampedSize / 2));
  const clampedDifficulty = Math.max(
    MIN_DIFFICULTY_LEVEL,
    Math.min(MAX_DIFFICULTY_LEVEL, difficultyLevel)
  );
  const factor = 1.45 - (clampedDifficulty - 1) * 0.08;
  return baseVisualRadius * factor;
}

/**
 * Options for gaze sample stability classification
 */
export interface GazeStabilityOptions {
  canvasWidth?: number;
  canvasHeight?: number;
  viewingDistanceCm?: number;
  pxPerCm?: number;
  maxFixationVelocityDegPerSec?: number;
  maxFixationVelocityPxPerSec?: number;
  minConfidenceThreshold?: number;
}

/**
 * Outcome reason for gaze stability classification
 */
export type GazeStabilityReason =
  | 'VALID_FIXATION'
  | 'LOW_CONFIDENCE'
  | 'SACCADE_DETECTED'
  | 'INVALID_DELTA_TIME'
  | 'INITIAL_SAMPLE';

/**
 * Result of gaze stability classification
 */
export interface GazeStabilityResult {
  isValidFixation: boolean;
  isSaccade: boolean;
  isFaceLost: boolean;
  pixelVelocity: number; // px/sec
  angularVelocityDegPerSec: number; // deg/sec
  displacementPx: number;
  confidence: number;
  reason: GazeStabilityReason;
}

/**
 * Instantaneous ocular stability classifier:
 * Evaluates current gaze sample against previous sample, deltaTimeMs, and confidence.
 * Determines if sample is a valid fixation (not a rapid saccadic jump nor face loss with confidence < 0.35).
 */
export function evaluateGazeSampleStability(
  current: RetinotopicPoint2D,
  previous: RetinotopicPoint2D | null | undefined,
  deltaTimeMs: number,
  confidence: number,
  options?: GazeStabilityOptions
): GazeStabilityResult;
export function evaluateGazeSampleStability(
  cursorX: number,
  cursorY: number,
  prevX: number | null | undefined,
  prevY: number | null | undefined,
  deltaTimeMs: number,
  confidence: number,
  options?: GazeStabilityOptions
): GazeStabilityResult;
export function evaluateGazeSampleStability(
  arg1: RetinotopicPoint2D | number,
  arg2?: RetinotopicPoint2D | number | null,
  arg3?: number | null,
  arg4?: number | null,
  arg5?: GazeStabilityOptions | number,
  arg6?: number,
  arg7?: GazeStabilityOptions
): GazeStabilityResult {
  let current: RetinotopicPoint2D;
  let previous: RetinotopicPoint2D | null | undefined;
  let deltaTimeMs: number;
  let confidence: number;
  let options: GazeStabilityOptions | undefined;

  if (typeof arg1 === 'number') {
    current = { x: arg1, y: typeof arg2 === 'number' ? arg2 : 0 };
    previous =
      arg3 !== null && arg3 !== undefined && arg4 !== null && arg4 !== undefined
        ? { x: arg3, y: arg4 }
        : null;
    deltaTimeMs = typeof arg5 === 'number' ? arg5 : 0;
    confidence = typeof arg6 === 'number' ? arg6 : 0;
    options = arg7;
  } else {
    current = arg1;
    previous = arg2 as RetinotopicPoint2D | null | undefined;
    deltaTimeMs = typeof arg3 === 'number' ? arg3 : 0;
    confidence = typeof arg4 === 'number' ? arg4 : 0;
    options = arg5 as GazeStabilityOptions | undefined;
  }

  const minConfidence = options?.minConfidenceThreshold ?? MIN_CONFIDENCE_THRESHOLD;
  const viewingDistanceCm = options?.viewingDistanceCm ?? DEFAULT_VIEWING_DISTANCE_CM;
  const pxPerCm = options?.pxPerCm ?? DEFAULT_PX_PER_CM;
  const maxVelocityDeg =
    options?.maxFixationVelocityDegPerSec ?? DEFAULT_MAX_FIXATION_VELOCITY_DEG_PER_SEC;
  const canvasWidth = options?.canvasWidth ?? 1920;
  const canvasHeight = options?.canvasHeight ?? 1080;

  // 1. Loss of face / tracking failure: confidence < 0.35
  if (confidence < minConfidence) {
    return {
      isValidFixation: false,
      isSaccade: false,
      isFaceLost: true,
      pixelVelocity: 0,
      angularVelocityDegPerSec: 0,
      displacementPx: 0,
      confidence,
      reason: 'LOW_CONFIDENCE'
    };
  }

  // 2. Initial sample or absent previous anchor
  if (!previous) {
    return {
      isValidFixation: true,
      isSaccade: false,
      isFaceLost: false,
      pixelVelocity: 0,
      angularVelocityDegPerSec: 0,
      displacementPx: 0,
      confidence,
      reason: 'INITIAL_SAMPLE'
    };
  }

  // 3. Invalid delta time check
  if (deltaTimeMs <= 0) {
    return {
      isValidFixation: false,
      isSaccade: false,
      isFaceLost: false,
      pixelVelocity: 0,
      angularVelocityDegPerSec: 0,
      displacementPx: 0,
      confidence,
      reason: 'INVALID_DELTA_TIME'
    };
  }

  // 4. Compute physical displacement
  const isNormalized = current.x <= 1 && current.y <= 1 && previous.x <= 1 && previous.y <= 1;
  const dx = isNormalized ? (current.x - previous.x) * canvasWidth : current.x - previous.x;
  const dy = isNormalized ? (current.y - previous.y) * canvasHeight : current.y - previous.y;
  const displacementPx = Math.hypot(dx, dy);

  const dtSec = deltaTimeMs / 1000;
  const pixelVelocity = displacementPx / dtSec;

  const displacementCm = displacementPx / pxPerCm;
  const displacementDeg = (Math.atan(displacementCm / viewingDistanceCm) * 180) / Math.PI;
  const angularVelocityDegPerSec = displacementDeg / dtSec;

  // Saccadic threshold evaluation
  const isSaccade =
    angularVelocityDegPerSec > maxVelocityDeg ||
    (options?.maxFixationVelocityPxPerSec !== undefined &&
      pixelVelocity > options.maxFixationVelocityPxPerSec);

  if (isSaccade) {
    return {
      isValidFixation: false,
      isSaccade: true,
      isFaceLost: false,
      pixelVelocity,
      angularVelocityDegPerSec,
      displacementPx,
      confidence,
      reason: 'SACCADE_DETECTED'
    };
  }

  return {
    isValidFixation: true,
    isSaccade: false,
    isFaceLost: false,
    pixelVelocity,
    angularVelocityDegPerSec,
    displacementPx,
    confidence,
    reason: 'VALID_FIXATION'
  };
}

/**
 * Configuration for biased Poisson-disk stimulus placement
 */
export interface BiasedPositionsConfig {
  targetCount: number;
  distractorCount: number;
  affectedHemifield: AffectedHemifield;
  affectedHemifieldBias: number; // 0.5 .. 1.0
  minSeparationPx: number;
  canvasWidth: number;
  canvasHeight: number;
  marginPx?: number;
  maxAttemptsPerPoint?: number;
  customRandom?: () => number;
}

/**
 * Positioned stimulus item
 */
export interface PositionedStimulus {
  id: string;
  type: 'TARGET' | 'DISTRACTOR';
  x: number;
  y: number;
  xNorm: number;
  yNorm: number;
  hemifield: AffectedHemifield;
}

/**
 * Generated stimuli positions container
 */
export interface GeneratedStimuliPositions {
  targets: PositionedStimulus[];
  distractors: PositionedStimulus[];
  all: PositionedStimulus[];
  [Symbol.iterator](): Iterator<PositionedStimulus>;
}

interface BoundingBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Generates non-overlapping target and distractor positions using Poisson-disk sampling
 * with hemifield bias, respecting affectedHemifield ('LEFT' | 'RIGHT'),
 * affectedHemifieldBias (0.5..1.0), and minSeparationPx.
 */
export function generateBiasedNonOverlappingPositions(
  config: BiasedPositionsConfig
): GeneratedStimuliPositions {
  const {
    targetCount,
    distractorCount,
    affectedHemifield,
    affectedHemifieldBias,
    minSeparationPx,
    canvasWidth,
    canvasHeight,
    marginPx = 50,
    maxAttemptsPerPoint = 60,
    customRandom = Math.random
  } = config;

  const bias = Math.max(0.5, Math.min(1.0, affectedHemifieldBias));
  const unaffectedHemifield: AffectedHemifield = affectedHemifield === 'LEFT' ? 'RIGHT' : 'LEFT';

  // Compute distribution quotas according to bias
  const targetAffected = Math.round(targetCount * bias);
  const targetUnaffected = Math.max(0, targetCount - targetAffected);

  const distractorAffected = Math.round(distractorCount * bias);
  const distractorUnaffected = Math.max(0, distractorCount - distractorAffected);

  const midX = canvasWidth / 2;

  // Establish bounding boxes for hemifields
  const leftBounds: BoundingBox = {
    minX: marginPx,
    maxX: Math.max(marginPx + minSeparationPx, midX - minSeparationPx / 2),
    minY: marginPx,
    maxY: Math.max(marginPx + minSeparationPx, canvasHeight - marginPx)
  };

  const rightBounds: BoundingBox = {
    minX: Math.min(canvasWidth - marginPx - minSeparationPx, midX + minSeparationPx / 2),
    maxX: Math.max(midX + minSeparationPx / 2 + 10, canvasWidth - marginPx),
    minY: marginPx,
    maxY: Math.max(marginPx + minSeparationPx, canvasHeight - marginPx)
  };

  const globalBounds: BoundingBox = {
    minX: marginPx,
    maxX: Math.max(marginPx + minSeparationPx, canvasWidth - marginPx),
    minY: marginPx,
    maxY: Math.max(marginPx + minSeparationPx, canvasHeight - marginPx)
  };

  const getBoundsForHemifield = (hemifield: AffectedHemifield): BoundingBox => {
    return hemifield === 'LEFT' ? leftBounds : rightBounds;
  };

  const placed: PositionedStimulus[] = [];

  const isValidDistance = (
    candidateX: number,
    candidateY: number,
    requiredDistance: number
  ): boolean => {
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i];
      const dist = Math.hypot(candidateX - p.x, candidateY - p.y);
      if (dist < requiredDistance) {
        return false;
      }
    }
    return true;
  };

  // Build stimulus specification list (targets first to guarantee high spatial quality)
  interface StimulusSpec {
    type: 'TARGET' | 'DISTRACTOR';
    assignedHemifield: AffectedHemifield;
  }

  const specs: StimulusSpec[] = [];

  for (let i = 0; i < targetAffected; i++) {
    specs.push({ type: 'TARGET', assignedHemifield: affectedHemifield });
  }
  for (let i = 0; i < targetUnaffected; i++) {
    specs.push({ type: 'TARGET', assignedHemifield: unaffectedHemifield });
  }
  for (let i = 0; i < distractorAffected; i++) {
    specs.push({ type: 'DISTRACTOR', assignedHemifield: affectedHemifield });
  }
  for (let i = 0; i < distractorUnaffected; i++) {
    specs.push({ type: 'DISTRACTOR', assignedHemifield: unaffectedHemifield });
  }

  // Poisson-disk sampling loop
  let targetSeq = 0;
  let distractorSeq = 0;

  for (let sIdx = 0; sIdx < specs.length; sIdx++) {
    const spec = specs[sIdx];
    const preferredBounds = getBoundsForHemifield(spec.assignedHemifield);

    let placedItem: PositionedStimulus | null = null;

    // Stage 1: Try strict placement in assigned hemifield
    for (let attempt = 0; attempt < maxAttemptsPerPoint; attempt++) {
      const candX =
        preferredBounds.minX + customRandom() * (preferredBounds.maxX - preferredBounds.minX);
      const candY =
        preferredBounds.minY + customRandom() * (preferredBounds.maxY - preferredBounds.minY);

      if (isValidDistance(candX, candY, minSeparationPx)) {
        const id =
          spec.type === 'TARGET' ? `target-${++targetSeq}` : `distractor-${++distractorSeq}`;
        placedItem = {
          id,
          type: spec.type,
          x: Math.round(candX),
          y: Math.round(candY),
          xNorm: canvasWidth > 0 ? candX / canvasWidth : 0.5,
          yNorm: canvasHeight > 0 ? candY / canvasHeight : 0.5,
          hemifield: candX < midX ? 'LEFT' : 'RIGHT'
        };
        break;
      }
    }

    // Stage 2: Relaxed separation inside assigned hemifield (0.8x distance)
    if (!placedItem) {
      const relaxedDistance = minSeparationPx * 0.8;
      for (let attempt = 0; attempt < maxAttemptsPerPoint; attempt++) {
        const candX =
          preferredBounds.minX + customRandom() * (preferredBounds.maxX - preferredBounds.minX);
        const candY =
          preferredBounds.minY + customRandom() * (preferredBounds.maxY - preferredBounds.minY);

        if (isValidDistance(candX, candY, relaxedDistance)) {
          const id =
            spec.type === 'TARGET' ? `target-${++targetSeq}` : `distractor-${++distractorSeq}`;
          placedItem = {
            id,
            type: spec.type,
            x: Math.round(candX),
            y: Math.round(candY),
            xNorm: canvasWidth > 0 ? candX / canvasWidth : 0.5,
            yNorm: canvasHeight > 0 ? candY / canvasHeight : 0.5,
            hemifield: candX < midX ? 'LEFT' : 'RIGHT'
          };
          break;
        }
      }
    }

    // Stage 3: Fallback search across global bounds
    if (!placedItem) {
      let bestX = globalBounds.minX;
      let bestY = globalBounds.minY;
      let maxMinDist = -1;

      for (let attempt = 0; attempt < maxAttemptsPerPoint; attempt++) {
        const candX =
          globalBounds.minX + customRandom() * (globalBounds.maxX - globalBounds.minX);
        const candY =
          globalBounds.minY + customRandom() * (globalBounds.maxY - globalBounds.minY);

        let minDistToPlaced = Infinity;
        for (let j = 0; j < placed.length; j++) {
          const d = Math.hypot(candX - placed[j].x, candY - placed[j].y);
          if (d < minDistToPlaced) {
            minDistToPlaced = d;
          }
        }

        if (minDistToPlaced > maxMinDist) {
          maxMinDist = minDistToPlaced;
          bestX = candX;
          bestY = candY;
        }
      }

      const id =
        spec.type === 'TARGET' ? `target-${++targetSeq}` : `distractor-${++distractorSeq}`;
      placedItem = {
        id,
        type: spec.type,
        x: Math.round(bestX),
        y: Math.round(bestY),
        xNorm: canvasWidth > 0 ? bestX / canvasWidth : 0.5,
        yNorm: canvasHeight > 0 ? bestY / canvasHeight : 0.5,
        hemifield: bestX < midX ? 'LEFT' : 'RIGHT'
      };
    }

    placed.push(placedItem);
  }

  const targets = placed.filter((item) => item.type === 'TARGET');
  const distractors = placed.filter((item) => item.type === 'DISTRACTOR');

  return {
    targets,
    distractors,
    all: placed,
    [Symbol.iterator]() {
      return placed[Symbol.iterator]();
    }
  };
}
