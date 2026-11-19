import type {
  FixationParameters,
  VisualSearchParameters,
} from '../../api/contracts/clinical.contracts';
import type {
  AnalyticsDataOrigin,
  SustainedFixationTrialBody,
  VisualSearchTrialBody,
} from '../../api/contracts/analytics.contracts';

/**
 * Standard RFC4122 v4 UUID generator (browser & worker safe).
 */
export function createUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const rand = (Math.random() * 16) | 0;
    const val = char === 'x' ? rand : (rand & 0x3) | 0x8;
    return val.toString(16);
  });
}

/**
 * Utility clamp function.
 */
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

/* ==========================================================================
 * ALGORITMO 4 — TARGET_SEARCH_WITH_DISTRACTORS (`visual-search`)
 * ========================================================================== */

export type DistractorVariant =
  | 'DIAMOND'
  | 'LANDOLT_OPEN_TOP'
  | 'LANDOLT_OPEN_BOTTOM'
  | 'HEXAGON';

export interface SearchEntity {
  id: string;
  x: number;
  y: number;
  radius: number;
  acceptanceRadius: number;
  kind: 'TARGET' | 'DISTRACTOR';
  distractorVariant: DistractorVariant;
  inAffectedHemifield: boolean;
  found: boolean;
  dwellTimeMs: number;
  falseFixationCount: number;
}

export interface VisualSearchTrialState {
  trialId: string;
  trialIndex: number;
  entities: SearchEntity[];
  elapsedMs: number;
  lastConfirmedDwellMs: number;
  falseFixations: number;
  completed: boolean;
  outcome: 'SUCCESS' | 'TIMEOUT' | 'INTERRUPTED' | null;
}

/**
 * Selects distractor variant based on difficulty level:
 * - Levels 1-2: 'DIAMOND' | 'HEXAGON'
 * - Levels 3-5: 'LANDOLT_OPEN_TOP' | 'LANDOLT_OPEN_BOTTOM' (requires fine foveal discrimination)
 */
function pickDistractorVariant(difficultyLevel: number, index: number): DistractorVariant {
  if (difficultyLevel <= 2) {
    return index % 2 === 0 ? 'DIAMOND' : 'HEXAGON';
  }
  return index % 2 === 0 ? 'LANDOLT_OPEN_TOP' : 'LANDOLT_OPEN_BOTTOM';
}

/**
 * Creates a visual search trial state with active targets and distractors according to Schema v2 parameters.
 *
 * Requirements:
 * - active targets: between 1 and Math.min(4, Math.max(1, Math.round(params.targetCount / Math.max(4, params.difficultyLevel))))
 * - distractors: clamp(params.distractorCount, 0, 20)
 * - non-overlapping entities with minimum center-to-center separation of `radius * 2.4`
 * - exact target allocation according to `params.affectedHemifieldBias` (0.5..1.0)
 * - distractor visual similarity scaled by `params.difficultyLevel` (1..5)
 */
export function createVisualSearchTrial(
  params: VisualSearchParameters,
  width: number,
  height: number,
  trialIndex: number
): VisualSearchTrialState {
  const trialId = createUuid();
  const radius = clamp((params.targetSizePx || 64) / 2, 16, 56);
  const acceptanceRadius = Math.max(radius * 1.4, radius + 14);
  const minSeparation = radius * 2.4;
  const margin = Math.max(36, radius * 1.4);

  // Active target calculation
  const targetDenominator = Math.max(4, params.difficultyLevel);
  const rawTargetCount = Math.round(params.targetCount / targetDenominator);
  const activeTargetCount = Math.min(4, Math.max(1, rawTargetCount));

  // Distractors count
  const activeDistractorCount = clamp(Math.round(params.distractorCount), 0, 20);

  // Affected hemifield distribution
  const bias = clamp(params.affectedHemifieldBias ?? 0.75, 0.5, 1.0);
  const affectedTargetCount = Math.min(
    activeTargetCount,
    Math.max(0, Math.round(activeTargetCount * bias))
  );

  const placed: SearchEntity[] = [];

  const checkOverlap = (cx: number, cy: number, currentSeparation: number): boolean => {
    for (let i = 0; i < placed.length; i++) {
      const dist = Math.hypot(placed[i].x - cx, placed[i].y - cy);
      if (dist < currentSeparation) return true;
    }
    return false;
  };

  const sampleCoordinateInHemifield = (
    inAffected: boolean
  ): { x: number; y: number } => {
    const isTargetLeft =
      (params.affectedHemifield === 'LEFT' && inAffected) ||
      (params.affectedHemifield === 'RIGHT' && !inAffected);

    const minX = isTargetLeft ? margin + radius : width / 2 + radius + 12;
    const maxX = isTargetLeft ? width / 2 - radius - 12 : width - margin - radius;
    const minY = margin + radius;
    const maxY = height - margin - radius;

    const spanX = Math.max(20, maxX - minX);
    const spanY = Math.max(20, maxY - minY);

    const x = minX + Math.random() * spanX;
    const y = minY + Math.random() * spanY;

    return { x, y };
  };

  // 1. Place TARGET entities
  for (let t = 0; t < activeTargetCount; t++) {
    const inAffected = t < affectedTargetCount;
    let chosenX = width * 0.5;
    let chosenY = height * 0.5;
    let separation = minSeparation;

    let placedSuccessfully = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      const coord = sampleCoordinateInHemifield(inAffected);
      if (!checkOverlap(coord.x, coord.y, separation)) {
        chosenX = coord.x;
        chosenY = coord.y;
        placedSuccessfully = true;
        break;
      }
      if (attempt > 80) {
        separation = radius * 2.0;
      }
    }

    if (!placedSuccessfully) {
      const coord = sampleCoordinateInHemifield(inAffected);
      chosenX = coord.x;
      chosenY = coord.y;
    }

    placed.push({
      id: createUuid(),
      x: chosenX,
      y: chosenY,
      radius,
      acceptanceRadius,
      kind: 'TARGET',
      distractorVariant: pickDistractorVariant(params.difficultyLevel, t),
      inAffectedHemifield: inAffected,
      found: false,
      dwellTimeMs: 0,
      falseFixationCount: 0,
    });
  }

  // 2. Place DISTRACTOR entities
  for (let d = 0; d < activeDistractorCount; d++) {
    const inAffected = Math.random() < bias;
    const variant = pickDistractorVariant(params.difficultyLevel, d);
    let chosenX = width * 0.5;
    let chosenY = height * 0.5;
    let separation = minSeparation;

    let placedSuccessfully = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      const coord = sampleCoordinateInHemifield(inAffected);
      if (!checkOverlap(coord.x, coord.y, separation)) {
        chosenX = coord.x;
        chosenY = coord.y;
        placedSuccessfully = true;
        break;
      }
      if (attempt > 80) {
        separation = radius * 2.0;
      }
    }

    if (!placedSuccessfully) {
      const coord = sampleCoordinateInHemifield(inAffected);
      chosenX = coord.x;
      chosenY = coord.y;
    }

    const actuallyInAffected =
      params.affectedHemifield === 'LEFT'
        ? chosenX < width / 2
        : chosenX >= width / 2;

    placed.push({
      id: createUuid(),
      x: chosenX,
      y: chosenY,
      radius,
      acceptanceRadius,
      kind: 'DISTRACTOR',
      distractorVariant: variant,
      inAffectedHemifield: actuallyInAffected,
      found: false,
      dwellTimeMs: 0,
      falseFixationCount: 0,
    });
  }

  return {
    trialId,
    trialIndex,
    entities: placed,
    elapsedMs: 0,
    lastConfirmedDwellMs: 0,
    falseFixations: 0,
    completed: false,
    outcome: null,
  };
}

/**
 * Steps the visual search trial simulation.
 *
 * Rules:
 * - Measures dwellTimeMs over each unfound TARGET.
 * - Tracks false fixations on DISTRACTOR (distractorDwellMs >= 250 ms -> increments falseFixations).
 * - When all TARGETs reach `params.minimumFixationMs`:
 *     confirmedDwellMs = Math.max(params.minimumFixationMs, Math.round(lastConfirmedDwellMs))
 *     searchDurationMs = Math.min(params.maximumSearchTimeMs, Math.max(confirmedDwellMs, Math.round(trialElapsedMs)))
 *     outcome: 'SUCCESS'
 * - If trialElapsedMs >= params.maximumSearchTimeMs:
 *     confirmedDwellMs: null
 *     searchDurationMs = Math.max(params.maximumSearchTimeMs, Math.round(trialElapsedMs))
 *     outcome: 'TIMEOUT'
 */
export function stepVisualSearchTrial(
  state: VisualSearchTrialState,
  cursor: { x: number; y: number },
  deltaMs: number,
  params: VisualSearchParameters,
  isGazeValid: boolean = true,
  dwellDeltaMs?: number,
  dataOrigin: AnalyticsDataOrigin = 'PRODUCER_REPORTED'
): VisualSearchTrialBody | null {
  if (state.completed) {
    return null;
  }

  const { safeDeltaMs, effectiveDwellDelta } = resolveStepDeltas(deltaMs, dwellDeltaMs);
  const minFixMs = Math.round(params.minimumFixationMs);
  const maxSearchMs = Math.round(params.maximumSearchTimeMs);

  state.elapsedMs += safeDeltaMs;

  for (let i = 0; i < state.entities.length; i++) {
    const entity = state.entities[i];
    const dist = Math.hypot(entity.x - cursor.x, entity.y - cursor.y);
    const hovering = dist <= entity.acceptanceRadius;

    if (entity.kind === 'TARGET') {
      if (!entity.found) {
        if (hovering && isGazeValid) {
          entity.dwellTimeMs += effectiveDwellDelta;
          if (entity.dwellTimeMs >= minFixMs) {
            entity.found = true;
            state.lastConfirmedDwellMs = entity.dwellTimeMs;
          }
        } else {
          // Smooth gaze jitter decay
          entity.dwellTimeMs = Math.max(0, entity.dwellTimeMs - safeDeltaMs * 1.5);
        }
      }
    } else {
      // DISTRACTOR entity
      if (hovering && isGazeValid) {
        const previousDwell = entity.dwellTimeMs;
        entity.dwellTimeMs += effectiveDwellDelta;
        if (previousDwell < 250 && entity.dwellTimeMs >= 250) {
          entity.falseFixationCount += 1;
          state.falseFixations += 1;
        }
      } else {
        entity.dwellTimeMs = Math.max(0, entity.dwellTimeMs - safeDeltaMs * 2.0);
      }
    }
  }

  // Check completion: all TARGETs found
  const targets = state.entities.filter((e) => e.kind === 'TARGET');
  const allTargetsFound = targets.length > 0 && targets.every((e) => e.found);

  if (allTargetsFound) {
    state.completed = true;
    state.outcome = 'SUCCESS';
    const confirmedDwellMs = Math.min(
      maxSearchMs,
      Math.max(
        minFixMs,
        Math.round(state.lastConfirmedDwellMs || minFixMs)
      )
    );
    const searchDurationMs = Math.min(
      maxSearchMs,
      Math.max(confirmedDwellMs, Math.round(state.elapsedMs))
    );

    return {
      schemaVersion: 1,
      trialId: state.trialId,
      dataOrigin,
      outcome: 'SUCCESS',
      confirmedDwellMs,
      searchDurationMs,
    };
  }

  // Check timeout
  if (state.elapsedMs >= maxSearchMs) {
    state.completed = true;
    state.outcome = 'TIMEOUT';
    const searchDurationMs = Math.max(
      maxSearchMs,
      Math.round(state.elapsedMs)
    );

    return {
      schemaVersion: 1,
      trialId: state.trialId,
      dataOrigin,
      outcome: 'TIMEOUT',
      confirmedDwellMs: null,
      searchDurationMs,
    };
  }

  return null;
}

/**
 * Prematurely interrupts an active visual search trial.
 */
export function interruptVisualSearchTrial(
  state: VisualSearchTrialState,
  params: VisualSearchParameters,
  dataOrigin: AnalyticsDataOrigin = 'PRODUCER_REPORTED'
): VisualSearchTrialBody {
  state.completed = true;
  state.outcome = 'INTERRUPTED';
  const maxSearchMs = Math.round(params.maximumSearchTimeMs);
  const duration = Math.min(
    Math.max(0, maxSearchMs - 1),
    Math.max(0, Math.round(state.elapsedMs))
  );

  return {
    schemaVersion: 1,
    trialId: state.trialId,
    dataOrigin,
    outcome: 'INTERRUPTED',
    confirmedDwellMs: null,
    searchDurationMs: duration,
  };
}

/* ==========================================================================
 * ALGORITMO 5 — SUSTAINED_TARGET_FIXATION (`fixation`)
 * ========================================================================== */

export interface FixationTrialState {
  id: string;
  x: number;
  y: number;
  radius: number;
  acceptanceRadius: number;
  positionLabel: 'CENTER' | 'LEFT' | 'RIGHT' | 'RANDOM';
  elapsedMs: number;
  insideTargetMs: number;
  currentContinuousInsideMs: number;
  longestContinuousInsideMs: number;
  outsideGraceMs: number;
  fixationLosses: number;
  completed?: boolean;
  outcome?: 'SUCCESS' | 'TIMEOUT' | 'INTERRUPTED' | null;
}

/**
 * Deterministic stratified 3x3 permutation avoiding border collisions.
 * Grid indices:
 * 0: Top-Left,   1: Top-Center,   2: Top-Right
 * 3: Mid-Left,   4: Center,       5: Mid-Right
 * 6: Bottom-Left, 7: Bottom-Center, 8: Bottom-Right
 */
const STRATIFIED_3X3_ORDER: readonly number[] = [4, 0, 8, 2, 6, 1, 5, 7, 3];

/**
 * Creates a sustained fixation trial state positioned according to `params.targetPosition`:
 * - 'CENTER': (width * 0.5, height * 0.5)
 * - 'LEFT': (width * 0.22, height * (0.35 + (trialIndex % 3) * 0.15))
 * - 'RIGHT': (width * 0.78, height * (0.35 + (trialIndex % 3) * 0.15))
 * - 'RANDOM': deterministic stratified 3x3 grid avoiding edges
 */
export function createSustainedFixationTrial(
  params: FixationParameters,
  width: number,
  height: number,
  trialIndex: number
): FixationTrialState {
  const radius = clamp((params.targetSizePx || 72) / 2, 22, 60);
  const acceptanceRadius = Math.max(radius * 1.45, radius + 16);
  const positionLabel = params.targetPosition;

  let x = width * 0.5;
  let y = height * 0.5;

  if (positionLabel === 'CENTER') {
    x = width * 0.5;
    y = height * 0.5;
  } else if (positionLabel === 'LEFT') {
    x = width * 0.22;
    y = height * (0.35 + (trialIndex % 3) * 0.15);
  } else if (positionLabel === 'RIGHT') {
    x = width * 0.78;
    y = height * (0.35 + (trialIndex % 3) * 0.15);
  } else if (positionLabel === 'RANDOM') {
    const cellIdx = STRATIFIED_3X3_ORDER[Math.abs(trialIndex) % STRATIFIED_3X3_ORDER.length];
    const col = cellIdx % 3;
    const row = Math.floor(cellIdx / 3);

    const cols = [width * 0.24, width * 0.5, width * 0.76];
    const rows = [height * 0.26, height * 0.5, height * 0.74];

    x = cols[col];
    y = rows[row];
  }

  return {
    id: createUuid(),
    x,
    y,
    radius,
    acceptanceRadius,
    positionLabel,
    elapsedMs: 0,
    insideTargetMs: 0,
    currentContinuousInsideMs: 0,
    longestContinuousInsideMs: 0,
    outsideGraceMs: 0,
    fixationLosses: 0,
    completed: false,
    outcome: null,
  };
}

/**
 * Steps the sustained fixation trial simulation.
 *
 * Rules:
 * - Micro-blink anti-jitter grace window (outsideGraceMs <= 90 ms) preserves continuous fixation streak.
 * - If outsideGraceMs > 90 ms, resets currentContinuousInsideMs = 0 and increments fixationLosses.
 *
 * Backend Contract Rule (analytics/integration.md):
 * "Longest continuous time cannot exceed cumulative time, which cannot exceed elapsed time."
 * Invariant: `longestInt <= insideInt <= elapsedFinal` at all times.
 *
 * Calculations:
 * - elapsedInt = Math.max(1, Math.round(state.elapsedMs))
 * - In SUCCESS:
 *     longestInt = clamp(Math.round(state.longestContinuousInsideMs), params.minimumFixationMs, params.maximumFixationMs)
 *     insideInt = clamp(Math.round(state.insideTargetMs), longestInt, params.maximumFixationMs)
 *     elapsedFinal = clamp(elapsedInt, insideInt, params.maximumFixationMs)
 *     (with guaranteed minimumFixationMs <= longestInt <= insideInt <= elapsedFinal <= maximumFixationMs)
 * - In TIMEOUT (state.elapsedMs >= params.maximumFixationMs):
 *     elapsedFinal = params.maximumFixationMs
 *     insideInt = clamp(Math.round(state.insideTargetMs), 0, elapsedFinal)
 *     longestInt = clamp(Math.round(state.longestContinuousInsideMs), 0, Math.min(insideInt, Math.max(0, params.minimumFixationMs - 1)))
 */
export function stepSustainedFixationTrial(
  state: FixationTrialState,
  cursor: { x: number; y: number },
  deltaMs: number,
  params: FixationParameters,
  isGazeValid: boolean = true,
  dwellDeltaMs?: number,
  dataOrigin: AnalyticsDataOrigin = 'PRODUCER_REPORTED'
): SustainedFixationTrialBody | null {
  if (state.completed) {
    return null;
  }

  const { safeDeltaMs, effectiveDwellDelta } = resolveStepDeltas(deltaMs, dwellDeltaMs);
  const minFixMs = Math.round(params.minimumFixationMs);
  const maxFixMs = Math.round(params.maximumFixationMs);

  state.elapsedMs += safeDeltaMs;

  const dist = Math.hypot(state.x - cursor.x, state.y - cursor.y);
  const hovering = dist <= state.acceptanceRadius;

  if (hovering && isGazeValid) {
    state.outsideGraceMs = 0;
    state.insideTargetMs += effectiveDwellDelta;
    state.currentContinuousInsideMs += effectiveDwellDelta;

    if (state.currentContinuousInsideMs > state.longestContinuousInsideMs) {
      state.longestContinuousInsideMs = state.currentContinuousInsideMs;
    }
  } else {
    state.outsideGraceMs += safeDeltaMs;
    if (state.outsideGraceMs > 90) {
      if (state.currentContinuousInsideMs > 0) {
        state.fixationLosses += 1;
        state.currentContinuousInsideMs = 0;
      }
    }
  }

  const elapsedInt = Math.max(1, Math.round(state.elapsedMs));

  // Check SUCCESS: sustained fixation meets or exceeds minimumFixationMs
  if (
    state.currentContinuousInsideMs >= minFixMs ||
    state.longestContinuousInsideMs >= minFixMs
  ) {
    const longestInt = clamp(
      Math.round(state.longestContinuousInsideMs),
      minFixMs,
      maxFixMs
    );
    const insideInt = clamp(
      Math.round(state.insideTargetMs),
      longestInt,
      maxFixMs
    );
    const elapsedFinal = clamp(
      elapsedInt,
      insideInt,
      maxFixMs
    );

    state.completed = true;
    state.outcome = 'SUCCESS';

    return {
      schemaVersion: 1,
      trialId: state.id,
      dataOrigin,
      outcome: 'SUCCESS',
      elapsedMs: elapsedFinal,
      insideTargetMs: insideInt,
      longestContinuousInsideMs: longestInt,
    };
  }

  // Check TIMEOUT
  if (state.elapsedMs >= maxFixMs) {
    const elapsedFinal = maxFixMs;
    const insideInt = clamp(
      Math.round(state.insideTargetMs),
      0,
      elapsedFinal
    );
    const longestInt = clamp(
      Math.round(state.longestContinuousInsideMs),
      0,
      Math.min(insideInt, Math.max(0, minFixMs - 1))
    );

    state.completed = true;
    state.outcome = 'TIMEOUT';

    return {
      schemaVersion: 1,
      trialId: state.id,
      dataOrigin,
      outcome: 'TIMEOUT',
      elapsedMs: elapsedFinal,
      insideTargetMs: insideInt,
      longestContinuousInsideMs: longestInt,
    };
  }

  return null;
}

/**
 * Prematurely interrupts an active sustained fixation trial, preserving the backend invariant:
 * longestInt <= insideInt <= elapsedFinal < maximumFixationMs and longestInt < minimumFixationMs
 */
export function interruptSustainedFixationTrial(
  state: FixationTrialState,
  params?: FixationParameters,
  dataOrigin: AnalyticsDataOrigin = 'PRODUCER_REPORTED'
): SustainedFixationTrialBody {
  const maxFixationMs =
    params?.maximumFixationMs !== undefined
      ? Math.round(params.maximumFixationMs)
      : Number.MAX_SAFE_INTEGER;
  const minFixationMs =
    params?.minimumFixationMs !== undefined
      ? Math.round(params.minimumFixationMs)
      : Number.MAX_SAFE_INTEGER;
  const elapsedFinal = clamp(
    Math.round(state.elapsedMs),
    1,
    Math.max(1, maxFixationMs - 1)
  );
  const insideInt = clamp(
    Math.round(state.insideTargetMs),
    0,
    elapsedFinal
  );
  const longestInt = clamp(
    Math.round(state.longestContinuousInsideMs),
    0,
    Math.min(insideInt, Math.max(0, minFixationMs - 1))
  );

  state.completed = true;
  state.outcome = 'INTERRUPTED';

  return {
    schemaVersion: 1,
    trialId: state.id,
    dataOrigin,
    outcome: 'INTERRUPTED',
    elapsedMs: elapsedFinal,
    insideTargetMs: insideInt,
    longestContinuousInsideMs: longestInt,
  };
}

/* ==========================================================================
 * CANVAS RENDERING HELPERS
 * ========================================================================== */

/**
 * Renders an entity for Visual Search on HTML5 2D Canvas.
 */
export function renderSearchEntity(
  ctx: CanvasRenderingContext2D,
  entity: SearchEntity,
  options?: {
    primaryColor?: string;
    distractorColor?: string;
    foundColor?: string;
    showAcceptanceRadius?: boolean;
  }
): void {
  const primaryColor = options?.primaryColor ?? '#06b6d4'; // Cyan-500
  const distractorColor = options?.distractorColor ?? '#94a3b8'; // Slate-400
  const foundColor = options?.foundColor ?? '#10b981'; // Emerald-500

  ctx.save();

  if (options?.showAcceptanceRadius) {
    ctx.beginPath();
    ctx.arc(entity.x, entity.y, entity.acceptanceRadius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  if (entity.kind === 'TARGET') {
    if (entity.found) {
      // Completed target: glowing solid emerald disc with check
      ctx.beginPath();
      ctx.arc(entity.x, entity.y, entity.radius, 0, Math.PI * 2);
      ctx.fillStyle = foundColor;
      ctx.shadowColor = foundColor;
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.beginPath();
      ctx.arc(entity.x, entity.y, entity.radius * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    } else {
      // Active target: concentric foveal rings with dwell arc
      ctx.beginPath();
      ctx.arc(entity.x, entity.y, entity.radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(6, 182, 212, 0.18)';
      ctx.fill();
      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(entity.x, entity.y, entity.radius * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = primaryColor;
      ctx.fill();

      // Dwell progress arc
      if (entity.dwellTimeMs > 0) {
        const progress = Math.min(1, entity.dwellTimeMs / 1000);
        ctx.beginPath();
        ctx.arc(
          entity.x,
          entity.y,
          entity.radius + 5,
          -Math.PI / 2,
          -Math.PI / 2 + progress * Math.PI * 2
        );
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }
  } else {
    // DISTRACTOR entity by variant
    ctx.strokeStyle = distractorColor;
    ctx.lineWidth = 2.5;

    switch (entity.distractorVariant) {
      case 'DIAMOND': {
        const r = entity.radius;
        ctx.beginPath();
        ctx.moveTo(entity.x, entity.y - r);
        ctx.lineTo(entity.x + r, entity.y);
        ctx.lineTo(entity.x, entity.y + r);
        ctx.lineTo(entity.x - r, entity.y);
        ctx.closePath();
        ctx.fillStyle = 'rgba(148, 163, 184, 0.15)';
        ctx.fill();
        ctx.stroke();
        break;
      }

      case 'HEXAGON': {
        const r = entity.radius;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const angle = (i * Math.PI) / 3;
          const px = entity.x + r * Math.cos(angle);
          const py = entity.y + r * Math.sin(angle);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(148, 163, 184, 0.15)';
        ctx.fill();
        ctx.stroke();
        break;
      }

      case 'LANDOLT_OPEN_TOP': {
        // C ring with gap at top (-PI/2)
        const gap = Math.PI * 0.32;
        ctx.beginPath();
        ctx.arc(
          entity.x,
          entity.y,
          entity.radius * 0.85,
          -Math.PI / 2 + gap / 2,
          -Math.PI / 2 - gap / 2 + Math.PI * 2
        );
        ctx.lineWidth = entity.radius * 0.32;
        ctx.stroke();
        break;
      }

      case 'LANDOLT_OPEN_BOTTOM': {
        // C ring with gap at bottom (PI/2)
        const gap = Math.PI * 0.32;
        ctx.beginPath();
        ctx.arc(
          entity.x,
          entity.y,
          entity.radius * 0.85,
          Math.PI / 2 + gap / 2,
          Math.PI / 2 - gap / 2 + Math.PI * 2
        );
        ctx.lineWidth = entity.radius * 0.32;
        ctx.stroke();
        break;
      }
    }
  }

  ctx.restore();
}

/**
 * Renders the fixation target for Sustained Fixation on HTML5 2D Canvas.
 */
export function renderFixationTarget(
  ctx: CanvasRenderingContext2D,
  state: FixationTrialState,
  params: FixationParameters,
  options?: {
    color?: string;
    activeColor?: string;
  }
): void {
  const baseColor = options?.color ?? '#818cf8'; // Indigo-400
  const activeColor = options?.activeColor ?? '#38bdf8'; // Sky-400
  const isInside = state.outsideGraceMs <= 90 && state.currentContinuousInsideMs > 0;

  ctx.save();

  // Acceptance aura
  ctx.beginPath();
  ctx.arc(state.x, state.y, state.acceptanceRadius, 0, Math.PI * 2);
  ctx.fillStyle = isInside
    ? 'rgba(56, 189, 248, 0.12)'
    : 'rgba(129, 140, 248, 0.05)';
  ctx.fill();

  // Outer target ring
  ctx.beginPath();
  ctx.arc(state.x, state.y, state.radius, 0, Math.PI * 2);
  ctx.strokeStyle = isInside ? activeColor : baseColor;
  ctx.lineWidth = 3;
  ctx.stroke();

  // Central foveal anchor cross
  const crossSize = state.radius * 0.45;
  ctx.beginPath();
  ctx.moveTo(state.x - crossSize, state.y);
  ctx.lineTo(state.x + crossSize, state.y);
  ctx.moveTo(state.x, state.y - crossSize);
  ctx.lineTo(state.x, state.y + crossSize);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Center bullseye dot
  ctx.beginPath();
  ctx.arc(state.x, state.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = isInside ? '#ffffff' : baseColor;
  ctx.fill();

  // Continuous progress arc
  if (state.currentContinuousInsideMs > 0) {
    const progress = Math.min(
      1,
      state.currentContinuousInsideMs / Math.max(1, params.minimumFixationMs)
    );
    ctx.beginPath();
    ctx.arc(
      state.x,
      state.y,
      state.radius + 6,
      -Math.PI / 2,
      -Math.PI / 2 + progress * Math.PI * 2
    );
    ctx.strokeStyle = '#38bdf8';
    ctx.shadowColor = '#38bdf8';
    ctx.shadowBlur = 10;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  ctx.restore();
}
