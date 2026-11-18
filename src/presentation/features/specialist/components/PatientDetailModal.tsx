import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  X, 
  ArrowLeft, 
  ArrowRight, 
  CheckCircle2, 
  ShieldCheck, 
  Save,
  Loader2,
  AlertCircle,
  FileText,
  Sliders,
  Activity,
  Calendar,
  Clock,
  ExternalLink,
  Layers
} from 'lucide-react';
import type { Patient } from '../../../../core/domain/Patient';
import { useAppStore } from '../../../../core/store/useAppStore';
import { 
  clinicalApi, 
  extractApiErrorMessage,
  type RehabilitationContextResponse,
  type TherapyPlanSummary,
  type DoctorTherapySessionSummary,
  type TherapyExerciseCode
} from '../../../../infrastructure/api';

interface PatientDetailModalProps {
  patient: Patient | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdatePatient: (updated: Patient) => void;
}

function formatExerciseName(code?: TherapyExerciseCode | string): string {
  switch (code) {
    case 'visual-scanning':
      return 'Rastreo Visual Sacádico';
    case 'visual-search':
      return 'Búsqueda Visual Oculomotora';
    case 'fixation':
      return 'Fijación Foveal';
    default:
      return code || 'Ejercicio Oculomotor';
  }
}

function formatSessionDateTime(iso: string): string {
  try {
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return iso;
    return parsed.toLocaleString('es-PE', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export const PatientDetailModal: React.FC<PatientDetailModalProps> = ({
  patient,
  isOpen,
  onClose,
  onUpdatePatient,
}) => {
  const navigate = useNavigate();
  const { authMode, accessToken } = useAppStore();
  const isCognitoMode = authMode === 'COGNITO' && Boolean(accessToken);

  const [activeTab, setActiveTab] = useState<'resumen' | 'prescripcion' | 'historial'>('resumen');
  
  // Parámetros de prescripción rápida (Demo / Mock)
  const [targetSpeed, setTargetSpeed] = useState(1.0);
  const [visualFieldAmplitude, setVisualFieldAmplitude] = useState(0.85);
  const [minFixationTime, setMinFixationTime] = useState(800);
  const [isSaved, setIsSaved] = useState(false);

  // Estados de datos en vivo (Modo COGNITO)
  const [isLoadingLive, setIsLoadingLive] = useState(false);
  const [liveContext, setLiveContext] = useState<RehabilitationContextResponse | null>(null);
  const [livePlans, setLivePlans] = useState<TherapyPlanSummary[]>([]);
  const [liveSessions, setLiveSessions] = useState<DoctorTherapySessionSummary[]>([]);
  const [liveError, setLiveError] = useState<string | null>(null);

  // Cargar datos reales en paralelo cuando esté abierto en modo COGNITO
  useEffect(() => {
    if (!isOpen || !patient) {
      setLiveContext(null);
      setLivePlans([]);
      setLiveSessions([]);
      setLiveError(null);
      setIsLoadingLive(false);
      return;
    }

    // Verificar si el ID corresponde a un paciente clínico real
    const isRealClinicalId = patient.id && !patient.id.startsWith('pat-');

    if (isCognitoMode && isRealClinicalId) {
      let isMounted = true;
      setIsLoadingLive(true);
      setLiveError(null);

      Promise.allSettled([
        clinicalApi.getRehabilitationContext(patient.id),
        clinicalApi.listTherapyPlans(patient.id),
        clinicalApi.listDoctorTherapySessions(patient.id),
      ])
        .then(([ctxResult, plansResult, sessionsResult]) => {
          if (!isMounted) return;

          if (ctxResult.status === 'fulfilled') {
            setLiveContext(ctxResult.value);
          }
          if (plansResult.status === 'fulfilled') {
            setLivePlans(plansResult.value.plans || []);
          }
          if (sessionsResult.status === 'fulfilled') {
            setLiveSessions(sessionsResult.value.sessions || []);
          }

          if (
            ctxResult.status === 'rejected' &&
            plansResult.status === 'rejected' &&
            sessionsResult.status === 'rejected'
          ) {
            setLiveError('No se pudo conectar con el servicio clínico para este paciente.');
          }
          setIsLoadingLive(false);
        })
        .catch((err) => {
          if (!isMounted) return;
          setLiveError(extractApiErrorMessage(err));
          setIsLoadingLive(false);
        });

      return () => {
        isMounted = false;
      };
    } else {
      setIsLoadingLive(false);
      setLiveContext(null);
      setLivePlans([]);
      setLiveSessions([]);
    }
  }, [isOpen, patient, isCognitoMode]);

  // Hemicampo calculado (prioriza el contexto en vivo)
  const effectiveHemifield = useMemo(() => {
    if (liveContext?.affectedHemifield) {
      return liveContext.affectedHemifield;
    }
    return patient?.affectedHemifield || 'LEFT';
  }, [liveContext, patient]);

  const isLeft = effectiveHemifield === 'LEFT';

  // Diagnóstico calculado
  const displayDiagnosis = useMemo(() => {
    if (liveContext?.previousDiagnosis) {
      return liveContext.previousDiagnosis;
    }
    if (patient?.primaryDiagnosisTitle) {
      return patient.primaryDiagnosisTitle;
    }
    return patient?.hemifieldDetail || 'Evaluación de defecto visual en curso';
  }, [liveContext, patient]);

  // Observaciones clínicas / Agudeza
  const displayObservations = useMemo(() => {
    if (liveContext?.observations) {
      return liveContext.observations;
    }
    if (patient?.clinicalNotes) {
      return patient.clinicalNotes;
    }
    return 'Déficit campimétrico secundario a evento cerebrovascular. Se recomienda terapia de compensación sacádica foveal.';
  }, [liveContext, patient]);

  // Secuelas
  const sequelaeList = useMemo(() => {
    if (liveContext?.sequelae && liveContext.sequelae.length > 0) {
      return liveContext.sequelae;
    }
    return [];
  }, [liveContext]);

  // Plan activo
  const activePlan = useMemo(() => {
    return livePlans.find((p) => p.status === 'ACTIVE') || livePlans[0] || null;
  }, [livePlans]);

  if (!isOpen || !patient) return null;

  const handleSavePrescription = () => {
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

    onUpdatePatient({
      ...patient,
      clinicalNotes: `${patient.clinicalNotes || ''} [Prescripción actualizada: Vel ${targetSpeed}x, Amp ${Math.round(visualFieldAmplitude * 100)}%, Dwell ${minFixationTime}ms]`,
    });

    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2500);
  };

  const handleNavigateToRecord = () => {
    onClose();
    navigate(`/specialist/patients/${patient.id}`);
  };

  const handleNavigateToPrescription = () => {
    onClose();
    navigate(`/specialist/patients/${patient.id}/prescripcion`);
  };

  const handleNavigateToAudit = () => {
    onClose();
    navigate(`/specialist/patients/${patient.id}/auditoria`);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#071524]/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-2xl max-w-3xl w-full shadow-2xl border border-[#071524]/10 overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-200">
        {/* Header con Perfil Clínico */}
        <div className="bg-[#1C2A39] text-white p-5 flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#006A62] text-white flex items-center justify-center font-bold text-lg shadow-sm shrink-0">
              {patient.initials}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold tracking-tight">{patient.name}</h2>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-[#84F5E8] text-[#071524]">
                  {isLeft ? <ArrowLeft className="w-3 h-3" /> : <ArrowRight className="w-3 h-3" />}
                  {isLeft ? 'Hemicampo Izquierdo' : 'Hemicampo Derecho'}
                </span>
                {isCognitoMode && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#006A62] text-white">
                    Clinical API Live
                  </span>
                )}
              </div>
              <p className="text-xs text-white/80 font-mono mt-0.5">
                HC: {patient.medicalRecordNumber} · DNI: {patient.nationalId}
                {patient.age > 0 ? ` · ${patient.age} años` : ''} · {patient.gender}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
            aria-label="Cerrar modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Navigation Action Strip */}
        <div className="bg-[#DBF1FE]/50 border-b border-[#071524]/10 px-6 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-[#44474C] font-medium flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-[#006A62]" />
            Acciones Clínicas Directas:
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleNavigateToRecord}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white border border-[#C4C6CC]/80 font-semibold text-[#071524] hover:bg-[#E6F6FF] transition-colors cursor-pointer shadow-2xs"
            >
              <FileText className="w-3.5 h-3.5 text-[#006A62]" />
              Expediente Completo
            </button>
            <button
              type="button"
              onClick={handleNavigateToPrescription}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white border border-[#C4C6CC]/80 font-semibold text-[#071524] hover:bg-[#E6F6FF] transition-colors cursor-pointer shadow-2xs"
            >
              <Sliders className="w-3.5 h-3.5 text-[#006A62]" />
              Prescripción
            </button>
            <button
              type="button"
              onClick={handleNavigateToAudit}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white border border-[#C4C6CC]/80 font-semibold text-[#071524] hover:bg-[#E6F6FF] transition-colors cursor-pointer shadow-2xs"
            >
              <Activity className="w-3.5 h-3.5 text-[#006A62]" />
              Auditoría Telemetría
            </button>
          </div>
        </div>

        {/* Sub-tabs de Navegación Interna */}
        <div className="bg-[#E6F6FF] border-b border-[#071524]/10 px-6 flex items-center gap-4 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab('resumen')}
            className={`py-3 px-2 border-b-2 transition-all cursor-pointer ${
              activeTab === 'resumen'
                ? 'border-[#006A62] text-[#006A62] font-bold'
                : 'border-transparent text-[#44474C] hover:text-[#071524]'
            }`}
          >
            Resumen Clínico y Campimetría
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('prescripcion')}
            className={`py-3 px-2 border-b-2 transition-all cursor-pointer ${
              activeTab === 'prescripcion'
                ? 'border-[#006A62] text-[#006A62] font-bold'
                : 'border-transparent text-[#44474C] hover:text-[#071524]'
            }`}
          >
            Plan Terapéutico y Parámetros
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('historial')}
            className={`py-3 px-2 border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'historial'
                ? 'border-[#006A62] text-[#006A62] font-bold'
                : 'border-transparent text-[#44474C] hover:text-[#071524]'
            }`}
          >
            <span>Historial de Telemetría Ocular</span>
            {liveSessions.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-[#006A62] text-white">
                {liveSessions.length}
              </span>
            )}
          </button>
        </div>

        {/* Live Loading Banner */}
        {isLoadingLive && (
          <div className="px-6 py-2 bg-[#E6F6FF] text-[#006A62] text-xs font-medium flex items-center gap-2 border-b border-[#006A62]/20">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Sincronizando contexto de rehabilitación, planes y sesiones en vivo...</span>
          </div>
        )}

        {liveError && (
          <div className="px-6 py-2 bg-[#FFDAD6] text-[#93000A] text-xs font-medium flex items-center gap-2 border-b border-[#BA1A1A]/20">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 text-[#BA1A1A]" />
            <span>{liveError}</span>
          </div>
        )}

        {/* Body Tab Content */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs text-[#071E27]">
          {activeTab === 'resumen' && (
            <div className="space-y-4">
              {/* Card de Diagnóstico */}
              <div className="p-4 rounded-xl bg-[#F3FAFF] border border-[#071524]/10">
                <span className="text-[11px] font-bold text-[#44474C] uppercase tracking-wider block mb-1">
                  Diagnóstico Campimétrico Principal
                </span>
                <p className="text-base font-bold text-[#071524]">{displayDiagnosis}</p>
                <p className="text-xs text-[#44474C] mt-1.5">
                  {displayObservations}
                </p>
                {sequelaeList.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-[#071524]/10 flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-[#071524]">Secuelas Clínicas:</span>
                    {sequelaeList.map((seq, idx) => (
                      <span key={idx} className="px-2 py-0.5 rounded text-[11px] bg-[#E6F6FF] text-[#006A62] font-medium">
                        {seq}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Indicadores Clave */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3.5 rounded-xl bg-white border border-[#071524]/10 shadow-2xs">
                  <span className="text-[#44474C] font-semibold text-[11px] block">Adherencia Terapéutica</span>
                  <div className="text-2xl font-bold text-[#006A62] mt-1">
                    {patient.adherence.rate}%
                  </div>
                  <span className="text-[10px] text-[#006A62] font-semibold">
                    Categoría: {patient.adherence.category}
                  </span>
                </div>

                <div className="p-3.5 rounded-xl bg-white border border-[#071524]/10 shadow-2xs">
                  <span className="text-[#44474C] font-semibold text-[11px] block">Última Sesión</span>
                  <div className="text-sm font-bold text-[#071524] mt-1">
                    {liveSessions.length > 0
                      ? formatSessionDateTime(liveSessions[0].startedAt)
                      : patient.lastSession.timestampText}
                  </div>
                  <span className="text-[10px] text-[#44474C] block mt-0.5">
                    {liveSessions.length > 0
                      ? `${formatExerciseName(liveSessions[0].exerciseCode)} (${Math.round(liveSessions[0].activeDurationSeconds / 60)} min)`
                      : `${patient.lastSession.moduleName} (${patient.lastSession.durationMinutes} min)`}
                  </span>
                </div>

                <div className="p-3.5 rounded-xl bg-white border border-[#071524]/10 shadow-2xs">
                  <span className="text-[#44474C] font-semibold text-[11px] block">Plan Terapéutico</span>
                  <div className="text-sm font-bold text-[#071524] mt-1">
                    {activePlan ? `Plan v${activePlan.configurationVersion}` : 'Plan Estándar'}
                  </div>
                  <span className="text-[10px] text-[#006A62] font-semibold block mt-0.5">
                    {activePlan ? `Estado: ${activePlan.status}` : 'Activo en Clinical'}
                  </span>
                </div>
              </div>

              {/* Visualizador Esquemático de Hemicampo */}
              <div className="p-4 rounded-xl border border-[#071524]/10 bg-white shadow-2xs">
                <span className="font-bold text-[#071524] block mb-2">
                  Esquema de Campimetría Estimada (Ojo Derecho e Izquierdo)
                </span>
                <div className="flex items-center justify-center gap-8 py-2">
                  {/* Campímetro Izquierdo */}
                  <div className="flex flex-col items-center">
                    <div className="w-24 h-24 rounded-full border-2 border-[#071524] overflow-hidden flex shadow-xs">
                      <div
                        className={`w-1/2 h-full flex items-center justify-center text-[10px] font-bold ${
                          isLeft ? 'bg-[#071524] text-white' : 'bg-[#E6F6FF] text-[#006A62]'
                        }`}
                      >
                        {isLeft ? 'Defecto' : 'Preservado'}
                      </div>
                      <div
                        className={`w-1/2 h-full flex items-center justify-center text-[10px] font-bold ${
                          !isLeft ? 'bg-[#071524] text-white' : 'bg-[#E6F6FF] text-[#006A62]'
                        }`}
                      >
                        {!isLeft ? 'Defecto' : 'Preservado'}
                      </div>
                    </div>
                    <span className="text-[11px] text-[#44474C] mt-1.5 font-semibold">Ojo Izquierdo</span>
                  </div>

                  {/* Campímetro Derecho */}
                  <div className="flex flex-col items-center">
                    <div className="w-24 h-24 rounded-full border-2 border-[#071524] overflow-hidden flex shadow-xs">
                      <div
                        className={`w-1/2 h-full flex items-center justify-center text-[10px] font-bold ${
                          isLeft ? 'bg-[#071524] text-white' : 'bg-[#E6F6FF] text-[#006A62]'
                        }`}
                      >
                        {isLeft ? 'Defecto' : 'Preservado'}
                      </div>
                      <div
                        className={`w-1/2 h-full flex items-center justify-center text-[10px] font-bold ${
                          !isLeft ? 'bg-[#071524] text-white' : 'bg-[#E6F6FF] text-[#006A62]'
                        }`}
                      >
                        {!isLeft ? 'Defecto' : 'Preservado'}
                      </div>
                    </div>
                    <span className="text-[11px] text-[#44474C] mt-1.5 font-semibold">Ojo Derecho</span>
                  </div>
                </div>
                <div className="text-center text-[11px] text-[#74777C] mt-2">
                  Área sombreada oscura representa el escotoma absoluto del hemicampo afectado por el ACV.
                </div>
              </div>
            </div>
          )}

          {activeTab === 'prescripcion' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-[#DBF1FE] text-[#006A62] text-xs font-medium flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span>Ajuste fino de la dificultad del Serious Game oculomotor dictada por el especialista facultativo.</span>
                <button
                  type="button"
                  onClick={handleNavigateToPrescription}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#006A62] text-white font-bold text-xs hover:bg-[#005049] transition-colors shrink-0 cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Prescripción Completa
                </button>
              </div>

              {/* Planes terapéuticos registrados en Clinical */}
              {isCognitoMode && livePlans.length > 0 && (
                <div className="p-4 rounded-xl bg-white border border-[#071524]/10 space-y-2">
                  <span className="font-bold text-[#071524] block">Planes Terapéuticos Registrados</span>
                  <div className="divide-y divide-[#071524]/10">
                    {livePlans.map((plan) => (
                      <div key={plan.therapyPlanId} className="py-2 flex items-center justify-between text-xs">
                        <div>
                          <span className="font-mono font-bold text-[#071524]">{plan.therapyPlanId.slice(0, 12)}...</span>
                          <span className="text-[#74777C] ml-2">Configuración v{plan.configurationVersion}</span>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                          plan.status === 'ACTIVE'
                            ? 'bg-[#E6F6FF] text-[#006A62]'
                            : 'bg-[#FFDAD6] text-[#BA1A1A]'
                        }`}>
                          {plan.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Slider 1: Velocidad del estímulo */}
              <div className="p-4 rounded-xl bg-[#F3FAFF] border border-[#071524]/10">
                <div className="flex justify-between items-center mb-1">
                  <label htmlFor="target-speed-slider" className="font-bold text-[#071524]">
                    Velocidad / Dinámica del Estímulo (Target Speed)
                  </label>
                  <span className="font-mono font-bold text-[#006A62] text-sm">{targetSpeed.toFixed(1)}x</span>
                </div>
                <input
                  id="target-speed-slider"
                  type="range"
                  min="0.5"
                  max="2.5"
                  step="0.1"
                  value={targetSpeed}
                  onChange={(e) => setTargetSpeed(parseFloat(e.target.value))}
                  className="w-full accent-[#006A62] cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-[#74777C] mt-1">
                  <span>0.5x (Lento / Inicial)</span>
                  <span>1.0x (Estándar)</span>
                  <span>2.5x (Desafío Sacádico)</span>
                </div>
              </div>

              {/* Slider 2: Amplitud de Campo Visual */}
              <div className="p-4 rounded-xl bg-[#F3FAFF] border border-[#071524]/10">
                <div className="flex justify-between items-center mb-1">
                  <label htmlFor="amplitude-slider" className="font-bold text-[#071524]">
                    Amplitud de Campo Visual (Visual Field Amplitude)
                  </label>
                  <span className="font-mono font-bold text-[#006A62] text-sm">{Math.round(visualFieldAmplitude * 100)}%</span>
                </div>
                <input
                  id="amplitude-slider"
                  type="range"
                  min="0.3"
                  max="1.0"
                  step="0.05"
                  value={visualFieldAmplitude}
                  onChange={(e) => setVisualFieldAmplitude(parseFloat(e.target.value))}
                  className="w-full accent-[#006A62] cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-[#74777C] mt-1">
                  <span>30% (Central / Foveal)</span>
                  <span>70% (Parafoveal)</span>
                  <span>100% (Periferia Extrema)</span>
                </div>
              </div>

              {/* Slider 3: Tiempo mínimo de fijación */}
              <div className="p-4 rounded-xl bg-[#F3FAFF] border border-[#071524]/10">
                <div className="flex justify-between items-center mb-1">
                  <label htmlFor="dwell-time-slider" className="font-bold text-[#071524]">
                    Tiempo Mínimo de Fijación Requerido (Dwell Time)
                  </label>
                  <span className="font-mono font-bold text-[#006A62] text-sm">{minFixationTime} ms</span>
                </div>
                <input
                  id="dwell-time-slider"
                  type="range"
                  min="300"
                  max="1500"
                  step="50"
                  value={minFixationTime}
                  onChange={(e) => setMinFixationTime(parseInt(e.target.value, 10))}
                  className="w-full accent-[#006A62] cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-[#74777C] mt-1">
                  <span>300 ms (Rápido)</span>
                  <span>800 ms (Recomendado)</span>
                  <span>1500 ms (Baja velocidad oculomotora)</span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                {isSaved ? (
                  <span className="text-xs font-bold text-[#006A62] flex items-center gap-1.5 animate-in fade-in">
                    <CheckCircle2 className="w-4 h-4" />
                    ¡Prescripción sincronizada con el motor de juego!
                  </span>
                ) : (
                  <span />
                )}

                <button
                  type="button"
                  onClick={handleSavePrescription}
                  className="px-5 py-2.5 rounded-lg bg-[#006A62] hover:bg-[#005049] text-white font-bold flex items-center gap-2 transition-all shadow-xs cursor-pointer ml-auto"
                >
                  <Save className="w-4 h-4" />
                  Guardar Prescripción Rápida
                </button>
              </div>
            </div>
          )}

          {activeTab === 'historial' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#071524]">
                  Sesiones Registradas por el Algoritmo Ocular
                </span>
                <button
                  type="button"
                  onClick={handleNavigateToAudit}
                  className="inline-flex items-center gap-1 text-xs font-bold text-[#006A62] hover:underline cursor-pointer"
                >
                  Ver Auditoría Completa
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* En modo COGNITO con sesiones reales */}
              {isCognitoMode && liveSessions.length > 0 ? (
                <div className="divide-y divide-[#071524]/10 border border-[#071524]/10 rounded-xl overflow-hidden bg-white">
                  {liveSessions.map((session) => {
                    const isCompleted = session.status === 'COMPLETED';
                    const isCancelled = session.status === 'CANCELLED' || session.status === 'ABANDONED';
                    const durationMin = Math.round(session.activeDurationSeconds / 60);

                    return (
                      <div key={session.therapySessionId} className="p-3.5 flex items-center justify-between hover:bg-[#F3FAFF] transition-colors">
                        <div className="flex items-center gap-3">
                          {isCompleted ? (
                            <CheckCircle2 className="w-4 h-4 text-[#006A62] shrink-0" />
                          ) : isCancelled ? (
                            <AlertCircle className="w-4 h-4 text-[#BA1A1A] shrink-0" />
                          ) : (
                            <Clock className="w-4 h-4 text-[#006A62] shrink-0" />
                          )}
                          <div>
                            <div className="font-bold text-[#071524] flex items-center gap-2">
                              <span>{formatExerciseName(session.exerciseCode)}</span>
                              <span className={`px-2 py-0.2 rounded text-[10px] font-bold ${
                                isCompleted
                                  ? 'bg-[#E6F6FF] text-[#006A62]'
                                  : isCancelled
                                  ? 'bg-[#FFDAD6] text-[#BA1A1A]'
                                  : 'bg-[#DBF1FE] text-[#071524]'
                              }`}>
                                {session.status}
                              </span>
                            </div>
                            <div className="text-[11px] text-[#74777C] flex items-center gap-2 mt-0.5">
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {formatSessionDateTime(session.startedAt)}
                              </span>
                              <span>·</span>
                              <span>{durationMin > 0 ? `${durationMin} min` : `${session.activeDurationSeconds}s`}</span>
                              <span>·</span>
                              <span className="font-mono text-[10px]">ID: {session.therapySessionId.slice(0, 8)}</span>
                            </div>
                          </div>
                        </div>

                        <div className="text-right">
                          <button
                            type="button"
                            onClick={handleNavigateToAudit}
                            className="px-2.5 py-1 rounded bg-[#E6F6FF] text-[#006A62] font-semibold text-xs hover:bg-[#DBF1FE] transition-colors cursor-pointer"
                          >
                            Telemetría
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : isCognitoMode && liveSessions.length === 0 && !isLoadingLive ? (
                <div className="p-8 text-center bg-[#F3FAFF] rounded-xl border border-[#071524]/10 space-y-2">
                  <Activity className="w-8 h-8 text-[#74777C] mx-auto" />
                  <p className="font-bold text-[#071524]">No se registran sesiones de terapia todavía</p>
                  <p className="text-xs text-[#44474C] max-w-sm mx-auto">
                    Prescriba un plan terapéutico para que el paciente pueda comenzar sus sesiones de serious gaming.
                  </p>
                  <button
                    type="button"
                    onClick={handleNavigateToPrescription}
                    className="inline-flex items-center gap-1.5 px-4 py-2 mt-2 rounded-lg bg-[#006A62] text-white font-bold text-xs hover:bg-[#005049] transition-colors cursor-pointer"
                  >
                    <Sliders className="w-4 h-4" />
                    Prescribir Plan Terapéutico
                  </button>
                </div>
              ) : (
                /* Mock Sessions Fallback */
                <div className="divide-y divide-[#071524]/10 border border-[#071524]/10 rounded-xl overflow-hidden">
                  <div className="p-3 bg-white flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="w-4 h-4 text-[#006A62]" />
                      <div>
                        <div className="font-bold text-[#071524]">Sesión 14 · Rastreo Sacádico II</div>
                        <div className="text-[10px] text-[#74777C]">Hoy, 09:15 AM · 15 minutos</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="font-bold text-[#006A62]">96% Aciertos</span>
                      <span className="block text-[10px] text-[#74777C]">Latencia: 240 ms</span>
                    </div>
                  </div>

                  <div className="p-3 bg-white flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="w-4 h-4 text-[#006A62]" />
                      <div>
                        <div className="font-bold text-[#071524]">Sesión 13 · Búsqueda Visual Oculomotora</div>
                        <div className="text-[10px] text-[#74777C]">Ayer, 10:30 AM · 12 minutos</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="font-bold text-[#006A62]">92% Aciertos</span>
                      <span className="block text-[10px] text-[#74777C]">Latencia: 265 ms</span>
                    </div>
                  </div>

                  <div className="p-3 bg-white flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="w-4 h-4 text-[#006A62]" />
                      <div>
                        <div className="font-bold text-[#071524]">Sesión 12 · Fijación Foveal y Calibración</div>
                        <div className="text-[10px] text-[#74777C]">Hace 3 días · 8 minutos</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="font-bold text-[#006A62]">R²: 94%</span>
                      <span className="block text-[10px] text-[#74777C]">Error angular: 0.8°</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="bg-[#E6F6FF] px-6 py-3 border-t border-[#071524]/10 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-[#006A62] font-semibold">
            <ShieldCheck className="w-4 h-4" />
            <span>Auditado por HL7/FHIR Specimen-Eye · NeuroVisión Rehab</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleNavigateToRecord}
              className="px-4 py-2 rounded-lg bg-white border border-[#C4C6CC]/80 text-[#071524] font-semibold text-xs hover:bg-[#DBF1FE] transition-colors cursor-pointer"
            >
              Expediente Completo
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 rounded-lg bg-[#071524] text-white font-bold text-xs hover:bg-[#1C2A39] transition-colors cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
