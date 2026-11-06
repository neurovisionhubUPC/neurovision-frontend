import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Download, 
  UserPlus, 
  CheckCircle2
} from 'lucide-react';
import { INITIAL_MOCK_PATIENTS } from '../../../../core/domain/mockPatients';
import type { Patient } from '../../../../core/domain/Patient';
import { SpecialistHeader } from '../components/SpecialistHeader';
import { SubHeaderStrip } from '../components/SubHeaderStrip';
import { SpecialistStatCards } from '../components/SpecialistStatCards';
import { PatientFilterToolbar } from '../components/PatientFilterToolbar';
import { PatientTable } from '../components/PatientTable';
import { NewPatientModal } from '../components/NewPatientModal';
import { PatientDetailModal } from '../components/PatientDetailModal';
import { SpecialistFooter } from '../components/SpecialistFooter';

export const SpecialistDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [patients, setPatients] = useState<Patient[]>(INITIAL_MOCK_PATIENTS);
  const [activeTab, setActiveTab] = useState<string>('pacientes');
  
  // Filtros
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDiagnosis, setSelectedDiagnosis] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  const [selectedFacility, setSelectedFacility] = useState('ALL');

  // Modales
  const [isNewPatientModalOpen, setIsNewPatientModalOpen] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Filtrado reactivo en tiempo real
  const filteredPatients = useMemo(() => {
    return patients.filter((patient) => {
      // Búsqueda por texto (Nombre, DNI o HC)
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesName = patient.name.toLowerCase().includes(query);
        const matchesDni = patient.nationalId.includes(query);
        const matchesHc = patient.medicalRecordNumber.toLowerCase().includes(query);
        if (!matchesName && !matchesDni && !matchesHc) return false;
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
  }, [patients, searchQuery, selectedDiagnosis, selectedStatus, selectedFacility]);

  // Cálculos estadísticos para las tarjetas Bento
  const activeCount = patients.filter((p) => p.accountStatus === 'ACTIVE').length;
  const criticalCount = patients.filter((p) => p.riskAlert.severity === 'CRITICAL').length;

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedDiagnosis('ALL');
    setSelectedStatus('ALL');
    setSelectedFacility('ALL');
  };

  const handleAddPatient = (newPatient: Patient) => {
    setPatients((prev) => [newPatient, ...prev]);
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
        onTabChange={(tab) => setActiveTab(tab)}
        onOpenNotifications={() => showToast('2 alertas críticas de adherencia pendientes de revisión.')}
      />

      {/* Breadcrumb Sub-Header */}
      <SubHeaderStrip />

      {/* Main Viewport Container */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 lg:px-6 xl:px-8 py-6 flex flex-col gap-5 sm:gap-6">
        {/* Page Title Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 sm:gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl xl:text-3xl font-bold text-[#071524] tracking-tight">
              Gestión de Pacientes y Monitorización de Telemetría Ocular
            </h1>
            <p className="text-xs sm:text-sm text-[#44474C] mt-1">
              Seguimiento activo de pacientes en rehabilitación de defectos campimétricos y hemianopsias homónimas.
            </p>
          </div>

          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 shrink-0">
            <button
              onClick={handleExportCSV}
              className="inline-flex items-center justify-center gap-2 px-3.5 py-2 sm:px-4 sm:py-2.5 rounded-lg border border-[#C4C6CC] bg-white text-[#071524] font-semibold text-xs hover:bg-[#DBF1FE] transition-colors focus:ring-2 focus:ring-[#071524]/20 shadow-xs cursor-pointer whitespace-nowrap"
            >
              <Download className="w-4 h-4 text-[#006A62]" />
              Exportar FHIR / CSV
            </button>

            <button
              onClick={() => setIsNewPatientModalOpen(true)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 sm:px-5 sm:py-2.5 rounded-lg bg-[#1C2A39] text-white font-semibold text-xs hover:bg-[#071524] transition-colors shadow-xs focus:ring-4 focus:ring-[#84F5E8]/50 cursor-pointer whitespace-nowrap"
            >
              <UserPlus className="w-4 h-4 text-[#84F5E8]" />
              + Registrar Paciente
            </button>
          </div>
        </div>

        {/* Bento Quick Stat Summary Cards */}
        <SpecialistStatCards
          totalPatients={patients.length}
          activePatientsCount={activeCount}
          completedTodayCount={18}
          scheduledTodayCount={22}
          criticalAlertsCount={criticalCount}
          globalAdherenceRate={94.2}
          onFilterCriticalAlerts={() => {
            setSelectedStatus('ACTIVE');
            showToast('Filtrando pacientes con alerta crítica.');
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
        />

        {/* Main Data Table */}
        <PatientTable
          patients={filteredPatients}
          onSelectPatient={(patient) => {
            navigate(`/specialist/patients/${patient.id}`);
          }}
          onPrescribePlan={(patient) => {
            setSelectedPatient(patient);
            setIsDetailModalOpen(true);
          }}
          onOpenAnalytics={(patient) => {
            navigate(`/specialist/patients/${patient.id}`);
          }}
          onContactPatient={(patient) => {
            showToast(`Iniciando llamada de protocolo de rescate a ${patient.phone || 'paciente'}...`);
          }}
          onResendSMS={(patient) => {
            showToast(`Código de activación reenviado por SMS al ${patient.phone || 'número registrado'}.`);
          }}
        />
      </main>

      {/* Shared Footer */}
      <SpecialistFooter />

      {/* Modals */}
      <NewPatientModal
        isOpen={isNewPatientModalOpen}
        onClose={() => setIsNewPatientModalOpen(false)}
        onSavePatient={handleAddPatient}
      />

      <PatientDetailModal
        patient={selectedPatient}
        isOpen={isDetailModalOpen}
        onClose={() => {
          setIsDetailModalOpen(false);
          setSelectedPatient(null);
        }}
        onUpdatePatient={(updated) => {
          setPatients((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
          showToast(`Expediente de ${updated.name} actualizado.`);
        }}
      />
    </div>
  );
};
