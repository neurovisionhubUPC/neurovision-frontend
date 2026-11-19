import type { VisualScanningParameters } from '../../api/contracts/clinical.contracts';
import type {
  AnalyticsDataOrigin,
  CompensatorySaccadeTrialBody,
  StandardScanningTrialBody,
  SystematicExplorationTrialBody,
} from '../../api/contracts/analytics.contracts';
import {
  calculateRetinotopicPosition,
  computeAcceptanceRadiusPx,
  DEFAULT_PX_PER_CM,
  DEFAULT_VIEWING_DISTANCE_CM,
} from '../retinotopicGeometry.ts';

export type ExplorationQuadrant = 'TOP_LEFT' | 'TOP_RIGHT' | 'BOTTOM_LEFT' | 'BOTTOM_RIGHT';

export const CANONICAL_EXPLORATION_QUADRANTS: readonly ExplorationQuadrant[] = [
  'TOP_LEFT',
  'TOP_RIGHT',
  'BOTTOM_LEFT',
  'BOTTOM_RIGHT',
] as const;

export interface ScanningEntity {
  id: string;
  x: number;
  y: number;
  radius: number;
  acceptanceRadius: number;
  kind: 'TARGET' | 'ANCHOR' | 'WAYPOINT';
  quadrant?: ExplorationQuadrant;
  orderIndex?: number;
  eccentricityDeg: number;
  meridianDeg: number;
  found: boolean;
  dwellTimeMs: number;
}

export interface ExplorationVisit {
  quadrant: ExplorationQuadrant;
  timeToVisitMs: number;
  confirmedDwellMs: number;
}

export interface StandardScanningTrialState {
  trialId: string;
  trialIndex: number;
  target: ScanningEntity;
  elapsedMs: number;
  completed: boolean;
  outcome: 'SUCCESS' | 'TIMEOUT' | 'INTERRUPTED' | null;
}

export interface SystematicExplorationTrialState {
  trialId: string;
  trialIndex: number;
  waypoints: ScanningEntity[];
  currentStepIndex: number;
  visits: ExplorationVisit[];
  elapsedMs: number;
  currentQuadrantElapsedMs: number;
  completed: boolean;
  outcome: 'COMPLETED' | 'TIMED_OUT' | 'INTERRUPTED' | null;
}

export interface CompensatorySaccadeTrialState {
  trialId: string;
  trialIndex: number;
  phase: 'CENTRAL_ANCHOR' | 'PERIPHERAL_TARGET';
  anchor: ScanningEntity;
  peripheralTarget: ScanningEntity;
  anchorHoldRequiredMs: number;
  saccadeElapsedMs: number;
  completed: boolean;
  outcome: 'SUCCESS' | 'TIMEOUT' | 'INTERRUPTED' | null;
}

function createUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const rand = (Math.random() * 16) | 0;
    const val = char === 'x' ? rand : (rand & 0x3) | 0x8;
    return val.toString(16);
  });
}

function clamp(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, val));
}

function resolveStepDeltas(
  deltaMs: number,
  dwellDeltaMs?: number
): { safeDeltaMs: number; effectiveDwellDelta: number } {
  const safeDeltaMs = Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;
  const rawDwell = dwellDeltaMs ?? safeDeltaMs;
  const effectiveDwellDelta = Number.isFinite(rawDwell) ? Math.max(0, rawDwell) : 0;
  return { safeDeltaMs, effectiveDwellDelta };
}

// Stratified meridians (degrees relative to horizontal hemifield axis)
const STRATIFIED_MERIDIANS_DEG: readonly number[] = [0, -28, 28, -15, 15, -36, 36];
const STRATIFIED_ECCENTRICITY_FACTORS: readonly number[] = [1.0, 0.82, 0.94, 0.72, 1.0, 0.88];

/* ==========================================================================
 * ALGORITMO 1 — STANDARD_SCANNING
 * ========================================================================== */

export function createStandardScanningTrial(
  params: VisualScanningParameters,
  width: number,
  height: number,
  trialIndex: number,
  viewingDistanceCm: number = DEFAULT_VIEWING_DISTANCE_CM
): StandardScanningTrialState {
  const trialId = createUuid();
  const radius = clamp((params.targetSizePx || 68) / 2, 15, 75);
  const acceptanceRadius = computeAcceptanceRadiusPx(
    params.targetSizePx || 68,
    params.difficultyLevel || 2
  );
  const marginPx = Math.max(48, radius + 16);

  const eccFactor =
    STRATIFIED_ECCENTRICITY_FACTORS[Math.abs(trialIndex) % STRATIFIED_ECCENTRICITY_FACTORS.length];
  const baseEcc = clamp(params.eccentricityDegrees || 20, 5, 30);
  const effectiveEccDeg = clamp(baseEcc * eccFactor, 5, 30);

  const meridianOffsetDeg =
    STRATIFIED_MERIDIANS_DEG[Math.abs(trialIndex) % STRATIFIED_MERIDIANS_DEG.length];
  const baseAngleDeg = params.affectedHemifield === 'LEFT' ? 180 : 0;
  const polarAngleDeg =
    params.affectedHemifield === 'LEFT'
      ? baseAngleDeg - meridianOffsetDeg
      : baseAngleDeg + meridianOffsetDeg;
  const polarAngleRad = (polarAngleDeg * Math.PI) / 180;

  const pos = calculateRetinotopicPosition({
    eccentricityDegrees: effectiveEccDeg,
    polarAngleRad,
    canvasWidth: width,
    canvasHeight: height,
    marginPx,
    viewingDistanceCm,
    pxPerCm: DEFAULT_PX_PER_CM,
  });

  // Ensure target strictly resides inside the prescribed affectedHemifield
  const x =
    params.affectedHemifield === 'LEFT'
      ? clamp(pos.x, marginPx, width / 2 - radius - 8)
      : clamp(pos.x, width / 2 + radius + 8, width - marginPx);

  return {
    trialId,
    trialIndex,
    target: {
      id: createUuid(),
      x,
      y: pos.y,
      radius,
      acceptanceRadius,
      kind: 'TARGET',
      eccentricityDeg: Number(effectiveEccDeg.toFixed(1)),
      meridianDeg: meridianOffsetDeg,
      found: false,
      dwellTimeMs: 0,
    },
    elapsedMs: 0,
    completed: false,
    outcome: null,
  };
}

export function stepStandardScanningTrial(
  state: StandardScanningTrialState,
  cursor: { x: number; y: number },
  deltaMs: number,
  params: VisualScanningParameters,
  isGazeValid: boolean = true,
  dwellDeltaMs?: number,
  dataOrigin: AnalyticsDataOrigin = 'PRODUCER_REPORTED'
): StandardScanningTrialBody | null {
  if (state.completed) return null;

  const { safeDeltaMs, effectiveDwellDelta } = resolveStepDeltas(deltaMs, dwellDeltaMs);
  const minFixMs = Math.round(params.minimumFixationMs);
  const maxStimulusMs = Math.round(params.maximumStimulusDurationMs);

  state.elapsedMs += safeDeltaMs;
  const target = state.target;
  const dist = Math.hypot(target.x - cursor.x, target.y - cursor.y);
  const hovering = dist <= target.acceptanceRadius;

  if (hovering && isGazeValid) {
    target.dwellTimeMs += effectiveDwellDelta;
    if (target.dwellTimeMs >= minFixMs) {
      target.found = true;
      state.completed = true;
      state.outcome = 'SUCCESS';

      const confirmedDwellMs = Math.min(
        maxStimulusMs,
        Math.max(minFixMs, Math.round(target.dwellTimeMs))
      );
      const localizationDurationMs = Math.min(
        maxStimulusMs,
        Math.max(confirmedDwellMs, Math.round(state.elapsedMs))
      );

      return {
        schemaVersion: 1,
        trialId: state.trialId,
        dataOrigin,
        outcome: 'SUCCESS',
        confirmedDwellMs,
        localizationDurationMs,
      };
    }
  } else {
    target.dwellTimeMs = Math.max(0, target.dwellTimeMs - safeDeltaMs * 1.25);
  }

  if (state.elapsedMs >= maxStimulusMs) {
    state.completed = true;
    state.outcome = 'TIMEOUT';
    const localizationDurationMs = Math.max(
      maxStimulusMs,
      Math.round(state.elapsedMs)
    );

    return {
      schemaVersion: 1,
      trialId: state.trialId,
      dataOrigin,
      outcome: 'TIMEOUT',
      confirmedDwellMs: null,
      localizationDurationMs,
    };
  }

  return null;
}

export function interruptStandardScanningTrial(
  state: StandardScanningTrialState,
  params: VisualScanningParameters,
  dataOrigin: AnalyticsDataOrigin = 'PRODUCER_REPORTED'
): StandardScanningTrialBody {
  state.completed = true;
  state.outcome = 'INTERRUPTED';
  const maxStimulusMs = Math.round(params.maximumStimulusDurationMs);
  const localizationDurationMs = Math.min(
    Math.max(0, maxStimulusMs - 1),
    Math.max(0, Math.round(state.elapsedMs))
  );
  return {
    schemaVersion: 1,
    trialId: state.trialId,
    dataOrigin,
    outcome: 'INTERRUPTED',
    confirmedDwellMs: null,
    localizationDurationMs,
  };
}

/* ==========================================================================
 * ALGORITMO 2 — SYSTEMATIC_EXPLORATION
 * ========================================================================== */

/**
 * CRITICAL BACKEND CONTRACT RULE (`analytics/integration.md` line 46):
 * `visits` MUST always be an ordered prefix of:
 *   ['TOP_LEFT', 'TOP_RIGHT', 'BOTTOM_LEFT', 'BOTTOM_RIGHT']
 * All four visits are required for `COMPLETED`. Timeout is spelled `'TIMED_OUT'`.
 */
export function createSystematicExplorationTrial(
  params: VisualScanningParameters,
  width: number,
  height: number,
  trialIndex: number = 0
): SystematicExplorationTrialState {
  const trialId = createUuid();
  const radius = clamp((params.targetSizePx || 68) / 2, 18, 64);
  const acceptanceRadius = computeAcceptanceRadiusPx(
    params.targetSizePx || 68,
    params.difficultyLevel || 2
  );

  const eccRatio = clamp((params.eccentricityDegrees || 20) / 30, 0.35, 1.0);
  // Shift the affected hemifield column deeper toward the periphery
  const leftOffsetRatio = params.affectedHemifield === 'LEFT' ? 0.34 * eccRatio + 0.08 : 0.24 * eccRatio + 0.06;
  const rightOffsetRatio = params.affectedHemifield === 'RIGHT' ? 0.34 * eccRatio + 0.08 : 0.24 * eccRatio + 0.06;

  const leftX = clamp(width * (0.5 - leftOffsetRatio), radius + 36, width * 0.42);
  const rightX = clamp(width * (0.5 + rightOffsetRatio), width * 0.58, width - radius - 36);
  const topY = clamp(height * 0.26, radius + 36, height * 0.42);
  const bottomY = clamp(height * 0.74, height * 0.58, height - radius - 36);

  const coordsByQuadrant: Record<
    ExplorationQuadrant,
    { x: number; y: number; meridianDeg: number }
  > = {
    TOP_LEFT: { x: leftX, y: topY, meridianDeg: 145 },
    TOP_RIGHT: { x: rightX, y: topY, meridianDeg: 35 },
    BOTTOM_LEFT: { x: leftX, y: bottomY, meridianDeg: -145 },
    BOTTOM_RIGHT: { x: rightX, y: bottomY, meridianDeg: -35 },
  };

  const waypoints: ScanningEntity[] = CANONICAL_EXPLORATION_QUADRANTS.map((quadrant, idx) => {
    const c = coordsByQuadrant[quadrant];
    return {
      id: createUuid(),
      x: c.x,
      y: c.y,
      radius,
      acceptanceRadius,
      kind: 'WAYPOINT',
      quadrant,
      orderIndex: idx,
      eccentricityDeg: params.eccentricityDegrees || 20,
      meridianDeg: c.meridianDeg,
      found: false,
      dwellTimeMs: 0,
    };
  });

  return {
    trialId,
    trialIndex,
    waypoints,
    currentStepIndex: 0,
    visits: [],
    elapsedMs: 0,
    currentQuadrantElapsedMs: 0,
    completed: false,
    outcome: null,
  };
}

export function stepSystematicExplorationTrial(
  state: SystematicExplorationTrialState,
  cursor: { x: number; y: number },
  deltaMs: number,
  params: VisualScanningParameters,
  isGazeValid: boolean = true,
  dwellDeltaMs?: number,
  dataOrigin: AnalyticsDataOrigin = 'PRODUCER_REPORTED'
): SystematicExplorationTrialBody | null {
  if (state.completed) return null;

  const { safeDeltaMs, effectiveDwellDelta } = resolveStepDeltas(deltaMs, dwellDeltaMs);
  const minFixMs = Math.round(params.minimumFixationMs);
  const maxStimulusMs = Math.round(params.maximumStimulusDurationMs);

  state.elapsedMs += safeDeltaMs;
  state.currentQuadrantElapsedMs += safeDeltaMs;
  const activeWp = state.waypoints[state.currentStepIndex];

  if (activeWp && !activeWp.found) {
    const dist = Math.hypot(activeWp.x - cursor.x, activeWp.y - cursor.y);
    const hovering = dist <= activeWp.acceptanceRadius;

    if (hovering && isGazeValid) {
      activeWp.dwellTimeMs += effectiveDwellDelta;
      if (activeWp.dwellTimeMs >= minFixMs) {
        activeWp.found = true;
        const confirmedDwellMs = Math.min(
          maxStimulusMs,
          Math.max(minFixMs, Math.round(activeWp.dwellTimeMs))
        );
        const timeToVisitMs = Math.min(
          maxStimulusMs,
          Math.max(confirmedDwellMs, Math.round(state.currentQuadrantElapsedMs))
        );

        state.visits.push({
          quadrant: CANONICAL_EXPLORATION_QUADRANTS[state.currentStepIndex],
          timeToVisitMs,
          confirmedDwellMs,
        });

        state.currentQuadrantElapsedMs = 0;
        state.currentStepIndex += 1;

        if (state.currentStepIndex >= CANONICAL_EXPLORATION_QUADRANTS.length) {
          state.completed = true;
          state.outcome = 'COMPLETED';
          const safeVisits = state.visits.slice(0, 4).map((v) => ({
            quadrant: v.quadrant,
            timeToVisitMs: Math.round(v.timeToVisitMs),
            confirmedDwellMs: Math.round(v.confirmedDwellMs),
          }));
          const confirmedDuration = safeVisits.reduce((sum, v) => sum + v.timeToVisitMs, 0);
          state.elapsedMs = confirmedDuration;

          return {
            schemaVersion: 1,
            trialId: state.trialId,
            dataOrigin,
            outcome: 'COMPLETED',
            elapsedMs: confirmedDuration,
            visits: safeVisits,
          };
        }
      }
    } else {
      activeWp.dwellTimeMs = Math.max(0, activeWp.dwellTimeMs - safeDeltaMs * 1.25);
    }
  }

  if (state.currentQuadrantElapsedMs >= maxStimulusMs) {
    state.completed = true;
    state.outcome = 'TIMED_OUT';
    const safeVisits = state.visits.slice(0, 3).map((v) => ({
      quadrant: v.quadrant,
      timeToVisitMs: Math.round(v.timeToVisitMs),
      confirmedDwellMs: Math.round(v.confirmedDwellMs),
    }));
    const confirmedDuration = safeVisits.reduce((sum, v) => sum + v.timeToVisitMs, 0);
    const elapsedMs = confirmedDuration + maxStimulusMs;
    state.elapsedMs = elapsedMs;

    return {
      schemaVersion: 1,
      trialId: state.trialId,
      dataOrigin,
      outcome: 'TIMED_OUT',
      elapsedMs,
      visits: safeVisits,
    };
  }

  return null;
}

export function interruptSystematicExplorationTrial(
  state: SystematicExplorationTrialState,
  params: VisualScanningParameters,
  dataOrigin: AnalyticsDataOrigin = 'PRODUCER_REPORTED'
): SystematicExplorationTrialBody {
  state.completed = true;
  state.outcome = 'INTERRUPTED';
  const maxStimulusMs = Math.round(params.maximumStimulusDurationMs);
  const safeVisits = state.visits.slice(0, 3).map((v) => ({
    quadrant: v.quadrant,
    timeToVisitMs: Math.round(v.timeToVisitMs),
    confirmedDwellMs: Math.round(v.confirmedDwellMs),
  }));
  const confirmedDuration = safeVisits.reduce((sum, v) => sum + v.timeToVisitMs, 0);
  const remaining = clamp(
    Math.round(state.currentQuadrantElapsedMs),
    0,
    Math.max(0, maxStimulusMs - 1)
  );
  const elapsedMs = confirmedDuration + remaining;

  return {
    schemaVersion: 1,
    trialId: state.trialId,
    dataOrigin,
    outcome: 'INTERRUPTED',
    elapsedMs,
    visits: safeVisits,
  };
}

/* ==========================================================================
 * ALGORITMO 3 — COMPENSATORY_SACCADE
 * ========================================================================== */

export function createCompensatorySaccadeTrial(
  params: VisualScanningParameters,
  width: number,
  height: number,
  trialIndex: number,
  viewingDistanceCm: number = DEFAULT_VIEWING_DISTANCE_CM
): CompensatorySaccadeTrialState {
  const trialId = createUuid();
  const radius = clamp((params.targetSizePx || 68) / 2, 16, 68);
  const acceptanceRadius = computeAcceptanceRadiusPx(
    params.targetSizePx || 68,
    params.difficultyLevel || 2
  );
  const marginPx = Math.max(48, radius + 16);

  const anchorHoldRequiredMs = clamp(Math.round(params.minimumFixationMs * 0.45), 250, 500);
  const baseEcc = clamp(params.eccentricityDegrees || 20, 5, 30);
  const meridianOffsetDeg =
    STRATIFIED_MERIDIANS_DEG[Math.abs(trialIndex) % STRATIFIED_MERIDIANS_DEG.length];
  const baseAngleDeg = params.affectedHemifield === 'LEFT' ? 180 : 0;
  const polarAngleDeg =
    params.affectedHemifield === 'LEFT'
      ? baseAngleDeg - meridianOffsetDeg
      : baseAngleDeg + meridianOffsetDeg;
  const polarAngleRad = (polarAngleDeg * Math.PI) / 180;

  const pos = calculateRetinotopicPosition({
    eccentricityDegrees: baseEcc,
    polarAngleRad,
    canvasWidth: width,
    canvasHeight: height,
    marginPx,
    viewingDistanceCm,
    pxPerCm: DEFAULT_PX_PER_CM,
  });

  const jumpX =
    params.affectedHemifield === 'LEFT'
      ? clamp(pos.x, marginPx, width / 2 - radius - 12)
      : clamp(pos.x, width / 2 + radius + 12, width - marginPx);

  return {
    trialId,
    trialIndex,
    phase: 'CENTRAL_ANCHOR',
    anchor: {
      id: createUuid(),
      x: width / 2,
      y: height / 2,
      radius: Math.max(22, radius * 0.85),
      acceptanceRadius: Math.max(32, acceptanceRadius * 0.9),
      kind: 'ANCHOR',
      eccentricityDeg: 0,
      meridianDeg: 0,
      found: false,
      dwellTimeMs: 0,
    },
    peripheralTarget: {
      id: createUuid(),
      x: jumpX,
      y: pos.y,
      radius,
      acceptanceRadius,
      kind: 'TARGET',
      eccentricityDeg: baseEcc,
      meridianDeg: meridianOffsetDeg,
      found: false,
      dwellTimeMs: 0,
    },
    anchorHoldRequiredMs,
    saccadeElapsedMs: 0,
    completed: false,
    outcome: null,
  };
}

export function stepCompensatorySaccadeTrial(
  state: CompensatorySaccadeTrialState,
  cursor: { x: number; y: number },
  deltaMs: number,
  params: VisualScanningParameters,
  isGazeValid: boolean = true,
  dwellDeltaMs?: number,
  dataOrigin: AnalyticsDataOrigin = 'PRODUCER_REPORTED'
): CompensatorySaccadeTrialBody | null {
  if (state.completed) return null;

  const { safeDeltaMs, effectiveDwellDelta } = resolveStepDeltas(deltaMs, dwellDeltaMs);
  const minFixMs = Math.round(params.minimumFixationMs);
  const maxStimulusMs = Math.round(params.maximumStimulusDurationMs);

  if (state.phase === 'CENTRAL_ANCHOR') {
    const dist = Math.hypot(state.anchor.x - cursor.x, state.anchor.y - cursor.y);
    if (dist <= state.anchor.acceptanceRadius && isGazeValid) {
      state.anchor.dwellTimeMs += effectiveDwellDelta;
      if (state.anchor.dwellTimeMs >= state.anchorHoldRequiredMs) {
        state.anchor.found = true;
        state.phase = 'PERIPHERAL_TARGET';
        state.saccadeElapsedMs = 0;
      }
    } else {
      state.anchor.dwellTimeMs = Math.max(0, state.anchor.dwellTimeMs - safeDeltaMs * 1.35);
    }
    return null;
  }

  // Phase 2: PERIPHERAL_TARGET
  state.saccadeElapsedMs += safeDeltaMs;
  const target = state.peripheralTarget;
  const dist = Math.hypot(target.x - cursor.x, target.y - cursor.y);

  if (dist <= target.acceptanceRadius && isGazeValid) {
    target.dwellTimeMs += effectiveDwellDelta;
    if (target.dwellTimeMs >= minFixMs) {
      target.found = true;
      state.completed = true;
      state.outcome = 'SUCCESS';

      const confirmedDwellMs = Math.min(
        maxStimulusMs,
        Math.max(minFixMs, Math.round(target.dwellTimeMs))
      );
      const elapsedMs = Math.min(
        maxStimulusMs,
        Math.max(confirmedDwellMs, Math.round(state.saccadeElapsedMs))
      );

      return {
        schemaVersion: 1,
        trialId: state.trialId,
        dataOrigin,
        outcome: 'SUCCESS',
        confirmedDwellMs,
        elapsedMs,
      };
    }
  } else {
    target.dwellTimeMs = Math.max(0, target.dwellTimeMs - safeDeltaMs * 1.25);
  }

  if (state.saccadeElapsedMs >= maxStimulusMs) {
    state.completed = true;
    state.outcome = 'TIMEOUT';
    const elapsedMs = Math.max(
      maxStimulusMs,
      Math.round(state.saccadeElapsedMs)
    );

    return {
      schemaVersion: 1,
      trialId: state.trialId,
      dataOrigin,
      outcome: 'TIMEOUT',
      confirmedDwellMs: null,
      elapsedMs,
    };
  }

  return null;
}

export function interruptCompensatorySaccadeTrial(
  state: CompensatorySaccadeTrialState,
  params: VisualScanningParameters,
  dataOrigin: AnalyticsDataOrigin = 'PRODUCER_REPORTED'
): CompensatorySaccadeTrialBody {
  state.completed = true;
  state.outcome = 'INTERRUPTED';
  const maxStimulusMs = Math.round(params.maximumStimulusDurationMs);
  const elapsedMs = Math.min(
    Math.max(0, maxStimulusMs - 1),
    Math.max(1, Math.round(state.saccadeElapsedMs || 1))
  );
  return {
    schemaVersion: 1,
    trialId: state.trialId,
    dataOrigin,
    outcome: 'INTERRUPTED',
    confirmedDwellMs: null,
    elapsedMs,
  };
}
