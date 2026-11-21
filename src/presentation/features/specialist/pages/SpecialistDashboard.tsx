import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Download,
  UserPlus,
  CheckCircle2,
  RefreshCw,
  AlertCircle,
  Loader2,
  Mail,
  Users,
} from 'lucide-react';
import { useAppStore } from '../../../../core/store/useAppStore';
import type { Patient, AffectedHemifield } from '../../../../core/domain/Patient';
import {
  clinicalApi,
  iamApi,
  extractApiErrorMessage,
  type AssignedPatient,
  type AssignedPatientDetailResponse,
  type RehabilitationContextResponse,
  type DoctorTherapySessionSummary,
  type TherapyExerciseCode,
} from '../../../../infrastructure/api';
import { SpecialistHeader } from '../components/SpecialistHeader';
import { SubHeaderStrip } from '../components/SubHeaderStrip';
import { SpecialistStatCards } from '../components/SpecialistStatCards';
import { PatientFilterToolbar } from '../components/PatientFilterToolbar';
import { PatientTable } from '../components/PatientTable';
import { NewPatientModal } from '../components/NewPatientModal';
import { PatientDetailModal } from '../components/PatientDetailModal';
import { SpecialistFooter } from '../components/SpecialistFooter';

function formatShortDate(iso: string): string {
  try {
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return iso;
    return parsed.toLocaleDateString('es-PE', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function isDateToday(isoString: string): boolean {
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return false;
    const now = new Date();
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  } catch {
    return false;
  }
}

function mapExerciseCodeToName(code?: TherapyExerciseCode | string): string {
  switch (code) {
    case 'visual-scanning':
      return 'Rastreo Sacádico';
    case 'visual-search':
      return 'Búsqueda Oculomotora';
    case 'fixation':
      return 'Fijación Foveal';
    default:
      return code || 'Terapia Ocular';
  }
}

function hasClinicalAlert(patient: Patient): boolean {
  const isPending = patient.accountStatus === 'PENDING';
  const isCriticalSeverity =
    patient.riskAlert.severity === 'CRITICAL' || patient.riskAlert.severity === 'WARNING';
  const hasLowAdherence = patient.adherence.rate > 0 && patient.adherence.rate < 70;
  return isPending || isCriticalSeverity || hasLowAdherence;
}

function mapAssignedPatientToHydratedPatient(
  item: AssignedPatient,
  detail: AssignedPatientDetailResponse | null,
  context: RehabilitationContextResponse | null,
  sessions: DoctorTherapySessionSummary[]
): Patient {
  const fullName =
    item.nameStatus === 'AVAILABLE'
      ? `${item.firstName} ${item.lastName}`.trim() || 'Paciente Asignado'
      : item.nameStatus === 'PENDING_COMPLETION'
      ? 'Paciente (Registro Pendiente)'
      : 'Paciente (Sin Nombre)';

  const initials =
    item.nameStatus === 'AVAILABLE'
      ? `${item.firstName?.[0] ?? ''}${item.lastName?.[0] ?? ''}`.toUpperCase() || 'PX'
      : 'PX';

  const shortId = item.clinicalPatientId.slice(0, 8).toUpperCase();
  const isPending = item.status === 'PENDING_ASSESSMENT';

  // Hemicampo afectado calculado
  const affectedHemifield: AffectedHemifield =
    context?.affectedHemifield === 'RIGHT' ? 'RIGHT' : 'LEFT';

  // Detalle de hemicampo y diagnóstico clínico
  const sideLabel = affectedHemifield === 'LEFT' ? 'Izquierda' : 'Derecha';
  const hemifieldDetail = isPending
    ? 'Evaluación clínica pendiente'
    : detail?.strokeDiagnosis ||
      context?.previousDiagnosis ||
      `Hemianopsia Homónima ${sideLabel}`;

  // Sesiones ordenadas por fecha más reciente
  const sortedSessions = [...sessions].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
  const latestSession = sortedSessions[0];

  // Adherencia real basada en sesiones completadas vs totales
  const completedSessions = sessions.filter((s) => s.status === 'COMPLETED').length;
  const adherenceRate =
    sessions.length > 0 ? Math.round((completedSessions / sessions.length) * 100) : 0;

  const adherenceCategory: 'Excelente' | 'Regular' | 'Moderada' | 'Deficiente' =
    adherenceRate >= 80
      ? 'Excelente'
      : adherenceRate >= 60
      ? 'Regular'
      : adherenceRate >= 40
      ? 'Moderada'
      : 'Deficiente';

  // Alerta de riesgo
  let riskAlert: { severity: 'OPTIMAL' | 'NORMAL' | 'PENDING' | 'WARNING' | 'CRITICAL'; label: string };
  if (isPending) {
    riskAlert = { severity: 'PENDING', label: 'Evaluación pendiente' };
  } else if (sessions.length > 0 && adherenceRate < 70) {
    riskAlert = { severity: 'CRITICAL', label: `Baja adherencia (${adherenceRate}%)` };
  } else if (sessions.length >= 3 && adherenceRate >= 80) {
    riskAlert = { severity: 'OPTIMAL', label: 'Progreso Óptimo' };
  } else if (sessions.length > 0) {
    riskAlert = { severity: 'NORMAL', label: 'En Seguimiento' };
  } else {
    riskAlert = { severity: 'NORMAL', label: 'Paciente Asignado' };
  }

  // Última sesión
  const lastSession = latestSession
    ? {
        timestampText: formatShortDate(latestSession.startedAt),
        durationMinutes: Math.round(latestSession.activeDurationSeconds / 60),
        moduleName: mapExerciseCodeToName(latestSession.exerciseCode),
        interrupted:
          latestSession.status === 'CANCELLED' || latestSession.status === 'ABANDONED',
      }
    : {
        timestampText: formatShortDate(item.updatedAt),
        durationMinutes: 0,
        moduleName: isPending ? 'Pendiente de valoración' : 'Sin sesiones registradas',
        interrupted: false,
      };

  return {
    id: item.clinicalPatientId,
    initials,
    name: fullName,
    medicalRecordNumber: `#${shortId}`,
    nationalId: item.nameStatus === 'AVAILABLE' ? 'Perfil verificado' : 'Perfil pendiente',
    age: 0,
    gender: 'Otro',
    affectedHemifield,
    hemifieldDetail,
    accountStatus: isPending ? 'PENDING' : 'ACTIVE',
    statusDetail: isPending
      ? 'Evaluación pendiente'
      : item.nameStatus === 'PENDING_COMPLETION'
      ? 'Completar perfil'
      : 'Activo en Clinical',
    lastSession,
    adherence: {
      rate: adherenceRate,
      category: adherenceCategory,
    },
    riskAlert,
    facility: 'NeuroVisión Clinical',
    shift: 'Consulta Externa',
    enrollmentDate: formatShortDate(item.createdAt),
    primaryDiagnosisTitle: detail?.strokeDiagnosis || context?.previousDiagnosis || undefined,
    primaryDiagnosisDetail:
      context?.observations ||
      (detail?.sequelae?.length ? `Secuelas: ${detail.sequelae.join(', ')}` : undefined),
    clinicalNotes: context?.observations || undefined,
  };
}

export const SpecialistDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { patients, authMode, accessToken, setPatients, addPatient, updatePatient } = useAppStore();
  const isCognitoMode = authMode === 'COGNITO' && Boolean(accessToken);

  const [activeTab, setActiveTab] = useState<string>('pacientes');

  // Estado de carga remota (modo COGNITO)
  const [cognitoPatients, setCognitoPatients] = useState<Patient[] | null>(null);
  const [totalAssigned, setTotalAssigned] = useState<number>(0);
  const [cognitoCompletedToday, setCognitoCompletedToday] = useState<number>(0);
  const [isLoadingPatients, setIsLoadingPatients] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filtros
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDiagnosis, setSelectedDiagnosis] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  const [selectedFacility, setSelectedFacility] = useState('ALL');
  const [criticalOnly, setCriticalOnly] = useState<boolean>(false);

  // Modales
  const [isNewPatientModalOpen, setIsNewPatientModalOpen] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  }, []);

  const fetchAssignedPatients = useCallback(async () => {
    if (!isCognitoMode) return;
    setIsLoadingPatients(true);
    setLoadError(null);
    try {
      const response = await clinicalApi.listAssignedPatients({ page: 0, size: 50 });
      const rawPatients = response.patients;
      setTotalAssigned(response.total ?? rawPatients.length);

      let todayCompletedCounter = 0;

      // Hidratar cada paciente asignado en paralelo con contexto, detalle y sesiones
      const hydratedList = await Promise.all(
        rawPatients.map(async (rawPatient) => {
          const id = rawPatient.clinicalPatientId;
          const [detailResult, contextResult, sessionsResult] = await Promise.allSettled([
            clinicalApi.getAssignedPatientDetail(id),
            clinicalApi.getRehabilitationContext(id),
            clinicalApi.listDoctorTherapySessions(id),
          ]);

          const detail = detailResult.status === 'fulfilled' ? detailResult.value : null;
          const context = contextResult.status === 'fulfilled' ? contextResult.value : null;
          const sessions = sessionsResult.status === 'fulfilled' ? sessionsResult.value.sessions : [];

          // Contar sesiones completadas hoy
          for (const s of sessions) {
            if (s.status === 'COMPLETED' && isDateToday(s.startedAt || s.quotaDate)) {
              todayCompletedCounter++;
            }
          }

          return mapAssignedPatientToHydratedPatient(rawPatient, detail, context, sessions);
        })
      );

      setCognitoCompletedToday(todayCompletedCounter);
      setCognitoPatients(hydratedList);
      setPatients(hydratedList);
    } catch (err) {
      setLoadError(extractApiErrorMessage(err));
    } finally {
      setIsLoadingPatients(false);
    }
  }, [isCognitoMode, setPatients]);

  useEffect(() => {
    if (isCognitoMode) {
      void fetchAssignedPatients();
    } else {
      setCognitoPatients(null);
      setLoadError(null);
      setCognitoCompletedToday(0);
    }
  }, [isCognitoMode, fetchAssignedPatients]);

  const activePatientsList = useMemo(() => {
    if (isCognitoMode) {
      return cognitoPatients ?? [];
    }
    return patients;
  }, [isCognitoMode, cognitoPatients, patients]);

  // Filtrado reactivo en tiempo real
  const filteredPatients = useMemo(() => {
    return activePatientsList.filter((patient) => {
      // Filtro de Alertas Críticas / Prioritarias
      if (criticalOnly && !hasClinicalAlert(patient)) {
        return false;
      }

      // Búsqueda por texto (Nombre, DNI, HC o ID)
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesName = patient.name.toLowerCase().includes(query);
        const matchesDni = patient.nationalId.toLowerCase().includes(query);
        const matchesHc = patient.medicalRecordNumber.toLowerCase().includes(query);
        const matchesId = patient.id.toLowerCase().includes(query);
        if (!matchesName && !matchesDni && !matchesHc && !matchesId) return false;
      }

      // Filtro por Diagnóstico
      if (selectedDiagnosis !== 'ALL') {
        const matchesDiagnosis = patient.hemifieldDetail
          .toLowerCase()
          .includes(selectedDiagnosis.toLowerCase().replace('diagnóstico clínico: ', ''));
        if (!matchesDiagnosis) return false;
      }

      // Filtro por Estado
      if (selectedStatus !== 'ALL') {
        if (patient.accountStatus !== selectedStatus) return false;
      }

      // Filtro por Sede
      if (selectedFacility !== 'ALL') {
        if (!patient.facility.includes(selectedFacility)) return false;
      }

      return true;
    });
  }, [activePatientsList, criticalOnly, searchQuery, selectedDiagnosis, selectedStatus, selectedFacility]);

  // Cálculos estadísticos para las tarjetas Bento
  const activeCount = activePatientsList.filter((p) => p.accountStatus === 'ACTIVE').length;
  const criticalAlertsCount = activePatientsList.filter(hasClinicalAlert).length;

  const realGlobalAdherence = useMemo(() => {
    const active = activePatientsList.filter((p) => p.accountStatus === 'ACTIVE');
    const withTelemetry = active.filter((p) => p.adherence.rate > 0);
    if (withTelemetry.length === 0) return 0;
    const sum = withTelemetry.reduce((acc, p) => acc + p.adherence.rate, 0);
    return Number((sum / withTelemetry.length).toFixed(1));
  }, [activePatientsList]);

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedDiagnosis('ALL');
    setSelectedStatus('ALL');
    setSelectedFacility('ALL');
    setCriticalOnly(false);
  };

  const handleAddPatient = (newPatient: Patient) => {
    addPatient(newPatient);
    showToast(`Paciente ${newPatient.name} registrado con éxito.`);
  };

  const handleExportCSV = () => {
    const headers = ['ID', 'Nombre', 'HC', 'DNI', 'Edad', 'Sexo', 'Hemicampo', 'Estado', 'Adherencia', 'Sede'];
    const rows = filteredPatients.map((p) => [
      p.id,
      `"${p.name}"`,
      p.medicalRecordNumber,
      p.nationalId,
      p.age,
      p.gender,
      p.affectedHemifield,
      p.accountStatus,
      `${p.adherence.rate}%`,
      `"${p.facility}"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `reporte_pacientes_neurovision_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast('Reporte clínico descargado en formato CSV / FHIR.');
  };

  // Reenviar invitación o gestionar invitación con IAM
  const handleResendOrManageInvitation = async (patient: Patient) => {
    if (isCognitoMode) {
      try {
        showToast('Consultando estado de invitación en IAM...');
        const invList = await iamApi.listPatientInvitations({ page: 0, size: 50 });
        const matchingInv = invList.items.find(
          (inv) => patient.email && inv.patientEmail.toLowerCase() === patient.email.toLowerCase()
        ) || invList.items[0];

        if (matchingInv) {
          const inviteText = `Invitación NeuroVisión - ID: ${matchingInv.invitationId} | Estado: ${matchingInv.status} | Email: ${matchingInv.patientEmail} | Fecha: ${formatShortDate(matchingInv.createdAt)}`;
          if (navigator.clipboard) {
            await navigator.clipboard.writeText(inviteText);
          }
          showToast(`Invitación (${matchingInv.status}) copiada al portapapeles.`);
        } else {
          showToast('Abriendo panel de gestión de invitaciones...');
        }
        setIsNewPatientModalOpen(true);
      } catch (err) {
        showToast(`Error al consultar invitaciones: ${extractApiErrorMessage(err)}`);
        setIsNewPatientModalOpen(true);
      }
    } else {
      showToast(
        `Código de activación reenviado por SMS al ${patient.phone || 'número registrado'}.`
      );
    }
  };

  const defaultPatientId = activePatientsList[0]?.id || (isCognitoMode ? '' : 'pat-000');

  const navigateWithPatientCheck = (pathBuilder: (id: string) => string) => {
    if (!defaultPatientId) {
      showToast('No hay pacientes asignados todavía. Invite a un paciente primero.');
      return;
    }
    navigate(pathBuilder(defaultPatientId));
  };

  return (
    <div className="min-h-screen bg-[#F3FAFF] text-[#071E27] font-sans flex flex-col justify-between selection:bg-[#84F5E8] selection:text-[#00201D]">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#071524] text-white px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-xs font-semibold animate-in slide-in-from-bottom-3 duration-200">
          <CheckCircle2 className="w-4 h-4 text-[#84F5E8]" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Application Bar */}
      <SpecialistHeader
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          if (tab === 'protocolos') navigateWithPatientCheck((id) => `/specialist/patients/${id}/parametros`);
          else if (tab === 'telemetria') navigateWithPatientCheck((id) => `/specialist/patients/${id}/auditoria`);
          else if (tab === 'interconsultas') navigateWithPatientCheck((id) => `/specialist/patients/${id}/reporte-pdf`);
        }}
        onOpenNotifications={() =>
          showToast(
            isCognitoMode
              ? `${activePatientsList.length} paciente(s) asignado(s) sincronizados desde Clinical.`
              : '2 alertas críticas de adherencia pendientes de revisión.'
          )
        }
      />

      {/* Breadcrumb Sub-Header */}
      <SubHeaderStrip />

      {/* Main Viewport Container */}
      <main className="flex-1 max-w-[1536px] w-full mx-auto px-4 lg:px-6 xl:px-8 py-6 flex flex-col gap-5 sm:gap-6">
        {/* Page Title Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 sm:gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl sm:text-2xl xl:text-3xl font-bold text-[#071524] tracking-tight">
                Gestión de Pacientes y Monitorización de Telemetría Ocular
              </h1>
              {isCognitoMode && (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#81F3E5] text-[#005049]">
                  Clinical API · {totalAssigned} asignados
                </span>
              )}
            </div>
            <p className="text-xs sm:text-sm text-[#44474C] mt-1">
              Seguimiento activo de pacientes en rehabilitación de defectos campimétricos y hemianopsias homónimas.
            </p>
          </div>

          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 shrink-0">
            {isCognitoMode && (
              <button
                type="button"
                onClick={() => void fetchAssignedPatients()}
                disabled={isLoadingPatients}
                className="inline-flex items-center justify-center gap-2 px-3.5 py-2 sm:px-4 sm:py-2.5 rounded-lg border border-[#006A62]/30 bg-white text-[#006A62] font-semibold text-xs hover:bg-[#E6F6FF] transition-colors disabled:opacity-60 shadow-xs cursor-pointer whitespace-nowrap"
              >
                <RefreshCw className={`w-4 h-4 ${isLoadingPatients ? 'animate-spin' : ''}`} />
                Actualizar
              </button>
            )}

            <button
              type="button"
              onClick={handleExportCSV}
              className="inline-flex items-center justify-center gap-2 px-3.5 py-2 sm:px-4 sm:py-2.5 rounded-lg border border-[#C4C6CC] bg-white text-[#071524] font-semibold text-xs hover:bg-[#DBF1FE] transition-colors focus:ring-2 focus:ring-[#071524]/20 shadow-xs cursor-pointer whitespace-nowrap"
            >
              <Download className="w-4 h-4 text-[#006A62]" />
              Exportar FHIR / CSV
            </button>

            <button
              type="button"
              onClick={() => setIsNewPatientModalOpen(true)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 sm:px-5 sm:py-2.5 rounded-lg bg-[#1C2A39] text-white font-semibold text-xs hover:bg-[#071524] transition-colors shadow-xs focus:ring-4 focus:ring-[#84F5E8]/50 cursor-pointer whitespace-nowrap"
            >
              <UserPlus className="w-4 h-4 text-[#84F5E8]" />
              {isCognitoMode ? 'Invitar Paciente' : '+ Registrar Paciente'}
            </button>
          </div>
        </div>

        {/* Error Banner (COGNITO) */}
        {isCognitoMode && loadError && (
          <div className="bg-[#FFDAD6] border border-[#BA1A1A]/30 text-[#93000A] rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 text-[#BA1A1A] shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-sm">No se pudo cargar la lista de pacientes asignados</p>
                <p className="mt-0.5 font-medium">{loadError}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void fetchAssignedPatients()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#BA1A1A] text-white font-bold hover:bg-[#93000A] transition-colors shrink-0 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reintentar
            </button>
          </div>
        )}

        {/* Bento Quick Stat Summary Cards */}
        <SpecialistStatCards
          totalPatients={activePatientsList.length}
          activePatientsCount={activeCount}
          completedTodayCount={isCognitoMode ? cognitoCompletedToday : 18}
          scheduledTodayCount={isCognitoMode ? Math.max(activePatientsList.length, 1) : 22}
          criticalAlertsCount={criticalAlertsCount}
          globalAdherenceRate={isCognitoMode ? realGlobalAdherence : 94.2}
          isCriticalFilterActive={criticalOnly}
          onFilterCriticalAlerts={() => {
            setCriticalOnly((prev) => {
              const next = !prev;
              showToast(
                next
                  ? 'Filtrando pacientes con alertas clínicas o pendientes.'
                  : 'Filtro de alertas clínicas desactivado.'
              );
              return next;
            });
          }}
        />

        {/* Filter and Search Action Toolbar */}
        <PatientFilterToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          selectedDiagnosis={selectedDiagnosis}
          onDiagnosisChange={setSelectedDiagnosis}
          selectedStatus={selectedStatus}
          onStatusChange={setSelectedStatus}
          selectedFacility={selectedFacility}
          onFacilityChange={setSelectedFacility}
          onResetFilters={handleResetFilters}
          criticalOnly={criticalOnly}
          onToggleCriticalOnly={() => {
            setCriticalOnly((prev) => !prev);
          }}
        />

        {/* Loading Skeleton / Empty State / Data Table */}
        {isCognitoMode && isLoadingPatients && cognitoPatients === null ? (
          <div className="bg-white rounded-xl border border-[#071524]/10 p-8 shadow-xs space-y-4">
            <div className="flex items-center gap-3 text-sm font-semibold text-[#006A62]">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Cargando pacientes asignados desde el servicio clínico...</span>
            </div>
            <div className="space-y-3 animate-pulse">
              {[1, 2, 3].map((row) => (
                <div key={row} className="h-14 rounded-lg bg-[#E6F6FF]" />
              ))}
            </div>
          </div>
        ) : isCognitoMode && !isLoadingPatients && !loadError && activePatientsList.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#071524]/10 p-10 shadow-xs text-center flex flex-col items-center justify-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-[#E6F6FF] text-[#006A62] flex items-center justify-center">
              <Users className="w-7 h-7" />
            </div>
            <h2 className="text-base sm:text-lg font-bold text-[#071524]">
              Aún no tiene pacientes asignados en su cartera clínica
            </h2>
            <p className="text-xs sm:text-sm text-[#44474C] max-w-md">
              Envíe una invitación al correo electrónico del paciente para habilitar su expediente clínico, contexto de rehabilitación y planes terapéuticos.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
              <button
                type="button"
                onClick={() => setIsNewPatientModalOpen(true)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#006A62] hover:bg-[#005049] text-white font-bold text-xs shadow-xs cursor-pointer"
              >
                <Mail className="w-4 h-4" />
                Invitar Paciente
              </button>
              <button
                type="button"
                onClick={() => void fetchAssignedPatients()}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[#C4C6CC] bg-white hover:bg-[#F3FAFF] text-[#071524] font-semibold text-xs cursor-pointer"
              >
                <RefreshCw className="w-4 h-4 text-[#006A62]" />
                Verificar nuevamente
              </button>
            </div>
          </div>
        ) : (
          <PatientTable
            patients={filteredPatients}
            onSelectPatient={(patient) => {
              navigate(`/specialist/patients/${patient.id}`);
            }}
            onPrescribePlan={(patient) => {
              navigate(`/specialist/patients/${patient.id}/prescripcion`);
            }}
            onOpenAnalytics={(patient) => {
              navigate(`/specialist/patients/${patient.id}/auditoria`);
            }}
            onContactPatient={(patient) => {
              setSelectedPatient(patient);
              setIsDetailModalOpen(true);
            }}
            onQuickViewPatient={(patient) => {
              setSelectedPatient(patient);
              setIsDetailModalOpen(true);
            }}
            onResendSMS={handleResendOrManageInvitation}
          />
        )}
      </main>

      {/* Shared Footer */}
      <SpecialistFooter />

      {/* Modals (soporta invitación Cognito y registro Mock) */}
      <NewPatientModal
        isOpen={isNewPatientModalOpen}
        onClose={() => setIsNewPatientModalOpen(false)}
        onSavePatient={handleAddPatient}
        onSuccess={() => {
          showToast('Invitación procesada. Actualizando pacientes asignados...');
          void fetchAssignedPatients();
        }}
      />

      <PatientDetailModal
        patient={selectedPatient}
        isOpen={isDetailModalOpen}
        onClose={() => {
          setIsDetailModalOpen(false);
          setSelectedPatient(null);
        }}
        onUpdatePatient={(updated) => {
          updatePatient(updated);
          showToast(`Expediente de ${updated.name} actualizado.`);
        }}
      />
    </div>
  );
};
