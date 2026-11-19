import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronRight,
  Download,
  PlusCircle,
  History,
  Eye,
  CheckCircle2,
  Users,
  Sliders,
  FileText,
  Activity,
  RefreshCw,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { useAppStore } from '../../../../core/store/useAppStore';
import type { Patient, SessionRecord } from '../../../../core/domain/Patient';
import {
  clinicalApi,
  extractApiErrorMessage,
  type AssignedPatientDetailResponse,
  type DoctorTherapySessionSummary,
  type RehabilitationContextResponse,
  type TherapyPlanDetailResponse,
  type TherapyPlanSummary,
} from '../../../../infrastructure/api';
import { SpecialistHeader } from '../components/SpecialistHeader';
import { PatientOverviewCard } from '../components/PatientOverviewCard';
import { SessionHistoryTab } from '../components/SessionHistoryTab';
import { PatientAntecedentsTab } from '../components/PatientAntecedentsTab';
import { TherapeuticPlanTab } from '../components/TherapeuticPlanTab';
import { CampimetryTab } from '../components/CampimetryTab';
import { SessionAnalyticsModal } from '../components/SessionAnalyticsModal';
import { SpecialistFooter } from '../components/SpecialistFooter';

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
    hemifieldDetail: 'Evaluación clínica en curso',
    accountStatus: 'ACTIVE',
    lastSession: {
      timestampText: 'Sin sesiones recientes',
      durationMinutes: 0,
      moduleName: 'Sin módulo activo',
    },
    adherence: {
      rate: 0,
      category: 'Regular',
    },
    riskAlert: {
      severity: 'NORMAL',
      label: 'Expediente Clinical',
    },
    facility: 'NeuroVisión Clinical',
    shift: 'Consulta Externa',
    sessionHistory: [],
  };
}

function formatSessionDateTime(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: '—', time: 'En curso' };
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return { date: iso, time: '' };
  return {
    date: parsed.toLocaleDateString('es-PE', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }),
    time: parsed.toLocaleTimeString('es-PE', {
      hour: '2-digit',
      minute: '2-digit',
    }),
  };
}

const EXERCISE_LABELS: Record<string, string> = {
  'visual-scanning': 'Exploración Visual (Scanning)',
  'visual-search': 'Búsqueda Visual',
  fixation: 'Fijación Foveal',
};

const STATUS_LABELS: Record<string, string> = {
  COMPLETED: 'Completada',
  ACTIVE: 'En Curso',
  ABANDONED: 'Abandonada',
  CANCELLED: 'Cancelada',
  FAILED_TECHNICAL: 'Fallo Técnico',
};

function mapDoctorSessionToRecord(summary: DoctorTherapySessionSummary): SessionRecord {
  const dt = formatSessionDateTime(summary.startedAt);
  const hour = new Date(summary.startedAt).getHours();
  const period: SessionRecord['period'] =
    hour < 12 ? 'Mañana' : hour < 19 ? 'Tarde' : 'Noche';
  const durationMinutes = Number((summary.activeDurationSeconds / 60).toFixed(1));
  const isCompleted = summary.status === 'COMPLETED';

  return {
    id: summary.therapySessionId,
    dateText: dt.date,
    timeText: dt.time,
    period,
    moduleName: EXERCISE_LABELS[summary.exerciseCode] || summary.exerciseCode,
    moduleDetail: `Config v${summary.configurationVersion} · Cuota ${summary.quotaDate}`,
    durationMinutes,
    complianceRate: isCompleted ? 100 : 0,
    fovealPrecision: 0,
    isValid: isCompleted,
    validationStatus: isCompleted
      ? 'VALID_OPTIMAL'
      : summary.status === 'FAILED_TECHNICAL'
      ? 'CALIBRATION_ISSUE'
      : 'INTERRUPTED_FATIGUE',
    validationLabel: STATUS_LABELS[summary.status] || summary.status,
    interrupted: summary.status === 'ABANDONED' || summary.status === 'FAILED_TECHNICAL',
    notes: `Sesión ${summary.therapySessionId} (${summary.status}) · Plan ${summary.therapyPlanId}`,
  };
}

function mapDetailToPatient(
  id: string,
  base: Patient | undefined,
  detail: AssignedPatientDetailResponse | null,
  context: RehabilitationContextResponse | null,
  doctorSessions: DoctorTherapySessionSummary[] = []
): Patient {
  const fallback = base ?? buildFallbackPatient(id);
  if (!detail && !context && doctorSessions.length === 0) return fallback;

  const fullName =
    detail?.nameStatus === 'AVAILABLE'
      ? `${detail.firstName} ${detail.lastName}`.trim() || fallback.name
      : detail?.nameStatus === 'PENDING_COMPLETION'
      ? 'Paciente (Registro Pendiente)'
      : detail
      ? 'Paciente (Sin Nombre)'
      : fallback.name;

  const initials =
    detail?.nameStatus === 'AVAILABLE'
      ? `${detail.firstName?.[0] ?? ''}${detail.lastName?.[0] ?? ''}`.toUpperCase() || 'PX'
      : fallback.initials;

  const hemifield = context?.affectedHemifield ?? fallback.affectedHemifield;
  const hemifieldDetail =
    context?.affectedHemifield === 'LEFT'
      ? 'Hemicampo Izquierdo afectado'
      : context?.affectedHemifield === 'RIGHT'
      ? 'Hemicampo Derecho afectado'
      : 'Hemicampo pendiente de definir';

  const diagnosisTitle =
    detail?.strokeDiagnosis ||
    context?.previousDiagnosis ||
    fallback.primaryDiagnosisTitle ||
    'Evaluación neurológica en curso';

  const sequelaeList =
    detail?.sequelae?.length
      ? detail.sequelae
      : context?.sequelae?.length
      ? context.sequelae
      : [];

  const mappedSessions = doctorSessions.length > 0
    ? doctorSessions.map(mapDoctorSessionToRecord)
    : fallback.sessionHistory || [];

  return {
    ...fallback,
    id: detail?.clinicalPatientId || id,
    initials,
    name: fullName,
    medicalRecordNumber: `#${(detail?.clinicalPatientId || id).slice(0, 8).toUpperCase()}`,
    affectedHemifield: hemifield,
    hemifieldDetail,
    accountStatus: detail?.status === 'PENDING_ASSESSMENT' ? 'PENDING' : 'ACTIVE',
    primaryDiagnosisTitle: diagnosisTitle,
    primaryDiagnosisDetail:
      sequelaeList.length > 0 ? sequelaeList.join(' · ') : 'Sin secuelas documentadas',
    clinicalNotes: context?.observations ?? fallback.clinicalNotes,
    enrollmentDate: detail?.createdAt
      ? new Date(detail.createdAt).toLocaleDateString('es-PE', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })
      : fallback.enrollmentDate,
    sessionHistory: mappedSessions,
  };
}

export const PatientRecordPage: React.FC = () => {
  const { patientId } = useParams<{ patientId?: string }>();
  const navigate = useNavigate();
  const { patients: allPatients, authMode, accessToken, userProfile } = useAppStore();
  const isCognitoMode = authMode === 'COGNITO' && Boolean(accessToken);

  // Seleccionar el paciente activo sincronizando cambios del parámetro URL
  const [selectedPatientId, setSelectedPatientId] = useState<string>(
    patientId || allPatients[0]?.id || 'pat-000'
  );

  useEffect(() => {
    if (patientId) {
      setSelectedPatientId(patientId);
    }
  }, [patientId]);

  const effectivePatientId = patientId || selectedPatientId || allPatients[0]?.id || 'pat-000';

  // Estado remoto en modo COGNITO
  const [patientDetail, setPatientDetail] = useState<AssignedPatientDetailResponse | null>(null);
  const [rehabContext, setRehabContext] = useState<RehabilitationContextResponse | null>(null);
  const [therapyPlans, setTherapyPlans] = useState<TherapyPlanSummary[]>([]);
  const [activePlanDetail, setActivePlanDetail] = useState<TherapyPlanDetailResponse | null>(null);
  const [doctorSessions, setDoctorSessions] = useState<DoctorTherapySessionSummary[]>([]);
  const [reportPreviewData, setReportPreviewData] = useState<unknown | null>(null);
  const [isLoadingClinical, setIsLoadingClinical] = useState(false);
  const [patientError, setPatientError] = useState<string | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [plansError, setPlansError] = useState<string | null>(null);

  const loadClinicalData = useCallback(async () => {
    if (!isCognitoMode || !effectivePatientId || effectivePatientId === 'pat-000') return;
    setIsLoadingClinical(true);
    setPatientError(null);
    setContextError(null);
    setPlansError(null);

    const apiWithPreview = clinicalApi as typeof clinicalApi & {
      getReportPreview?: (id: string) => Promise<unknown>;
    };

    const [detailRes, contextRes, plansRes, sessionsRes, reportRes] = await Promise.allSettled([
      clinicalApi.getAssignedPatientDetail(effectivePatientId),
      clinicalApi.getRehabilitationContext(effectivePatientId),
      clinicalApi.listTherapyPlans(effectivePatientId, { page: 0, size: 20 }),
      clinicalApi.listDoctorTherapySessions(effectivePatientId, { page: 0, size: 50 }),
      typeof apiWithPreview.getReportPreview === 'function'
        ? apiWithPreview.getReportPreview(effectivePatientId)
        : Promise.resolve(null),
    ]);

    if (detailRes.status === 'fulfilled') {
      setPatientDetail(detailRes.value);
    } else {
      setPatientDetail(null);
      setPatientError(extractApiErrorMessage(detailRes.reason));
    }

    if (contextRes.status === 'fulfilled') {
      setRehabContext(contextRes.value);
    } else {
      setRehabContext(null);
      setContextError(extractApiErrorMessage(contextRes.reason));
    }

    if (plansRes.status === 'fulfilled') {
      const fetchedPlans = plansRes.value.plans;
      setTherapyPlans(fetchedPlans);
      if (fetchedPlans.length > 0) {
        const preferred =
          fetchedPlans.find((p) => p.status === 'ACTIVE') ?? fetchedPlans[0];
        try {
          const planDetail = await clinicalApi.getTherapyPlanDetail(
            effectivePatientId,
            preferred.therapyPlanId
          );
          setActivePlanDetail(planDetail);
        } catch (err) {
          setActivePlanDetail(null);
          setPlansError(extractApiErrorMessage(err));
        }
      } else {
        setActivePlanDetail(null);
      }
    } else {
      setTherapyPlans([]);
      setActivePlanDetail(null);
      setPlansError(extractApiErrorMessage(plansRes.reason));
    }

    if (sessionsRes.status === 'fulfilled') {
      setDoctorSessions(sessionsRes.value.sessions);
    } else {
      setDoctorSessions([]);
    }

    if (reportRes.status === 'fulfilled') {
      setReportPreviewData(reportRes.value);
    } else {
      setReportPreviewData(null);
    }

    setIsLoadingClinical(false);
  }, [isCognitoMode, effectivePatientId]);

  useEffect(() => {
    if (isCognitoMode) {
      void loadClinicalData();
    } else {
      setPatientDetail(null);
      setRehabContext(null);
      setTherapyPlans([]);
      setActivePlanDetail(null);
      setDoctorSessions([]);
      setReportPreviewData(null);
      setPatientError(null);
      setContextError(null);
      setPlansError(null);
    }
  }, [isCognitoMode, loadClinicalData]);

  const handleSelectPlan = useCallback(
    async (therapyPlanId: string) => {
      if (!isCognitoMode || !effectivePatientId) return;
      setPlansError(null);
      try {
        const detail = await clinicalApi.getTherapyPlanDetail(
          effectivePatientId,
          therapyPlanId
        );
        setActivePlanDetail(detail);
      } catch (err) {
        setPlansError(extractApiErrorMessage(err));
      }
    },
    [isCognitoMode, effectivePatientId]
  );

  const currentPatient: Patient = useMemo(() => {
    const found = allPatients.find(
      (p) =>
        p.id === effectivePatientId ||
        p.medicalRecordNumber.replace('#', '') === effectivePatientId
    );
    if (isCognitoMode) {
      return mapDetailToPatient(effectivePatientId, found, patientDetail, rehabContext, doctorSessions);
    }
    return found || allPatients[0] || buildFallbackPatient(effectivePatientId);
  }, [allPatients, effectivePatientId, isCognitoMode, patientDetail, rehabContext, doctorSessions]);

  // Tab activo (por defecto 'historial' que coincide con la pantalla de Stitch)
  const [activeTab, setActiveTab] = useState<'antecedentes' | 'plan' | 'historial' | 'campimetria'>('historial');

  // Modales
  const [selectedSessionForAnalytics, setSelectedSessionForAnalytics] = useState<SessionRecord | null>(null);
  const [isAnalyticsModalOpen, setIsAnalyticsModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Cálculo de estadísticas dinámicas reales (sin mezcla con valores demo en modo COGNITO)
  const clinicalStats = useMemo(() => {
    if (isCognitoMode) {
      const totalRecorded = doctorSessions.length;
      const completed = doctorSessions.filter((s) => s.status === 'COMPLETED').length;
      const totalSeconds = doctorSessions.reduce((acc, s) => acc + (s.activeDurationSeconds || 0), 0);
      const totalHours = Number((totalSeconds / 3600).toFixed(1));
      const adherence =
        totalRecorded > 0 ? Math.min(100, Math.round((completed / totalRecorded) * 100)) : 0;
      return {
        completedSessionsCount: completed,
        scheduledSessionsCount: totalRecorded,
        totalTherapyHours: totalHours,
        adherenceRate: adherence,
      };
    }
    return {
      completedSessionsCount: currentPatient.stats?.completedSessions ?? 28,
      scheduledSessionsCount: currentPatient.stats?.scheduledSessions ?? 30,
      totalTherapyHours: currentPatient.stats?.totalTherapyHours ?? 5.6,
      adherenceRate: currentPatient.stats?.globalAdherence ?? currentPatient.adherence.rate ?? 92.4,
    };
  }, [isCognitoMode, doctorSessions, currentPatient.stats, currentPatient.adherence.rate]);

  const specialistDoctorProp = useMemo(() => {
    if (userProfile && (userProfile.firstName || userProfile.lastName)) {
      const fullName = `${userProfile.firstName ?? ''} ${userProfile.lastName ?? ''}`.trim();
      return {
        fullName: fullName || null,
        specialty: userProfile.specialty || 'Especialista en Neurorrehabilitación',
        cmpNumber: userProfile.medicalLicense ? `CMP #${userProfile.medicalLicense}` : null,
        hospital: currentPatient.facility || 'NeuroVisión Clinical',
      };
    }
    return null;
  }, [userProfile, currentPatient.facility]);

  const latestSessionId = useMemo(() => {
    if (isCognitoMode && doctorSessions.length > 0) {
      return doctorSessions[0].therapySessionId;
    }
    return currentPatient.sessionHistory?.[0]?.id ?? null;
  }, [isCognitoMode, doctorSessions, currentPatient.sessionHistory]);

  const handleExportFullRecord = () => {
    // Generar archivo JSON/FHIR representativo para descarga
    const fhirResource = {
      resourceType: 'Bundle',
      type: 'document',
      timestamp: new Date().toISOString(),
      patient: {
        id: currentPatient.id,
        name: currentPatient.name,
        identifier: [
          { system: 'HC', value: currentPatient.medicalRecordNumber },
          { system: 'DNI', value: currentPatient.nationalId },
        ],
        gender: currentPatient.gender,
        age: currentPatient.age,
        clinicalDiagnosis: currentPatient.primaryDiagnosisTitle,
        campimetry: currentPatient.campimetryData,
        adherence: clinicalStats.adherenceRate,
        rehabilitationContext: rehabContext ?? undefined,
        activeTherapyPlan: activePlanDetail ?? undefined,
        reportPreview: reportPreviewData ?? undefined,
      },
      sessions: currentPatient.sessionHistory || [],
    };

    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(fhirResource, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `Expediente_FHIR_${currentPatient.name.replace(/\s+/g, '_')}_${currentPatient.medicalRecordNumber.replace('#', '')}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();

    showToast('Expediente clínico completo exportado en formato FHIR R4 / JSON.');
  };

  const handleDownloadSessionPDF = (session: SessionRecord) => {
    navigate(`/specialist/patients/${currentPatient.id}/reporte-pdf?sessionId=${encodeURIComponent(session.id)}`);
  };

  const handleDownloadConsolidatedPDF = () => {
    navigate(`/specialist/patients/${currentPatient.id}/reporte-pdf`);
  };

  const handleIssueCertifiedReport = () => {
    navigate(`/specialist/patients/${currentPatient.id}/reporte-pdf`);
  };

  return (
    <div className="min-h-screen bg-[#F3FAFF] text-[#071E27] font-sans flex flex-col justify-between selection:bg-[#81F3E5] selection:text-[#00201D]">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#071524] text-white px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-xs font-semibold animate-in slide-in-from-bottom-3 duration-200">
          <CheckCircle2 className="w-4 h-4 text-[#84F5E8]" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Application Bar */}
      <SpecialistHeader
        activeTab="pacientes"
        onTabChange={(tab) => {
          if (tab === 'pacientes') navigate('/specialist/dashboard');
          else if (tab === 'protocolos') navigate(`/specialist/patients/${currentPatient.id}/parametros`);
          else if (tab === 'telemetria') navigate(`/specialist/patients/${currentPatient.id}/auditoria`);
          else if (tab === 'interconsultas') navigate(`/specialist/patients/${currentPatient.id}/reporte-pdf`);
        }}
        onOpenNotifications={() => showToast('Sin nuevas alertas para este paciente.')}
      />

      {/* Main Container */}
      <main className="flex-1 w-full max-w-[1440px] mx-auto px-4 md:px-8 py-6 flex flex-col gap-6">
        {/* Breadcrumb & Contextual Actions Bar */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 sm:gap-4 pb-2 border-b border-[#071524]/10">
          {/* Back Link & Breadcrumb */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0">
            <button
              onClick={() => navigate('/specialist/dashboard')}
              className="inline-flex items-center gap-1.5 text-[#006A62] font-semibold hover:underline text-xs sm:text-sm group cursor-pointer transition-colors whitespace-nowrap"
            >
              <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform shrink-0" />
              <span>Volver a Gestión de Pacientes</span>
            </button>

            <span className="hidden sm:inline-block text-[#C4C6CC]">|</span>

            <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-[#44474C] truncate">
              <span className="hidden md:inline whitespace-nowrap">Portal Clínico</span>
              <ChevronRight className="w-3 h-3 text-[#74777C] hidden md:inline shrink-0" />
              <span className="whitespace-nowrap">Pacientes</span>
              <ChevronRight className="w-3 h-3 text-[#74777C] shrink-0" />
              <span className="font-bold text-[#071524] truncate">
                HC {currentPatient.medicalRecordNumber} - {currentPatient.name}
              </span>
            </nav>
          </div>

          {/* Quick Actions & Live HL7 Indicator */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 shrink-0">
            {/* Patient Switcher */}
            {allPatients.length > 0 && (
              <div className="inline-flex items-center gap-1.5 bg-white border border-[#071524]/10 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#071524] shadow-xs">
                <Users className="w-3.5 h-3.5 text-[#006A62] shrink-0" />
                <select
                  value={currentPatient.id}
                  onChange={(e) => {
                    setSelectedPatientId(e.target.value);
                    navigate(`/specialist/patients/${e.target.value}`);
                  }}
                  className="bg-transparent border-none text-xs font-bold text-[#071524] outline-none cursor-pointer max-w-[140px] sm:max-w-none truncate"
                >
                  {!allPatients.some((p) => p.id === currentPatient.id) && (
                    <option value={currentPatient.id}>
                      {currentPatient.name} ({currentPatient.medicalRecordNumber})
                    </option>
                  )}
                  {allPatients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.medicalRecordNumber})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {isCognitoMode && (
              <button
                type="button"
                onClick={() => void loadClinicalData()}
                disabled={isLoadingClinical}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 text-xs font-semibold rounded-lg bg-white border border-[#006A62]/30 hover:bg-[#E6F6FF] text-[#006A62] transition-colors shadow-xs disabled:opacity-60 cursor-pointer whitespace-nowrap"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingClinical ? 'animate-spin' : ''}`} />
                <span>Sincronizar</span>
              </button>
            )}

            <button
              onClick={() => navigate(`/specialist/patients/${currentPatient.id}/auditoria`)}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 text-xs font-semibold rounded-lg bg-[#E6F6FF] border border-[#071524]/15 hover:bg-[#D5ECF8] text-[#071524] transition-colors shadow-xs cursor-pointer whitespace-nowrap"
              type="button"
            >
              <Activity className="w-3.5 h-3.5 text-[#006A62] shrink-0" />
              <span>Auditoría 120Hz</span>
            </button>

            <button
              onClick={() => navigate(`/specialist/patients/${currentPatient.id}/reporte-pdf`)}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 text-xs font-semibold rounded-lg bg-white border border-[#071524]/20 hover:bg-[#DBF1FE] text-[#071524] transition-colors shadow-xs cursor-pointer whitespace-nowrap"
              type="button"
            >
              <FileText className="w-3.5 h-3.5 text-[#006A62] shrink-0" />
              <span>Visor PDF</span>
            </button>

            <button
              onClick={handleExportFullRecord}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 text-xs font-semibold rounded-lg bg-white border border-[#071524]/20 hover:bg-[#DBF1FE] text-[#071524] transition-colors shadow-xs cursor-pointer whitespace-nowrap"
              type="button"
            >
              <Download className="w-3.5 h-3.5 text-[#006A62] shrink-0" />
              <span>Exportar (FHIR)</span>
            </button>

            <button
              onClick={() => navigate(`/specialist/patients/${currentPatient.id}/parametros`)}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 text-xs font-semibold rounded-lg bg-[#1C2A39] hover:bg-[#071524] text-white transition-colors shadow-xs cursor-pointer whitespace-nowrap"
              type="button"
            >
              <Sliders className="w-3.5 h-3.5 text-[#84F5E8] shrink-0" />
              <span>Ajuste Fino</span>
            </button>

            <button
              onClick={() => navigate(`/specialist/patients/${currentPatient.id}/prescripcion`)}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 sm:px-4 sm:py-2 text-xs font-semibold rounded-lg bg-[#006A62] hover:bg-[#005049] text-white transition-colors shadow-xs cursor-pointer whitespace-nowrap"
              type="button"
            >
              <PlusCircle className="w-3.5 h-3.5 shrink-0" />
              <span>+ Prescribir Plan</span>
            </button>
          </div>
        </div>

        {/* Estado de carga o error de detalle en modo COGNITO */}
        {isCognitoMode && isLoadingClinical && !patientDetail && (
          <div className="bg-white rounded-xl border border-[#071524]/10 p-4 flex items-center gap-2.5 text-xs font-semibold text-[#006A62] shadow-xs">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Cargando expediente, contexto de rehabilitación y planes terapéuticos...</span>
          </div>
        )}

        {isCognitoMode && patientError && (
          <div className="bg-[#FFDAD6] border border-[#BA1A1A]/30 text-[#93000A] rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#BA1A1A]" />
              <div>
                <p className="font-bold">Error al consultar detalle del paciente</p>
                <p>{patientError}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void loadClinicalData()}
              className="px-3 py-1.5 rounded-lg bg-[#BA1A1A] text-white font-bold hover:bg-[#93000A] shrink-0 cursor-pointer"
            >
              Reintentar
            </button>
          </div>
        )}

        {/* Patient Clinical Overview Card */}
        <PatientOverviewCard
          patient={currentPatient}
          completedSessionsCount={clinicalStats.completedSessionsCount}
          scheduledSessionsCount={clinicalStats.scheduledSessionsCount}
          totalTherapyHours={clinicalStats.totalTherapyHours}
          adherenceRate={clinicalStats.adherenceRate}
          treatingDoctor={specialistDoctorProp}
        />

        {/* Clinical Tabs Navigation */}
        <nav
          aria-label="Pestañas del expediente"
          className="border-b border-[#071524]/15 flex gap-2 sm:gap-6 overflow-x-auto text-xs md:text-sm font-semibold scrollbar-none"
        >
          <button
            onClick={() => setActiveTab('antecedentes')}
            className={`py-3 px-2 flex items-center gap-2 whitespace-nowrap cursor-pointer transition-all ${
              activeTab === 'antecedentes'
                ? 'text-[#071524] font-bold border-b-4 border-[#006A62]'
                : 'text-[#44474C] hover:text-[#071524]'
            }`}
          >
            <span>Expediente & Antecedentes</span>
            <span className="px-1.5 py-0.5 rounded text-[11px] bg-[#DBF1FE] text-[#071524] font-bold">
              {isCognitoMode && rehabContext ? `v${rehabContext.version}` : '12'}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('plan')}
            className={`py-3 px-2 flex items-center gap-2 whitespace-nowrap cursor-pointer transition-all ${
              activeTab === 'plan'
                ? 'text-[#071524] font-bold border-b-4 border-[#006A62]'
                : 'text-[#44474C] hover:text-[#071524]'
            }`}
          >
            <span>Plan Terapéutico Activo</span>
            <span className="px-2 py-0.5 rounded-full text-[11px] bg-[#81F3E5] text-[#005049] font-bold">
              {isCognitoMode
                ? `${activePlanDetail?.configurations.length ?? 0} configs`
                : '3 ejercicios'}
            </span>
          </button>

          {/* ACTIVE TAB DE STITCH: Historial de Sesiones & PDF */}
          <button
            onClick={() => setActiveTab('historial')}
            className={`py-3 px-2 flex items-center gap-2 whitespace-nowrap cursor-pointer transition-all ${
              activeTab === 'historial'
                ? 'text-[#071524] font-bold border-b-4 border-[#006A62]'
                : 'text-[#44474C] hover:text-[#071524]'
            }`}
          >
            <History className="w-4 h-4 text-[#006A62]" />
            <span>Historial de Sesiones & PDF</span>
            <span className="px-1.5 py-0.5 rounded text-[11px] bg-[#071524] text-white font-bold">
              {currentPatient.sessionHistory?.length || (isCognitoMode ? 0 : 28)}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('campimetria')}
            className={`py-3 px-2 flex items-center gap-2 whitespace-nowrap cursor-pointer transition-all ${
              activeTab === 'campimetria'
                ? 'text-[#071524] font-bold border-b-4 border-[#006A62]'
                : 'text-[#44474C] hover:text-[#071524]'
            }`}
          >
            <Eye className="w-4 h-4 text-[#006A62]" />
            <span>Campimetría & Mapas de Fijación</span>
          </button>
        </nav>

        {/* Tab Content Render */}
        {activeTab === 'historial' && (
          <SessionHistoryTab
            sessions={currentPatient.sessionHistory || []}
            patientId={currentPatient.id}
            patient={currentPatient}
            onOpenAnalytics={(session) => {
              setSelectedSessionForAnalytics(session);
              setIsAnalyticsModalOpen(true);
            }}
            onDownloadSessionPDF={handleDownloadSessionPDF}
            onDownloadConsolidatedPDF={handleDownloadConsolidatedPDF}
            onIssueCertifiedReport={handleIssueCertifiedReport}
          />
        )}

        {activeTab === 'antecedentes' && (
          <PatientAntecedentsTab
            patient={currentPatient}
            patientDetail={isCognitoMode ? patientDetail : undefined}
            rehabilitationContext={isCognitoMode ? rehabContext : undefined}
            contextLoading={isLoadingClinical}
            contextError={contextError}
            onContextUpdated={(updated) => {
              setRehabContext(updated);
              showToast(`Contexto de rehabilitación guardado (v${updated.version}).`);
            }}
            onReloadContext={loadClinicalData}
          />
        )}

        {activeTab === 'plan' && (
          <TherapeuticPlanTab
            patient={currentPatient}
            plans={isCognitoMode ? therapyPlans : undefined}
            activePlanDetail={isCognitoMode ? activePlanDetail : undefined}
            plansLoading={isLoadingClinical}
            plansError={plansError}
            onSelectPlan={(planId) => void handleSelectPlan(planId)}
            onPlanUpdated={() => {
              showToast('Plan terapéutico actualizado con éxito.');
              if (isCognitoMode) void loadClinicalData();
            }}
          />
        )}

        {activeTab === 'campimetria' && (
          <CampimetryTab
            patient={currentPatient}
            rehabilitationContext={rehabContext}
            patientId={currentPatient.id}
            latestSessionId={latestSessionId}
            onEditContext={() => setActiveTab('antecedentes')}
            onOpenAudit={() => navigate(`/specialist/patients/${currentPatient.id}/auditoria`)}
          />
        )}
      </main>

      {/* Shared Footer */}
      <SpecialistFooter />

      {/* Session Analytics Modal */}
      <SessionAnalyticsModal
        session={selectedSessionForAnalytics}
        isOpen={isAnalyticsModalOpen}
        onClose={() => {
          setIsAnalyticsModalOpen(false);
          setSelectedSessionForAnalytics(null);
        }}
      />
    </div>
  );
};
