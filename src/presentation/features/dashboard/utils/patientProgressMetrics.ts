import type {
  PatientExerciseAvailabilityReason,
  PatientExerciseAvailabilityStatus,
  PatientTherapyPlanResponse,
  TherapyExerciseCode,
  VersionedConfiguration,
} from '../../../../infrastructure/api/contracts/clinical.contracts.ts';

export interface ExerciseLabelMeta {
  title: string;
  subtitle?: string;
  goal?: string;
}

export interface CognitoProgressItem {
  exerciseCode: TherapyExerciseCode;
  exerciseTitle: string;
  modeLabel: string;
  completedRunsToday: number | null;
  dailyTargetRuns: number | null;
  remainingRunsToday: number | null;
  runCompletionPercentage: number | null;
  availabilityStatus: PatientExerciseAvailabilityStatus;
  reason: string | null;
}

export interface CognitoProgressView {
  plan: PatientTherapyPlanResponse;
  dailyCompletionPercentage: number | null;
  planCompletionPercentage: number | null;
  completedTodaySessions: number | null;
  remainingSlots: number | null;
  dailyLimit: number;
  totalCompletedRunsToday: number | null;
  totalPrescribedRunsToday: number;
  hasIncompleteAvailability: boolean;
  items: CognitoProgressItem[];
}

function extractExerciseMode(config: VersionedConfiguration): string {
  if (config.parameterSchemaVersion === 2) {
    return config.parameters.parameters.mode;
  }
  return config.parameters.mode;
}

/**
 * Derives daily and per-exercise progress metrics from `PatientTherapyPlanResponse[]`
 * without coercing `null` slot counts or `CHECK_AT_START` states to `0` or `1`.
 */
export function computeCognitoProgressView(
  plans: PatientTherapyPlanResponse[],
  exerciseLabels: Record<TherapyExerciseCode, ExerciseLabelMeta>,
  modeLabels: Record<string, string>,
  reasonLabels: Record<PatientExerciseAvailabilityReason, string>
): CognitoProgressView | null {
  if (!Array.isArray(plans) || plans.length === 0) {
    return null;
  }

  const activePlan = plans.find((p) => p.status === 'ACTIVE') || plans[0];
  const dailyLimit = activePlan.dailySessionLimit;
  const remainingSlots = activePlan.dailyAvailability.remainingPlanSessionSlots;

  const completedTodaySessions =
    remainingSlots !== null && dailyLimit > 0
      ? Math.max(0, dailyLimit - remainingSlots)
      : null;

  const dailyCompletionPercentage =
    completedTodaySessions !== null && dailyLimit > 0
      ? Math.min(100, Math.round((completedTodaySessions / dailyLimit) * 100))
      : null;

  const items: CognitoProgressItem[] = activePlan.effectiveConfigurations.map((cfg) => {
    const meta = exerciseLabels[cfg.exerciseCode] || {
      title: cfg.exerciseCode,
      subtitle: cfg.exerciseCode,
      goal: '',
    };
    const mode = extractExerciseMode(cfg);
    const avail = activePlan.dailyAvailability.exercises.find(
      (e) => e.exerciseCode === cfg.exerciseCode
    );

    const dailyTargetRuns = activePlan.dailyExercisePrescriptions?.[cfg.exerciseCode] ?? null;
    const remainingRunsToday = avail ? avail.remainingPrescribedSlots : null;
    const completedRunsToday =
      remainingRunsToday !== null && dailyTargetRuns !== null
        ? Math.max(0, dailyTargetRuns - remainingRunsToday)
        : null;
    const runCompletionPercentage =
      completedRunsToday !== null && dailyTargetRuns !== null && dailyTargetRuns > 0
        ? Math.min(100, Math.round((completedRunsToday / dailyTargetRuns) * 100))
        : null;
    const availabilityStatus: PatientExerciseAvailabilityStatus =
      avail?.status ?? (activePlan.status === 'ACTIVE' ? 'CHECK_AT_START' : 'BLOCKED');

    return {
      exerciseCode: cfg.exerciseCode,
      exerciseTitle: meta.title,
      modeLabel: modeLabels[mode] || mode,
      completedRunsToday,
      dailyTargetRuns,
      remainingRunsToday,
      runCompletionPercentage,
      availabilityStatus,
      reason: avail?.reason ? reasonLabels[avail.reason] || avail.reason : null,
    };
  });

  const hasIncompleteAvailability =
    remainingSlots === null ||
    items.some(
      (it) => it.remainingRunsToday === null || it.availabilityStatus === 'CHECK_AT_START'
    );

  const totalPrescribedRunsToday = items.reduce(
    (acc, it) => acc + (it.dailyTargetRuns ?? 0),
    0
  );

  const hasUnknownPrescribedItem = items.some(
    (it) =>
      it.dailyTargetRuns !== null &&
      it.dailyTargetRuns > 0 &&
      it.completedRunsToday === null
  );

  const totalCompletedRunsToday = hasUnknownPrescribedItem
    ? null
    : items.reduce((acc, it) => acc + (it.completedRunsToday ?? 0), 0);

  const planCompletionPercentage = hasUnknownPrescribedItem
    ? null
    : totalPrescribedRunsToday > 0 && totalCompletedRunsToday !== null
      ? Math.min(100, Math.round((totalCompletedRunsToday / totalPrescribedRunsToday) * 100))
      : dailyCompletionPercentage;

  return {
    plan: activePlan,
    dailyCompletionPercentage,
    planCompletionPercentage,
    completedTodaySessions,
    remainingSlots,
    dailyLimit,
    totalCompletedRunsToday,
    totalPrescribedRunsToday,
    hasIncompleteAvailability,
    items,
  };
}
