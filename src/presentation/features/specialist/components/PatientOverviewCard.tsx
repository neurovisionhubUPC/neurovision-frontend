import React from 'react';
import { 
  Stethoscope, 
  Building2, 
  Calendar, 
  TrendingUp, 
  AlertCircle,
  Eye
} from 'lucide-react';
import type { Patient } from '../../../../core/domain/Patient';

interface PatientOverviewCardProps {
  patient: Patient;
}

export const PatientOverviewCard: React.FC<PatientOverviewCardProps> = ({ patient }) => {
  const stats = patient.stats || {
    globalAdherence: patient.adherence.rate,
    completedSessions: 28,
    scheduledSessions: 30,
    meanFatigue: 1.8,
    totalTherapyHours: 5.6,
    validatedSessions: 27,
    totalRecordedSessions: 28,
  };

  const doctor = patient.treatingDoctor || {
    name: 'Dra. Elena Ramos Morales, M.D.',
    specialty: 'Neuroftalmología',
    idNumber: 'CMP #4492',
    hospital: patient.facility,
  };

  return (
    <section className="bg-white rounded-xl border border-[#071524]/10 p-4 sm:p-6 md:p-7 shadow-xs">
      <div className="flex flex-col xl:flex-row gap-4 sm:gap-6 justify-between items-start xl:items-center pb-5 sm:pb-6 border-b border-[#071524]/10">
        {/* Left: Identity & Badges */}
        <div className="flex items-start gap-3.5 sm:gap-4">
          <div className="w-14 h-14 sm:w-16 sm:h-16 md:w-20 md:h-20 rounded-xl bg-[#E6F6FF] text-[#071524] flex items-center justify-center font-bold text-xl sm:text-2xl md:text-3xl shrink-0 border border-[#071524]/15 shadow-xs">
            {patient.initials}
          </div>

          <div className="flex flex-col">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-[#071524] tracking-tight">
                {patient.name}
              </h1>
              <span className="px-2.5 py-0.5 rounded-md text-xs font-bold uppercase bg-[#DBF1FE] text-[#071524] border border-[#071524]/15">
                HC {patient.medicalRecordNumber}
              </span>
              <span className="px-2.5 py-0.5 rounded-md text-xs font-semibold bg-[#DBF1FE] text-[#44474C]">
                DNI: {patient.nationalId}
              </span>
              <span className="px-2.5 py-0.5 rounded-md text-xs font-semibold bg-[#DBF1FE] text-[#44474C]">
                {patient.age} años ({patient.gender})
              </span>
            </div>

            {/* Primary Diagnosis */}
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-md bg-[#FFDAD6] text-[#93000A] text-xs font-bold border border-[#BA1A1A]/20">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {patient.primaryDiagnosisTitle || `${patient.hemifieldDetail} post-ACV`}
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#D5ECF8] text-[#071E27] text-xs font-semibold border border-[#071524]/10">
                <Eye className="w-3.5 h-3.5 text-[#006A62] shrink-0" />
                {patient.primaryDiagnosisDetail || `Defecto campimétrico hemicampo ${patient.affectedHemifield === 'LEFT' ? 'izquierdo' : 'derecho'}`}
              </span>
            </div>
          </div>
        </div>

        {/* Right: Treating Clinician Details */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-2 sm:gap-2.5 text-xs text-[#44474C] border-t xl:border-t-0 pt-4 xl:pt-0 w-full xl:w-auto">
          <div className="flex items-center gap-2">
            <Stethoscope className="w-4 h-4 text-[#006A62] shrink-0" />
            <div>
              <strong className="text-[#071524] font-semibold">Doctor tratante:</strong>{' '}
              {doctor.name} ({doctor.specialty})
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-[#006A62] shrink-0" />
            <div>
              <strong className="text-[#071524] font-semibold">Hospital Afiliado:</strong>{' '}
              {patient.facility}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[#006A62] shrink-0" />
            <div>
              <strong className="text-[#071524] font-semibold">Enrolamiento:</strong>{' '}
              {patient.enrollmentDate || 'Hace 6 semanas'}
            </div>
          </div>
        </div>
      </div>

      {/* Quick Clinical Stats Chips */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mt-5 sm:mt-6">
        <div className="bg-[#E6F6FF] p-4 rounded-xl border border-[#071524]/10 flex flex-col justify-between">
          <span className="text-xs text-[#44474C] font-semibold uppercase tracking-wider">
            Adherencia Global
          </span>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-[#071524]">
              {stats.globalAdherence}%
            </span>
            <span className="inline-flex items-center text-xs font-bold text-[#006A62]">
              <TrendingUp className="w-3.5 h-3.5 mr-0.5" /> Óptima
            </span>
          </div>
        </div>

        <div className="bg-[#E6F6FF] p-4 rounded-xl border border-[#071524]/10 flex flex-col justify-between">
          <span className="text-xs text-[#44474C] font-semibold uppercase tracking-wider">
            Sesiones Realizadas
          </span>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-[#071524]">
              {stats.completedSessions}{' '}
              <span className="text-sm font-normal text-[#44474C]">/ {stats.scheduledSessions}</span>
            </span>
            <span className="text-xs font-semibold text-[#44474C]">
              {Math.round((stats.completedSessions / Math.max(1, stats.scheduledSessions)) * 100)}% meta
            </span>
          </div>
        </div>

        <div className="bg-[#E6F6FF] p-4 rounded-xl border border-[#071524]/10 flex flex-col justify-between">
          <span className="text-xs text-[#44474C] font-semibold uppercase tracking-wider">
            Fatiga Ocular Media
          </span>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-[#071524]">
              {stats.meanFatigue}{' '}
              <span className="text-sm font-normal text-[#44474C]">/ 5.0</span>
            </span>
            <span className="inline-flex items-center text-xs font-semibold text-[#006A62]">
              Bajo impacto
            </span>
          </div>
        </div>

        <div className="bg-[#E6F6FF] p-4 rounded-xl border border-[#071524]/10 flex flex-col justify-between">
          <span className="text-xs text-[#44474C] font-semibold uppercase tracking-wider">
            Tiempo Total Terapia
          </span>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-[#071524]">
              {stats.totalTherapyHours}{' '}
              <span className="text-sm font-normal text-[#44474C]">horas</span>
            </span>
            <span className="text-xs font-semibold text-[#44474C]">Acumuladas</span>
          </div>
        </div>
      </div>
    </section>
  );
};
