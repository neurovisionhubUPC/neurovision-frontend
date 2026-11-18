import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  CheckCircle2,
  Calendar,
  Shield,
  Dumbbell,
  Timer,
  Lock,
  Sliders,
  ArrowLeft,
  AlertCircle,
  Loader2,
  PlusCircle,
  RefreshCw,
  Send,
  Layers,
} from 'lucide-react';
import { useAppStore } from '../../../../core/store/useAppStore';
import type { Patient } from '../../../../core/domain/Patient';
import {
  clinicalApi,
  createUuid,
  extractApiErrorMessage,
  type AffectedHemifield,
  type AppendTherapeuticConfigurationBody,
  type AssignedPatientDetailResponse,
  type CreateTherapyPlanBody,
  type DailyExercisePrescriptions,
  type EffectiveTherapeuticConfiguration,
  type FixationParameters,
  type RehabilitationContextResponse,
  type ReviseTherapyPlanBody,
  type TherapyCompletionTarget,
  type TherapyExerciseCode,
  type TherapyPlanDetailResponse,
  type TherapyPlanStopStatus,
  type VisualScanningParameters,
  type VisualSearchParameters,
} from '../../../../infrastructure/api';
import { SpecialistHeader } from '../components/SpecialistHeader';

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampFloat(value: number, min: number, max: number, decimals = 2): number {
  if (!Number.isFinite(value)) return min;
  const clamped = Math.min(max, Math.max(min, value));
  return Number(clamped.toFixed(decimals));
}

function sanitizeScanningParams(raw: VisualScanningParameters): VisualScanningParameters {
  return {
    mode: raw.mode,
    affectedHemifield: raw.affectedHemifield === 'RIGHT' ? 'RIGHT' : 'LEFT',
    minimumFixationMs: clampInt(raw.minimumFixationMs, 300, 2000),
    maximumStimulusDurationMs: clampInt(raw.maximumStimulusDurationMs, 2000, 10000),
    eccentricityDegrees: clampInt(raw.eccentricityDegrees, 5, 30),
    targetSizePx: clampInt(raw.targetSizePx, 30, 150),
    repetitions: clampInt(raw.repetitions, 5, 50),
    interStimulusIntervalMs: clampInt(raw.interStimulusIntervalMs, 500, 3000),
    difficultyLevel: clampInt(raw.difficultyLevel, 1, 5),
  };
}

function sanitizeSearchParams(raw: VisualSearchParameters): VisualSearchParameters {
  return {
    mode: 'TARGET_SEARCH_WITH_DISTRACTORS',
    affectedHemifield: raw.affectedHemifield === 'RIGHT' ? 'RIGHT' : 'LEFT',
    targetCount: clampInt(raw.targetCount, 5, 40),
    distractorCount: clampInt(raw.distractorCount, 0, 20),
    minimumFixationMs: clampInt(raw.minimumFixationMs, 300, 2000),
    maximumSearchTimeMs: clampInt(raw.maximumSearchTimeMs, 3000, 20000),
    affectedHemifieldBias: clampFloat(raw.affectedHemifieldBias, 0.5, 1.0, 2),
    targetSizePx: clampInt(raw.targetSizePx, 30, 150),
    difficultyLevel: clampInt(raw.difficultyLevel, 1, 5),
  };
}

function sanitizeFixationParams(raw: FixationParameters): FixationParameters {
  const minimumFixationMs = clampInt(raw.minimumFixationMs, 300, 3000);
  const maximumFixationMs = clampInt(
    Math.max(raw.maximumFixationMs, minimumFixationMs),
    Math.max(500, minimumFixationMs),
    5000
  );
  return {
    mode: 'SUSTAINED_TARGET_FIXATION',
    targetPosition: raw.targetPosition,
    minimumFixationMs,
    maximumFixationMs,
    targetSizePx: clampInt(raw.targetSizePx, 30, 150),
    repetitions: clampInt(raw.repetitions, 5, 30),
    restBetweenRepetitionsMs: clampInt(raw.restBetweenRepetitionsMs, 500, 3000),
    difficultyLevel: clampInt(raw.difficultyLevel, 1, 5),
  };
}

function sanitizeCompletionTarget(
  target: TherapyCompletionTarget,
  maxRepetitions: number | null
): TherapyCompletionTarget {
  if (target.criterion === 'ACTIVE_TIME') {
    return {
      criterion: 'ACTIVE_TIME',
      target: clampInt(target.target, 30, 3600),
    };
  }
  const upper = maxRepetitions !== null ? Math.max(1, maxRepetitions) : 100;
  return {
    criterion: 'REPETITIONS',
    target: clampInt(target.target, 1, upper),
  };
}

function buildFallbackPatient(id: string): Patient {
  const shortId = id.slice(0, 8).toUpperCase();
  return {
    id,
    initials: 'PX',
    name: `Paciente ${shortId}`,
    medicalRecordNumber: `#${shortId}`,
    nationalId: 'Sincronizado',
    age: 0,
    gender: 'Otro',
    affectedHemifield: 'LEFT',
    hemifieldDetail: 'Contexto clínico',
    accountStatus: 'ACTIVE',
    lastSession: {
      timestampText: 'Sin sesiones',
      durationMinutes: 0,
      moduleName: 'Sin módulo',
    },
    adherence: { rate: 0, category: 'Regular' },
    riskAlert: { severity: 'NORMAL', label: 'Activo' },
    facility: 'NeuroVisión Clinical',
    shift: 'Consulta Externa',
  };
}

export const TherapeuticPrescriptionPage: React.FC = () => {
  const { patientId } = useParams<{ patientId?: string }>();
  const navigate = useNavigate();
  const { patients, authMode, accessToken, updatePatient, setPrescription } = useAppStore();
  const isCognitoMode = authMode === 'COGNITO' && Boolean(accessToken);

  const effectivePatientId = patientId || patients[0]?.id || 'pat-000';

  // Estado remoto en modo COGNITO
  const [patientDetail, setPatientDetail] = useState<AssignedPatientDetailResponse | null>(null);
  const [rehabContext, setRehabContext] = useState<RehabilitationContextResponse | null>(null);
  const [existingPlans, setExistingPlans] = useState<TherapyPlanDetailResponse[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [createNewPlanMode, setCreateNewPlanMode] = useState<boolean>(false);
  const [isLoadingRemote, setIsLoadingRemote] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const currentPatient: Patient = useMemo(() => {
    const found = patients.find(
      (p) =>
        p.id === effectivePatientId ||
        p.medicalRecordNumber.replace('#', '') === effectivePatientId
    );
    if (isCognitoMode && patientDetail) {
      const fullName =
        patientDetail.nameStatus === 'AVAILABLE'
          ? `${patientDetail.firstName} ${patientDetail.lastName}`.trim() || found?.name || 'Paciente'
          : found?.name || `Paciente ${effectivePatientId.slice(0, 8).toUpperCase()}`;
      const initials =
        patientDetail.nameStatus === 'AVAILABLE'
          ? `${patientDetail.firstName?.[0] ?? ''}${patientDetail.lastName?.[0] ?? ''}`.toUpperCase() || 'PX'
          : found?.initials || 'PX';
      return {
        ...(found ?? buildFallbackPatient(effectivePatientId)),
        id: patientDetail.clinicalPatientId,
        name: fullName,
        initials,
        affectedHemifield: rehabContext?.affectedHemifield ?? found?.affectedHemifield ?? 'LEFT',
        primaryDiagnosisTitle:
          patientDetail.strokeDiagnosis ??
          rehabContext?.previousDiagnosis ??
          found?.primaryDiagnosisTitle,
      };
    }
    return found || patients[0] || buildFallbackPatient(effectivePatientId);
  }, [patients, effectivePatientId, isCognitoMode, patientDetail, rehabContext]);

  const activePlan = useMemo(() => {
    if (!selectedPlanId) return existingPlans[0] ?? null;
    return existingPlans.find((p) => p.therapyPlanId === selectedPlanId) ?? existingPlans[0] ?? null;
  }, [existingPlans, selectedPlanId]);

  // === SECTION 1 & 2: Parámetros del Plan Terapéutico (CreateTherapyPlanBody / ReviseTherapyPlanBody) ===
  const [dailySessionLimit, setDailySessionLimit] = useState<number>(3);
  const [dailyTargetDurationMinutes, setDailyTargetDurationMinutes] = useState<number>(15);
  const [useHardSafetyLimit, setUseHardSafetyLimit] = useState<boolean>(true);
  const [dailyHardSafetyLimitMinutes, setDailyHardSafetyLimitMinutes] = useState<number>(30);
  const [minimumValidDurationMinutes, setMinimumValidDurationMinutes] = useState<number>(1);
  const [maximumSessionDurationMinutes, setMaximumSessionDurationMinutes] = useState<number>(20);
  const [minimumValidSampleCount, setMinimumValidSampleCount] = useState<number>(60);
  const [clinicalReason, setClinicalReason] = useState<string>('');
  const [revisionStopStatus, setRevisionStopStatus] = useState<'KEEP_ACTIVE' | TherapyPlanStopStatus>('KEEP_ACTIVE');

  // Metadatos visuales para Mock / referencia clínica
  const [startDate, setStartDate] = useState('2024-10-28');
  const [clinicalNotes, setClinicalNotes] = useState(
    currentPatient.clinicalNotes ||
      'Estimulación compensatoria en hemicampo anópsico. Monitorear síntomas de fatiga visual o astenopía.'
  );
  const [selectedDays, setSelectedDays] = useState<boolean[]>([
    true,
    true,
    true,
    true,
    true,
    false,
    false,
  ]);

  // === SECTION 3: 3 Familias de Ejercicios (Schema v2 exact bounds) ===
  // 3.1 Visual Scanning
  const [scanningEnabled, setScanningEnabled] = useState<boolean>(true);
  const [scanningDailyCount, setScanningDailyCount] = useState<number>(1);
  const [scanningParams, setScanningParams] = useState<VisualScanningParameters>({
    mode: 'STANDARD_SCANNING',
    affectedHemifield: 'LEFT',
    minimumFixationMs: 650,
    maximumStimulusDurationMs: 5000,
    eccentricityDegrees: 20,
    targetSizePx: 64,
    repetitions: 15,
    interStimulusIntervalMs: 1000,
    difficultyLevel: 2,
  });
  const [scanningTarget, setScanningTarget] = useState<TherapyCompletionTarget>({
    criterion: 'REPETITIONS',
    target: 12,
  });

  // 3.2 Visual Search
  const [searchEnabled, setSearchEnabled] = useState<boolean>(true);
  const [searchDailyCount, setSearchDailyCount] = useState<number>(1);
  const [searchParams, setSearchParams] = useState<VisualSearchParameters>({
    mode: 'TARGET_SEARCH_WITH_DISTRACTORS',
    affectedHemifield: 'LEFT',
    targetCount: 12,
    distractorCount: 10,
    minimumFixationMs: 600,
    maximumSearchTimeMs: 10000,
    affectedHemifieldBias: 0.75,
    targetSizePx: 60,
    difficultyLevel: 2,
  });
  const [searchTarget, setSearchTarget] = useState<TherapyCompletionTarget>({
    criterion: 'REPETITIONS',
    target: 10,
  });

  // 3.3 Fixation
  const [fixationEnabled, setFixationEnabled] = useState<boolean>(true);
  const [fixationDailyCount, setFixationDailyCount] = useState<number>(1);
  const [fixationParams, setFixationParams] = useState<FixationParameters>({
    mode: 'SUSTAINED_TARGET_FIXATION',
    targetPosition: 'CENTER',
    minimumFixationMs: 700,
    maximumFixationMs: 2500,
    targetSizePx: 56,
    repetitions: 12,
    restBetweenRepetitionsMs: 1000,
    difficultyLevel: 2,
  });
  const [fixationTarget, setFixationTarget] = useState<TherapyCompletionTarget>({
    criterion: 'REPETITIONS',
    target: 10,
  });

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [mockPlanVersion, setMockPlanVersion] = useState('v1.2');

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  }, []);

  const hydrateFromConfigurations = useCallback(
    (configs: EffectiveTherapeuticConfiguration[], defaultHemifield: AffectedHemifield) => {
      setScanningParams((prev) => ({ ...prev, affectedHemifield: defaultHemifield }));
      setSearchParams((prev) => ({ ...prev, affectedHemifield: defaultHemifield }));

      const scanCfg = configs.find((c) => c.exerciseCode === 'visual-scanning' && c.status === 'ACTIVE') ??
        configs.find((c) => c.exerciseCode === 'visual-scanning');
      if (scanCfg && scanCfg.exerciseCode === 'visual-scanning') {
        const inner =
          scanCfg.parameterSchemaVersion === 2
            ? scanCfg.parameters.parameters
            : scanCfg.parameters;
        const clean = sanitizeScanningParams(inner);
        setScanningParams(clean);
        if (scanCfg.parameterSchemaVersion === 2) {
          setScanningTarget(sanitizeCompletionTarget(scanCfg.parameters.completionTarget, clean.repetitions));
        }
      }

      const searchCfg = configs.find((c) => c.exerciseCode === 'visual-search' && c.status === 'ACTIVE') ??
        configs.find((c) => c.exerciseCode === 'visual-search');
      if (searchCfg && searchCfg.exerciseCode === 'visual-search') {
        const inner =
          searchCfg.parameterSchemaVersion === 2
            ? searchCfg.parameters.parameters
            : searchCfg.parameters;
        const clean = sanitizeSearchParams(inner);
        setSearchParams(clean);
        if (searchCfg.parameterSchemaVersion === 2) {
          setSearchTarget(sanitizeCompletionTarget(searchCfg.parameters.completionTarget, null));
        }
      }

      const fixCfg = configs.find((c) => c.exerciseCode === 'fixation' && c.status === 'ACTIVE') ??
        configs.find((c) => c.exerciseCode === 'fixation');
      if (fixCfg && fixCfg.exerciseCode === 'fixation') {
        const inner =
          fixCfg.parameterSchemaVersion === 2
            ? fixCfg.parameters.parameters
            : fixCfg.parameters;
        const clean = sanitizeFixationParams(inner);
        setFixationParams(clean);
        if (fixCfg.parameterSchemaVersion === 2) {
          setFixationTarget(sanitizeCompletionTarget(fixCfg.parameters.completionTarget, clean.repetitions));
        }
      }
    },
    []
  );

  const hydrateFromPlan = useCallback(
    (plan: TherapyPlanDetailResponse, defaultHemifield: AffectedHemifield) => {
      setDailySessionLimit(clampInt(plan.dailySessionLimit, 1, 10));
      setDailyTargetDurationMinutes(clampInt(plan.dailyTargetDurationMinutes, 1, 180));
      if (plan.dailyHardSafetyLimitMinutes != null) {
        setUseHardSafetyLimit(true);
        setDailyHardSafetyLimitMinutes(
          clampInt(plan.dailyHardSafetyLimitMinutes, plan.dailyTargetDurationMinutes, 240)
        );
      } else {
        setUseHardSafetyLimit(false);
      }
      const maxMin = clampInt(plan.maximumSessionDurationMinutes, 1, 60);
      setMaximumSessionDurationMinutes(maxMin);
      setMinimumValidDurationMinutes(clampInt(plan.minimumValidDurationMinutes, 1, maxMin));
      setMinimumValidSampleCount(clampInt(plan.minimumValidSampleCount, 1, 10000));

      const rx = plan.dailyExercisePrescriptions || {};
      setScanningEnabled(Boolean(rx['visual-scanning']));
      setScanningDailyCount(clampInt(rx['visual-scanning'] ?? 1, 1, 5));
      setSearchEnabled(Boolean(rx['visual-search']));
      setSearchDailyCount(clampInt(rx['visual-search'] ?? 1, 1, 5));
      setFixationEnabled(Boolean(rx.fixation));
      setFixationDailyCount(clampInt(rx.fixation ?? 1, 1, 5));

      hydrateFromConfigurations(plan.configurations || [], defaultHemifield);
    },
    [hydrateFromConfigurations]
  );

  const loadRemoteData = useCallback(async () => {
    if (!isCognitoMode || !effectivePatientId || effectivePatientId === 'pat-000') return;
    setIsLoadingRemote(true);
    setApiError(null);

    const [detailRes, contextRes, plansRes] = await Promise.allSettled([
      clinicalApi.getAssignedPatientDetail(effectivePatientId),
      clinicalApi.getRehabilitationContext(effectivePatientId),
      clinicalApi.listTherapyPlans(effectivePatientId, { page: 0, size: 20 }),
    ]);

    let defaultHemifield: AffectedHemifield = 'LEFT';
    if (detailRes.status === 'fulfilled') {
      setPatientDetail(detailRes.value);
    }
    if (contextRes.status === 'fulfilled') {
      setRehabContext(contextRes.value);
      if (contextRes.value.affectedHemifield === 'RIGHT') {
        defaultHemifield = 'RIGHT';
      }
      if (contextRes.value.observations) {
        setClinicalNotes(contextRes.value.observations);
      }
    }

    if (plansRes.status === 'fulfilled') {
      const details = await Promise.all(
        plansRes.value.plans.map((p) =>
          clinicalApi.getTherapyPlanDetail(effectivePatientId, p.therapyPlanId)
        )
      );
      setExistingPlans(details);
      if (details.length > 0) {
        const preferred = details.find((p) => p.status === 'ACTIVE') ?? details[0];
        setSelectedPlanId(preferred.therapyPlanId);
        setCreateNewPlanMode(false);
        hydrateFromPlan(preferred, defaultHemifield);
      } else {
        setCreateNewPlanMode(true);
        hydrateFromConfigurations([], defaultHemifield);
      }
    } else {
      setApiError(extractApiErrorMessage(plansRes.reason));
    }

    setIsLoadingRemote(false);
  }, [isCognitoMode, effectivePatientId, hydrateFromPlan, hydrateFromConfigurations]);

  useEffect(() => {
    if (isCognitoMode) {
      void loadRemoteData();
    }
  }, [isCognitoMode, loadRemoteData]);

  // Cálculos de prescripción diaria
  const dailyExercisePrescriptions: DailyExercisePrescriptions = useMemo(() => {
    const out: DailyExercisePrescriptions = {};
    if (scanningEnabled) out['visual-scanning'] = clampInt(scanningDailyCount, 1, 5);
    if (searchEnabled) out['visual-search'] = clampInt(searchDailyCount, 1, 5);
    if (fixationEnabled) out.fixation = clampInt(fixationDailyCount, 1, 5);
    return out;
  }, [
    scanningEnabled,
    scanningDailyCount,
    searchEnabled,
    searchDailyCount,
    fixationEnabled,
    fixationDailyCount,
  ]);

  const activeModulesCount = [scanningEnabled, searchEnabled, fixationEnabled].filter(Boolean).length;
  const totalPrescribedDailySessions =
    (scanningEnabled ? scanningDailyCount : 0) +
    (searchEnabled ? searchDailyCount : 0) +
    (fixationEnabled ? fixationDailyCount : 0);

  const buildConfigurationBody = (
    code: TherapyExerciseCode
  ): AppendTherapeuticConfigurationBody => {
    // Set effectiveFrom +2000ms ahead of client clock so server clock.instant() in
    // TherapeuticExerciseConfiguration.create() never fails `effectiveFrom.isBefore(createdAt)`
    const effectiveFrom = new Date(Date.now() + 2000).toISOString();
    if (code === 'visual-scanning') {
      const cleanParams = sanitizeScanningParams(scanningParams);
      const cleanTarget = sanitizeCompletionTarget(scanningTarget, cleanParams.repetitions);
      return {
        exerciseCode: 'visual-scanning',
        parameterSchemaVersion: 2,
        effectiveFrom,
        parameters: {
          parameters: cleanParams,
          completionTarget: cleanTarget,
        },
      };
    }
    if (code === 'visual-search') {
      const cleanParams = sanitizeSearchParams(searchParams);
      const cleanTarget = sanitizeCompletionTarget(searchTarget, null);
      return {
        exerciseCode: 'visual-search',
        parameterSchemaVersion: 2,
        effectiveFrom,
        parameters: {
          parameters: cleanParams,
          completionTarget: cleanTarget,
        },
      };
    }
    const cleanParams = sanitizeFixationParams(fixationParams);
    const cleanTarget = sanitizeCompletionTarget(fixationTarget, cleanParams.repetitions);
    return {
      exerciseCode: 'fixation',
      parameterSchemaVersion: 2,
      effectiveFrom,
      parameters: {
        parameters: cleanParams,
        completionTarget: cleanTarget,
      },
    };
  };

  const syncLocalStorePreview = (planId: string) => {
    const cleanScanning = sanitizeScanningParams(scanningParams);
    const cleanTarget = sanitizeCompletionTarget(scanningTarget, cleanScanning.repetitions);

    setPrescription({
      prescriptionId: `PLN-${planId.slice(0, 8)}-${Date.now()}`,
      patientId: currentPatient.id,
      gameId: scanningEnabled ? 'visual-scanning' : searchEnabled ? 'visual-search' : 'fixation',
      parameters: {
        target_speed: Number((cleanScanning.difficultyLevel * 0.45).toFixed(2)),
        visual_field_amplitude: Number((cleanScanning.eccentricityDegrees / 30).toFixed(2)),
        min_fixation_time: cleanScanning.minimumFixationMs,
      },
      clinicalContext: {
        therapyPlanId: planId,
        exerciseCode: scanningEnabled ? 'visual-scanning' : searchEnabled ? 'visual-search' : 'fixation',
        mode: cleanScanning.mode,
        parameterSchemaVersion: 2,
        frozenParameters: cleanScanning,
        completionTarget: cleanTarget,
        sessionLimits: {
          minimumValidDurationMinutes,
          maximumSessionDurationMinutes,
          minimumValidSampleCount,
        },
      },
    });
  };

  const handleCreatePlanAndConfigs = async () => {
    if (activeModulesCount === 0) {
      setApiError('Debe habilitar al menos un ejercicio terapéutico para crear el plan.');
      return;
    }

    setIsSubmitting(true);
    setApiError(null);
    let createdPlanId: string | null = null;
    try {
      const safeMaxDuration = clampInt(maximumSessionDurationMinutes, 1, 60);
      const safeMinDuration = clampInt(minimumValidDurationMinutes, 1, safeMaxDuration);
      const safeTargetDuration = clampInt(dailyTargetDurationMinutes, 1, 180);
      const safeHardLimit = useHardSafetyLimit
        ? clampInt(Math.max(dailyHardSafetyLimitMinutes, safeTargetDuration), safeTargetDuration, 240)
        : null;
      const safeSessionLimit = clampInt(
        Math.max(dailySessionLimit, totalPrescribedDailySessions),
        1,
        10
      );

      const createBody: CreateTherapyPlanBody = {
        dailySessionLimit: safeSessionLimit,
        dailyTargetDurationMinutes: safeTargetDuration,
        dailyHardSafetyLimitMinutes: safeHardLimit,
        minimumValidDurationMinutes: safeMinDuration,
        maximumSessionDurationMinutes: safeMaxDuration,
        minimumValidSampleCount: clampInt(minimumValidSampleCount, 10, 10000),
        dailyExercisePrescriptions,
      };

      const createdPlan = await clinicalApi.createTherapyPlan(effectivePatientId, createBody);
      createdPlanId = createdPlan.therapyPlanId;

      const enabledCodes: TherapyExerciseCode[] = [
        ...(scanningEnabled ? (['visual-scanning'] as const) : []),
        ...(searchEnabled ? (['visual-search'] as const) : []),
        ...(fixationEnabled ? (['fixation'] as const) : []),
      ];

      for (const code of enabledCodes) {
        await clinicalApi.appendConfiguration(
          effectivePatientId,
          createdPlan.therapyPlanId,
          buildConfigurationBody(code)
        );
      }

      // Wait briefly so effectiveFrom (+2000ms) is <= server clock when reading back plan detail
      await new Promise((resolve) => setTimeout(resolve, 2100));
      syncLocalStorePreview(createdPlan.therapyPlanId);
      setCreateNewPlanMode(false);
      await loadRemoteData();
      setSelectedPlanId(createdPlan.therapyPlanId);
      showToast(
        `Plan creado (${createdPlan.therapyPlanId.slice(0, 8)}) y ${enabledCodes.length} configuración(es) Schema v2 publicadas.`
      );
    } catch (err) {
      if (createdPlanId) {
        setCreateNewPlanMode(false);
        await loadRemoteData();
        setSelectedPlanId(createdPlanId);
      }
      setApiError(extractApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAppendSingleConfiguration = async (code: TherapyExerciseCode) => {
    if (!activePlan) {
      setApiError('Primero debe crear un Plan Terapéutico antes de agregar configuraciones.');
      return;
    }
    setIsSubmitting(true);
    setApiError(null);
    try {
      const res = await clinicalApi.appendConfiguration(
        effectivePatientId,
        activePlan.therapyPlanId,
        buildConfigurationBody(code)
      );
      await new Promise((resolve) => setTimeout(resolve, 2100));
      syncLocalStorePreview(activePlan.therapyPlanId);
      await loadRemoteData();
      showToast(`Configuración ${code} v${res.version} (Schema v${res.parameterSchemaVersion}) agregada al plan.`);
    } catch (err) {
      setApiError(extractApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAppendAllEnabledConfigurations = async () => {
    if (!activePlan) return;
    if (activeModulesCount === 0) {
      setApiError('Seleccione al menos un ejercicio habilitado para agregar su configuración.');
      return;
    }
    setIsSubmitting(true);
    setApiError(null);
    try {
      const enabledCodes: TherapyExerciseCode[] = [
        ...(scanningEnabled ? (['visual-scanning'] as const) : []),
        ...(searchEnabled ? (['visual-search'] as const) : []),
        ...(fixationEnabled ? (['fixation'] as const) : []),
      ];
      for (const code of enabledCodes) {
        await clinicalApi.appendConfiguration(
          effectivePatientId,
          activePlan.therapyPlanId,
          buildConfigurationBody(code)
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 2100));
      syncLocalStorePreview(activePlan.therapyPlanId);
      await loadRemoteData();
      showToast(`${enabledCodes.length} configuración(es) Schema v2 agregada(s) al plan actual.`);
    } catch (err) {
      setApiError(extractApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRevisePlan = async () => {
    if (!activePlan) return;
    if (activeModulesCount === 0 && revisionStopStatus === 'KEEP_ACTIVE') {
      setApiError('Debe mantener al menos un ejercicio prescrito o suspender/cancelar el plan.');
      return;
    }

    setIsSubmitting(true);
    setApiError(null);
    try {
      const safeTargetDuration = clampInt(dailyTargetDurationMinutes, 1, 180);
      const safeSessionLimit = clampInt(dailySessionLimit, 1, 10);
      const safeHardLimit = useHardSafetyLimit
        ? clampInt(
            Math.max(dailyHardSafetyLimitMinutes, safeTargetDuration),
            safeTargetDuration,
            240
          )
        : null;

      const sessionLimitChanged = safeSessionLimit !== activePlan.dailySessionLimit;
      const targetDurationChanged =
        safeTargetDuration !== activePlan.dailyTargetDurationMinutes;
      const hardLimitChanged =
        safeHardLimit !== null &&
        safeHardLimit !== (activePlan.dailyHardSafetyLimitMinutes ?? null);

      const currentRx = activePlan.dailyExercisePrescriptions || {};
      const nextKeys = Object.keys(dailyExercisePrescriptions) as TherapyExerciseCode[];
      const currKeys = Object.keys(currentRx) as TherapyExerciseCode[];
      const prescriptionsChanged =
        nextKeys.length !== currKeys.length ||
        nextKeys.some((k) => dailyExercisePrescriptions[k] !== currentRx[k]);

      const statusChanged = revisionStopStatus !== 'KEEP_ACTIVE';
      const hasPlanLevelChanges =
        sessionLimitChanged ||
        targetDurationChanged ||
        hardLimitChanged ||
        prescriptionsChanged ||
        statusChanged;

      // Backend contract (`ReviseTherapyPlanCommandService.java` line 116):
      // POST /revisions rejects requests with 400 when no plan-level schedule/quota field changed.
      // If only module parameters were modified, publish the module configurations instead.
      if (!hasPlanLevelChanges) {
        const enabledCodes: TherapyExerciseCode[] = [
          ...(scanningEnabled ? (['visual-scanning'] as const) : []),
          ...(searchEnabled ? (['visual-search'] as const) : []),
          ...(fixationEnabled ? (['fixation'] as const) : []),
        ];
        for (const code of enabledCodes) {
          await clinicalApi.appendConfiguration(
            effectivePatientId,
            activePlan.therapyPlanId,
            buildConfigurationBody(code)
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 2100));
        syncLocalStorePreview(activePlan.therapyPlanId);
        await loadRemoteData();
        showToast(
          `Las cuotas diarias no cambiaron; se publicaron ${enabledCodes.length} configuración(es) de módulos en el plan.`
        );
        return;
      }

      const reviseBody: ReviseTherapyPlanBody = {
        commandId: createUuid(),
        ...(sessionLimitChanged ? { dailySessionLimit: safeSessionLimit } : {}),
        ...(targetDurationChanged
          ? { dailyTargetDurationMinutes: safeTargetDuration }
          : {}),
        ...(hardLimitChanged && safeHardLimit !== null
          ? { dailyHardSafetyLimitMinutes: safeHardLimit }
          : {}),
        ...(prescriptionsChanged ? { dailyExercisePrescriptions } : {}),
        ...(statusChanged ? { status: revisionStopStatus } : {}),
        ...(clinicalReason.trim() ? { clinicalReason: clinicalReason.trim() } : {}),
      };

      const res = await clinicalApi.reviseTherapyPlan(
        effectivePatientId,
        activePlan.therapyPlanId,
        reviseBody
      );
      syncLocalStorePreview(activePlan.therapyPlanId);
      await loadRemoteData();
      showToast(
        `Revisión del plan emitida (${res.revisions.length} cambio(s), commandId ${res.commandId.slice(0, 8)}).`
      );
    } catch (err) {
      setApiError(extractApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  // === Handlers de Modo MOCK ===
  const handleMockSaveDraft = () => {
    updatePatient({
      ...currentPatient,
      clinicalNotes,
    });
    showToast(`Borrador del Plan Terapéutico guardado para ${currentPatient.name}.`);
  };

  const handleMockSaveImmutableVersion = () => {
    const cleanScanning = sanitizeScanningParams(scanningParams);
    const cleanSearch = sanitizeSearchParams(searchParams);
    const cleanFixation = sanitizeFixationParams(fixationParams);

    setPrescription({
      prescriptionId: `PLN-2024-089-${Date.now()}`,
      patientId: currentPatient.id,
      gameId: 'saccadic-explorer',
      parameters: {
        target_speed: Number((cleanScanning.difficultyLevel * 0.5).toFixed(2)),
        visual_field_amplitude: Number((cleanScanning.eccentricityDegrees / 30).toFixed(2)),
        min_fixation_time: cleanScanning.minimumFixationMs,
      },
    });

    updatePatient({
      ...currentPatient,
      clinicalNotes,
      activePlan: {
        prescribedDate: startDate,
        exercises: [
          ...(scanningEnabled
            ? [
                {
                  id: 'ex-01',
                  name: 'Exploración Sacádica Visual',
                  category: 'Prioritario',
                  level: cleanScanning.difficultyLevel,
                  targetSpeed: Number((cleanScanning.difficultyLevel * 0.5).toFixed(2)),
                  visualFieldAmplitude: Number((cleanScanning.eccentricityDegrees / 30).toFixed(2)),
                  minFixationTimeMs: cleanScanning.minimumFixationMs,
                  dailyTargetMinutes: Math.max(1, Math.round(dailyTargetDurationMinutes / Math.max(1, activeModulesCount))),
                },
              ]
            : []),
          ...(searchEnabled
            ? [
                {
                  id: 'ex-02',
                  name: 'Búsqueda Visual Dinámica',
                  category: 'Compensatorio',
                  level: cleanSearch.difficultyLevel,
                  targetSpeed: 1.1,
                  visualFieldAmplitude: cleanSearch.affectedHemifieldBias,
                  minFixationTimeMs: cleanSearch.minimumFixationMs,
                  dailyTargetMinutes: Math.max(1, Math.round(dailyTargetDurationMinutes / Math.max(1, activeModulesCount))),
                },
              ]
            : []),
          ...(fixationEnabled
            ? [
                {
                  id: 'ex-03',
                  name: 'Fijación Ocular Sostenida',
                  category: 'Estabilidad',
                  level: cleanFixation.difficultyLevel,
                  targetSpeed: 0.9,
                  visualFieldAmplitude: 0.5,
                  minFixationTimeMs: cleanFixation.minimumFixationMs,
                  dailyTargetMinutes: Math.max(1, Math.round(dailyTargetDurationMinutes / Math.max(1, activeModulesCount))),
                },
              ]
            : []),
        ],
      },
    });

    setMockPlanVersion('v1.3');
    showToast(`Versión Inmutable (${mockPlanVersion}) sellada y sincronizada con el motor del paciente.`);
  };

  const toggleDay = (index: number) => {
    setSelectedDays((prev) => prev.map((val, i) => (i === index ? !val : val)));
  };

  const dayLabels = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
  const activeDaysCount = selectedDays.filter(Boolean).length;

  return (
    <div className="min-h-screen flex flex-col font-sans text-[#071E27] bg-[#F3FAFF] antialiased selection:bg-[#81F3E5] selection:text-[#005049]">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-20 right-6 z-50 bg-[#071524] text-white px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-xs font-semibold border border-[#006A62]">
          <CheckCircle2 className="w-4 h-4 text-[#84F5E8]" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top App Bar */}
      <SpecialistHeader
        activeTab="pacientes"
        onTabChange={(tab) => {
          if (tab === 'pacientes') navigate('/specialist/dashboard');
          else if (tab === 'protocolos') navigate(`/specialist/patients/${currentPatient.id}/parametros`);
          else if (tab === 'telemetria') navigate(`/specialist/patients/${currentPatient.id}/auditoria`);
          else if (tab === 'interconsultas') navigate(`/specialist/patients/${currentPatient.id}/reporte-pdf`);
        }}
        onOpenNotifications={() => showToast('Constructor de prescripción Schema v2 activo.')}
      />

      {/* Main Patient Context & Workspace Canvas */}
      <main className="flex-1 max-w-[1280px] w-full mx-auto px-4 md:px-6 py-6 pb-40">
        {/* Clinical Breadcrumb */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs font-medium text-[#44474C] overflow-x-auto whitespace-nowrap">
            <button
              onClick={() => navigate('/specialist/dashboard')}
              className="hover:text-[#071524] cursor-pointer transition-colors"
            >
              Portal Clínico
            </button>
            <ChevronRight className="w-3.5 h-3.5 text-[#74777C]" />
            <button
              onClick={() => navigate('/specialist/dashboard')}
              className="hover:text-[#071524] cursor-pointer transition-colors"
            >
              Pacientes
            </button>
            <ChevronRight className="w-3.5 h-3.5 text-[#74777C]" />
            <button
              onClick={() => navigate(`/specialist/patients/${currentPatient.id}`)}
              className="text-[#071E27] font-semibold hover:underline cursor-pointer"
            >
              {currentPatient.name} (HC {currentPatient.medicalRecordNumber})
            </button>
            <ChevronRight className="w-3.5 h-3.5 text-[#74777C]" />
            <span aria-current="page" className="text-[#006A62] font-bold">
              Prescripción Terapéutica
            </span>
          </nav>

          <div className="flex flex-wrap items-center gap-2">
            {isCognitoMode && (
              <button
                type="button"
                onClick={() => void loadRemoteData()}
                disabled={isLoadingRemote}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-[#E6F6FF] text-[#006A62] text-xs font-bold border border-[#006A62]/30 cursor-pointer disabled:opacity-60"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingRemote ? 'animate-spin' : ''}`} />
                Sincronizar
              </button>
            )}
            <button
              onClick={() => navigate(`/specialist/patients/${currentPatient.id}`)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#E6F6FF] hover:bg-[#D5ECF8] text-[#071524] text-xs font-bold border border-[#071524]/10 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Volver al Expediente
            </button>
            <button
              onClick={() => navigate(`/specialist/patients/${currentPatient.id}/parametros`)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1C2A39] hover:bg-[#071524] text-white text-xs font-bold cursor-pointer shadow-xs"
            >
              <Sliders className="w-3.5 h-3.5 text-[#84F5E8]" />
              Configuración Fina de Parámetros
            </button>
          </div>
        </div>

        {/* Patient Quick Context Strip */}
        <section className="bg-white border border-[#071524]/10 rounded-xl p-5 mb-6 shadow-xs">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
            <div className="flex items-start sm:items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-[#1C2A39] text-white flex items-center justify-center font-bold text-xl ring-4 ring-[#D5ECF8] shrink-0">
                {currentPatient.initials}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-xl sm:text-2xl text-[#071524] font-bold tracking-tight">
                    {currentPatient.name}
                  </h1>
                  <span className="px-2.5 py-0.5 text-xs font-semibold bg-[#84F5E8] text-[#00201D] rounded border border-[#006A62]/20">
                    HC {currentPatient.medicalRecordNumber}
                  </span>
                  {isCognitoMode && (
                    <span className="px-2.5 py-0.5 text-xs font-bold bg-[#DBF1FE] text-[#006A62] rounded">
                      Hemicampo: {rehabContext?.affectedHemifield ?? 'Sin definir'}
                    </span>
                  )}
                </div>
                <p className="text-xs sm:text-sm font-medium text-[#44474C] mt-1">
                  <strong className="text-[#071524]">Diagnóstico Principal:</strong>{' '}
                  {currentPatient.primaryDiagnosisTitle ||
                    `Hemianopsia Homónima ${currentPatient.affectedHemifield === 'LEFT' ? 'Izquierda' : 'Derecha'}`}
                </p>
              </div>
            </div>

            {isCognitoMode && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {existingPlans.length > 0 && (
                  <select
                    value={activePlan?.therapyPlanId || ''}
                    onChange={(e) => {
                      const nextPlan = existingPlans.find((p) => p.therapyPlanId === e.target.value);
                      setSelectedPlanId(e.target.value);
                      setCreateNewPlanMode(false);
                      if (nextPlan) {
                        hydrateFromPlan(
                          nextPlan,
                          rehabContext?.affectedHemifield === 'RIGHT' ? 'RIGHT' : 'LEFT'
                        );
                      }
                    }}
                    className="h-10 px-3 rounded-lg bg-[#E6F6FF] border border-[#071524]/15 font-bold text-[#071524] cursor-pointer"
                  >
                    {existingPlans.map((p) => (
                      <option key={p.therapyPlanId} value={p.therapyPlanId}>
                        Plan {p.therapyPlanId.slice(0, 8)} · {p.status} (v{p.configurationVersion})
                      </option>
                    ))}
                  </select>
                )}

                <button
                  type="button"
                  onClick={() => setCreateNewPlanMode((v) => !v)}
                  disabled={existingPlans.length === 0}
                  className={`inline-flex items-center gap-1.5 h-10 px-3.5 rounded-lg border font-bold cursor-pointer transition-colors ${
                    createNewPlanMode
                      ? 'bg-[#006A62] text-white border-[#006A62]'
                      : 'bg-white text-[#071524] border-[#C4C6CC] hover:bg-[#F3FAFF]'
                  } disabled:opacity-60`}
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  {createNewPlanMode ? 'Modo: Crear Nuevo Plan' : 'Nuevo Plan'}
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Error & Loading Banners */}
        {isCognitoMode && isLoadingRemote && (
          <div className="mb-6 p-4 rounded-xl bg-white border border-[#071524]/10 flex items-center gap-2.5 text-xs font-semibold text-[#006A62]">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Cargando planes terapéuticos y contexto clínico...</span>
          </div>
        )}

        {apiError && (
          <div className="mb-6 p-4 rounded-xl bg-[#FFDAD6] border border-[#BA1A1A]/30 text-[#93000A] text-xs font-semibold flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#BA1A1A]" />
            <div>
              <p className="font-bold">No se pudo completar la operación clínica</p>
              <p className="mt-0.5">{apiError}</p>
            </div>
          </div>
        )}

        {/* Master Form Container */}
        <form className="space-y-8" onSubmit={(e) => e.preventDefault()}>
          {/* SECTION 1: Vigencia / Contexto del Plan */}
          {!isCognitoMode && (
            <section className="bg-white border border-[#071524]/10 rounded-xl p-6 sm:p-8 shadow-xs">
              <div className="flex flex-wrap items-center justify-between pb-6 mb-6 border-b border-[#071524]/10 gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[#D5ECF8] flex items-center justify-center text-[#071524]">
                    <Calendar className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-[#071524] tracking-tight">
                      1. Vigencia y Parámetros Temporales del Plan
                    </h2>
                    <p className="text-xs text-[#44474C]">
                      Definición del ciclo activo de telerehabilitación y objetivos de plasticidad neuronal
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-1 space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-[#071524] mb-2" htmlFor="fecha-inicio">
                      Fecha de Inicio Clínico
                    </label>
                    <input
                      id="fecha-inicio"
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full h-11 px-4 bg-[#F3FAFF] rounded-lg border-2 border-[#C4C6CC] focus:border-[#006A62] focus:outline-none text-[#071524] font-medium text-sm"
                    />
                  </div>
                  <div className="bg-[#E6F6FF] p-4 rounded-xl border border-[#071524]/10">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-bold text-[#071524]">{activeDaysCount} Días por semana</span>
                    </div>
                    <div className="grid grid-cols-7 gap-1 text-center">
                      {dayLabels.map((label, idx) => {
                        const active = selectedDays[idx];
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => toggleDay(idx)}
                            className={`py-2 font-bold text-xs rounded transition-colors cursor-pointer ${
                              active
                                ? 'bg-[#006A62] text-white'
                                : 'bg-white text-[#74777C] hover:bg-[#D5ECF8]'
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-2">
                  <label className="block text-sm font-semibold text-[#071524] mb-2" htmlFor="clinical-notes">
                    Notas Clínicas y Objetivos
                  </label>
                  <textarea
                    id="clinical-notes"
                    rows={5}
                    value={clinicalNotes}
                    onChange={(e) => setClinicalNotes(e.target.value)}
                    className="w-full p-4 bg-[#F3FAFF] rounded-lg border-2 border-[#C4C6CC] focus:border-[#006A62] focus:outline-none text-[#071E27] text-sm"
                  />
                </div>
              </div>
            </section>
          )}

          {/* SECTION 2: Límites de Sesión y Cuota Diaria (CreateTherapyPlanBody / ReviseTherapyPlanBody) */}
          <section className="bg-white border border-[#071524]/10 rounded-xl p-6 sm:p-8 shadow-xs">
            <div className="flex flex-wrap items-center justify-between pb-6 mb-6 border-b border-[#071524]/10 gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#D5ECF8] flex items-center justify-center text-[#006A62]">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-[#071524] tracking-tight">
                    {isCognitoMode ? '1.' : '2.'} Límites de Sesión y Seguridad del Plan Terapéutico
                  </h2>
                  <p className="text-xs text-[#44474C]">
                    Reglas clínicas de duración válida, cuota diaria y muestras mínimas exigidas por Clinical Service
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#E6F6FF] text-[#071524] border border-[#071524]/10">
                <Layers className="w-3.5 h-3.5 text-[#006A62]" />
                {totalPrescribedDailySessions} sesiones prescritas/día
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mb-6">
              {/* dailySessionLimit */}
              <div className="p-4 rounded-xl bg-[#E6F6FF] border border-[#071524]/10">
                <label className="block text-xs font-bold uppercase tracking-wider text-[#44474C] mb-2">
                  Límite Diario de Sesiones (`dailySessionLimit`)
                </label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={dailySessionLimit}
                  onChange={(e) => setDailySessionLimit(clampInt(Number(e.target.value), 1, 10))}
                  className="w-full h-11 px-3 font-bold text-lg bg-white rounded-lg border border-[#C4C6CC] text-[#071524]"
                />
                <p className="text-[11px] text-[#44474C] mt-1.5">
                  Rango válido: 1–10 sesiones/día (prescritas: {totalPrescribedDailySessions})
                </p>
              </div>

              {/* dailyTargetDurationMinutes */}
              <div className="p-4 rounded-xl bg-[#E6F6FF] border border-[#071524]/10">
                <label className="block text-xs font-bold uppercase tracking-wider text-[#44474C] mb-2">
                  Meta Diaria de Terapia (min)
                </label>
                <input
                  type="number"
                  min={1}
                  max={180}
                  value={dailyTargetDurationMinutes}
                  onChange={(e) => {
                    const next = clampInt(Number(e.target.value), 1, 180);
                    setDailyTargetDurationMinutes(next);
                    if (dailyHardSafetyLimitMinutes < next) {
                      setDailyHardSafetyLimitMinutes(next);
                    }
                  }}
                  className="w-full h-11 px-3 font-bold text-lg bg-white rounded-lg border border-[#C4C6CC] text-[#071524]"
                />
                <p className="text-[11px] text-[#44474C] mt-1.5">Rango válido: 1–180 minutos diarios</p>
              </div>

              {/* dailyHardSafetyLimitMinutes */}
              <div className="p-4 rounded-xl bg-[#E6F6FF] border border-[#071524]/10">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-[#44474C]">
                    Tope Duro de Seguridad (min)
                  </label>
                  <input
                    type="checkbox"
                    checked={useHardSafetyLimit}
                    onChange={(e) => setUseHardSafetyLimit(e.target.checked)}
                    className="w-4 h-4 accent-[#006A62] cursor-pointer"
                  />
                </div>
                <input
                  type="number"
                  min={dailyTargetDurationMinutes}
                  max={240}
                  disabled={!useHardSafetyLimit}
                  value={dailyHardSafetyLimitMinutes}
                  onChange={(e) =>
                    setDailyHardSafetyLimitMinutes(
                      clampInt(Number(e.target.value), dailyTargetDurationMinutes, 240)
                    )
                  }
                  className="w-full h-11 px-3 font-bold text-lg bg-white rounded-lg border border-[#C4C6CC] text-[#071524] disabled:opacity-50"
                />
                <p className="text-[11px] text-[#44474C] mt-1.5">
                  Rango: {dailyTargetDurationMinutes}–240 min (opcional)
                </p>
              </div>

              {/* minimumValidDurationMinutes */}
              <div className="p-4 rounded-xl bg-[#F3FAFF] border border-[#071524]/10">
                <label className="block text-xs font-bold uppercase tracking-wider text-[#44474C] mb-2">
                  Duración Mínima Válida (min)
                </label>
                <input
                  type="number"
                  min={1}
                  max={maximumSessionDurationMinutes}
                  value={minimumValidDurationMinutes}
                  onChange={(e) =>
                    setMinimumValidDurationMinutes(
                      clampInt(Number(e.target.value), 1, maximumSessionDurationMinutes)
                    )
                  }
                  className="w-full h-11 px-3 font-bold text-base bg-white rounded-lg border border-[#C4C6CC] text-[#071524]"
                />
                <p className="text-[11px] text-[#44474C] mt-1.5">
                  Rango: 1–{maximumSessionDurationMinutes} min ({minimumValidDurationMinutes * 60} seg)
                </p>
              </div>

              {/* maximumSessionDurationMinutes */}
              <div className="p-4 rounded-xl bg-[#F3FAFF] border border-[#071524]/10">
                <label className="block text-xs font-bold uppercase tracking-wider text-[#44474C] mb-2">
                  Duración Máxima por Sesión (min)
                </label>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={maximumSessionDurationMinutes}
                  onChange={(e) => {
                    const nextMax = clampInt(Number(e.target.value), 1, 60);
                    setMaximumSessionDurationMinutes(nextMax);
                    if (minimumValidDurationMinutes > nextMax) {
                      setMinimumValidDurationMinutes(nextMax);
                    }
                  }}
                  className="w-full h-11 px-3 font-bold text-base bg-white rounded-lg border border-[#C4C6CC] text-[#071524]"
                />
                <p className="text-[11px] text-[#44474C] mt-1.5">
                  Rango: 1–60 min ({maximumSessionDurationMinutes * 60} seg, tope 3600s)
                </p>
              </div>

              {/* minimumValidSampleCount */}
              <div className="p-4 rounded-xl bg-[#F3FAFF] border border-[#071524]/10">
                <label className="block text-xs font-bold uppercase tracking-wider text-[#44474C] mb-2">
                  Muestras Mínimas Válidas (`sampleCount`)
                </label>
                <input
                  type="number"
                  min={10}
                  max={10000}
                  value={minimumValidSampleCount}
                  onChange={(e) =>
                    setMinimumValidSampleCount(clampInt(Number(e.target.value), 10, 10000))
                  }
                  className="w-full h-11 px-3 font-bold text-base bg-white rounded-lg border border-[#C4C6CC] text-[#071524]"
                />
                <p className="text-[11px] text-[#44474C] mt-1.5">Rango válido: 10–10000 muestras</p>
              </div>
            </div>

            {/* Controles adicionales cuando se revisa un plan existente en COGNITO */}
            {isCognitoMode && activePlan && !createNewPlanMode && (
              <div className="p-4 rounded-xl bg-[#F3FAFF] border border-[#006A62]/20 grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-[#071524] mb-1">
                    Motivo Clínico de Revisión (`clinicalReason`)
                  </label>
                  <input
                    type="text"
                    value={clinicalReason}
                    onChange={(e) => setClinicalReason(e.target.value)}
                    placeholder="Ej. Ajuste de cuota diaria por buena tolerancia visual..."
                    className="w-full h-10 px-3 rounded-lg bg-white border border-[#C4C6CC] text-xs sm:text-sm text-[#071524]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#071524] mb-1">
                    Cambio de Estado en Revisión
                  </label>
                  <select
                    value={revisionStopStatus}
                    onChange={(e) =>
                      setRevisionStopStatus(e.target.value as 'KEEP_ACTIVE' | TherapyPlanStopStatus)
                    }
                    className="w-full h-10 px-3 rounded-lg bg-white border border-[#C4C6CC] text-xs font-bold text-[#071524]"
                  >
                    <option value="KEEP_ACTIVE">Mantener estado actual ({activePlan.status})</option>
                    <option value="SUSPENDED">Suspender Plan (SUSPENDED)</option>
                    <option value="CANCELLED">Cancelar Plan (CANCELLED)</option>
                  </select>
                </div>
              </div>
            )}
          </section>

          {/* SECTION 3: Configuraciones Schema v2 por Familia de Ejercicio */}
          <section className="bg-white border border-[#071524]/10 rounded-xl p-6 sm:p-8 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 mb-6 border-b border-[#071524]/10 gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#D5ECF8] flex items-center justify-center text-[#071524]">
                  <Dumbbell className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-[#071524] tracking-tight">
                    {isCognitoMode ? '2.' : '3.'} Parametrización Schema v2 de Ejercicios Terapéuticos
                  </h2>
                  <p className="text-xs text-[#44474C]">
                    Todos los campos se validan estrictamente contra los límites del contrato Schema 2 de Clinical
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg border bg-[#81F3E5]/40 text-[#005049] border-[#006A62]/30">
                <Timer className="w-4 h-4" />
                <span className="text-xs font-bold">
                  {activeModulesCount} Módulos habilitados • {totalPrescribedDailySessions} sesiones/día
                </span>
              </div>
            </div>

            <div className="space-y-6">
              {/* MÓDULO 1: VISUAL SCANNING */}
              <div
                className={`border-2 rounded-xl p-5 transition-all ${
                  scanningEnabled
                    ? 'border-[#006A62]/40 bg-white'
                    : 'border-[#C4C6CC]/40 bg-[#F3FAFF]/50 opacity-75'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#071524]/10">
                  <div className="flex items-center gap-3">
                    <input
                      id="mod-scanning"
                      type="checkbox"
                      checked={scanningEnabled}
                      onChange={(e) => setScanningEnabled(e.target.checked)}
                      className="w-5 h-5 rounded accent-[#006A62] cursor-pointer"
                    />
                    <div>
                      <label htmlFor="mod-scanning" className="text-base font-bold text-[#071524] cursor-pointer">
                        Módulo 1: Exploración Sacádica (`visual-scanning`)
                      </label>
                      <p className="text-xs text-[#44474C]">
                        Modos: STANDARD_SCANNING · SYSTEMATIC_EXPLORATION · COMPENSATORY_SACCADE
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-xs font-semibold text-[#44474C]">Sesiones/día:</label>
                    <input
                      type="number"
                      min={1}
                      max={5}
                      disabled={!scanningEnabled}
                      value={scanningDailyCount}
                      onChange={(e) => setScanningDailyCount(clampInt(Number(e.target.value), 1, 5))}
                      className="w-16 h-9 px-2 text-center font-bold bg-[#E6F6FF] rounded-lg border border-[#C4C6CC] text-xs"
                    />
                    {isCognitoMode && activePlan && !createNewPlanMode && (
                      <button
                        type="button"
                        disabled={!scanningEnabled || isSubmitting}
                        onClick={() => void handleAppendSingleConfiguration('visual-scanning')}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#1C2A39] hover:bg-[#071524] text-white text-xs font-bold disabled:opacity-50 cursor-pointer"
                      >
                        <Send className="w-3.5 h-3.5 text-[#84F5E8]" />
                        Agregar al Plan
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-4 text-xs">
                  <div>
                    <label className="block font-bold text-[#44474C] uppercase mb-1">Modo</label>
                    <select
                      disabled={!scanningEnabled}
                      value={scanningParams.mode}
                      onChange={(e) =>
                        setScanningParams((prev) => ({
                          ...prev,
                          mode: e.target.value as VisualScanningParameters['mode'],
                        }))
                      }
                      className="w-full h-10 px-3 bg-[#F3FAFF] rounded-lg border border-[#C4C6CC] font-semibold"
                    >
                      <option value="STANDARD_SCANNING">STANDARD_SCANNING</option>
                      <option value="SYSTEMATIC_EXPLORATION">SYSTEMATIC_EXPLORATION</option>
                      <option value="COMPENSATORY_SACCADE">COMPENSATORY_SACCADE</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-bold text-[#44474C] uppercase mb-1">Hemicampo (`LEFT | RIGHT`)</label>
                    <select
                      disabled={!scanningEnabled}
                      value={scanningParams.affectedHemifield}
                      onChange={(e) =>
                        setScanningParams((prev) => ({
                          ...prev,
                          affectedHemifield: e.target.value === 'RIGHT' ? 'RIGHT' : 'LEFT',
                        }))
                      }
                      className="w-full h-10 px-3 bg-[#F3FAFF] rounded-lg border border-[#C4C6CC] font-semibold"
                    >
                      <option value="LEFT">LEFT (Izquierdo)</option>
                      <option value="RIGHT">RIGHT (Derecho)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-bold text-[#44474C] uppercase mb-1">
                      Excentricidad ({scanningParams.eccentricityDegrees}°)
                    </label>
                    <input
                      type="number"
                      min={5}
                      max={30}
                      disabled={!scanningEnabled}
                      value={scanningParams.eccentricityDegrees}
                      onChange={(e) =>
                        setScanningParams((prev) => ({
                          ...prev,
                          eccentricityDegrees: clampInt(Number(e.target.value), 5, 30),
                        }))
                      }
                      className="w-full h-10 px-3 bg-[#F3FAFF] rounded-lg border border-[#C4C6CC] font-bold"
                    />
                    <span className="text-[10px] text-[#44474C]">Rango: 5°–30°</span>
                  </div>

                  <div>
                    <label className="block font-bold text-[#44474C] uppercase mb-1">Fijación Mínima (ms)</label>
                    <input
                      type="number"
                      min={300}
                      max={2000}
                      step={50}
                      disabled={!scanningEnabled}
                      value={scanningParams.minimumFixationMs}
                      onChange={(e) =>
                        setScanningParams((prev) => ({
                          ...prev,
                          minimumFixationMs: clampInt(Number(e.target.value), 300, 2000),
                        }))
                      }
                      className="w-full h-10 px-3 bg-[#F3FAFF] rounded-lg border border-[#C4C6CC] font-bold"
                    />
                    <span className="text-[10px] text-[#44474C]">Rango: 300–2000 ms</span>
                  </div>

                  <div>
                    <label className="block font-bold text-[#44474C] uppercase mb-1">Duración Máx Estímulo (ms)</label>
                    <input
                      type="number"
                      min={2000}
                      max={10000}
                      step={250}
                      disabled={!scanningEnabled}
                      value={scanningParams.maximumStimulusDurationMs}
                      onChange={(e) =>
                        setScanningParams((prev) => ({
                          ...prev,
                          maximumStimulusDurationMs: clampInt(Number(e.target.value), 2000, 10000),
                        }))
                      }
                      className="w-full h-10 px-3 bg-[#F3FAFF] rounded-lg border border-[#C4C6CC] font-bold"
                    />
                    <span className="text-[10px] text-[#44474C]">Rango: 2000–10000 ms</span>
                  </div>

                  <div>
                    <label className="block font-bold text-[#44474C] uppercase mb-1">Intervalo Interestímulo (ms)</label>
                    <input
                      type="number"
                      min={500}
                      max={3000}
                      step={100}
                      disabled={!scanningEnabled}
                      value={scanningParams.interStimulusIntervalMs}
                      onChange={(e) =>
                        setScanningParams((prev) => ({
                          ...prev,
                          interStimulusIntervalMs: clampInt(Number(e.target.value), 500, 3000),
                        }))
                      }
                      className="w-full h-10 px-3 bg-[#F3FAFF] rounded-lg border border-[#C4C6CC] font-bold"
                    />
                    <span className="text-[10px] text-[#44474C]">Rango: 500–3000 ms</span>
                  </div>

                  <div>
                    <label className="block font-bold text-[#44474C] uppercase mb-1">Repeticiones</label>
                    <input
                      type="number"
                      min={5}
                      max={50}
                      disabled={!scanningEnabled}
                      value={scanningParams.repetitions}
                      onChange={(e) => {
                        const reps = clampInt(Number(e.target.value), 5, 50);
                        setScanningParams((prev) => ({ ...prev, repetitions: reps }));
                        if (scanningTarget.criterion === 'REPETITIONS' && scanningTarget.target > reps) {
                          setScanningTarget({ criterion: 'REPETITIONS', target: reps });
                        }
                      }}
                      className="w-full h-10 px-3 bg-[#F3FAFF] rounded-lg border border-[#C4C6CC] font-bold"
                    />
                    <span className="text-[10px] text-[#44474C]">Rango: 5–50 reps</span>
                  </div>

                  <div>
                    <label className="block font-bold text-[#44474C] uppercase mb-1">Tamaño Diana (px) & Nivel</label>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="number"
                        min={30}
                        max={150}
                        disabled={!scanningEnabled}
                        value={scanningParams.targetSizePx}
                        onChange={(e) =>
                          setScanningParams((prev) => ({
                            ...prev,
                            targetSizePx: clampInt(Number(e.target.value), 30, 150),
                          }))
                        }
                        className="h-10 px-2 bg-[#F3FAFF] rounded-lg border border-[#C4C6CC] font-bold"
                      />
                      <select
                        disabled={!scanningEnabled}
                        value={scanningParams.difficultyLevel}
                        onChange={(e) =>
                          setScanningParams((prev) => ({
                            ...prev,
                            difficultyLevel: clampInt(Number(e.target.value), 1, 5),
                          }))
                        }
                        className="h-10 px-2 bg-[#F3FAFF] rounded-lg border border-[#C4C6CC] font-bold"
                      >
                        {[1, 2, 3, 4, 5].map((lvl) => (
                          <option key={lvl} value={lvl}>
                            Niv {lvl}
                          </option>
                        ))}
                      </select>
                    </div>
                    <span className="text-[10px] text-[#44474C]">Diana: 30–150 px · Nivel: 1–5</span>
                  </div>

                  {/* completionTarget */}
                  <div className="sm:col-span-2 lg:col-span-4 p-3 rounded-lg bg-[#E6F6FF] border border-[#071524]/10 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-bold text-[#071524] mb-1">Criterio de Meta (`completionTarget`)</label>
                      <select
                        disabled={!scanningEnabled}
                        value={scanningTarget.criterion}
                        onChange={(e) => {
                          const crit = e.target.value as TherapyCompletionTarget['criterion'];
                          setScanningTarget(
                            crit === 'REPETITIONS'
                              ? { criterion: 'REPETITIONS', target: Math.min(12, scanningParams.repetitions) }
                              : { criterion: 'ACTIVE_TIME', target: 180 }
                          );
                        }}
                        className="w-full h-9 px-3 bg-white rounded-lg border border-[#C4C6CC] font-semibold"
                      >
                        <option value="REPETITIONS">REPETITIONS (Repeticiones exitosas)</option>
                        <option value="ACTIVE_TIME">ACTIVE_TIME (Segundos activos)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-bold text-[#071524] mb-1">
                        Meta Objetivo ({scanningTarget.criterion === 'REPETITIONS' ? `1–${scanningParams.repetitions} reps` : '30–3600 seg'})
                      </label>
                      <input
                        type="number"
                        min={scanningTarget.criterion === 'REPETITIONS' ? 1 : 30}
                        max={scanningTarget.criterion === 'REPETITIONS' ? scanningParams.repetitions : 3600}
                        disabled={!scanningEnabled}
                        value={scanningTarget.target}
                        onChange={(e) =>
                          setScanningTarget((prev) =>
                            sanitizeCompletionTarget(
                              { criterion: prev.criterion, target: Number(e.target.value) },
                              scanningParams.repetitions
                            )
                          )
                        }
                        className="w-full h-9 px-3 bg-white rounded-lg border border-[#C4C6CC] font-bold"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* MÓDULO 2: VISUAL SEARCH */}
              <div
                className={`border-2 rounded-xl p-5 transition-all ${
                  searchEnabled
                    ? 'border-[#006A62]/40 bg-white'
                    : 'border-[#C4C6CC]/40 bg-[#F3FAFF]/50 opacity-75'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#071524]/10">
                  <div className="flex items-center gap-3">
                    <input
                      id="mod-search"
                      type="checkbox"
                      checked={searchEnabled}
                      onChange={(e) => setSearchEnabled(e.target.checked)}
                      className="w-5 h-5 rounded accent-[#006A62] cursor-pointer"
                    />
                    <div>
                      <label htmlFor="mod-search" className="text-base font-bold text-[#071524] cursor-pointer">
                        Módulo 2: Búsqueda Visual (`visual-search`)
                      </label>
                      <p className="text-xs text-[#44474C]">
                        Modo: TARGET_SEARCH_WITH_DISTRACTORS · Distractores máx 20
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-xs font-semibold text-[#44474C]">Sesiones/día:</label>
                    <input
                      type="number"
                      min={1}
                      max={5}
                      disabled={!searchEnabled}
                      value={searchDailyCount}
                      onChange={(e) => setSearchDailyCount(clampInt(Number(e.target.value), 1, 5))}
                      className="w-16 h-9 px-2 text-center font-bold bg-[#E6F6FF] rounded-lg border border-[#C4C6CC] text-xs"
                    />
                    {isCognitoMode && activePlan && !createNewPlanMode && (
                      <button
                        type="button"
                        disabled={!searchEnabled || isSubmitting}
                        onClick={() => void handleAppendSingleConfiguration('visual-search')}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#1C2A39] hover:bg-[#071524] text-white text-xs font-bold disabled:opacity-50 cursor-pointer"
                      >
                        <Send className="w-3.5 h-3.5 text-[#84F5E8]" />
                        Agregar al Plan
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-4 text-xs">
                  <div>
                    <label className="block font-bold text-[#44474C] uppercase mb-1">Hemicampo (`LEFT | RIGHT`)</label>
                    <select
                      disabled={!searchEnabled}
                      value={searchParams.affectedHemifield}
                      onChange={(e) =>
                        setSearchParams((prev) => ({
                          ...prev,
                          affectedHemifield: e.target.value === 'RIGHT' ? 'RIGHT' : 'LEFT',
                        }))
                      }
                      className="w-full h-10 px-3 bg-[#F3FAFF] rounded-lg border border-[#C4C6CC] font-semibold"
                    >
                      <option value="LEFT">LEFT (Izquierdo)</option>
                      <option value="RIGHT">RIGHT (Derecho)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-bold text-[#44474C] uppercase mb-1">Dianas (`targetCount`)</label>
                    <input
                      type="number"
                      min={5}
                      max={40}
                      disabled={!searchEnabled}
                      value={searchParams.targetCount}
                      onChange={(e) =>
                        setSearchParams((prev) => ({
                          ...prev,
                          targetCount: clampInt(Number(e.target.value), 5, 40),
                        }))
                      }
                      className="w-full h-10 px-3 bg-[#F3FAFF] rounded-lg border border-[#C4C6CC] font-bold"
                    />
                    <span className="text-[10px] text-[#44474C]">Rango: 5–40 dianas</span>
                  </div>

                  <div>
                    <label className="block font-bold text-[#44474C] uppercase mb-1">Distractores</label>
                    <input
                      type="number"
                      min={0}
                      max={20}
                      disabled={!searchEnabled}
                      value={searchParams.distractorCount}
                      onChange={(e) =>
                        setSearchParams((prev) => ({
                          ...prev,
                          distractorCount: clampInt(Number(e.target.value), 0, 20),
                        }))
                      }
                      className="w-full h-10 px-3 bg-[#F3FAFF] rounded-lg border border-[#C4C6CC] font-bold"
                    />
                    <span className="text-[10px] text-[#44474C]">Rango estricto: 0–20 distractores</span>
                  </div>

                  <div>
                    <label className="block font-bold text-[#44474C] uppercase mb-1">Sesgo Hemicampo (`bias`)</label>
                    <input
                      type="number"
                      min={0.5}
                      max={1.0}
                      step={0.05}
                      disabled={!searchEnabled}
                      value={searchParams.affectedHemifieldBias}
                      onChange={(e) =>
                        setSearchParams((prev) => ({
                          ...prev,
                          affectedHemifieldBias: clampFloat(Number(e.target.value), 0.5, 1.0, 2),
                        }))
                      }
                      className="w-full h-10 px-3 bg-[#F3FAFF] rounded-lg border border-[#C4C6CC] font-bold"
                    />
                    <span className="text-[10px] text-[#44474C]">Rango: 0.50–1.00</span>
                  </div>

                  <div>
                    <label className="block font-bold text-[#44474C] uppercase mb-1">Fijación Mínima (ms)</label>
                    <input
                      type="number"
                      min={300}
                      max={2000}
                      step={50}
                      disabled={!searchEnabled}
                      value={searchParams.minimumFixationMs}
                      onChange={(e) =>
                        setSearchParams((prev) => ({
                          ...prev,
                          minimumFixationMs: clampInt(Number(e.target.value), 300, 2000),
                        }))
                      }
                      className="w-full h-10 px-3 bg-[#F3FAFF] rounded-lg border border-[#C4C6CC] font-bold"
                    />
                    <span className="text-[10px] text-[#44474C]">Rango: 300–2000 ms</span>
                  </div>

                  <div>
                    <label className="block font-bold text-[#44474C] uppercase mb-1">Tiempo Máx Búsqueda (ms)</label>
                    <input
                      type="number"
                      min={3000}
                      max={20000}
                      step={500}
                      disabled={!searchEnabled}
                      value={searchParams.maximumSearchTimeMs}
                      onChange={(e) =>
                        setSearchParams((prev) => ({
                          ...prev,
                          maximumSearchTimeMs: clampInt(Number(e.target.value), 3000, 20000),
                        }))
                      }
                      className="w-full h-10 px-3 bg-[#F3FAFF] rounded-lg border border-[#C4C6CC] font-bold"
                    />
                    <span className="text-[10px] text-[#44474C]">Rango: 3000–20000 ms</span>
                  </div>

                  <div>
                    <label className="block font-bold text-[#44474C] uppercase mb-1">Tamaño Diana (px) & Nivel</label>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="number"
                        min={30}
                        max={150}
                        disabled={!searchEnabled}
                        value={searchParams.targetSizePx}
                        onChange={(e) =>
                          setSearchParams((prev) => ({
                            ...prev,
                            targetSizePx: clampInt(Number(e.target.value), 30, 150),
                          }))
                        }
                        className="h-10 px-2 bg-[#F3FAFF] rounded-lg border border-[#C4C6CC] font-bold"
                      />
                      <select
                        disabled={!searchEnabled}
                        value={searchParams.difficultyLevel}
                        onChange={(e) =>
                          setSearchParams((prev) => ({
                            ...prev,
                            difficultyLevel: clampInt(Number(e.target.value), 1, 5),
                          }))
                        }
                        className="h-10 px-2 bg-[#F3FAFF] rounded-lg border border-[#C4C6CC] font-bold"
                      >
                        {[1, 2, 3, 4, 5].map((lvl) => (
                          <option key={lvl} value={lvl}>
                            Niv {lvl}
                          </option>
                        ))}
                      </select>
                    </div>
                    <span className="text-[10px] text-[#44474C]">Diana: 30–150 px · Nivel: 1–5</span>
                  </div>

                  {/* completionTarget */}
                  <div className="sm:col-span-2 lg:col-span-4 p-3 rounded-lg bg-[#E6F6FF] border border-[#071524]/10 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-bold text-[#071524] mb-1">Criterio de Meta (`completionTarget`)</label>
                      <select
                        disabled={!searchEnabled}
                        value={searchTarget.criterion}
                        onChange={(e) => {
                          const crit = e.target.value as TherapyCompletionTarget['criterion'];
                          setSearchTarget(
                            crit === 'REPETITIONS'
                              ? { criterion: 'REPETITIONS', target: Math.max(1, searchParams.targetCount) }
                              : { criterion: 'ACTIVE_TIME', target: 180 }
                          );
                        }}
                        className="w-full h-9 px-3 bg-white rounded-lg border border-[#C4C6CC] font-semibold"
                      >
                        <option value="REPETITIONS">REPETITIONS (&gt;= 1)</option>
                        <option value="ACTIVE_TIME">ACTIVE_TIME (Segundos activos)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-bold text-[#071524] mb-1">
                        Meta Objetivo ({searchTarget.criterion === 'REPETITIONS' ? '>= 1 (máx 100)' : '30–3600 seg'})
                      </label>
                      <input
                        type="number"
                        min={searchTarget.criterion === 'REPETITIONS' ? 1 : 30}
                        max={searchTarget.criterion === 'REPETITIONS' ? 100 : 3600}
                        disabled={!searchEnabled}
                        value={searchTarget.target}
                        onChange={(e) =>
                          setSearchTarget((prev) =>
                            sanitizeCompletionTarget(
                              { criterion: prev.criterion, target: Number(e.target.value) },
                              null
                            )
                          )
                        }
                        className="w-full h-9 px-3 bg-white rounded-lg border border-[#C4C6CC] font-bold"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* MÓDULO 3: FIXATION */}
              <div
                className={`border-2 rounded-xl p-5 transition-all ${
                  fixationEnabled
                    ? 'border-[#006A62]/40 bg-white'
                    : 'border-[#C4C6CC]/40 bg-[#F3FAFF]/50 opacity-75'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#071524]/10">
                  <div className="flex items-center gap-3">
                    <input
                      id="mod-fixation"
                      type="checkbox"
                      checked={fixationEnabled}
                      onChange={(e) => setFixationEnabled(e.target.checked)}
                      className="w-5 h-5 rounded accent-[#006A62] cursor-pointer"
                    />
                    <div>
                      <label htmlFor="mod-fixation" className="text-base font-bold text-[#071524] cursor-pointer">
                        Módulo 3: Fijación Ocular Sostenida (`fixation`)
                      </label>
                      <p className="text-xs text-[#44474C]">
                        Modo: SUSTAINED_TARGET_FIXATION · `maximumFixationMs &gt;= minimumFixationMs`
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-xs font-semibold text-[#44474C]">Sesiones/día:</label>
                    <input
                      type="number"
                      min={1}
                      max={5}
                      disabled={!fixationEnabled}
                      value={fixationDailyCount}
                      onChange={(e) => setFixationDailyCount(clampInt(Number(e.target.value), 1, 5))}
                      className="w-16 h-9 px-2 text-center font-bold bg-[#E6F6FF] rounded-lg border border-[#C4C6CC] text-xs"
                    />
                    {isCognitoMode && activePlan && !createNewPlanMode && (
                      <button
                        type="button"
                        disabled={!fixationEnabled || isSubmitting}
                        onClick={() => void handleAppendSingleConfiguration('fixation')}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#1C2A39] hover:bg-[#071524] text-white text-xs font-bold disabled:opacity-50 cursor-pointer"
                      >
                        <Send className="w-3.5 h-3.5 text-[#84F5E8]" />
                        Agregar al Plan
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-4 text-xs">
                  <div>
                    <label className="block font-bold text-[#44474C] uppercase mb-1">Posición Diana</label>
                    <select
                      disabled={!fixationEnabled}
                      value={fixationParams.targetPosition}
                      onChange={(e) =>
                        setFixationParams((prev) => ({
                          ...prev,
                          targetPosition: e.target.value as FixationParameters['targetPosition'],
                        }))
                      }
                      className="w-full h-10 px-3 bg-[#F3FAFF] rounded-lg border border-[#C4C6CC] font-semibold"
                    >
                      <option value="CENTER">CENTER</option>
                      <option value="LEFT">LEFT</option>
                      <option value="RIGHT">RIGHT</option>
                      <option value="RANDOM">RANDOM</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-bold text-[#44474C] uppercase mb-1">Fijación Mínima (ms)</label>
                    <input
                      type="number"
                      min={300}
                      max={3000}
                      step={50}
                      disabled={!fixationEnabled}
                      value={fixationParams.minimumFixationMs}
                      onChange={(e) =>
                        setFixationParams((prev) =>
                          sanitizeFixationParams({
                            ...prev,
                            minimumFixationMs: clampInt(Number(e.target.value), 300, 3000),
                          })
                        )
                      }
                      className="w-full h-10 px-3 bg-[#F3FAFF] rounded-lg border border-[#C4C6CC] font-bold"
                    />
                    <span className="text-[10px] text-[#44474C]">Rango: 300–3000 ms</span>
                  </div>

                  <div>
                    <label className="block font-bold text-[#44474C] uppercase mb-1">Fijación Máxima (ms)</label>
                    <input
                      type="number"
                      min={Math.max(500, fixationParams.minimumFixationMs)}
                      max={5000}
                      step={50}
                      disabled={!fixationEnabled}
                      value={fixationParams.maximumFixationMs}
                      onChange={(e) =>
                        setFixationParams((prev) =>
                          sanitizeFixationParams({
                            ...prev,
                            maximumFixationMs: Number(e.target.value),
                          })
                        )
                      }
                      className="w-full h-10 px-3 bg-[#F3FAFF] rounded-lg border border-[#C4C6CC] font-bold"
                    />
                    <span className="text-[10px] text-[#44474C]">
                      Rango: {Math.max(500, fixationParams.minimumFixationMs)}–5000 ms
                    </span>
                  </div>

                  <div>
                    <label className="block font-bold text-[#44474C] uppercase mb-1">Descanso Entre Reps (ms)</label>
                    <input
                      type="number"
                      min={500}
                      max={3000}
                      step={100}
                      disabled={!fixationEnabled}
                      value={fixationParams.restBetweenRepetitionsMs}
                      onChange={(e) =>
                        setFixationParams((prev) => ({
                          ...prev,
                          restBetweenRepetitionsMs: clampInt(Number(e.target.value), 500, 3000),
                        }))
                      }
                      className="w-full h-10 px-3 bg-[#F3FAFF] rounded-lg border border-[#C4C6CC] font-bold"
                    />
                    <span className="text-[10px] text-[#44474C]">Rango: 500–3000 ms</span>
                  </div>

                  <div>
                    <label className="block font-bold text-[#44474C] uppercase mb-1">Repeticiones</label>
                    <input
                      type="number"
                      min={5}
                      max={30}
                      disabled={!fixationEnabled}
                      value={fixationParams.repetitions}
                      onChange={(e) => {
                        const reps = clampInt(Number(e.target.value), 5, 30);
                        setFixationParams((prev) => ({ ...prev, repetitions: reps }));
                        if (fixationTarget.criterion === 'REPETITIONS' && fixationTarget.target > reps) {
                          setFixationTarget({ criterion: 'REPETITIONS', target: reps });
                        }
                      }}
                      className="w-full h-10 px-3 bg-[#F3FAFF] rounded-lg border border-[#C4C6CC] font-bold"
                    />
                    <span className="text-[10px] text-[#44474C]">Rango: 5–30 reps</span>
                  </div>

                  <div>
                    <label className="block font-bold text-[#44474C] uppercase mb-1">Tamaño Diana (px) & Nivel</label>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="number"
                        min={30}
                        max={150}
                        disabled={!fixationEnabled}
                        value={fixationParams.targetSizePx}
                        onChange={(e) =>
                          setFixationParams((prev) => ({
                            ...prev,
                            targetSizePx: clampInt(Number(e.target.value), 30, 150),
                          }))
                        }
                        className="h-10 px-2 bg-[#F3FAFF] rounded-lg border border-[#C4C6CC] font-bold"
                      />
                      <select
                        disabled={!fixationEnabled}
                        value={fixationParams.difficultyLevel}
                        onChange={(e) =>
                          setFixationParams((prev) => ({
                            ...prev,
                            difficultyLevel: clampInt(Number(e.target.value), 1, 5),
                          }))
                        }
                        className="h-10 px-2 bg-[#F3FAFF] rounded-lg border border-[#C4C6CC] font-bold"
                      >
                        {[1, 2, 3, 4, 5].map((lvl) => (
                          <option key={lvl} value={lvl}>
                            Niv {lvl}
                          </option>
                        ))}
                      </select>
                    </div>
                    <span className="text-[10px] text-[#44474C]">Diana: 30–150 px · Nivel: 1–5</span>
                  </div>

                  {/* completionTarget */}
                  <div className="sm:col-span-2 lg:col-span-4 p-3 rounded-lg bg-[#E6F6FF] border border-[#071524]/10 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-bold text-[#071524] mb-1">Criterio de Meta (`completionTarget`)</label>
                      <select
                        disabled={!fixationEnabled}
                        value={fixationTarget.criterion}
                        onChange={(e) => {
                          const crit = e.target.value as TherapyCompletionTarget['criterion'];
                          setFixationTarget(
                            crit === 'REPETITIONS'
                              ? { criterion: 'REPETITIONS', target: Math.min(10, fixationParams.repetitions) }
                              : { criterion: 'ACTIVE_TIME', target: 180 }
                          );
                        }}
                        className="w-full h-9 px-3 bg-white rounded-lg border border-[#C4C6CC] font-semibold"
                      >
                        <option value="REPETITIONS">REPETITIONS (Repeticiones exitosas)</option>
                        <option value="ACTIVE_TIME">ACTIVE_TIME (Segundos activos)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-bold text-[#071524] mb-1">
                        Meta Objetivo ({fixationTarget.criterion === 'REPETITIONS' ? `1–${fixationParams.repetitions} reps` : '30–3600 seg'})
                      </label>
                      <input
                        type="number"
                        min={fixationTarget.criterion === 'REPETITIONS' ? 1 : 30}
                        max={fixationTarget.criterion === 'REPETITIONS' ? fixationParams.repetitions : 3600}
                        disabled={!fixationEnabled}
                        value={fixationTarget.target}
                        onChange={(e) =>
                          setFixationTarget((prev) =>
                            sanitizeCompletionTarget(
                              { criterion: prev.criterion, target: Number(e.target.value) },
                              fixationParams.repetitions
                            )
                          )
                        }
                        className="w-full h-9 px-3 bg-white rounded-lg border border-[#C4C6CC] font-bold"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </form>
      </main>

      {/* Sticky Bottom Action Bar */}
      <aside
        aria-label="Acciones de guardado de prescripción"
        className="fixed bottom-0 left-0 w-full z-50 bg-white/95 backdrop-blur-md border-t-2 border-[#071524]/10 shadow-[0_-4px_16px_rgba(7,21,36,0.06)]"
      >
        <div className="max-w-[1280px] mx-auto px-4 md:px-6 py-3.5 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-5 text-xs text-[#44474C]">
            {isCognitoMode ? (
              <div>
                <span className="font-bold text-[#071524]">
                  {activePlan && !createNewPlanMode
                    ? `Plan Activo: ${activePlan.therapyPlanId.slice(0, 8)} (${activePlan.status})`
                    : 'Nuevo Plan Terapéutico'}
                </span>
                <span className="mx-2">•</span>
                <span className="text-[#006A62] font-bold">
                  {activeModulesCount} módulo(s) · Schema v2 validado
                </span>
              </div>
            ) : (
              <div>
                <span className="font-bold text-[#071524]">ID: PLN-2024-089</span>
                <span className="mx-2">•</span>
                <span className="text-[#006A62] font-bold">
                  Versión: {mockPlanVersion} ({activeModulesCount} módulos)
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto justify-end">
            {isCognitoMode ? (
              activePlan && !createNewPlanMode ? (
                <>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => void handleAppendAllEnabledConfigurations()}
                    className="h-11 px-4 rounded-lg border-2 border-[#071524] text-[#071524] font-bold hover:bg-[#E6F6FF] transition-colors text-xs cursor-pointer disabled:opacity-60 flex items-center gap-2"
                  >
                    <Send className="w-4 h-4 text-[#006A62]" />
                    <span>Agregar Configuración al Plan Actual</span>
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => void handleRevisePlan()}
                    className="h-11 px-5 rounded-lg bg-[#006A62] text-white font-bold hover:bg-[#005049] transition-all text-xs shadow-sm flex items-center gap-2 cursor-pointer disabled:opacity-60"
                  >
                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                    <span>Emitir Revisión del Plan</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => void handleCreatePlanAndConfigs()}
                  className="h-11 px-6 rounded-lg bg-[#006A62] text-white font-bold hover:bg-[#005049] transition-all text-xs shadow-sm flex items-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlusCircle className="w-4 h-4" />}
                  <span>Crear Plan Terapéutico y Publicar Configuraciones</span>
                </button>
              )
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleMockSaveDraft}
                  className="h-11 px-5 rounded-lg border-2 border-[#071524] text-[#071524] font-semibold hover:bg-[#E6F6FF] transition-colors text-xs sm:text-sm cursor-pointer"
                >
                  Guardar como Borrador
                </button>
                <button
                  type="button"
                  onClick={handleMockSaveImmutableVersion}
                  className="h-11 px-6 rounded-lg bg-[#006A62] text-white font-bold hover:bg-[#005049] transition-all text-xs sm:text-sm shadow-sm flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Lock className="w-4 h-4" />
                  <span>Guardar Versión Inmutable ({mockPlanVersion})</span>
                </button>
              </>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
};
