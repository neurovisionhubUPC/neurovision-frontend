import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeCognitoProgressView } from '../src/presentation/features/dashboard/utils/patientProgressMetrics.ts';
import type {
  PatientExerciseAvailabilityReason,
  PatientTherapyPlanResponse,
  TherapyExerciseCode,
} from '../src/infrastructure/api/contracts/clinical.contracts.ts';

const EXERCISE_LABELS: Record<TherapyExerciseCode, { title: string; subtitle: string; goal: string }> = {
  'visual-scanning': { title: 'Exploración Visual', subtitle: 'Visual Scanning', goal: '' },
  'visual-search': { title: 'Búsqueda Visual', subtitle: 'Visual Search', goal: '' },
  fixation: { title: 'Fijación Ocular Sostenida', subtitle: 'Sustained Fixation', goal: '' },
};

const MODE_LABELS: Record<string, string> = {
  STANDARD_SCANNING: 'Escaneo Visual Estándar',
  TARGET_SEARCH_WITH_DISTRACTORS: 'Búsqueda con Distractores',
  SUSTAINED_TARGET_FIXATION: 'Fijación Sostenida',
};

const REASON_LABELS: Record<PatientExerciseAvailabilityReason, string> = {
  ACTIVE_SESSION: 'Ya existe una sesión activa en curso.',
  CONFIGURATION_UNAVAILABLE: 'Configuración clínica aún no efectiva.',
  PLAN_QUOTA_EXHAUSTED: 'Límite diario de sesiones del plan alcanzado.',
  EXERCISE_QUOTA_EXHAUSTED: 'Límite diario de este ejercicio completado.',
  DAILY_TARGET_TIME_INSUFFICIENT: 'Tiempo objetivo diario insuficiente para iniciar.',
  DAILY_SAFETY_TIME_INSUFFICIENT: 'Límite de seguridad diario de exposición alcanzado.',
};

function makeBasePlan(
  overrides: Partial<PatientTherapyPlanResponse> = {}
): PatientTherapyPlanResponse {
  return {
    therapyPlanId: 'plan-1',
    status: 'ACTIVE',
    dailySessionLimit: 4,
    dailyTargetDurationMinutes: 20,
    dailyHardSafetyLimitMinutes: 45,
    minimumValidDurationMinutes: 3,
    maximumSessionDurationMinutes: 20,
    minimumValidSampleCount: 100,
    dailyExercisePrescriptions: {
      'visual-scanning': 2,
      'visual-search': 2,
    },
    effectiveConfigurations: [
      {
        configurationId: 'cfg-1',
        exerciseCode: 'visual-scanning',
        version: 1,
        effectiveFrom: '2026-11-20T00:00:00Z',
        parameterSchemaVersion: 1,
        parameters: {
          mode: 'STANDARD_SCANNING',
          affectedHemifield: 'LEFT',
          minimumFixationMs: 300,
          maximumStimulusDurationMs: 4000,
          eccentricityDegrees: 15,
          targetSizePx: 40,
          repetitions: 10,
          interStimulusIntervalMs: 500,
          difficultyLevel: 1,
        },
      },
      {
        configurationId: 'cfg-2',
        exerciseCode: 'visual-search',
        version: 1,
        effectiveFrom: '2026-11-20T00:00:00Z',
        parameterSchemaVersion: 1,
        parameters: {
          mode: 'TARGET_SEARCH_WITH_DISTRACTORS',
          affectedHemifield: 'LEFT',
          targetCount: 4,
          distractorCount: 8,
          minimumFixationMs: 300,
          maximumSearchTimeMs: 8000,
          affectedHemifieldBias: 0.7,
          targetSizePx: 40,
          difficultyLevel: 1,
        },
      },
    ],
    dailyAvailability: {
      quotaDate: '2026-11-20',
      evaluatedAt: '2026-11-20T12:00:00Z',
      remainingPlanSessionSlots: 2,
      exercises: [
        {
          exerciseCode: 'visual-scanning',
          remainingPrescribedSlots: 1,
          status: 'AVAILABLE',
          reason: null,
        },
        {
          exerciseCode: 'visual-search',
          remainingPrescribedSlots: 1,
          status: 'AVAILABLE',
          reason: null,
        },
      ],
    },
    ...overrides,
  };
}

describe('computeCognitoProgressView', () => {
  it('computes complete numeric availability accurately', () => {
    const plan = makeBasePlan();
    const view = computeCognitoProgressView([plan], EXERCISE_LABELS, MODE_LABELS, REASON_LABELS);

    assert.ok(view);
    assert.equal(view.remainingSlots, 2);
    assert.equal(view.completedTodaySessions, 2);
    assert.equal(view.dailyCompletionPercentage, 50);
    assert.equal(view.totalCompletedRunsToday, 2);
    assert.equal(view.totalPrescribedRunsToday, 4);
    assert.equal(view.planCompletionPercentage, 50);
    assert.equal(view.hasIncompleteAvailability, false);

    assert.equal(view.items.length, 2);
    assert.equal(view.items[0].completedRunsToday, 1);
    assert.equal(view.items[0].remainingRunsToday, 1);
    assert.equal(view.items[0].runCompletionPercentage, 50);
    assert.equal(view.items[0].availabilityStatus, 'AVAILABLE');
  });

  it('preserves null slots and CHECK_AT_START without coercing to 0 or 100%', () => {
    const plan = makeBasePlan({
      dailyAvailability: {
        quotaDate: '2026-11-20',
        evaluatedAt: '2026-11-20T12:00:00Z',
        remainingPlanSessionSlots: null,
        exercises: [
          {
            exerciseCode: 'visual-scanning',
            remainingPrescribedSlots: null,
            status: 'CHECK_AT_START',
            reason: 'ACTIVE_SESSION',
          },
          {
            exerciseCode: 'visual-search',
            remainingPrescribedSlots: null,
            status: 'CHECK_AT_START',
            reason: 'ACTIVE_SESSION',
          },
        ],
      },
    });

    const view = computeCognitoProgressView([plan], EXERCISE_LABELS, MODE_LABELS, REASON_LABELS);

    assert.ok(view);
    assert.equal(view.remainingSlots, null);
    assert.equal(view.completedTodaySessions, null);
    assert.equal(view.dailyCompletionPercentage, null);
    assert.equal(view.totalCompletedRunsToday, null);
    assert.equal(view.planCompletionPercentage, null);
    assert.equal(view.hasIncompleteAvailability, true);

    for (const item of view.items) {
      assert.equal(item.remainingRunsToday, null);
      assert.equal(item.completedRunsToday, null);
      assert.equal(item.runCompletionPercentage, null);
      assert.equal(item.availabilityStatus, 'CHECK_AT_START');
      assert.equal(item.reason, REASON_LABELS.ACTIVE_SESSION);
    }
  });

  it('sets totalCompletedRunsToday and planCompletionPercentage to null when mixed remainingPrescribedSlots has null', () => {
    const plan = makeBasePlan({
      dailyAvailability: {
        quotaDate: '2026-11-20',
        evaluatedAt: '2026-11-20T12:00:00Z',
        remainingPlanSessionSlots: 3,
        exercises: [
          {
            exerciseCode: 'visual-scanning',
            remainingPrescribedSlots: 1,
            status: 'AVAILABLE',
            reason: null,
          },
          {
            exerciseCode: 'visual-search',
            remainingPrescribedSlots: null,
            status: 'CHECK_AT_START',
            reason: null,
          },
        ],
      },
    });

    const view = computeCognitoProgressView([plan], EXERCISE_LABELS, MODE_LABELS, REASON_LABELS);

    assert.ok(view);
    assert.equal(view.dailyCompletionPercentage, 25);
    assert.equal(view.completedTodaySessions, 1);
    assert.equal(view.totalCompletedRunsToday, null);
    assert.equal(view.planCompletionPercentage, null);
    assert.equal(view.hasIncompleteAvailability, true);

    assert.equal(view.items[0].completedRunsToday, 1);
    assert.equal(view.items[0].runCompletionPercentage, 50);
    assert.equal(view.items[1].remainingRunsToday, null);
    assert.equal(view.items[1].completedRunsToday, null);
    assert.equal(view.items[1].runCompletionPercentage, null);
  });

  it('treats explicit 0 slots as 100% completed and BLOCKED', () => {
    const plan = makeBasePlan({
      dailyAvailability: {
        quotaDate: '2026-11-20',
        evaluatedAt: '2026-11-20T12:00:00Z',
        remainingPlanSessionSlots: 0,
        exercises: [
          {
            exerciseCode: 'visual-scanning',
            remainingPrescribedSlots: 0,
            status: 'BLOCKED',
            reason: 'PLAN_QUOTA_EXHAUSTED',
          },
          {
            exerciseCode: 'visual-search',
            remainingPrescribedSlots: 0,
            status: 'BLOCKED',
            reason: 'EXERCISE_QUOTA_EXHAUSTED',
          },
        ],
      },
    });

    const view = computeCognitoProgressView([plan], EXERCISE_LABELS, MODE_LABELS, REASON_LABELS);

    assert.ok(view);
    assert.equal(view.remainingSlots, 0);
    assert.equal(view.completedTodaySessions, 4);
    assert.equal(view.dailyCompletionPercentage, 100);
    assert.equal(view.totalCompletedRunsToday, 4);
    assert.equal(view.planCompletionPercentage, 100);
    assert.equal(view.hasIncompleteAvailability, false);
    assert.equal(view.items[0].availabilityStatus, 'BLOCKED');
    assert.equal(view.items[0].completedRunsToday, 2);
    assert.equal(view.items[0].runCompletionPercentage, 100);
  });
});
