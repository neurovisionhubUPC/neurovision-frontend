import type { FrozenClinicalExerciseParameters } from '../../core/domain/Prescription.ts';
import {
  MAX_GAZE_STALENESS_MS,
  SUPPORTED_MIN_INFERENCE_FPS,
} from './gazeFreshnessGuard.ts';

export const MIN_CLINICAL_REACTION_HEADROOM_MS = 250;

export type InferenceRateStatus = 'WARMING_UP' | 'SUPPORTED' | 'BELOW_MIN_FPS' | 'STALLED';

export interface InferenceRateSnapshot {
  sampleCount: number;
  measuredFps: number | null;
  meanIntervalMs: number | null;
  maxIntervalMs: number | null;
  status: InferenceRateStatus;
}

/**
 * Tracks real webcam inference arrival timestamps over a sliding window
 * instead of assuming fixed 60 Hz / 120 Hz hardware rates.
 */
export class InferenceRateMonitor {
  private readonly maxSamples: number;
  private readonly windowMs: number;
  private timestamps: number[] = [];

  constructor(options?: { maxSamples?: number; windowMs?: number }) {
    this.maxSamples = Math.max(4, options?.maxSamples ?? 20);
    this.windowMs = Math.max(1000, options?.windowMs ?? 3000);
  }

  recordSample(nowPerfMs: number): void {
    if (!Number.isFinite(nowPerfMs) || nowPerfMs <= 0) return;
    if (this.timestamps.length > 0) {
      const last = this.timestamps[this.timestamps.length - 1];
      if (nowPerfMs <= last) {
        return;
      }
    }
    this.timestamps.push(nowPerfMs);
    this.prune(nowPerfMs);
  }

  reset(): void {
    this.timestamps = [];
  }

  getSnapshot(nowPerfMs: number): InferenceRateSnapshot {
    if (Number.isFinite(nowPerfMs) && nowPerfMs > 0) {
      this.prune(nowPerfMs);
    }

    const count = this.timestamps.length;
    if (count < 2) {
      if (
        count === 1 &&
        Number.isFinite(nowPerfMs) &&
        nowPerfMs - this.timestamps[0] > MAX_GAZE_STALENESS_MS
      ) {
        return {
          sampleCount: count,
          measuredFps: null,
          meanIntervalMs: null,
          maxIntervalMs: null,
          status: 'STALLED',
        };
      }
      return {
        sampleCount: count,
        measuredFps: null,
        meanIntervalMs: null,
        maxIntervalMs: null,
        status: 'WARMING_UP',
      };
    }

    const newest = this.timestamps[count - 1];
    const oldest = this.timestamps[0];
    const spanMs = newest - oldest;

    let maxIntervalMs = 0;
    for (let i = 1; i < count; i++) {
      maxIntervalMs = Math.max(maxIntervalMs, this.timestamps[i] - this.timestamps[i - 1]);
    }
    const meanIntervalMs = spanMs / (count - 1);

    const hasEnoughWindow = count >= 3 && spanMs >= 400;
    const measuredFps = hasEnoughWindow
      ? Number((((count - 1) * 1000) / spanMs).toFixed(1))
      : null;

    const staleNow =
      Number.isFinite(nowPerfMs) && nowPerfMs - newest > MAX_GAZE_STALENESS_MS;

    let status: InferenceRateStatus = 'WARMING_UP';
    if (measuredFps !== null && measuredFps < SUPPORTED_MIN_INFERENCE_FPS) {
      status = 'BELOW_MIN_FPS';
    } else if (staleNow) {
      status = 'STALLED';
    } else if (measuredFps !== null) {
      status = 'SUPPORTED';
    }

    return {
      sampleCount: count,
      measuredFps,
      meanIntervalMs: Math.round(meanIntervalMs),
      maxIntervalMs: Math.round(maxIntervalMs),
      status,
    };
  }

  private prune(nowPerfMs: number): void {
    const cutoff = nowPerfMs - this.windowMs;
    while (this.timestamps.length > 1 && this.timestamps[0] < cutoff) {
      this.timestamps.shift();
    }
    while (this.timestamps.length > this.maxSamples) {
      this.timestamps.shift();
    }
  }
}

export type CompatibilityIssueSeverity = 'ERROR' | 'WARNING';

export interface ExerciseCompatibilityIssue {
  severity: CompatibilityIssueSeverity;
  code: string;
  message: string;
}

export interface ExerciseCompatibilityReport {
  compatible: boolean;
  issues: ExerciseCompatibilityIssue[];
  requiredPureDwellMs: number;
  allowedDurationMs: number;
  headroomMs: number;
  effectiveFps: number | null;
}

export function computeVisualSearchActiveTargetCount(
  targetCount: number,
  difficultyLevel: number
): number {
  const safeTargetCount = Number.isFinite(targetCount) ? Math.round(targetCount) : 5;
  const safeDifficulty = Number.isFinite(difficultyLevel) ? Math.round(difficultyLevel) : 1;
  const targetDenominator = Math.max(4, safeDifficulty);
  const rawTargetCount = Math.round(safeTargetCount / targetDenominator);
  return Math.min(4, Math.max(1, rawTargetCount));
}

function isIntInRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

/**
 * Validates both static clinical parameter feasibility and dynamic compatibility with
 * real measured webcam inference frequency (>= 4 Hz clinical minimum).
 */
export function validateExerciseCaptureCompatibility(
  params: FrozenClinicalExerciseParameters,
  capture?: { isMouseFallback?: boolean; measuredFps?: number | null }
): ExerciseCompatibilityReport {
  const issues: ExerciseCompatibilityIssue[] = [];
  const effectiveFps =
    !capture?.isMouseFallback &&
    typeof capture?.measuredFps === 'number' &&
    Number.isFinite(capture.measuredFps) &&
    capture.measuredFps > 0
      ? capture.measuredFps
      : null;

  if (!isIntInRange(params.targetSizePx, 30, 150)) {
    issues.push({
      severity: 'ERROR',
      code: 'OUT_OF_RANGE_TARGET_SIZE',
      message: 'El tamaño del estímulo (targetSizePx) debe ser un entero entre 30 y 150 px.',
    });
  }
  if (!isIntInRange(params.difficultyLevel, 1, 5)) {
    issues.push({
      severity: 'ERROR',
      code: 'OUT_OF_RANGE_DIFFICULTY',
      message: 'El nivel de dificultad debe ser un entero entre 1 y 5.',
    });
  }

  let minimumFixationMs = params.minimumFixationMs;
  let allowedDurationMs = 0;
  let activeTargetsPerTrial = 1;
  let reactionTargets = 1;

  if (
    params.mode === 'STANDARD_SCANNING' ||
    params.mode === 'SYSTEMATIC_EXPLORATION' ||
    params.mode === 'COMPENSATORY_SACCADE'
  ) {
    minimumFixationMs = params.minimumFixationMs;
    allowedDurationMs = params.maximumStimulusDurationMs;

    if (!isIntInRange(params.minimumFixationMs, 300, 2000)) {
      issues.push({
        severity: 'ERROR',
        code: 'OUT_OF_RANGE_MIN_FIXATION',
        message: 'La fijación mínima en escaneo debe ser un entero entre 300 y 2000 ms.',
      });
    }
    if (!isIntInRange(params.maximumStimulusDurationMs, 2000, 10000)) {
      issues.push({
        severity: 'ERROR',
        code: 'OUT_OF_RANGE_MAX_DURATION',
        message: 'El tiempo máximo por estímulo debe ser un entero entre 2000 y 10000 ms.',
      });
    }
    if (!isIntInRange(params.eccentricityDegrees, 5, 30)) {
      issues.push({
        severity: 'ERROR',
        code: 'OUT_OF_RANGE_ECCENTRICITY',
        message: 'La excentricidad debe ser un entero entre 5° y 30°.',
      });
    }
    if (!isIntInRange(params.repetitions, 5, 50)) {
      issues.push({
        severity: 'ERROR',
        code: 'OUT_OF_RANGE_REPETITIONS',
        message: 'Las repeticiones en escaneo deben ser un entero entre 5 y 50.',
      });
    }
    if (!isIntInRange(params.interStimulusIntervalMs, 500, 3000)) {
      issues.push({
        severity: 'ERROR',
        code: 'OUT_OF_RANGE_ISI',
        message: 'El intervalo entre estímulos debe ser un entero entre 500 y 3000 ms.',
      });
    }

    if (params.minimumFixationMs > params.maximumStimulusDurationMs) {
      issues.push({
        severity: 'ERROR',
        code: 'MIN_EXCEEDS_MAX',
        message: `La fijación mínima (${params.minimumFixationMs} ms) supera la ventana del estímulo (${params.maximumStimulusDurationMs} ms).`,
      });
    } else if (
      params.maximumStimulusDurationMs - params.minimumFixationMs <
      MIN_CLINICAL_REACTION_HEADROOM_MS
    ) {
      issues.push({
        severity: 'WARNING',
        code: 'LOW_REACTION_HEADROOM',
        message: `Margen de latencia reducido (${params.maximumStimulusDurationMs - params.minimumFixationMs} ms): la fijación mínima (${params.minimumFixationMs} ms) deja menos de ${MIN_CLINICAL_REACTION_HEADROOM_MS} ms para localizar el estímulo.`,
      });
    }
  } else if (params.mode === 'TARGET_SEARCH_WITH_DISTRACTORS') {
    minimumFixationMs = params.minimumFixationMs;
    allowedDurationMs = params.maximumSearchTimeMs;
    activeTargetsPerTrial = computeVisualSearchActiveTargetCount(
      params.targetCount,
      params.difficultyLevel
    );
    reactionTargets = activeTargetsPerTrial;

    if (!isIntInRange(params.targetCount, 5, 40)) {
      issues.push({
        severity: 'ERROR',
        code: 'OUT_OF_RANGE_TARGET_COUNT',
        message: 'El total de objetivos debe ser un entero entre 5 y 40.',
      });
    }
    if (!isIntInRange(params.distractorCount, 0, 20)) {
      issues.push({
        severity: 'ERROR',
        code: 'OUT_OF_RANGE_DISTRACTORS',
        message: 'Los distractores deben ser un entero entre 0 y 20.',
      });
    }
    if (!isIntInRange(params.minimumFixationMs, 300, 2000)) {
      issues.push({
        severity: 'ERROR',
        code: 'OUT_OF_RANGE_MIN_FIXATION',
        message: 'La fijación mínima en búsqueda debe ser un entero entre 300 y 2000 ms.',
      });
    }
    if (!isIntInRange(params.maximumSearchTimeMs, 3000, 20000)) {
      issues.push({
        severity: 'ERROR',
        code: 'OUT_OF_RANGE_MAX_DURATION',
        message: 'El tiempo máximo de búsqueda debe ser un entero entre 3000 y 20000 ms.',
      });
    }
    if (
      !Number.isFinite(params.affectedHemifieldBias) ||
      params.affectedHemifieldBias < 0.5 ||
      params.affectedHemifieldBias > 1.0
    ) {
      issues.push({
        severity: 'ERROR',
        code: 'OUT_OF_RANGE_BIAS',
        message: 'El sesgo al hemicampo afectado debe estar entre 0.50 y 1.00.',
      });
    }

    const requiredSearchDwellMs = activeTargetsPerTrial * params.minimumFixationMs;
    if (requiredSearchDwellMs > params.maximumSearchTimeMs) {
      issues.push({
        severity: 'ERROR',
        code: 'UNCOMPLETABLE_SEARCH_TARGETS',
        message: `Configuración incompletable: ${activeTargetsPerTrial} objetivos simultáneos requieren ${requiredSearchDwellMs} ms de dwell mínimo (> tiempo máximo de búsqueda ${params.maximumSearchTimeMs} ms).`,
      });
    } else if (
      params.maximumSearchTimeMs - requiredSearchDwellMs <
      activeTargetsPerTrial * MIN_CLINICAL_REACTION_HEADROOM_MS
    ) {
      issues.push({
        severity: 'WARNING',
        code: 'LOW_REACTION_HEADROOM',
        message: `Margen de búsqueda estrecho: ${activeTargetsPerTrial} objetivos × ${params.minimumFixationMs} ms = ${requiredSearchDwellMs} ms sobre ${params.maximumSearchTimeMs} ms disponibles.`,
      });
    }
  } else if (params.mode === 'SUSTAINED_TARGET_FIXATION') {
    minimumFixationMs = params.minimumFixationMs;
    allowedDurationMs = params.maximumFixationMs;
    reactionTargets = params.targetPosition === 'CENTER' ? 0 : 1;

    if (!isIntInRange(params.minimumFixationMs, 300, 3000)) {
      issues.push({
        severity: 'ERROR',
        code: 'OUT_OF_RANGE_MIN_FIXATION',
        message: 'La fijación mínima debe ser un entero entre 300 y 3000 ms.',
      });
    }
    if (!isIntInRange(params.maximumFixationMs, 500, 5000)) {
      issues.push({
        severity: 'ERROR',
        code: 'OUT_OF_RANGE_MAX_DURATION',
        message: 'La duración máxima de fijación debe ser un entero entre 500 y 5000 ms.',
      });
    }
    if (!isIntInRange(params.repetitions, 5, 30)) {
      issues.push({
        severity: 'ERROR',
        code: 'OUT_OF_RANGE_REPETITIONS',
        message: 'Las repeticiones de fijación deben ser un entero entre 5 y 30.',
      });
    }
    if (!isIntInRange(params.restBetweenRepetitionsMs, 500, 3000)) {
      issues.push({
        severity: 'ERROR',
        code: 'OUT_OF_RANGE_REST',
        message: 'El descanso entre fijaciones debe ser un entero entre 500 y 3000 ms.',
      });
    }

    if (params.minimumFixationMs > params.maximumFixationMs) {
      issues.push({
        severity: 'ERROR',
        code: 'MIN_EXCEEDS_MAX',
        message: `La fijación mínima (${params.minimumFixationMs} ms) no puede superar el tiempo máximo (${params.maximumFixationMs} ms).`,
      });
    } else if (
      params.targetPosition !== 'CENTER' &&
      params.maximumFixationMs - params.minimumFixationMs <
        MIN_CLINICAL_REACTION_HEADROOM_MS
    ) {
      issues.push({
        severity: 'WARNING',
        code: 'LOW_REACTION_HEADROOM',
        message: `Margen de latencia reducido (${params.maximumFixationMs - params.minimumFixationMs} ms) para objetivo en posición ${params.targetPosition}.`,
      });
    }
  }

  const requiredPureDwellMs = activeTargetsPerTrial * minimumFixationMs;
  const headroomMs = allowedDurationMs - requiredPureDwellMs;

  if (effectiveFps !== null) {
    if (effectiveFps < SUPPORTED_MIN_INFERENCE_FPS) {
      issues.push({
        severity: 'ERROR',
        code: 'INFERENCE_RATE_BELOW_MINIMUM',
        message: `Frecuencia real medida (${effectiveFps.toFixed(1)} Hz) por debajo del mínimo técnico clínico (${SUPPORTED_MIN_INFERENCE_FPS} Hz / 280 ms máx). No se puede validar fijación continua con cámara sin falsos descartes.`,
      });
    } else {
      const periodMs = 1000 / effectiveFps;
      // 3 consecutive samples confirm sustained capture (>= 2 full intervals for minimal dwells)
      const perTargetEffectiveMinMs = Math.max(minimumFixationMs, Math.ceil(2 * periodMs));
      const effectiveRequiredMs = activeTargetsPerTrial * perTargetEffectiveMinMs;
      if (effectiveRequiredMs > allowedDurationMs) {
        issues.push({
          severity: 'ERROR',
          code: 'INCOMPATIBLE_WITH_CAPTURE_RATE',
          message: `A ${effectiveFps.toFixed(1)} Hz, ${activeTargetsPerTrial} objetivo(s) requieren ~${effectiveRequiredMs} ms para confirmar fijación, superando los ${allowedDurationMs} ms prescritos.`,
        });
      } else if (
        reactionTargets > 0 &&
        allowedDurationMs - effectiveRequiredMs < MIN_CLINICAL_REACTION_HEADROOM_MS
      ) {
        issues.push({
          severity: 'WARNING',
          code: 'LOW_HEADROOM_AT_CAPTURE_RATE',
          message: `A ${effectiveFps.toFixed(1)} Hz queda un margen ajustado (${allowedDurationMs - effectiveRequiredMs} ms) para completar el ensayo dentro de ${allowedDurationMs} ms.`,
        });
      }
    }
  }

  return {
    compatible: !issues.some((i) => i.severity === 'ERROR'),
    issues,
    requiredPureDwellMs,
    allowedDurationMs,
    headroomMs,
    effectiveFps,
  };
}
