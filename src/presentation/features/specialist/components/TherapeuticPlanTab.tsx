import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sliders,
  Target,
  Sparkles,
  Save,
  CheckCircle2,
  Zap,
  Clock,
  ExternalLink,
  Layers,
  Shield,
  AlertCircle,
  Loader2,
  PlusCircle,
} from 'lucide-react';
import type { Patient } from '../../../../core/domain/Patient';
import { useAppStore } from '../../../../core/store/useAppStore';
import {
  clinicalApi,
  extractApiErrorMessage,
  type EffectiveTherapeuticConfiguration,
  type TherapyCompletionTarget,
  type TherapyExerciseCode,
  type TherapyPlanDetailResponse,
  type TherapyPlanStatus,
  type TherapyPlanSummary,
} from '../../../../infrastructure/api';

interface TherapeuticPlanTabProps {
  patient: Patient;
  onPlanUpdated?: () => void;
  plans?: TherapyPlanSummary[];
  activePlanDetail?: TherapyPlanDetailResponse | null;
  plansLoading?: boolean;
  plansError?: string | null;
  onSelectPlan?: (therapyPlanId: string) => void;
}

const EXERCISE_LABELS: Record<TherapyExerciseCode, string> = {
  'visual-scanning': 'Exploración Sacádica (Visual Scanning)',
  'visual-search': 'Búsqueda Visual (Visual Search)',
  fixation: 'Fijación Sostenida (Fixation)',
};

function getPlanStatusBadge(status: TherapyPlanStatus): { label: string; className: string } {
  if (status === 'ACTIVE') {
    return { label: 'ACTIVO', className: 'bg-[#81F3E5] text-[#005049]' };
  }
  if (status === 'SUSPENDED') {
    return { label: 'SUSPENDIDO', className: 'bg-[#FFDCC4] text-[#6F3800]' };
  }
  return { label: 'CANCELADO', className: 'bg-[#FFDAD6] text-[#93000A]' };
}

function formatDateTime(iso: string): string {
  try {
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return iso;
    return parsed.toLocaleString('es-PE', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function extractCompletionTarget(
  cfg: EffectiveTherapeuticConfiguration
): TherapyCompletionTarget | null {
  if (cfg.parameterSchemaVersion === 2) {
    return cfg.parameters.completionTarget;
  }
  return null;
}

function renderConfigurationDetails(cfg: EffectiveTherapeuticConfiguration): React.ReactNode {
  if (cfg.exerciseCode === 'visual-scanning') {
    const p = cfg.parameterSchemaVersion === 2 ? cfg.parameters.parameters : cfg.parameters;
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
        <div className="p-2 rounded bg-[#F3FAFF]">
          <span className="text-[#44474C] block">Modo</span>
          <strong className="text-[#071524]">{p.mode}</strong>
        </div>
        <div className="p-2 rounded bg-[#F3FAFF]">
          <span className="text-[#44474C] block">Hemicampo</span>
          <strong className="text-[#006A62]">{p.affectedHemifield}</strong>
        </div>
        <div className="p-2 rounded bg-[#F3FAFF]">
          <span className="text-[#44474C] block">Excentricidad</span>
          <strong className="text-[#071524]">{p.eccentricityDegrees}°</strong>
        </div>
        <div className="p-2 rounded bg-[#F3FAFF]">
          <span className="text-[#44474C] block">Fijación / Repeticiones</span>
          <strong className="text-[#071524]">
            {p.minimumFixationMs} ms · {p.repetitions} reps
          </strong>
        </div>
        <div className="p-2 rounded bg-[#F3FAFF]">
          <span className="text-[#44474C] block">Estímulo Máx / ISI</span>
          <strong className="text-[#071524]">
            {p.maximumStimulusDurationMs} / {p.interStimulusIntervalMs} ms
          </strong>
        </div>
        <div className="p-2 rounded bg-[#F3FAFF]">
          <span className="text-[#44474C] block">Diana / Dificultad</span>
          <strong className="text-[#071524]">
            {p.targetSizePx} px · Nivel {p.difficultyLevel}
          </strong>
        </div>
      </div>
    );
  }

  if (cfg.exerciseCode === 'visual-search') {
    const p = cfg.parameterSchemaVersion === 2 ? cfg.parameters.parameters : cfg.parameters;
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
        <div className="p-2 rounded bg-[#F3FAFF]">
          <span className="text-[#44474C] block">Modo</span>
          <strong className="text-[#071524]">{p.mode}</strong>
        </div>
        <div className="p-2 rounded bg-[#F3FAFF]">
          <span className="text-[#44474C] block">Hemicampo / Sesgo</span>
          <strong className="text-[#006A62]">
            {p.affectedHemifield} ({Math.round(p.affectedHemifieldBias * 100)}%)
          </strong>
        </div>
        <div className="p-2 rounded bg-[#F3FAFF]">
          <span className="text-[#44474C] block">Dianas / Distractores</span>
          <strong className="text-[#071524]">
            {p.targetCount} / {p.distractorCount}
          </strong>
        </div>
        <div className="p-2 rounded bg-[#F3FAFF]">
          <span className="text-[#44474C] block">Fijación / Búsqueda Máx</span>
          <strong className="text-[#071524]">
            {p.minimumFixationMs} ms · {p.maximumSearchTimeMs} ms
          </strong>
        </div>
        <div className="p-2 rounded bg-[#F3FAFF]">
          <span className="text-[#44474C] block">Diana / Dificultad</span>
          <strong className="text-[#071524]">
            {p.targetSizePx} px · Nivel {p.difficultyLevel}
          </strong>
        </div>
      </div>
    );
  }

  const p = cfg.parameterSchemaVersion === 2 ? cfg.parameters.parameters : cfg.parameters;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
      <div className="p-2 rounded bg-[#F3FAFF]">
        <span className="text-[#44474C] block">Modo</span>
        <strong className="text-[#071524]">{p.mode}</strong>
      </div>
      <div className="p-2 rounded bg-[#F3FAFF]">
        <span className="text-[#44474C] block">Posición Diana</span>
        <strong className="text-[#006A62]">{p.targetPosition}</strong>
      </div>
      <div className="p-2 rounded bg-[#F3FAFF]">
        <span className="text-[#44474C] block">Ventana Fijación</span>
        <strong className="text-[#071524]">
          {p.minimumFixationMs}–{p.maximumFixationMs} ms
        </strong>
      </div>
      <div className="p-2 rounded bg-[#F3FAFF]">
        <span className="text-[#44474C] block">Repeticiones / Descanso</span>
        <strong className="text-[#071524]">
          {p.repetitions} reps · {p.restBetweenRepetitionsMs} ms
        </strong>
      </div>
      <div className="p-2 rounded bg-[#F3FAFF]">
        <span className="text-[#44474C] block">Diana / Dificultad</span>
        <strong className="text-[#071524]">
          {p.targetSizePx} px · Nivel {p.difficultyLevel}
        </strong>
      </div>
    </div>
  );
}

export const TherapeuticPlanTab: React.FC<TherapeuticPlanTabProps> = ({
  patient,
  onPlanUpdated,
  plans,
  activePlanDetail,
  plansLoading = false,
  plansError = null,
  onSelectPlan,
}) => {
  const navigate = useNavigate();
  const { authMode, accessToken, updatePatient } = useAppStore();
  const isCognitoMode = authMode === 'COGNITO' && Boolean(accessToken);

  // Soporte autónomo si el componente se monta sin que el padre pase plans
  const [selfPlans, setSelfPlans] = useState<TherapyPlanSummary[]>([]);
  const [selfPlanDetail, setSelfPlanDetail] = useState<TherapyPlanDetailResponse | null>(null);
  const [selfLoading, setSelfLoading] = useState(false);
  const [selfError, setSelfError] = useState<string | null>(null);

  const loadSelfPlans = useCallback(async () => {
    if (!isCognitoMode || !patient.id) return;
    setSelfLoading(true);
    setSelfError(null);
    try {
      const res = await clinicalApi.listTherapyPlans(patient.id, { page: 0, size: 20 });
      setSelfPlans(res.plans);
      if (res.plans.length > 0) {
        const preferred = res.plans.find((p) => p.status === 'ACTIVE') ?? res.plans[0];
        const detail = await clinicalApi.getTherapyPlanDetail(patient.id, preferred.therapyPlanId);
        setSelfPlanDetail(detail);
      } else {
        setSelfPlanDetail(null);
      }
    } catch (err) {
      setSelfError(extractApiErrorMessage(err));
    } finally {
      setSelfLoading(false);
    }
  }, [isCognitoMode, patient.id]);

  useEffect(() => {
    if (isCognitoMode && plans === undefined) {
      void loadSelfPlans();
    }
  }, [isCognitoMode, plans, loadSelfPlans]);

  const effectivePlans = plans !== undefined ? plans : selfPlans;
  const effectiveDetail = activePlanDetail !== undefined ? activePlanDetail : selfPlanDetail;
  const isLoading = plans !== undefined ? plansLoading : selfLoading;
  const loadError = plans !== undefined ? plansError : selfError;

  const handleChoosePlan = async (therapyPlanId: string) => {
    if (onSelectPlan) {
      onSelectPlan(therapyPlanId);
      return;
    }
    try {
      setSelfLoading(true);
      const detail = await clinicalApi.getTherapyPlanDetail(patient.id, therapyPlanId);
      setSelfPlanDetail(detail);
    } catch (err) {
      setSelfError(extractApiErrorMessage(err));
    } finally {
      setSelfLoading(false);
    }
  };

  // Estado para modo MOCK
  const [targetSpeed, setTargetSpeed] = useState(
    patient.activePlan?.exercises?.[0]?.targetSpeed ?? 1.2
  );
  const [visualFieldAmplitude, setVisualFieldAmplitude] = useState(
    patient.activePlan?.exercises?.[0]?.visualFieldAmplitude ?? 0.85
  );
  const [minFixationTime, setMinFixationTime] = useState(
    patient.activePlan?.exercises?.[0]?.minFixationTimeMs ?? 650
  );
  const [isSaved, setIsSaved] = useState(false);

  if (isCognitoMode) {
    return (
      <div className="space-y-6">
        {loadError && (
          <div className="bg-[#FFDAD6] border border-[#BA1A1A]/30 text-[#93000A] rounded-xl p-4 flex items-start gap-2.5 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{loadError}</span>
          </div>
        )}

        {isLoading && !effectiveDetail ? (
          <div className="bg-white p-10 rounded-xl border border-[#071524]/10 shadow-xs flex items-center justify-center gap-2 text-xs font-semibold text-[#006A62]">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Cargando planes terapéuticos desde Clinical Service...</span>
          </div>
        ) : effectivePlans.length === 0 && !effectiveDetail ? (
          <div className="bg-white p-8 rounded-xl border border-[#071524]/10 shadow-xs text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-[#E6F6FF] text-[#006A62] flex items-center justify-center mx-auto">
              <Layers className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-[#071524]">
              Paciente sin Plan Terapéutico asignado
            </h3>
            <p className="text-xs text-[#44474C] max-w-md mx-auto">
              Cree el plan inicial definiendo los límites diarios de sesión, prescripciones por módulo y parámetros clínicos Schema v2.
            </p>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => navigate(`/specialist/patients/${patient.id}/prescripcion`)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#006A62] hover:bg-[#005049] text-white font-bold text-xs shadow-xs cursor-pointer"
              >
                <PlusCircle className="w-4 h-4" />
                Crear Plan Terapéutico
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Selector de Planes del Paciente */}
            {effectivePlans.length > 0 && (
              <div className="bg-white p-4 rounded-xl border border-[#071524]/10 shadow-xs flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-[#44474C] uppercase tracking-wider mr-1">
                    Planes ({effectivePlans.length}):
                  </span>
                  {effectivePlans.map((summary) => {
                    const badge = getPlanStatusBadge(summary.status);
                    const isSelected = effectiveDetail?.therapyPlanId === summary.therapyPlanId;
                    return (
                      <button
                        key={summary.therapyPlanId}
                        type="button"
                        onClick={() => void handleChoosePlan(summary.therapyPlanId)}
                        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                          isSelected
                            ? 'border-[#006A62] bg-[#E6F6FF] text-[#071524]'
                            : 'border-[#C4C6CC]/60 bg-white text-[#44474C] hover:bg-[#F3FAFF]'
                        }`}
                      >
                        <span className="font-mono">{summary.therapyPlanId.slice(0, 8)}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${badge.className}`}>
                          {badge.label}
                        </span>
                        <span className="text-[10px] font-mono text-[#44474C]">
                          v{summary.configurationVersion}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => navigate(`/specialist/patients/${patient.id}/prescripcion`)}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-[#071524] bg-[#F3FAFF] hover:bg-[#DBF1FE] border border-[#C4C6CC]/60 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-[#006A62]" />
                    Prescripción y Revisiones
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate(`/specialist/patients/${patient.id}/parametros`)}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-[#006A62] bg-[#DBF1FE] hover:bg-[#84F5E8]/40 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Ajuste Fino Schema v2
                  </button>
                </div>
              </div>
            )}

            {/* Detalle del Plan Activo / Seleccionado */}
            {effectiveDetail && (
              <div className="bg-white p-6 rounded-xl border border-[#071524]/10 shadow-xs space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#071524]/10">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-[#D5ECF8] text-[#006A62] flex items-center justify-center">
                      <Shield className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-bold text-base text-[#071524]">
                          Plan Terapéutico ({effectiveDetail.therapyPlanId.slice(0, 8)}…)
                        </h3>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                            getPlanStatusBadge(effectiveDetail.status).className
                          }`}
                        >
                          {getPlanStatusBadge(effectiveDetail.status).label}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-[#DBF1FE] text-[#071524] text-[11px] font-mono font-bold">
                          Versión Config v{effectiveDetail.configurationVersion}
                        </span>
                      </div>
                      <p className="text-xs text-[#44474C] mt-0.5">
                        Límites de sesión, cuota diaria y configuraciones activas del paciente
                      </p>
                    </div>
                  </div>
                </div>

                {/* Límites de Sesión y Metas Diarias */}
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
                  <div className="p-3.5 rounded-xl bg-[#E6F6FF] border border-[#071524]/10">
                    <span className="text-[#44474C] font-semibold block">Límite Diario</span>
                    <strong className="text-lg text-[#071524]">
                      {effectiveDetail.dailySessionLimit} sesiones/día
                    </strong>
                  </div>
                  <div className="p-3.5 rounded-xl bg-[#E6F6FF] border border-[#071524]/10">
                    <span className="text-[#44474C] font-semibold block">Meta Diaria</span>
                    <strong className="text-lg text-[#071524]">
                      {effectiveDetail.dailyTargetDurationMinutes} min
                    </strong>
                  </div>
                  <div className="p-3.5 rounded-xl bg-[#E6F6FF] border border-[#071524]/10">
                    <span className="text-[#44474C] font-semibold block">Tope Seguridad Diario</span>
                    <strong className="text-lg text-[#071524]">
                      {effectiveDetail.dailyHardSafetyLimitMinutes != null
                        ? `${effectiveDetail.dailyHardSafetyLimitMinutes} min`
                        : 'No definido'}
                    </strong>
                  </div>
                  <div className="p-3.5 rounded-xl bg-[#E6F6FF] border border-[#071524]/10">
                    <span className="text-[#44474C] font-semibold block">Duración por Sesión</span>
                    <strong className="text-lg text-[#071524]">
                      {effectiveDetail.minimumValidDurationMinutes}–{effectiveDetail.maximumSessionDurationMinutes} min
                    </strong>
                  </div>
                  <div className="p-3.5 rounded-xl bg-[#E6F6FF] border border-[#071524]/10">
                    <span className="text-[#44474C] font-semibold block">Muestras Mínimas</span>
                    <strong className="text-lg text-[#071524]">
                      {effectiveDetail.minimumValidSampleCount}
                    </strong>
                  </div>
                </div>

                {/* Prescripciones Diarias por Ejercicio */}
                <div className="p-4 rounded-xl bg-[#F3FAFF] border border-[#071524]/10">
                  <span className="text-xs font-bold text-[#071524] block mb-2">
                    Prescripciones Diarias por Ejercicio (`dailyExercisePrescriptions`)
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {(Object.entries(effectiveDetail.dailyExercisePrescriptions) as [TherapyExerciseCode, number | undefined][]).map(
                      ([code, count]) =>
                        count !== undefined && (
                          <span
                            key={code}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[#006A62]/20 text-xs font-semibold text-[#071524]"
                          >
                            <span className="w-2 h-2 rounded-full bg-[#006A62]" />
                            {EXERCISE_LABELS[code] || code}: <strong>{count} / día</strong>
                          </span>
                        )
                    )}
                  </div>
                </div>

                {/* Configuraciones Efectivas */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-[#071524]">
                      Configuraciones Terapéuticas ({effectiveDetail.configurations.length})
                    </h4>
                  </div>

                  {effectiveDetail.configurations.length === 0 ? (
                    <div className="p-5 rounded-xl bg-[#F3FAFF] border border-dashed border-[#071524]/20 text-center text-xs text-[#44474C]">
                      Aún no se han agregado configuraciones de parámetros a este plan. Use{' '}
                      <button
                        type="button"
                        onClick={() => navigate(`/specialist/patients/${patient.id}/parametros`)}
                        className="text-[#006A62] font-bold underline cursor-pointer"
                      >
                        Ajuste Fino
                      </button>{' '}
                      o{' '}
                      <button
                        type="button"
                        onClick={() => navigate(`/specialist/patients/${patient.id}/prescripcion`)}
                        className="text-[#006A62] font-bold underline cursor-pointer"
                      >
                        Prescripción
                      </button>{' '}
                      para publicar una configuración Schema v2.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {effectiveDetail.configurations.map((cfg) => {
                        const completionTarget = extractCompletionTarget(cfg);
                        return (
                          <div
                            key={cfg.configurationId}
                            className="p-4 rounded-xl border border-[#071524]/10 bg-white space-y-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#071524]/10">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-bold text-sm text-[#071524]">
                                  {EXERCISE_LABELS[cfg.exerciseCode] || cfg.exerciseCode}
                                </span>
                                <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-[#DBF1FE] text-[#006A62]">
                                  v{cfg.version} · Schema v{cfg.parameterSchemaVersion}
                                </span>
                                <span
                                  className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                                    cfg.status === 'ACTIVE'
                                      ? 'bg-[#81F3E5]/50 text-[#005049]'
                                      : 'bg-[#FFDAD6] text-[#93000A]'
                                  }`}
                                >
                                  {cfg.status}
                                </span>
                              </div>
                              <span className="text-[11px] text-[#44474C]">
                                Vigente desde: {formatDateTime(cfg.effectiveFrom)}
                              </span>
                            </div>

                            {renderConfigurationDetails(cfg)}

                            {completionTarget && (
                              <div className="pt-2 border-t border-[#071524]/5 flex items-center gap-2 text-xs text-[#006A62] font-semibold">
                                <Target className="w-3.5 h-3.5" />
                                <span>
                                  Meta de Finalización (Schema v2):{' '}
                                  <strong>
                                    {completionTarget.criterion === 'REPETITIONS'
                                      ? `${completionTarget.target} repeticiones exitosas`
                                      : `${completionTarget.target} segundos activos`}
                                  </strong>
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // Modo MOCK: preserva el editor interactivo y tarjetas originales
  const exercises = patient.activePlan?.exercises || [
    {
      id: 'ex-01',
      name: 'Búsqueda Visual Dinámica',
      category: 'Exploración Periférica',
      level: 3,
      targetSpeed: 1.2,
      visualFieldAmplitude: 0.85,
      minFixationTimeMs: 650,
      dailyTargetMinutes: 15,
    },
    {
      id: 'ex-02',
      name: 'Fijación Foveal y Estabilidad',
      category: 'Anclaje Central',
      level: 2,
      targetSpeed: 0.9,
      visualFieldAmplitude: 0.50,
      minFixationTimeMs: 900,
      dailyTargetMinutes: 10,
    },
    {
      id: 'ex-03',
      name: 'Exploración Sacádica Compensatoria',
      category: 'Amplitud Oculomotora',
      level: 3,
      targetSpeed: 1.4,
      visualFieldAmplitude: 0.90,
      minFixationTimeMs: 500,
      dailyTargetMinutes: 15,
    },
  ];

  const handleSave = () => {
    useAppStore.getState().setPrescription({
      prescriptionId: `rx-${Date.now()}`,
      patientId: patient.id,
      gameId: 'saccadic-explorer',
      parameters: {
        target_speed: targetSpeed,
        visual_field_amplitude: visualFieldAmplitude,
        min_fixation_time: minFixationTime,
      },
    });

    if (patient.activePlan) {
      updatePatient({
        ...patient,
        activePlan: {
          ...patient.activePlan,
          exercises: patient.activePlan.exercises.map((ex, idx) =>
            idx === 0
              ? {
                  ...ex,
                  targetSpeed,
                  visualFieldAmplitude,
                  minFixationTimeMs: minFixationTime,
                }
              : ex
          ),
        },
      });
    }

    setIsSaved(true);
    if (onPlanUpdated) onPlanUpdated();
    setTimeout(() => setIsSaved(false), 3000);
  };

  return (
    <div className="space-y-6">
      {/* Ejercicios Prescritos Actuales */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {exercises.map((ex) => (
          <div
            key={ex.id}
            className="bg-white p-5 rounded-xl border border-[#071524]/10 shadow-xs flex flex-col justify-between space-y-4 hover:border-[#006A62]/30 transition-all"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-[#DBF1FE] text-[#006A62]">
                  {ex.category}
                </span>
                <span className="text-xs font-bold text-[#071524]">Nivel {ex.level}</span>
              </div>
              <h4 className="font-bold text-sm text-[#071524] mt-2">{ex.name}</h4>
              <p className="text-xs text-[#44474C] mt-1">
                Meta diaria: <strong>{ex.dailyTargetMinutes} minutos</strong> de estímulos sacádicos guiados.
              </p>
            </div>

            <div className="pt-3 border-t border-[#071524]/10 grid grid-cols-3 gap-2 text-center text-[11px]">
              <div className="p-1.5 rounded bg-[#E6F6FF]">
                <span className="text-[#44474C] block">Velocidad</span>
                <strong className="text-[#071524]">{ex.targetSpeed}x</strong>
              </div>
              <div className="p-1.5 rounded bg-[#E6F6FF]">
                <span className="text-[#44474C] block">Amplitud</span>
                <strong className="text-[#071524]">{Math.round(ex.visualFieldAmplitude * 100)}%</strong>
              </div>
              <div className="p-1.5 rounded bg-[#E6F6FF]">
                <span className="text-[#44474C] block">Fijación</span>
                <strong className="text-[#071524]">{ex.minFixationTimeMs}ms</strong>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Editor de Prescripción Dinámica */}
      <div className="bg-white p-6 rounded-xl border border-[#071524]/10 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-[#071524]/10">
          <div>
            <h3 className="font-bold text-base text-[#071524] flex items-center gap-2">
              <Sliders className="w-5 h-5 text-[#006A62]" />
              Ajuste Dinámico de Parámetros de la Terapia
            </h3>
            <p className="text-xs text-[#44474C]">
              Estas variables modifican en tiempo real la física y sensibilidad del motor Serious Games para este paciente.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => navigate(`/specialist/patients/${patient.id}/prescripcion`)}
              className="flex items-center gap-1.5 text-xs font-bold text-[#071524] bg-[#F3FAFF] hover:bg-[#DBF1FE] border border-[#C4C6CC]/60 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5 text-[#006A62]" />
              <span>Constructor Completo</span>
            </button>
            <button
              onClick={() => navigate(`/specialist/patients/${patient.id}/parametros`)}
              className="flex items-center gap-1.5 text-xs font-bold text-[#006A62] bg-[#DBF1FE] hover:bg-[#84F5E8]/40 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Simulador y Ajuste Fino</span>
            </button>
          </div>
        </div>

        {/* Sliders */}
        <div className="space-y-4">
          {/* Slider 1: Velocidad */}
          <div className="p-4 rounded-xl bg-[#F3FAFF] border border-[#071524]/10">
            <div className="flex justify-between items-center mb-1">
              <label className="font-bold text-xs sm:text-sm text-[#071524] flex items-center gap-1.5">
                <Zap className="w-4 h-4 text-[#006A62]" />
                Velocidad de Presentación de Estímulos (Target Speed)
              </label>
              <span className="font-mono font-bold text-[#006A62] text-sm bg-white px-2 py-0.5 rounded border border-[#006A62]/20">
                {targetSpeed.toFixed(1)}x
              </span>
            </div>
            <input
              type="range"
              min="0.5"
              max="2.5"
              step="0.1"
              value={targetSpeed}
              onChange={(e) => setTargetSpeed(parseFloat(e.target.value))}
              className="w-full accent-[#006A62]"
            />
            <div className="flex justify-between text-[10px] text-[#74777C] mt-1 font-medium">
              <span>0.5x (Fatiga o Iniciación)</span>
              <span>1.0x (Estándar de Recuperación)</span>
              <span>2.5x (Máxima Exigencia Sacádica)</span>
            </div>
          </div>

          {/* Slider 2: Amplitud de Campo Visual */}
          <div className="p-4 rounded-xl bg-[#F3FAFF] border border-[#071524]/10">
            <div className="flex justify-between items-center mb-1">
              <label className="font-bold text-xs sm:text-sm text-[#071524] flex items-center gap-1.5">
                <Target className="w-4 h-4 text-[#006A62]" />
                Amplitud Excéntrica en Pantalla (Visual Field Amplitude)
              </label>
              <span className="font-mono font-bold text-[#006A62] text-sm bg-white px-2 py-0.5 rounded border border-[#006A62]/20">
                {Math.round(visualFieldAmplitude * 100)}%
              </span>
            </div>
            <input
              type="range"
              min="0.3"
              max="1.0"
              step="0.05"
              value={visualFieldAmplitude}
              onChange={(e) => setVisualFieldAmplitude(parseFloat(e.target.value))}
              className="w-full accent-[#006A62]"
            />
            <div className="flex justify-between text-[10px] text-[#74777C] mt-1 font-medium">
              <span>30% (Solo Zona Foveal Central)</span>
              <span>70% (Parafóvea y Media Periferia)</span>
              <span>100% (Exploración Completa del Hemicampo Ciego)</span>
            </div>
          </div>

          {/* Slider 3: Tiempo mínimo de fijación */}
          <div className="p-4 rounded-xl bg-[#F3FAFF] border border-[#071524]/10">
            <div className="flex justify-between items-center mb-1">
              <label className="font-bold text-xs sm:text-sm text-[#071524] flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-[#006A62]" />
                Tiempo de Fijación Requerido por Diana (Dwell Time)
              </label>
              <span className="font-mono font-bold text-[#006A62] text-sm bg-white px-2 py-0.5 rounded border border-[#006A62]/20">
                {minFixationTime} ms
              </span>
            </div>
            <input
              type="range"
              min="300"
              max="1500"
              step="50"
              value={minFixationTime}
              onChange={(e) => setMinFixationTime(parseInt(e.target.value))}
              className="w-full accent-[#006A62]"
            />
            <div className="flex justify-between text-[10px] text-[#74777C] mt-1 font-medium">
              <span>300 ms (Fijación Rápida)</span>
              <span>650 ms (Recomendado para Juan Pérez)</span>
              <span>1500 ms (Para pacientes con nistagmo o inestabilidad)</span>
            </div>
          </div>
        </div>

        {/* Footer de Acción */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-[#071524]/10">
          {isSaved ? (
            <span className="text-xs font-bold text-[#006A62] flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-[#006A62]" />
              ¡Prescripción guardada y sincronizada con el motor de juego!
            </span>
          ) : (
            <span className="text-xs text-[#74777C]">
              Los cambios se aplicarán en la próxima sesión que inicie el paciente en su domicilio.
            </span>
          )}

          <button
            onClick={handleSave}
            className="w-full sm:w-auto px-6 py-2.5 rounded-lg bg-[#006A62] hover:bg-[#005049] text-white font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-xs cursor-pointer ml-auto"
          >
            <Save className="w-4 h-4" />
            Guardar y Emitir Prescripción
          </button>
        </div>
      </div>
    </div>
  );
};
