import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  User,
  Eye,
  HeartPulse,
  Radar,
  Compass,
  Crosshair,
  Sliders,
  Info,
  ArrowLeftRight,
  ShieldCheck,
  EyeOff,
  Gauge,
  Pause,
  Play,
  RotateCcw,
  Radio,
  Fingerprint,
  Smartphone,
  Save,
  CheckCircle2,
  AlertCircle,
  Loader2,
  PlusCircle,
} from 'lucide-react';
import { useAppStore } from '../../../../core/store/useAppStore';
import type { Patient } from '../../../../core/domain/Patient';
import {
  clinicalApi,
  extractApiErrorMessage,
  type AffectedHemifield,
  type AppendTherapeuticConfigurationBody,
  type AssignedPatientDetailResponse,
  type EffectiveTherapeuticConfiguration,
  type FixationParameters,
  type RehabilitationContextResponse,
  type TherapyCompletionTarget,
  type TherapyExerciseCode,
  type TherapyPlanDetailResponse,
  type VisualScanningParameters,
  type VisualSearchParameters,
} from '../../../../infrastructure/api';
import { SpecialistHeader } from '../components/SpecialistHeader';
import { SpecialistFooter } from '../components/SpecialistFooter';

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampFloat(value: number, min: number, max: number, decimals = 2): number {
  if (!Number.isFinite(value)) return min;
  const clamped = Math.min(max, Math.max(min, value));
  return Number(clamped.toFixed(decimals));
}

function sanitizeScanning(raw: VisualScanningParameters): VisualScanningParameters {
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

function sanitizeSearch(raw: VisualSearchParameters): VisualSearchParameters {
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

function sanitizeFixation(raw: FixationParameters): FixationParameters {
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

function sanitizeTarget(
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

export const FineParameterConfigPage: React.FC = () => {
  const { patientId } = useParams<{ patientId?: string }>();
  const navigate = useNavigate();
  const { patients, authMode, accessToken, setPrescription, updatePatient } = useAppStore();
  const isCognitoMode = authMode === 'COGNITO' && Boolean(accessToken);

  const effectivePatientId = patientId || patients[0]?.id || 'pat-000';

  // Estado remoto en modo COGNITO
  const [patientDetail, setPatientDetail] = useState<AssignedPatientDetailResponse | null>(null);
  const [rehabContext, setRehabContext] = useState<RehabilitationContextResponse | null>(null);
  const [activePlan, setActivePlan] = useState<TherapyPlanDetailResponse | null>(null);
  const [isLoadingRemote, setIsLoadingRemote] = useState<boolean>(false);
  const [isSavingRemote, setIsSavingRemote] = useState<boolean>(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [saveBanner, setSaveBanner] = useState<string | null>(null);

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

  const [activeModuleTab, setActiveModuleTab] = useState<'saccadic' | 'search' | 'fixation'>('saccadic');

  // === Parámetros estrictamente acotados por familia (Schema v2) ===
  const [scanningParams, setScanningParams] = useState<VisualScanningParameters>({
    mode: 'STANDARD_SCANNING',
    affectedHemifield: 'LEFT',
    minimumFixationMs: 650,
    maximumStimulusDurationMs: 5000,
    eccentricityDegrees: 25,
    targetSizePx: 64,
    repetitions: 15,
    interStimulusIntervalMs: 1000,
    difficultyLevel: 2,
  });
  const [scanningTarget, setScanningTarget] = useState<TherapyCompletionTarget>({
    criterion: 'REPETITIONS',
    target: 12,
  });

  const [searchParams, setSearchParams] = useState<VisualSearchParameters>({
    mode: 'TARGET_SEARCH_WITH_DISTRACTORS',
    affectedHemifield: 'LEFT',
    targetCount: 15,
    distractorCount: 10,
    minimumFixationMs: 550,
    maximumSearchTimeMs: 10000,
    affectedHemifieldBias: 0.75,
    targetSizePx: 60,
    difficultyLevel: 2,
  });
  const [searchTarget, setSearchTarget] = useState<TherapyCompletionTarget>({
    criterion: 'REPETITIONS',
    target: 10,
  });

  const [fixationParams, setFixationParams] = useState<FixationParameters>({
    mode: 'SUSTAINED_TARGET_FIXATION',
    targetPosition: 'CENTER',
    minimumFixationMs: 800,
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

  // Simulador en vivo
  const [isSimPaused, setIsSimPaused] = useState(false);
  const [simPositionX, setSimPositionX] = useState(0);
  const [simPositionY, setSimPositionY] = useState(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  }, []);

  const hydrateFromConfigs = useCallback(
    (configs: EffectiveTherapeuticConfiguration[], defaultHemifield: AffectedHemifield) => {
      setScanningParams((prev) => ({ ...prev, affectedHemifield: defaultHemifield }));
      setSearchParams((prev) => ({ ...prev, affectedHemifield: defaultHemifield }));

      const scanCfg =
        configs.find((c) => c.exerciseCode === 'visual-scanning' && c.status === 'ACTIVE') ??
        configs.find((c) => c.exerciseCode === 'visual-scanning');
      if (scanCfg && scanCfg.exerciseCode === 'visual-scanning') {
        const inner =
          scanCfg.parameterSchemaVersion === 2
            ? scanCfg.parameters.parameters
            : scanCfg.parameters;
        const clean = sanitizeScanning(inner);
        setScanningParams(clean);
        if (scanCfg.parameterSchemaVersion === 2) {
          setScanningTarget(sanitizeTarget(scanCfg.parameters.completionTarget, clean.repetitions));
        }
      }

      const searchCfg =
        configs.find((c) => c.exerciseCode === 'visual-search' && c.status === 'ACTIVE') ??
        configs.find((c) => c.exerciseCode === 'visual-search');
      if (searchCfg && searchCfg.exerciseCode === 'visual-search') {
        const inner =
          searchCfg.parameterSchemaVersion === 2
            ? searchCfg.parameters.parameters
            : searchCfg.parameters;
        const clean = sanitizeSearch(inner);
        setSearchParams(clean);
        if (searchCfg.parameterSchemaVersion === 2) {
          setSearchTarget(sanitizeTarget(searchCfg.parameters.completionTarget, null));
        }
      }

      const fixCfg =
        configs.find((c) => c.exerciseCode === 'fixation' && c.status === 'ACTIVE') ??
        configs.find((c) => c.exerciseCode === 'fixation');
      if (fixCfg && fixCfg.exerciseCode === 'fixation') {
        const inner =
          fixCfg.parameterSchemaVersion === 2
            ? fixCfg.parameters.parameters
            : fixCfg.parameters;
        const clean = sanitizeFixation(inner);
        setFixationParams(clean);
        if (fixCfg.parameterSchemaVersion === 2) {
          setFixationTarget(sanitizeTarget(fixCfg.parameters.completionTarget, clean.repetitions));
        }
      }
    },
    []
  );

  const loadRemoteData = useCallback(async () => {
    if (!isCognitoMode || !effectivePatientId || effectivePatientId === 'pat-000') return;
    setIsLoadingRemote(true);
    setRemoteError(null);

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
    }

    if (plansRes.status === 'fulfilled') {
      const plans = plansRes.value.plans;
      if (plans.length > 0) {
        const preferred = plans.find((p) => p.status === 'ACTIVE') ?? plans[0];
        try {
          const detail = await clinicalApi.getTherapyPlanDetail(
            effectivePatientId,
            preferred.therapyPlanId
          );
          setActivePlan(detail);
          hydrateFromConfigs(detail.configurations || [], defaultHemifield);
        } catch (err) {
          setRemoteError(extractApiErrorMessage(err));
        }
      } else {
        setActivePlan(null);
        hydrateFromConfigs([], defaultHemifield);
      }
    } else {
      setRemoteError(extractApiErrorMessage(plansRes.reason));
    }

    setIsLoadingRemote(false);
  }, [isCognitoMode, effectivePatientId, hydrateFromConfigs]);

  useEffect(() => {
    if (isCognitoMode) {
      void loadRemoteData();
    }
  }, [isCognitoMode, loadRemoteData]);

  // Variables derivadas para el simulador visual
  const activeHemifield: AffectedHemifield =
    activeModuleTab === 'saccadic'
      ? scanningParams.affectedHemifield
      : activeModuleTab === 'search'
      ? searchParams.affectedHemifield
      : fixationParams.targetPosition === 'RIGHT'
      ? 'RIGHT'
      : 'LEFT';

  const simEccentricity =
    activeModuleTab === 'saccadic'
      ? scanningParams.eccentricityDegrees
      : activeModuleTab === 'search'
      ? 24
      : fixationParams.targetPosition === 'CENTER'
      ? 5
      : 16;

  const simDwellMs =
    activeModuleTab === 'saccadic'
      ? scanningParams.minimumFixationMs
      : activeModuleTab === 'search'
      ? searchParams.minimumFixationMs
      : fixationParams.minimumFixationMs;

  const simTargetSizePx =
    activeModuleTab === 'saccadic'
      ? scanningParams.targetSizePx
      : activeModuleTab === 'search'
      ? searchParams.targetSizePx
      : fixationParams.targetSizePx;

  const simDifficulty =
    activeModuleTab === 'saccadic'
      ? scanningParams.difficultyLevel
      : activeModuleTab === 'search'
      ? searchParams.difficultyLevel
      : fixationParams.difficultyLevel;

  const isLeftHemifield = activeHemifield === 'LEFT';

  // Animación reactiva del simulador según excentricidad (5..30°), dificultad y hemicampo
  useEffect(() => {
    if (isSimPaused) return;
    let animFrame: number;
    const startTime = performance.now();

    const animate = (now: number) => {
      const elapsedSec = (now - startTime) / 1000;
      const maxOffsetPx = (simEccentricity / 30) * 140;
      const freq = 0.65 + simDifficulty * 0.25;
      const biasMagnitude =
        activeModuleTab === 'search' ? (searchParams.affectedHemifieldBias - 0.5) * 90 : 28;
      const biasSign = isLeftHemifield ? -1 : 1;

      const x =
        activeModuleTab === 'fixation' && fixationParams.targetPosition === 'CENTER'
          ? Math.sin(elapsedSec * freq * 1.5) * 12
          : Math.sin(elapsedSec * freq * 2.1) * maxOffsetPx + biasSign * biasMagnitude;

      const y =
        activeModuleTab === 'search'
          ? Math.cos(elapsedSec * freq * 3.1) * 58
          : activeModuleTab === 'fixation'
          ? Math.sin(elapsedSec * freq * 2.2) * 16
          : Math.sin(elapsedSec * freq * 1.4) * 20;

      setSimPositionX(x);
      setSimPositionY(y);
      animFrame = requestAnimationFrame(animate);
    };

    animFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrame);
  }, [
    isSimPaused,
    activeModuleTab,
    simEccentricity,
    simDifficulty,
    isLeftHemifield,
    searchParams.affectedHemifieldBias,
    fixationParams.targetPosition,
  ]);

  const activeExerciseCode: TherapyExerciseCode =
    activeModuleTab === 'saccadic'
      ? 'visual-scanning'
      : activeModuleTab === 'search'
      ? 'visual-search'
      : 'fixation';

  const buildActiveConfigurationBody = (): AppendTherapeuticConfigurationBody => {
    const effectiveFrom = new Date(Date.now() + 2000).toISOString();
    if (activeExerciseCode === 'visual-scanning') {
      const clean = sanitizeScanning(scanningParams);
      const target = sanitizeTarget(scanningTarget, clean.repetitions);
      return {
        exerciseCode: 'visual-scanning',
        parameterSchemaVersion: 2,
        effectiveFrom,
        parameters: {
          parameters: clean,
          completionTarget: target,
        },
      };
    }
    if (activeExerciseCode === 'visual-search') {
      const clean = sanitizeSearch(searchParams);
      const target = sanitizeTarget(searchTarget, null);
      return {
        exerciseCode: 'visual-search',
        parameterSchemaVersion: 2,
        effectiveFrom,
        parameters: {
          parameters: clean,
          completionTarget: target,
        },
      };
    }
    const clean = sanitizeFixation(fixationParams);
    const target = sanitizeTarget(fixationTarget, clean.repetitions);
    return {
      exerciseCode: 'fixation',
      parameterSchemaVersion: 2,
      effectiveFrom,
      parameters: {
        parameters: clean,
        completionTarget: target,
      },
    };
  };

  const syncStorePreview = (planId?: string, configId?: string, configVersion?: number) => {
    const normalizedSpeed = Number((0.6 + simDifficulty * 0.35).toFixed(2));
    const normalizedAmplitude = Number((simEccentricity / 30).toFixed(2));
    const body = buildActiveConfigurationBody();

    const frozenParams =
      body.parameterSchemaVersion === 2
        ? body.parameters.parameters
        : body.parameters;
    const target =
      body.parameterSchemaVersion === 2 ? body.parameters.completionTarget : undefined;

    setPrescription({
      prescriptionId: configId || `EX-FINE-${Date.now()}`,
      patientId: currentPatient.id,
      gameId: activeExerciseCode,
      parameters: {
        target_speed: normalizedSpeed,
        visual_field_amplitude: normalizedAmplitude,
        min_fixation_time: simDwellMs,
      },
      ...(planId
        ? {
            clinicalContext: {
              therapyPlanId: planId,
              exerciseCode: activeExerciseCode,
              mode: frozenParams.mode,
              configurationId: configId,
              configurationVersion: configVersion,
              parameterSchemaVersion: 2,
              frozenParameters: frozenParams,
              completionTarget: target,
              sessionLimits: activePlan
                ? {
                    minimumValidDurationMinutes: activePlan.minimumValidDurationMinutes,
                    maximumSessionDurationMinutes: activePlan.maximumSessionDurationMinutes,
                    minimumValidSampleCount: activePlan.minimumValidSampleCount,
                  }
                : undefined,
            },
          }
        : {}),
    });
  };

  const handleResetProtocolDefaults = () => {
    const defaultHemi: AffectedHemifield =
      rehabContext?.affectedHemifield ??
      (currentPatient.affectedHemifield === 'RIGHT' ? 'RIGHT' : 'LEFT');

    setScanningParams({
      mode: 'STANDARD_SCANNING',
      affectedHemifield: defaultHemi,
      minimumFixationMs: 650,
      maximumStimulusDurationMs: 5000,
      eccentricityDegrees: 25,
      targetSizePx: 64,
      repetitions: 15,
      interStimulusIntervalMs: 1000,
      difficultyLevel: 2,
    });
    setScanningTarget({ criterion: 'REPETITIONS', target: 12 });

    setSearchParams({
      mode: 'TARGET_SEARCH_WITH_DISTRACTORS',
      affectedHemifield: defaultHemi,
      targetCount: 15,
      distractorCount: 10,
      minimumFixationMs: 550,
      maximumSearchTimeMs: 10000,
      affectedHemifieldBias: 0.75,
      targetSizePx: 60,
      difficultyLevel: 2,
    });
    setSearchTarget({ criterion: 'REPETITIONS', target: 10 });

    setFixationParams({
      mode: 'SUSTAINED_TARGET_FIXATION',
      targetPosition: 'CENTER',
      minimumFixationMs: 800,
      maximumFixationMs: 2500,
      targetSizePx: 56,
      repetitions: 12,
      restBetweenRepetitionsMs: 1000,
      difficultyLevel: 2,
    });
    setFixationTarget({ criterion: 'REPETITIONS', target: 10 });

    setSaveBanner(null);
    showToast('Parámetros restablecidos dentro de los límites clínicos Schema v2.');
  };

  const handleApplyAndSave = async () => {
    setRemoteError(null);
    setSaveBanner(null);

    if (isCognitoMode) {
      if (!activePlan) {
        setRemoteError(
          'El paciente aún no tiene un Plan Terapéutico creado. Cree primero un plan en "Prescripción Terapéutica" para poder adjuntar configuraciones.'
        );
        return;
      }

      setIsSavingRemote(true);
      try {
        const body = buildActiveConfigurationBody();
        const res = await clinicalApi.appendConfiguration(
          effectivePatientId,
          activePlan.therapyPlanId,
          body
        );
        await new Promise((resolve) => setTimeout(resolve, 2100));
        syncStorePreview(activePlan.therapyPlanId, res.configurationId, res.version);
        await loadRemoteData();
        const okMsg = `Configuración ${res.exerciseCode} v${res.version} (Schema v${res.parameterSchemaVersion}) guardada en el plan.`;
        setSaveBanner(okMsg);
        showToast(okMsg);
      } catch (err) {
        setRemoteError(extractApiErrorMessage(err));
      } finally {
        setIsSavingRemote(false);
      }
      return;
    }

    // Modo MOCK
    syncStorePreview();
    updatePatient({
      ...currentPatient,
      clinicalNotes: `${currentPatient.clinicalNotes || ''} [Ajuste fino ${activeExerciseCode}: ${simEccentricity}° exc, Dwell ${simDwellMs}ms, Diana ${simTargetSizePx}px]`,
    });
    const mockMsg = 'Parámetros aplicados y sincronizados con el motor Serious Games del paciente.';
    setSaveBanner(mockMsg);
    showToast(mockMsg);
  };

  const estimatedSaccadesPerMin = Math.round(60000 / Math.max(800, simDwellMs + 900));
  const estimatedLatencyMs = Math.max(120, Math.round(simDwellMs * 0.58));

  return (
    <div className="bg-[#F3FAFF] text-[#071E27] antialiased min-h-screen flex flex-col font-sans selection:bg-[#84F5E8] selection:text-[#00201D]">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-20 right-6 z-50 bg-[#071524] text-white px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-xs font-semibold border border-[#006A62]">
          <CheckCircle2 className="w-4 h-4 text-[#84F5E8]" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* TOP APP BAR */}
      <SpecialistHeader
        activeTab="protocolos"
        onTabChange={(tab) => {
          if (tab === 'pacientes') navigate('/specialist/dashboard');
          else if (tab === 'telemetria') navigate(`/specialist/patients/${currentPatient.id}/auditoria`);
          else if (tab === 'interconsultas') navigate(`/specialist/patients/${currentPatient.id}/reporte-pdf`);
        }}
        onOpenNotifications={() => showToast('Motor de calibración fino conectado (Schema v2).')}
      />

      {/* PATIENT CONTEXT HEADER BANNER */}
      <section className="bg-white border-b border-[#071524]/10 py-4 px-4 md:px-8 shadow-xs">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start md:items-center gap-4">
            <button
              onClick={() => navigate(`/specialist/patients/${currentPatient.id}`)}
              className="inline-flex items-center gap-1.5 text-[#071524] hover:bg-[#DBF1FE] px-3 py-2 rounded-lg transition-colors border border-[#071524]/10 text-xs font-bold cursor-pointer shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Expediente HC {currentPatient.medicalRecordNumber}</span>
            </button>

            <div className="w-11 h-11 rounded-xl bg-[#CFE6F2] flex items-center justify-center text-[#071524] shrink-0">
              <User className="w-6 h-6" />
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-lg sm:text-xl font-bold text-[#071524]">
                  {currentPatient.name}
                </h1>
                <span className="text-xs font-mono font-semibold bg-[#D5E4F8] text-[#0E1D2B] px-2 py-0.5 rounded">
                  HC {currentPatient.medicalRecordNumber}
                </span>
                {isCognitoMode && activePlan && (
                  <span className="text-xs font-mono font-bold bg-[#81F3E5] text-[#005049] px-2.5 py-0.5 rounded">
                    Plan {activePlan.therapyPlanId.slice(0, 8)} · v{activePlan.configurationVersion}
                  </span>
                )}
              </div>
              <p className="text-xs font-semibold text-[#006A62] flex items-center gap-1.5 mt-0.5">
                <span>•</span>
                {currentPatient.primaryDiagnosisTitle ||
                  `Hemianopsia Homónima ${isLeftHemifield ? 'Izquierda' : 'Derecha'}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="bg-[#E6F6FF] border border-[#006A62]/20 rounded-lg p-2.5 flex items-center gap-3">
              <div className="w-9 h-9 rounded bg-[#006A62]/15 flex items-center justify-center text-[#006A62]">
                <Eye className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#006A62]" />
                  <span className="text-[11px] font-bold text-[#006A62] uppercase tracking-wider">
                    Validación Schema v2
                  </span>
                </div>
                <p className="text-xs text-[#071E27] font-semibold">
                  Límites Clínicos Activos
                </p>
              </div>
            </div>

            <div className="hidden sm:flex bg-[#E6F6FF] border border-[#071524]/10 rounded-lg p-2.5 items-center gap-3">
              <div className="w-9 h-9 rounded bg-[#1C2A39]/10 flex items-center justify-center text-[#071524]">
                <HeartPulse className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[11px] font-bold text-[#071E27] uppercase tracking-wider block">
                  Hemicampo Base
                </span>
                <p className="text-xs text-[#44474C] font-medium">
                  {rehabContext?.affectedHemifield ?? currentPatient.affectedHemifield}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* NAVIGATION TABS FOR EXERCISES */}
      <nav className="bg-[#E6F6FF] border-b border-[#071524]/10 px-4 md:px-8 sticky top-16 z-30">
        <div className="max-w-7xl mx-auto flex items-center space-x-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveModuleTab('saccadic')}
            className={`flex items-center gap-2.5 py-3.5 px-4 text-xs sm:text-sm transition-all whitespace-nowrap cursor-pointer ${
              activeModuleTab === 'saccadic'
                ? 'text-[#071524] font-bold border-b-4 border-[#006A62] bg-[#F3FAFF]'
                : 'text-[#44474C] hover:text-[#071524] hover:bg-[#F3FAFF]/60 font-medium'
            }`}
          >
            <Radar className="w-4 h-4 text-[#006A62]" />
            <span>1. Exploración Sacádica (`visual-scanning`)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveModuleTab('search')}
            className={`flex items-center gap-2.5 py-3.5 px-4 text-xs sm:text-sm transition-all whitespace-nowrap cursor-pointer ${
              activeModuleTab === 'search'
                ? 'text-[#071524] font-bold border-b-4 border-[#006A62] bg-[#F3FAFF]'
                : 'text-[#44474C] hover:text-[#071524] hover:bg-[#F3FAFF]/60 font-medium'
            }`}
          >
            <Compass className="w-4 h-4 text-[#006A62]" />
            <span>2. Búsqueda Visual (`visual-search`)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveModuleTab('fixation')}
            className={`flex items-center gap-2.5 py-3.5 px-4 text-xs sm:text-sm transition-all whitespace-nowrap cursor-pointer ${
              activeModuleTab === 'fixation'
                ? 'text-[#071524] font-bold border-b-4 border-[#006A62] bg-[#F3FAFF]'
                : 'text-[#44474C] hover:text-[#071524] hover:bg-[#F3FAFF]/60 font-medium'
            }`}
          >
            <Crosshair className="w-4 h-4 text-[#006A62]" />
            <span>3. Fijación Sostenida (`fixation`)</span>
          </button>
        </div>
      </nav>

      {/* MAIN TWO-COLUMN CONTENT AREA */}
      <main className="flex-grow max-w-7xl mx-auto w-full px-4 md:px-8 py-6">
        {/* Status Banners */}
        {isCognitoMode && isLoadingRemote && (
          <div className="mb-5 p-4 rounded-xl bg-white border border-[#071524]/10 flex items-center gap-2.5 text-xs font-semibold text-[#006A62]">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Cargando plan terapéutico y parámetros vigentes...</span>
          </div>
        )}

        {isCognitoMode && !isLoadingRemote && !activePlan && !remoteError && (
          <div className="mb-5 p-4 rounded-xl bg-[#FFDCC4] border border-[#FFB780] text-[#6F3800] text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Este paciente aún no tiene un Plan Terapéutico activo</p>
                <p>Cree primero un plan para poder guardar configuraciones Schema v2 desde el ajuste fino.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate(`/specialist/patients/${currentPatient.id}/prescripcion`)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#071524] text-white font-bold shrink-0 cursor-pointer"
            >
              <PlusCircle className="w-3.5 h-3.5 text-[#84F5E8]" />
              Ir a Crear Plan
            </button>
          </div>
        )}

        {remoteError && (
          <div className="mb-5 p-4 rounded-xl bg-[#FFDAD6] border border-[#BA1A1A]/30 text-[#93000A] text-xs font-semibold flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#BA1A1A]" />
            <span>{remoteError}</span>
          </div>
        )}

        {saveBanner && (
          <div className="mb-5 p-4 rounded-xl bg-[#81F3E5]/30 border border-[#006A62]/30 text-[#005049] text-xs font-bold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#006A62] shrink-0" />
            <span>{saveBanner}</span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* COLUMN 1: CLINICAL PARAMETERIZATION CONTROLS (7 cols) */}
          <section className="lg:col-span-7 space-y-5">
            {/* Header Card */}
            <div className="bg-white rounded-xl border border-[#071524]/10 p-5 flex items-start gap-4 shadow-xs">
              <div className="w-10 h-10 rounded-lg bg-[#D5ECF8] flex items-center justify-center text-[#071524] shrink-0">
                <Sliders className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-bold text-[#071524]">
                  {activeModuleTab === 'saccadic'
                    ? 'Parametrización de Exploración Sacádica (visual-scanning)'
                    : activeModuleTab === 'search'
                    ? 'Parametrización de Búsqueda Visual (visual-search)'
                    : 'Parametrización de Fijación Sostenida (fixation)'}
                </h2>
                <p className="text-xs sm:text-sm text-[#44474C] mt-1">
                  Controles estrictamente acotados a Schema v2 para el hemicampo{' '}
                  <strong>{isLeftHemifield ? 'izquierdo (LEFT)' : 'derecho (RIGHT)'}</strong>.
                </p>
              </div>
            </div>

            {/* === TAB 1: VISUAL SCANNING === */}
            {activeModuleTab === 'saccadic' && (
              <>
                <div className="bg-white rounded-xl border border-[#071524]/10 p-5 grid grid-cols-1 sm:grid-cols-2 gap-4 shadow-xs text-xs">
                  <div>
                    <label className="font-bold text-[#071524] block mb-1">Modo de Exploración</label>
                    <select
                      value={scanningParams.mode}
                      onChange={(e) =>
                        setScanningParams((prev) => ({
                          ...prev,
                          mode: e.target.value as VisualScanningParameters['mode'],
                        }))
                      }
                      className="w-full h-11 px-3 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC] font-semibold"
                    >
                      <option value="STANDARD_SCANNING">STANDARD_SCANNING</option>
                      <option value="SYSTEMATIC_EXPLORATION">SYSTEMATIC_EXPLORATION</option>
                      <option value="COMPENSATORY_SACCADE">COMPENSATORY_SACCADE</option>
                    </select>
                  </div>
                  <div>
                    <label className="font-bold text-[#071524] block mb-1">Hemicampo Objetivo (`LEFT | RIGHT`)</label>
                    <select
                      value={scanningParams.affectedHemifield}
                      onChange={(e) =>
                        setScanningParams((prev) => ({
                          ...prev,
                          affectedHemifield: e.target.value === 'RIGHT' ? 'RIGHT' : 'LEFT',
                        }))
                      }
                      className="w-full h-11 px-3 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC] font-semibold"
                    >
                      <option value="LEFT">LEFT (Hemicampo Izquierdo)</option>
                      <option value="RIGHT">RIGHT (Hemicampo Derecho)</option>
                    </select>
                  </div>
                </div>

                {/* Excentricidad (5..30°) */}
                <div className="bg-white rounded-xl border border-[#071524]/10 p-5 space-y-3 shadow-xs">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-sm font-bold text-[#071524] flex items-center gap-2">
                        <span>1. Excentricidad Angular (`eccentricityDegrees`)</span>
                        <span title="Límite estricto del contrato Schema 2: 5° a 30°">
                          <Info className="w-4 h-4 text-[#74777C]" />
                        </span>
                      </label>
                      <p className="text-xs text-[#44474C]">Rango válido: 5° a 30° enteros</p>
                    </div>
                    <span className="text-base font-bold bg-[#071524] text-white px-3 py-1 rounded">
                      {scanningParams.eccentricityDegrees}°
                    </span>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={30}
                    step={1}
                    value={scanningParams.eccentricityDegrees}
                    onChange={(e) =>
                      setScanningParams((prev) => ({
                        ...prev,
                        eccentricityDegrees: clampInt(Number(e.target.value), 5, 30),
                      }))
                    }
                    className="w-full h-3 bg-[#CFE6F2] rounded-lg cursor-pointer accent-[#006A62]"
                  />
                  <div className="flex justify-between text-xs text-[#44474C] font-medium">
                    <span>5° (Fóvea)</span>
                    <span>15° (Parafóvea)</span>
                    <span className="text-[#006A62] font-bold">25° (Objetivo)</span>
                    <span>30° (Máximo Backend)</span>
                  </div>
                </div>

                {/* Dwell Time (300..2000 ms) */}
                <div className="bg-white rounded-xl border border-[#071524]/10 p-5 space-y-3 shadow-xs">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-sm font-bold text-[#071524]">
                        2. Fijación Mínima (`minimumFixationMs`)
                      </label>
                      <p className="text-xs text-[#44474C]">Rango válido: 300–2000 ms</p>
                    </div>
                    <span className="text-base font-bold bg-[#CFE6F2] text-[#071524] px-3 py-1 rounded">
                      {scanningParams.minimumFixationMs} ms
                    </span>
                  </div>
                  <input
                    type="range"
                    min={300}
                    max={2000}
                    step={50}
                    value={scanningParams.minimumFixationMs}
                    onChange={(e) =>
                      setScanningParams((prev) => ({
                        ...prev,
                        minimumFixationMs: clampInt(Number(e.target.value), 300, 2000),
                      }))
                    }
                    className="w-full h-3 bg-[#CFE6F2] rounded-lg cursor-pointer accent-[#006A62]"
                  />
                  <div className="flex justify-between text-xs text-[#44474C]">
                    <span>300 ms</span>
                    <span>1000 ms</span>
                    <span>2000 ms</span>
                  </div>
                </div>

                {/* Duración máx estímulo, Repeticiones, ISI */}
                <div className="bg-white rounded-xl border border-[#071524]/10 p-5 grid grid-cols-1 sm:grid-cols-3 gap-4 shadow-xs text-xs">
                  <div>
                    <label className="font-bold text-[#071524] block mb-1">
                      Duración Máx Estímulo (ms)
                    </label>
                    <input
                      type="number"
                      min={2000}
                      max={10000}
                      step={250}
                      value={scanningParams.maximumStimulusDurationMs}
                      onChange={(e) =>
                        setScanningParams((prev) => ({
                          ...prev,
                          maximumStimulusDurationMs: clampInt(Number(e.target.value), 2000, 10000),
                        }))
                      }
                      className="w-full h-11 px-3 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC] font-bold"
                    />
                    <span className="text-[10px] text-[#44474C]">Rango: 2000–10000 ms</span>
                  </div>

                  <div>
                    <label className="font-bold text-[#071524] block mb-1">Repeticiones</label>
                    <input
                      type="number"
                      min={5}
                      max={50}
                      value={scanningParams.repetitions}
                      onChange={(e) => {
                        const reps = clampInt(Number(e.target.value), 5, 50);
                        setScanningParams((prev) => ({ ...prev, repetitions: reps }));
                        if (scanningTarget.criterion === 'REPETITIONS' && scanningTarget.target > reps) {
                          setScanningTarget({ criterion: 'REPETITIONS', target: reps });
                        }
                      }}
                      className="w-full h-11 px-3 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC] font-bold"
                    />
                    <span className="text-[10px] text-[#44474C]">Rango: 5–50 reps</span>
                  </div>

                  <div>
                    <label className="font-bold text-[#071524] block mb-1">Intervalo ISI (ms)</label>
                    <input
                      type="number"
                      min={500}
                      max={3000}
                      step={100}
                      value={scanningParams.interStimulusIntervalMs}
                      onChange={(e) =>
                        setScanningParams((prev) => ({
                          ...prev,
                          interStimulusIntervalMs: clampInt(Number(e.target.value), 500, 3000),
                        }))
                      }
                      className="w-full h-11 px-3 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC] font-bold"
                    />
                    <span className="text-[10px] text-[#44474C]">Rango: 500–3000 ms</span>
                  </div>
                </div>
              </>
            )}

            {/* === TAB 2: VISUAL SEARCH === */}
            {activeModuleTab === 'search' && (
              <>
                <div className="bg-white rounded-xl border border-[#071524]/10 p-5 grid grid-cols-1 sm:grid-cols-2 gap-4 shadow-xs text-xs">
                  <div>
                    <label className="font-bold text-[#071524] block mb-1">Hemicampo Objetivo (`LEFT | RIGHT`)</label>
                    <select
                      value={searchParams.affectedHemifield}
                      onChange={(e) =>
                        setSearchParams((prev) => ({
                          ...prev,
                          affectedHemifield: e.target.value === 'RIGHT' ? 'RIGHT' : 'LEFT',
                        }))
                      }
                      className="w-full h-11 px-3 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC] font-semibold"
                    >
                      <option value="LEFT">LEFT (Hemicampo Izquierdo)</option>
                      <option value="RIGHT">RIGHT (Hemicampo Derecho)</option>
                    </select>
                  </div>
                  <div>
                    <label className="font-bold text-[#071524] block mb-1">Dianas (`targetCount` · 5–40)</label>
                    <input
                      type="number"
                      min={5}
                      max={40}
                      value={searchParams.targetCount}
                      onChange={(e) =>
                        setSearchParams((prev) => ({
                          ...prev,
                          targetCount: clampInt(Number(e.target.value), 5, 40),
                        }))
                      }
                      className="w-full h-11 px-3 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC] font-bold"
                    />
                  </div>
                </div>

                {/* Distractores (0..20) */}
                <div className="bg-white rounded-xl border border-[#071524]/10 p-5 space-y-3 shadow-xs">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-sm font-bold text-[#071524]">
                        1. Distractores Simultáneos (`distractorCount`)
                      </label>
                      <p className="text-xs text-[#44474C]">Rango estricto: 0–20 distractores</p>
                    </div>
                    <span className="text-base font-bold bg-[#071524] text-white px-3 py-1 rounded">
                      {searchParams.distractorCount}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={20}
                    step={1}
                    value={searchParams.distractorCount}
                    onChange={(e) =>
                      setSearchParams((prev) => ({
                        ...prev,
                        distractorCount: clampInt(Number(e.target.value), 0, 20),
                      }))
                    }
                    className="w-full h-3 bg-[#CFE6F2] rounded-lg cursor-pointer accent-[#006A62]"
                  />
                  <div className="flex justify-between text-xs text-[#44474C]">
                    <span>0 (Sin distractores)</span>
                    <span>10 (Moderado)</span>
                    <span>20 (Máximo Backend)</span>
                  </div>
                </div>

                {/* Hemifield Bias (0.50..1.00) */}
                <div className="bg-white rounded-xl border-2 border-[#006A62]/30 p-5 space-y-3 shadow-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="w-9 h-9 rounded-full bg-[#006A62]/15 flex items-center justify-center text-[#006A62]">
                        <ArrowLeftRight className="w-4 h-4" />
                      </span>
                      <div>
                        <h3 className="text-sm font-bold text-[#071524]">
                          2. Sesgo hacia Hemicampo Deficitario (`affectedHemifieldBias`)
                        </h3>
                        <p className="text-xs text-[#44474C]">Rango estricto: 0.50 a 1.00</p>
                      </div>
                    </div>
                    <span className="text-base font-bold bg-[#E6F6FF] text-[#006A62] px-3 py-1 rounded">
                      {Math.round(searchParams.affectedHemifieldBias * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.5}
                    max={1.0}
                    step={0.05}
                    value={searchParams.affectedHemifieldBias}
                    onChange={(e) =>
                      setSearchParams((prev) => ({
                        ...prev,
                        affectedHemifieldBias: clampFloat(Number(e.target.value), 0.5, 1.0, 2),
                      }))
                    }
                    className="w-full h-3 bg-[#CFE6F2] rounded-lg cursor-pointer accent-[#006A62]"
                  />
                  <div className="flex justify-between text-xs text-[#44474C]">
                    <span>0.50 (Neutro 50/50)</span>
                    <span>0.75 (Recomendado)</span>
                    <span>1.00 (100% Hemicampo Ciego)</span>
                  </div>
                </div>

                {/* Dwell Time + Search Time */}
                <div className="bg-white rounded-xl border border-[#071524]/10 p-5 grid grid-cols-1 sm:grid-cols-2 gap-4 shadow-xs text-xs">
                  <div>
                    <label className="font-bold text-[#071524] block mb-1">
                      Fijación Mínima (`minimumFixationMs`)
                    </label>
                    <input
                      type="number"
                      min={300}
                      max={2000}
                      step={50}
                      value={searchParams.minimumFixationMs}
                      onChange={(e) =>
                        setSearchParams((prev) => ({
                          ...prev,
                          minimumFixationMs: clampInt(Number(e.target.value), 300, 2000),
                        }))
                      }
                      className="w-full h-11 px-3 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC] font-bold"
                    />
                    <span className="text-[10px] text-[#44474C]">Rango: 300–2000 ms</span>
                  </div>
                  <div>
                    <label className="font-bold text-[#071524] block mb-1">
                      Tiempo Máx Búsqueda (`maximumSearchTimeMs`)
                    </label>
                    <input
                      type="number"
                      min={3000}
                      max={20000}
                      step={500}
                      value={searchParams.maximumSearchTimeMs}
                      onChange={(e) =>
                        setSearchParams((prev) => ({
                          ...prev,
                          maximumSearchTimeMs: clampInt(Number(e.target.value), 3000, 20000),
                        }))
                      }
                      className="w-full h-11 px-3 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC] font-bold"
                    />
                    <span className="text-[10px] text-[#44474C]">Rango: 3000–20000 ms</span>
                  </div>
                </div>
              </>
            )}

            {/* === TAB 3: FIXATION === */}
            {activeModuleTab === 'fixation' && (
              <>
                <div className="bg-white rounded-xl border border-[#071524]/10 p-5 grid grid-cols-1 sm:grid-cols-2 gap-4 shadow-xs text-xs">
                  <div>
                    <label className="font-bold text-[#071524] block mb-1">Posición de Diana (`targetPosition`)</label>
                    <select
                      value={fixationParams.targetPosition}
                      onChange={(e) =>
                        setFixationParams((prev) => ({
                          ...prev,
                          targetPosition: e.target.value as FixationParameters['targetPosition'],
                        }))
                      }
                      className="w-full h-11 px-3 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC] font-semibold"
                    >
                      <option value="CENTER">CENTER (Centro Foveal)</option>
                      <option value="LEFT">LEFT (Izquierda)</option>
                      <option value="RIGHT">RIGHT (Derecha)</option>
                      <option value="RANDOM">RANDOM (Aleatoria)</option>
                    </select>
                  </div>
                  <div>
                    <label className="font-bold text-[#071524] block mb-1">Repeticiones (`repetitions` · 5–30)</label>
                    <input
                      type="number"
                      min={5}
                      max={30}
                      value={fixationParams.repetitions}
                      onChange={(e) => {
                        const reps = clampInt(Number(e.target.value), 5, 30);
                        setFixationParams((prev) => ({ ...prev, repetitions: reps }));
                        if (fixationTarget.criterion === 'REPETITIONS' && fixationTarget.target > reps) {
                          setFixationTarget({ criterion: 'REPETITIONS', target: reps });
                        }
                      }}
                      className="w-full h-11 px-3 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC] font-bold"
                    />
                  </div>
                </div>

                {/* Minimum & Maximum Fixation (with max >= min invariant) */}
                <div className="bg-white rounded-xl border border-[#071524]/10 p-5 space-y-4 shadow-xs">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-sm font-bold text-[#071524]">
                        1. Ventana de Fijación (`minimumFixationMs` / `maximumFixationMs`)
                      </label>
                      <p className="text-xs text-[#44474C]">
                        Mínima 300–3000 ms · Máxima 500–5000 ms (automáticamente &gt;= mínima)
                      </p>
                    </div>
                    <span className="text-sm font-bold bg-[#CFE6F2] text-[#071524] px-3 py-1 rounded">
                      {fixationParams.minimumFixationMs}–{fixationParams.maximumFixationMs} ms
                    </span>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <span className="text-xs font-semibold text-[#071524] block mb-1">
                        Fijación Mínima: {fixationParams.minimumFixationMs} ms
                      </span>
                      <input
                        type="range"
                        min={300}
                        max={3000}
                        step={50}
                        value={fixationParams.minimumFixationMs}
                        onChange={(e) =>
                          setFixationParams((prev) =>
                            sanitizeFixation({
                              ...prev,
                              minimumFixationMs: clampInt(Number(e.target.value), 300, 3000),
                            })
                          )
                        }
                        className="w-full h-3 bg-[#CFE6F2] rounded-lg cursor-pointer accent-[#006A62]"
                      />
                    </div>

                    <div>
                      <span className="text-xs font-semibold text-[#071524] block mb-1">
                        Fijación Máxima: {fixationParams.maximumFixationMs} ms
                      </span>
                      <input
                        type="range"
                        min={Math.max(500, fixationParams.minimumFixationMs)}
                        max={5000}
                        step={50}
                        value={fixationParams.maximumFixationMs}
                        onChange={(e) =>
                          setFixationParams((prev) =>
                            sanitizeFixation({
                              ...prev,
                              maximumFixationMs: Number(e.target.value),
                            })
                          )
                        }
                        className="w-full h-3 bg-[#CFE6F2] rounded-lg cursor-pointer accent-[#006A62]"
                      />
                    </div>
                  </div>
                </div>

                {/* Rest between repetitions */}
                <div className="bg-white rounded-xl border border-[#071524]/10 p-5 space-y-2 shadow-xs text-xs">
                  <div className="flex items-center justify-between">
                    <label className="font-bold text-[#071524]">
                      2. Descanso entre Repeticiones (`restBetweenRepetitionsMs`)
                    </label>
                    <span className="font-bold text-[#006A62]">{fixationParams.restBetweenRepetitionsMs} ms</span>
                  </div>
                  <input
                    type="range"
                    min={500}
                    max={3000}
                    step={100}
                    value={fixationParams.restBetweenRepetitionsMs}
                    onChange={(e) =>
                      setFixationParams((prev) => ({
                        ...prev,
                        restBetweenRepetitionsMs: clampInt(Number(e.target.value), 500, 3000),
                      }))
                    }
                    className="w-full h-3 bg-[#CFE6F2] rounded-lg cursor-pointer accent-[#006A62]"
                  />
                  <div className="flex justify-between text-[#44474C]">
                    <span>500 ms</span>
                    <span>1500 ms</span>
                    <span>3000 ms</span>
                  </div>
                </div>
              </>
            )}

            {/* Shared Parameters Across All 3 Families: targetSizePx (30..150), difficultyLevel (1..5), completionTarget */}
            <div className="bg-white rounded-xl border border-[#071524]/10 p-5 space-y-4 shadow-xs text-xs">
              <h3 className="text-xs font-bold text-[#74777C] uppercase tracking-wider">
                Parámetros Compartidos Schema v2 (`targetSizePx`, `difficultyLevel`, `completionTarget`)
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-[#F3FAFF] p-3 rounded-lg border border-[#071524]/10">
                  <div className="flex justify-between mb-1">
                    <label className="font-bold text-[#071524]">Tamaño de Diana (`targetSizePx`)</label>
                    <span className="font-mono font-bold text-[#006A62]">{simTargetSizePx} px</span>
                  </div>
                  <input
                    type="range"
                    min={30}
                    max={150}
                    step={2}
                    value={simTargetSizePx}
                    onChange={(e) => {
                      const val = clampInt(Number(e.target.value), 30, 150);
                      if (activeModuleTab === 'saccadic') {
                        setScanningParams((prev) => ({ ...prev, targetSizePx: val }));
                      } else if (activeModuleTab === 'search') {
                        setSearchParams((prev) => ({ ...prev, targetSizePx: val }));
                      } else {
                        setFixationParams((prev) => ({ ...prev, targetSizePx: val }));
                      }
                    }}
                    className="w-full accent-[#006A62]"
                  />
                  <span className="text-[10px] text-[#44474C] block mt-1">Rango estricto: 30–150 px</span>
                </div>

                <div className="bg-[#F3FAFF] p-3 rounded-lg border border-[#071524]/10">
                  <label className="font-bold text-[#071524] block mb-1">
                    Nivel de Dificultad (`difficultyLevel` · 1–5)
                  </label>
                  <select
                    value={simDifficulty}
                    onChange={(e) => {
                      const val = clampInt(Number(e.target.value), 1, 5);
                      if (activeModuleTab === 'saccadic') {
                        setScanningParams((prev) => ({ ...prev, difficultyLevel: val }));
                      } else if (activeModuleTab === 'search') {
                        setSearchParams((prev) => ({ ...prev, difficultyLevel: val }));
                      } else {
                        setFixationParams((prev) => ({ ...prev, difficultyLevel: val }));
                      }
                    }}
                    className="w-full h-10 px-3 bg-white border border-[#071524]/20 rounded font-bold text-[#071524]"
                  >
                    {[1, 2, 3, 4, 5].map((lvl) => (
                      <option key={lvl} value={lvl}>
                        Nivel {lvl} / 5
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* completionTarget editor for active tab */}
              {(() => {
                const currentTarget =
                  activeModuleTab === 'saccadic'
                    ? scanningTarget
                    : activeModuleTab === 'search'
                    ? searchTarget
                    : fixationTarget;
                const maxReps =
                  activeModuleTab === 'saccadic'
                    ? scanningParams.repetitions
                    : activeModuleTab === 'fixation'
                    ? fixationParams.repetitions
                    : null;
                const setTarget =
                  activeModuleTab === 'saccadic'
                    ? setScanningTarget
                    : activeModuleTab === 'search'
                    ? setSearchTarget
                    : setFixationTarget;

                return (
                  <div className="bg-[#E6F6FF] p-3.5 rounded-lg border border-[#071524]/10 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="font-bold text-[#071524] block mb-1">
                        Criterio de Meta (`completionTarget.criterion`)
                      </label>
                      <select
                        value={currentTarget.criterion}
                        onChange={(e) => {
                          const crit = e.target.value as TherapyCompletionTarget['criterion'];
                          setTarget(
                            crit === 'REPETITIONS'
                              ? { criterion: 'REPETITIONS', target: maxReps ? Math.min(10, maxReps) : 10 }
                              : { criterion: 'ACTIVE_TIME', target: 180 }
                          );
                        }}
                        className="w-full h-10 px-3 bg-white border border-[#C4C6CC] rounded-lg font-semibold"
                      >
                        <option value="REPETITIONS">REPETITIONS (Repeticiones)</option>
                        <option value="ACTIVE_TIME">ACTIVE_TIME (Segundos activos)</option>
                      </select>
                    </div>
                    <div>
                      <label className="font-bold text-[#071524] block mb-1">
                        Valor Objetivo (
                        {currentTarget.criterion === 'REPETITIONS'
                          ? maxReps
                            ? `1–${maxReps} reps`
                            : '1–100 (>= 1)'
                          : '30–3600 seg'}
                        )
                      </label>
                      <input
                        type="number"
                        min={currentTarget.criterion === 'REPETITIONS' ? 1 : 30}
                        max={
                          currentTarget.criterion === 'REPETITIONS'
                            ? maxReps ?? 100
                            : 3600
                        }
                        value={currentTarget.target}
                        onChange={(e) =>
                          setTarget((prev) =>
                            sanitizeTarget(
                              { criterion: prev.criterion, target: Number(e.target.value) },
                              maxReps
                            )
                          )
                        }
                        className="w-full h-10 px-3 bg-white border border-[#C4C6CC] rounded-lg font-bold"
                      />
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Safety Certification Notice */}
            <div className="flex items-center gap-3 bg-[#D5ECF8] text-[#071524] p-4 rounded-xl border border-[#006A62]/30">
              <ShieldCheck className="w-6 h-6 text-[#006A62] shrink-0" />
              <p className="text-xs leading-relaxed font-medium">
                <strong className="font-bold">Validación Schema 2 Activa:</strong> Todos los rangos se ajustan automáticamente a los límites aceptados por el microservicio clínico antes del envío.
              </p>
            </div>
          </section>

          {/* COLUMN 2: REAL-TIME SIMULATION & INTERACTIVE PREVIEW WIDGET (5 cols) */}
          <section className="lg:col-span-5 space-y-6">
            {/* Preview Card */}
            <div className="bg-white rounded-xl border border-[#071524]/10 overflow-hidden flex flex-col shadow-xs">
              <div className="p-4 bg-[#E6F6FF] border-b border-[#071524]/10 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-[#006A62] animate-pulse" />
                  <h3 className="text-sm font-bold text-[#071524]">Simulación del Campo Visual</h3>
                </div>
                <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-[#1C2A39] text-white">
                  60 FPS • Schema v2
                </span>
              </div>

              {/* Interactive Graphic Canvas */}
              <div
                className="relative bg-[#1C2A39] h-80 w-full overflow-hidden flex items-center justify-center select-none"
                style={{
                  backgroundImage:
                    'linear-gradient(to right, rgba(131,145,164,0.12) 1px, transparent 1px), linear-gradient(to bottom, rgba(131,145,164,0.12) 1px, transparent 1px)',
                  backgroundSize: '24px 24px',
                }}
              >
                {/* Left Hemifield */}
                <div
                  className={`absolute left-0 top-0 bottom-0 w-1/2 flex flex-col justify-between p-3 pointer-events-none ${
                    isLeftHemifield
                      ? 'bg-[#BA1A1A]/15 border-r-2 border-dashed border-[#BA1A1A]/50'
                      : ''
                  }`}
                >
                  <div
                    className={`flex items-center gap-1.5 ${
                      isLeftHemifield ? 'text-[#FFDAD6]' : 'text-[#84F5E8]'
                    }`}
                  >
                    {isLeftHemifield ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    <span className="text-[11px] font-bold uppercase tracking-wider">
                      {isLeftHemifield ? 'Hemicampo Ciego (Izq)' : 'Hemicampo Sano (Izq)'}
                    </span>
                  </div>
                </div>

                {/* Right Hemifield */}
                <div
                  className={`absolute right-0 top-0 bottom-0 w-1/2 flex flex-col justify-between p-3 pointer-events-none text-right ${
                    !isLeftHemifield
                      ? 'bg-[#BA1A1A]/15 border-l-2 border-dashed border-[#BA1A1A]/50'
                      : ''
                  }`}
                >
                  <div
                    className={`flex items-center justify-end gap-1.5 ${
                      !isLeftHemifield ? 'text-[#FFDAD6]' : 'text-[#84F5E8]'
                    }`}
                  >
                    <span className="text-[11px] font-bold uppercase tracking-wider">
                      {!isLeftHemifield ? 'Hemicampo Ciego (Der)' : 'Hemicampo Sano (Der)'}
                    </span>
                    {!isLeftHemifield ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </div>
                </div>

                {/* Central Foveal Meridian Line (0°) */}
                <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-0.5 bg-[#84F5E8]/70 flex flex-col items-center justify-center">
                  <div className="w-7 h-7 rounded-full border-2 border-[#84F5E8] flex items-center justify-center bg-[#1C2A39]/80 z-10 shadow-xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#84F5E8]" />
                  </div>
                  <span className="absolute top-2 text-[10px] font-mono text-[#84F5E8] bg-[#1C2A39] px-1 rounded border border-[#84F5E8]/40">
                    0° Fóvea
                  </span>
                </div>

                {/* Degree Horizon Axis Markers (clamped to -30°..+30°) */}
                <div className="absolute bottom-2 left-6 text-[10px] font-mono text-[#B9C8DB]">-30°</div>
                <div className="absolute bottom-2 left-1/4 text-[10px] font-mono text-[#B9C8DB]">-15°</div>
                <div className="absolute bottom-2 right-1/4 text-[10px] font-mono text-[#B9C8DB]">+15°</div>
                <div className="absolute bottom-2 right-6 text-[10px] font-mono text-[#B9C8DB]">+30°</div>

                {/* Target Stimulus Node */}
                <div
                  style={{
                    transform: `translate(${simPositionX}px, ${simPositionY}px)`,
                  }}
                  className="relative z-20 flex items-center justify-center transition-transform duration-75"
                >
                  <div
                    style={{
                      width: `${Math.min(64, Math.max(24, Math.round(simTargetSizePx * 0.45)))}px`,
                      height: `${Math.min(64, Math.max(24, Math.round(simTargetSizePx * 0.45)))}px`,
                    }}
                    className="rounded-full border-2 border-[#84F5E8] border-dashed animate-spin"
                  />
                  <div className="absolute w-4 h-4 rounded-full bg-[#84F5E8] shadow-[0_0_12px_#84f5e8] ring-2 ring-[#071524]" />
                </div>

                {/* Velocity / Direction Vector Indicator */}
                <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-[#071524]/85 backdrop-blur-xs px-3 py-1 rounded text-[11px] font-mono text-[#84F5E8] border border-[#84F5E8]/30 flex items-center gap-1.5 whitespace-nowrap">
                  <Gauge className="w-3.5 h-3.5" />
                  <span>
                    {simEccentricity}° • {simTargetSizePx}px • Dwell {simDwellMs}ms
                  </span>
                </div>
              </div>

              {/* Real-Time Metrics Deck */}
              <div className="p-4 bg-[#F3FAFF] border-t border-[#071524]/10 grid grid-cols-3 gap-3 text-center">
                <div className="p-2.5 rounded bg-[#E6F6FF] border border-[#071524]/10">
                  <p className="text-xs text-[#44474C] font-medium">Estímulos / min</p>
                  <p className="text-lg font-bold text-[#071524] mt-0.5">
                    {estimatedSaccadesPerMin}
                  </p>
                </div>
                <div className="p-2.5 rounded bg-[#E6F6FF] border border-[#071524]/10">
                  <p className="text-xs text-[#44474C] font-medium">Dificultad</p>
                  <p className="text-lg font-bold text-[#006A62] mt-0.5">
                    Nivel {simDifficulty}/5
                  </p>
                </div>
                <div className="p-2.5 rounded bg-[#E6F6FF] border border-[#071524]/10">
                  <p className="text-xs text-[#44474C] font-medium">Latencia Est.</p>
                  <p className="text-lg font-bold text-[#071524] mt-0.5">
                    ~{estimatedLatencyMs} <span className="text-[11px] font-normal">ms</span>
                  </p>
                </div>
              </div>

              {/* Preview Control Toolbar */}
              <div className="p-4 bg-white border-t border-[#071524]/10 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsSimPaused(!isSimPaused)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#DBF1FE] hover:bg-[#D5ECF8] text-[#071524] text-xs font-bold transition-all border border-[#071524]/10 cursor-pointer"
                  >
                    {isSimPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                    <span>{isSimPaused ? 'Reanudar' : 'Pausar'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSimPositionX(0);
                      setSimPositionY(0);
                      setIsSimPaused(false);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#DBF1FE] hover:bg-[#D5ECF8] text-[#071524] text-xs font-bold transition-all border border-[#071524]/10 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reiniciar</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    syncStorePreview(activePlan?.therapyPlanId);
                    navigate('/serious-games');
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#006A62] text-white text-xs font-bold hover:bg-[#005049] transition-all shadow-xs cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Probar Estímulo en Vivo</span>
                </button>
              </div>
            </div>

            {/* Telemetry & Sensor Integrity Card */}
            <div className="bg-white rounded-xl border border-[#071524]/10 p-5 space-y-4 shadow-xs">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-[#071524] flex items-center gap-2">
                  <Radio className="w-4 h-4 text-[#006A62]" />
                  Resumen de Payload Schema v2 (`{activeExerciseCode}`)
                </h4>
              </div>
              <pre className="p-3 rounded-lg bg-[#071524] text-[#84F5E8] text-[11px] font-mono overflow-x-auto max-h-56">
                {JSON.stringify(buildActiveConfigurationBody(), null, 2)}
              </pre>
            </div>
          </section>
        </div>
      </main>

      {/* CLINICAL ACTIONS AND TRACEABILITY BOTTOM BAR */}
      <footer className="bg-[#E6F6FF] border-t border-[#071524]/10 py-5 px-4 md:px-8">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#071524]/10 flex items-center justify-center text-[#071524]">
              <Fingerprint className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-[#44474C]">
                Configuración activa:{' '}
                <strong className="text-[#071524]">{activeExerciseCode} (Schema v2)</strong>
              </p>
              <p className="text-xs font-mono font-bold text-[#071524]">
                {activePlan
                  ? `Plan ${activePlan.therapyPlanId.slice(0, 8)} • v${activePlan.configurationVersion}`
                  : 'Modo Local / Previsualización'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto justify-end">
            <button
              type="button"
              onClick={handleResetProtocolDefaults}
              className="h-12 px-4 rounded-lg border-2 border-[#071524] text-[#071524] text-xs sm:text-sm font-bold hover:bg-[#DBF1FE] transition-all flex items-center gap-2 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Restablecer Valores</span>
            </button>

            <button
              type="button"
              onClick={() => {
                syncStorePreview(activePlan?.therapyPlanId);
                showToast(`Previsualización sincronizada para ${currentPatient.name}.`);
              }}
              className="h-12 px-4 rounded-lg border-2 border-[#006A62] text-[#006A62] text-xs sm:text-sm font-bold hover:bg-[#006A62]/10 transition-all flex items-center gap-2 cursor-pointer"
            >
              <Smartphone className="w-4 h-4" />
              <span>Sincronizar Simulador</span>
            </button>

            <button
              type="button"
              disabled={isSavingRemote}
              onClick={() => void handleApplyAndSave()}
              className="h-12 px-6 rounded-lg bg-[#006A62] text-white text-xs sm:text-sm font-bold hover:bg-[#005049] transition-all shadow-md flex items-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {isSavingRemote ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              <span>
                {isCognitoMode
                  ? 'Guardar Configuración en Plan (Schema v2)'
                  : 'Aplicar Parámetros y Actualizar Plan'}
              </span>
            </button>
          </div>
        </div>
      </footer>

      <SpecialistFooter />
    </div>
  );
};
