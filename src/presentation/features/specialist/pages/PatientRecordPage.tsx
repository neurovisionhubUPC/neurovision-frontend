import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, 
  ChevronRight, 
  Download, 
  PlusCircle, 
  History, 
  Eye, 
  CheckCircle2, 
  Users 
} from 'lucide-react';
import patientsJson from '../../../../core/data/patients.json';
import type { Patient, SessionRecord } from '../../../../core/domain/Patient';
import { SpecialistHeader } from '../components/SpecialistHeader';
import { PatientOverviewCard } from '../components/PatientOverviewCard';
import { SessionHistoryTab } from '../components/SessionHistoryTab';
import { PatientAntecedentsTab } from '../components/PatientAntecedentsTab';
import { TherapeuticPlanTab } from '../components/TherapeuticPlanTab';
import { CampimetryTab } from '../components/CampimetryTab';
import { SessionAnalyticsModal } from '../components/SessionAnalyticsModal';
import { SpecialistFooter } from '../components/SpecialistFooter';

export const PatientRecordPage: React.FC = () => {
  const { patientId } = useParams<{ patientId?: string }>();
  const navigate = useNavigate();

  const allPatients: Patient[] = useMemo(() => {
    return patientsJson as unknown as Patient[];
  }, []);

  // Seleccionar el paciente activo (por defecto Juan Pérez `pat-000` si no se encuentra o no se envía)
  const [selectedPatientId, setSelectedPatientId] = useState<string>(
    patientId || 'pat-000'
  );

  const currentPatient: Patient = useMemo(() => {
    const found = allPatients.find(
      (p) => p.id === selectedPatientId || p.medicalRecordNumber.replace('#', '') === selectedPatientId
    );
    return found || allPatients[0];
  }, [allPatients, selectedPatientId]);

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
        adherence: currentPatient.stats?.globalAdherence,
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
    showToast(`Generando reporte individual de ${session.moduleName} (${session.dateText})...`);
  };

  const handleDownloadConsolidatedPDF = () => {
    showToast(`Generando informe consolidado de telemetría de ${currentPatient.name}...`);
  };

  const handleIssueCertifiedReport = () => {
    showToast(`Informe certificado con firma digital de la Dra. Elena Ramos Morales emitido exitosamente.`);
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
            {/* Patient Switcher (Simulación con los datos del JSON) */}
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
                {allPatients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.medicalRecordNumber})
                  </option>
                ))}
              </select>
            </div>

            {/* Live HL7 Telemetry Status */}
            <div
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#DBF1FE] border border-[#071524]/10 text-xs font-semibold text-[#071524] whitespace-nowrap"
              title="Sincronización en tiempo real vía protocolo HL7 / FHIR R4"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse shrink-0"></span>
              <span className="hidden sm:inline">Telemetría Activa - HL7/FHIR</span>
              <span className="sm:hidden">HL7 Activo</span>
            </div>

            <button
              onClick={handleExportFullRecord}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 text-xs font-semibold rounded-lg bg-white border border-[#071524]/20 hover:bg-[#DBF1FE] text-[#071524] transition-colors shadow-xs cursor-pointer whitespace-nowrap"
              type="button"
            >
              <Download className="w-3.5 h-3.5 text-[#006A62] shrink-0" />
              <span>Exportar (FHIR)</span>
            </button>

            <button
              onClick={() => setActiveTab('plan')}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 sm:px-4 sm:py-2 text-xs font-semibold rounded-lg bg-[#006A62] hover:bg-[#005049] text-white transition-colors shadow-xs cursor-pointer whitespace-nowrap"
              type="button"
            >
              <PlusCircle className="w-3.5 h-3.5 shrink-0" />
              <span>+ Prescribir Sesión</span>
            </button>
          </div>
        </div>

        {/* Patient Clinical Overview Card */}
        <PatientOverviewCard patient={currentPatient} />

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
              12
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
              3 ejercicios
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
              {currentPatient.sessionHistory?.length || 28}
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
          <PatientAntecedentsTab patient={currentPatient} />
        )}

        {activeTab === 'plan' && (
          <TherapeuticPlanTab
            patient={currentPatient}
            onPlanUpdated={() => showToast('Plan terapéutico actualizado con éxito.')}
          />
        )}

        {activeTab === 'campimetria' && (
          <CampimetryTab patient={currentPatient} />
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
