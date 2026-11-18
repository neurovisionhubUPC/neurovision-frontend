export interface ClinicalAuthHeaders {
  Authorization: `Bearer ${string}`;
}

export interface RehabilitationContextPatchHeaders extends ClinicalAuthHeaders {
  'Content-Type': 'application/json';
}

export interface ClinicalPatientPathParams {
  clinicalPatientId: string;
}

export interface AssignedPatientsQueryParams {
  page?: number;
  size?: number;
}

export type ClinicalPatientStatus = 'PENDING_ASSESSMENT' | 'ACTIVE';

export type AssignedPatientName =
  | { nameStatus: 'AVAILABLE'; firstName: string; lastName: string }
  | { nameStatus: 'MISSING' | 'PENDING_COMPLETION'; firstName: null; lastName: null };

export type AssignedPatient = AssignedPatientName & {
  clinicalPatientId: string;
  status: ClinicalPatientStatus;
  createdAt: string;
  updatedAt: string;
};

export interface AssignedPatientsResponse {
  patients: AssignedPatient[];
  page: number;
  size: number;
  total: number;
}

export type AssignedPatientDetailResponse = AssignedPatient & {
  strokeDiagnosis: string | null;
  sequelae: string[];
};

export type AffectedHemifield = 'LEFT' | 'RIGHT';

export interface RehabilitationContextResponse {
  clinicalPatientId: string;
  version: number;
  updatedAt: string;
  affectedHemifield: AffectedHemifield | null;
  previousDiagnosis: string | null;
  sequelae: string[];
  observations: string | null;
}

/** Omission preserves a field; null clears it. Send at least one context field. */
export interface RehabilitationContextPatchBody {
  expectedVersion: number;
  affectedHemifield?: AffectedHemifield | null;
  previousDiagnosis?: string | null;
  sequelae?: string[] | null;
  observations?: string | null;
}

/** Controller-mapped errors only; framework errors may use a different shape. */
export interface ClinicalPatientApiErrorResponse {
  code:
    | `PATIENT_READ_${'INVALID_REQUEST' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'UNAVAILABLE'}`
    | `REHABILITATION_CONTEXT_${'INVALID_REQUEST' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'CONFLICT' | 'UNAVAILABLE'}`;
}

export interface ClinicalJsonHeaders extends ClinicalAuthHeaders {
  'Content-Type': 'application/json';
}

export interface TherapyPlanPathParams extends ClinicalPatientPathParams {
  therapyPlanId: string;
}

export type TherapyPlanStatus = 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
export type TherapyExerciseCode = 'visual-scanning' | 'visual-search' | 'fixation';
export type DailyExercisePrescriptions = Partial<Record<TherapyExerciseCode, number>>;

export interface TherapyPlansQueryParams {
  page?: number;
  size?: number;
  status?: TherapyPlanStatus;
}

export interface CreateTherapyPlanBody {
  dailySessionLimit: number;
  dailyTargetDurationMinutes: number;
  dailyHardSafetyLimitMinutes?: number | null;
  minimumValidDurationMinutes: number;
  maximumSessionDurationMinutes: number;
  minimumValidSampleCount: number;
  dailyExercisePrescriptions: DailyExercisePrescriptions;
}

export interface TherapyPlanSummary {
  therapyPlanId: string;
  status: TherapyPlanStatus;
  configurationVersion: number;
}

export interface TherapyPlansResponse extends ClinicalPatientPathParams {
  plans: TherapyPlanSummary[];
  page: number;
  size: number;
  total: number;
}

export interface TherapyPlanResponse extends TherapyPlanSummary, ClinicalPatientPathParams, CreateTherapyPlanBody {
  dailyHardSafetyLimitMinutes: number | null;
}

export interface VisualScanningParameters {
  mode: 'STANDARD_SCANNING' | 'SYSTEMATIC_EXPLORATION' | 'COMPENSATORY_SACCADE';
  affectedHemifield: AffectedHemifield;
  minimumFixationMs: number;
  maximumStimulusDurationMs: number;
  eccentricityDegrees: number;
  targetSizePx: number;
  repetitions: number;
  interStimulusIntervalMs: number;
  difficultyLevel: number;
}

export interface VisualSearchParameters {
  mode: 'TARGET_SEARCH_WITH_DISTRACTORS';
  affectedHemifield: AffectedHemifield;
  targetCount: number;
  distractorCount: number;
  minimumFixationMs: number;
  maximumSearchTimeMs: number;
  affectedHemifieldBias: number;
  targetSizePx: number;
  difficultyLevel: number;
}

export interface FixationParameters {
  mode: 'SUSTAINED_TARGET_FIXATION';
  targetPosition: 'CENTER' | 'LEFT' | 'RIGHT' | 'RANDOM';
  minimumFixationMs: number;
  maximumFixationMs: number;
  targetSizePx: number;
  repetitions: number;
  restBetweenRepetitionsMs: number;
  difficultyLevel: number;
}

export interface TherapyCompletionTarget {
  criterion: 'ACTIVE_TIME' | 'REPETITIONS';
  /** Seconds for ACTIVE_TIME; count for REPETITIONS. */
  target: number;
}

export interface ParametersByExercise {
  'visual-scanning': VisualScanningParameters;
  'visual-search': VisualSearchParameters;
  fixation: FixationParameters;
}

export type VersionedConfiguration = {
  [Code in TherapyExerciseCode]: { exerciseCode: Code } & (
    | { parameterSchemaVersion: 1; parameters: ParametersByExercise[Code] }
    | { parameterSchemaVersion: 2; parameters: {
        parameters: ParametersByExercise[Code];
        completionTarget: TherapyCompletionTarget;
      } }
  )
}[TherapyExerciseCode];

export type AppendTherapeuticConfigurationBody = VersionedConfiguration & { effectiveFrom: string };

export interface TherapeuticConfigurationResponse {
  configurationId: string;
  therapyPlanId: string;
  exerciseCode: TherapyExerciseCode;
  version: number;
  parameterSchemaVersion: 1 | 2;
  effectiveFrom: string;
  status: 'ACTIVE' | 'REVOKED';
}

export type TherapyPlanDetailResponse = TherapyPlanResponse & {
  configurations: EffectiveTherapeuticConfiguration[];
};

/** Read responses also include the serialized parameters; keep the schema and exercise discriminators. */
export type EffectiveTherapeuticConfiguration = TherapeuticConfigurationResponse & VersionedConfiguration;

export type TherapyPlanStopStatus = Exclude<TherapyPlanStatus, 'ACTIVE'>;

export interface TherapyPlanRevisionChanges {
  dailySessionLimit?: number;
  dailyTargetDurationMinutes?: number;
  dailyHardSafetyLimitMinutes?: number;
  dailyExercisePrescriptions?: DailyExercisePrescriptions;
  status?: TherapyPlanStopStatus;
  clinicalReason?: string;
}

export interface ReviseTherapyPlanBody extends TherapyPlanRevisionChanges {
  commandId: string;
}

export interface TherapyPlanRevisionResponse {
  commandId: string;
  therapyPlanId: string;
  idempotentReplay: boolean;
  revisions: {
    revisionId: string;
    sequence: number;
    kind: 'IMMEDIATE' | 'DEFERRED';
    effectiveFrom: string;
    changes: TherapyPlanRevisionChanges;
  }[];
}

export interface TherapyPlanApiErrorResponse {
  code:
    | `PLAN_READ_${'INVALID_REQUEST' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'UNAVAILABLE'}`
    | `PLAN_REVISION_${'INVALID_REQUEST' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'CONFLICT' | 'UNAVAILABLE'}`;
}

export interface PatientTherapyPlanPathParams {
  therapyPlanId: string;
}

export interface PatientTherapySessionPathParams {
  therapySessionId: string;
}

export interface PatientSessionIdempotentHeaders extends ClinicalJsonHeaders {
  'Idempotency-Key': string;
}

export type PatientExerciseAvailabilityStatus = 'AVAILABLE' | 'BLOCKED' | 'CHECK_AT_START';
export type PatientExerciseAvailabilityReason =
  | 'ACTIVE_SESSION'
  | 'CONFIGURATION_UNAVAILABLE'
  | 'PLAN_QUOTA_EXHAUSTED'
  | 'EXERCISE_QUOTA_EXHAUSTED'
  | 'DAILY_TARGET_TIME_INSUFFICIENT'
  | 'DAILY_SAFETY_TIME_INSUFFICIENT';

export interface PatientDailyAvailability {
  quotaDate: string;
  evaluatedAt: string;
  remainingPlanSessionSlots: number | null;
  exercises: {
    exerciseCode: TherapyExerciseCode;
    remainingPrescribedSlots: number | null;
    status: PatientExerciseAvailabilityStatus;
    reason: PatientExerciseAvailabilityReason | null;
  }[];
}

export type PatientEffectiveConfiguration = VersionedConfiguration & {
  configurationId: string;
  version: number;
  effectiveFrom: string;
};

export type PatientTherapyPlanResponse = Omit<TherapyPlanResponse, 'clinicalPatientId' | 'configurationVersion'> & {
  effectiveConfigurations: PatientEffectiveConfiguration[];
  dailyAvailability: PatientDailyAvailability;
};

export interface StartPatientTherapySessionBody {
  exerciseCode: TherapyExerciseCode;
}

export type PatientTherapySessionStatus =
  | 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'ABANDONED' | 'FAILED_TECHNICAL';

export interface PatientSessionLimits {
  minimumValidDurationMinutes: number;
  maximumSessionDurationMinutes: number;
  minimumValidSampleCount: number;
}

export type PatientFrozenSession = VersionedConfiguration & {
  therapySessionId: string;
  therapyPlanId: string;
  status: PatientTherapySessionStatus;
  quotaDate: string;
  configurationId: string;
  configurationVersion: number;
  startedAt: string;
};

export type PatientTherapySessionResponse = PatientFrozenSession & PatientSessionLimits & {
  leaseExpiresAt: string | null;
};

export type PatientCurrentSessionResponse = { evaluatedAt: string } & (
  | { state: 'NONE'; session: null }
  | { state: 'ACTIVE' | 'EXPIRED'; session: PatientTherapySessionResponse }
);

export interface PatientTechnicalProgress {
  criterion: TherapyCompletionTarget['criterion'];
  target: number;
  activeMilliseconds: number;
  completedRepetitions: number;
  targetReached: boolean;
}

export type PatientTherapySessionDetailResponse = PatientFrozenSession & {
  endedAt: string | null;
  activeDurationSeconds: number;
  sessionLimits: PatientSessionLimits;
  technicalProgress: PatientTechnicalProgress | null;
};

export type PatientActivityEventBody = {
  schemaVersion: 1;
  eventId: string;
  sequence: number;
} & (
  | { type: 'ACTIVITY_STARTED' | 'HEARTBEAT' | 'PAUSED' | 'RESUMED' }
  | { type: 'REPETITION_STARTED' | 'REPETITION_FINISHED'; repetitionId: string; repetitionIndex: number }
);

export interface PatientSessionCompletionBody {
  action: 'FINISHED' | 'ABANDONED';
}

export interface PatientSessionProgressResponse extends PatientTechnicalProgress {
  therapySessionId: string;
  status: PatientTherapySessionStatus;
  nextSequence: number;
  activityState: 'NEW' | 'ACTIVE' | 'PAUSED' | 'RESUME_REQUIRED';
  endedAt: string | null;
}

export interface PatientTherapyApiErrorResponse {
  code:
    | 'PATIENT_THERAPY_AVAILABILITY_UNAVAILABLE'
    | `PATIENT_CURRENT_SESSION_${'UNAUTHENTICATED' | 'FORBIDDEN' | 'UNAVAILABLE'}`
    | `PATIENT_SESSION_DETAIL_${'INVALID_REQUEST' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'UNAVAILABLE'}`
    | `SESSION_PROGRESS_${'INVALID_REQUEST' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'CONFLICT' | 'UNAVAILABLE'}`;
}

export interface DoctorTherapySessionPathParams extends ClinicalPatientPathParams {
  therapySessionId: string;
}

export interface DoctorTherapySessionsQueryParams {
  page?: number;
  size?: number;
  exerciseCode?: TherapyExerciseCode;
  status?: PatientTherapySessionStatus;
  /** Offset-aware date-time; inclusive lower bound on startedAt. */
  from?: string;
  /** Offset-aware date-time; exclusive upper bound on startedAt. */
  to?: string;
}

export interface DoctorTherapySessionSummary {
  therapySessionId: string;
  therapyPlanId: string;
  exerciseCode: TherapyExerciseCode;
  status: PatientTherapySessionStatus;
  startedAt: string;
  endedAt: string | null;
  activeDurationSeconds: number;
  quotaDate: string;
  configurationId: string;
  configurationVersion: number;
  parameterSchemaVersion: 1 | 2;
}

export interface DoctorTherapySessionsResponse extends ClinicalPatientPathParams {
  sessions: DoctorTherapySessionSummary[];
  page: number;
  size: number;
  total: number;
}

export type DoctorSessionTechnicalProgress =
  | ({ availability: 'AVAILABLE' } & PatientTechnicalProgress)
  | {
      availability: 'NOT_APPLICABLE';
      criterion: null;
      target: null;
      activeMilliseconds: null;
      completedRepetitions: null;
      targetReached: null;
    };

type DoctorFrozenConfiguration<T extends VersionedConfiguration = VersionedConfiguration> =
  T extends VersionedConfiguration
    ? Omit<T, 'parameters'> & { configurationParameters: T['parameters'] }
    : never;

export type DoctorTherapySessionDetailResponse =
  Omit<DoctorTherapySessionSummary, 'exerciseCode' | 'parameterSchemaVersion'>
  & ClinicalPatientPathParams & DoctorFrozenConfiguration & {
    sessionLimits: PatientSessionLimits;
    technicalProgress: DoctorSessionTechnicalProgress;
  };

export interface DoctorTherapySessionApiErrorResponse {
  code: `SESSION_READ_${'INVALID_REQUEST' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'UNAVAILABLE'}`;
}

export interface DoctorReportSnapshotPathParams extends DoctorTherapySessionPathParams {
  reportSnapshotId: string;
}

export interface CreateDoctorReportSnapshotHeaders extends ClinicalAuthHeaders {
  'Idempotency-Key': string;
}

export type ReportDataOrigin = 'SYNTHETIC' | 'PRODUCER_REPORTED';
export type ReportSelector =
  | 'visualSearchDataOrigin' | 'standardScanningDataOrigin' | 'sustainedFixationDataOrigin'
  | 'compensatorySaccadeDataOrigin' | 'systematicExplorationDataOrigin';

export type DoctorReportSelectionQuery =
  | Partial<Record<ReportSelector, never>>
  | { [Key in ReportSelector]: Record<Key, ReportDataOrigin>
      & Partial<Record<Exclude<ReportSelector, Key>, never>> }[ReportSelector];

export interface DoctorReportSnapshotsQuery {
  page?: number;
  size?: number;
}

type ReportParameters = VersionedConfiguration['parameters'];
export type ReportMode = ParametersByExercise[TherapyExerciseCode]['mode'];

interface ReportIdentity {
  availability: string;
  firstName: string | null;
  lastName: string | null;
}

interface ReportMetricSource {
  calculationVersion: string;
  therapySessionId: string;
  configurationId: string;
  configurationVersion: number;
  dataOrigin: ReportDataOrigin;
  reportedTrialCount: number;
}

interface ReportProjectionEvidence {
  source: {
    therapySessionId: string;
    streamId: string;
    calculationVersion: string;
    revision: number;
    contractVersion: number;
    sourceSchemaVersion: number;
  };
  completeness: {
    minimumSequence: number;
    maximumSequence: number;
    highSequence: number;
    missingSequenceRangeCount: number;
    missingSequenceRangesTruncated: boolean;
    lateArrivalCount: number;
    unknownSessionBoundary: boolean;
    missingSequenceRanges: { fromInclusive: number; toInclusive: number }[];
    observedTimeRange: { minimum: string; maximum: string } | null;
    sampleCounts: { gaze: number; gameplay: number; total: number };
  };
}

interface ReportNumeric {
  count: number;
  minimum: number | null;
  maximum: number | null;
  mean: number | null;
}

interface ReportOrdered {
  first: number | null;
  last: number | null;
  signedDelta: number | null;
  distribution: ReportNumeric;
}

interface ReportGrid {
  rows: number;
  columns: number;
  cellCounts: number[];
}

export interface DoctorReportStream {
  summary: ReportProjectionEvidence & {
    confidence: ReportNumeric;
    confidenceHistogram: number[];
    heatmap: ReportGrid;
    coverage: {
      occupiedCellCount: number;
      occupiedCellRatio: number;
      boundingBox: {
        minimumX: number; minimumY: number; maximumX: number; maximumY: number;
        width: number; height: number; area: number;
      } | null;
    };
    gazePath: { totalDistance: number; excludedNonPositiveDeltaCount: number; velocity: ReportNumeric };
    gameplay: { playerTargetDistance: ReportNumeric; score: ReportOrdered; speed: ReportOrdered; progress: ReportOrdered };
  };
  heatmap: ReportProjectionEvidence & {
    grid: ReportGrid;
    coordinateSpace: string;
    cellWeight: string;
    confidenceFiltered: boolean;
  };
  gazePlot: ReportProjectionEvidence & {
    pageSize: number;
    sourceBatchScanLimit: number;
    startsAtBeginning: boolean;
    hasNext: boolean;
    points: {
      sequence: number; gazeSampleIndex: number; effectiveTime: string;
      x: number; y: number; confidence: number; segmentBreakBefore: boolean;
    }[];
  };
}

export type DoctorReportAnalytics = { therapySessionId: string } & (
  | { availability: 'CONFIRMED_NO_EVIDENCE'; streams: [] }
  | { availability: 'OBSERVED_EVIDENCE'; streams: DoctorReportStream[];
      discoveryPage: number; discoverySize: number; hasNext: boolean }
);

export interface DoctorSessionReport {
  schemaVersion: 1;
  clinicalPatientId: string;
  issuedAt: string;
  mode: ReportMode;
  analyticsNotice: string | null;
  doctor: ReportIdentity & { specialty: string | null; medicalLicense: string | null };
  patient: ReportIdentity;
  execution: {
    therapySessionId: string; therapyPlanId: string; status: 'COMPLETED';
    startedAt: string; endedAt: string; activeDurationSeconds: number; quotaDate: string;
  };
  configuration: {
    configurationId: string;
    configurationVersion: number;
    parameterSchemaVersion: 1 | 2;
    parameters: ReportParameters;
  };
  sessionLimits: PatientSessionLimits;
  technicalProgress: DoctorSessionTechnicalProgress;
  analytics: DoctorReportAnalytics;
  visualSearch?: ReportMetricSource & {
    hitCount: number; omissionCount: number; interruptedCount: number;
    eligibleSearchCount: number; medianSearchDurationMs: number | null;
  };
  standardScanning?: ReportMetricSource & {
    detectedTargetCount: number; omissionCount: number; interruptedCount: number;
    eligibleLocalizationCount: number; medianLocalizationDurationMs: number | null;
  };
  sustainedFixation?: ReportMetricSource & { totalInsideTargetMs: number; completedTargetCount: number };
  compensatorySaccade?: ReportMetricSource & { reachedTargetCount: number; medianTimeToTargetMs: number | null };
  systematicExploration?: ReportMetricSource & {
    traversals: {
      trialId: string; outcome: 'COMPLETED' | 'TIMED_OUT' | 'INTERRUPTED';
      visitedRegionCount: number; coveragePercent: number; elapsedMs: number;
    }[];
  };
}

export interface DoctorReportSnapshotMetadata {
  reportSnapshotId: string;
  createdAt: string;
}

export interface DoctorReportSnapshotResponse extends DoctorReportSnapshotMetadata {
  report: DoctorSessionReport;
}

export interface DoctorReportSnapshotsResponse extends DoctorTherapySessionPathParams {
  page: number;
  size: number;
  total: number;
  snapshots: DoctorReportSnapshotMetadata[];
}

/** Binary HTTP response; Blob is the browser representation, not JSON. */
export type DoctorReportPdf = Blob;

type ReportReadError = 'INVALID_REQUEST' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'UNAVAILABLE';

export interface DoctorReportApiErrorResponse {
  code: `SESSION_REPORT_${ReportReadError}`
    | `SESSION_REPORT_SNAPSHOT_${ReportReadError | 'NOT_FOUND' | 'SELECTION_CONFLICT'}`;
}
