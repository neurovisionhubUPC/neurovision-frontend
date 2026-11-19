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
import { useAppStore } from '../../../../core/store/useAppStore';

export interface TreatingDoctorOverview {
  fullName?: string | null;
  specialty?: string | null;
  cmpNumber?: string | null;
  hospital?: string | null;
}

export interface PatientOverviewCardProps {
  patient: Patient;
  completedSessionsCount?: number;
  scheduledSessionsCount?: number;
  totalTherapyHours?: number;
  adherenceRate?: number;
  treatingDoctor?: TreatingDoctorOverview | null;
}

export const PatientOverviewCard: React.FC<PatientOverviewCardProps> = ({
  patient,
  completedSessionsCount,
  scheduledSessionsCount,
  totalTherapyHours,
  adherenceRate,
  treatingDoctor,
}) => {
  const authMode = useAppStore((state) => state.authMode);
  const accessToken = useAppStore((state) => state.accessToken);
  const isCognitoMode = authMode === 'COGNITO' && Boolean(accessToken);

  const stats = patient.stats || {
    globalAdherence: patient.adherence.rate,
    completedSessions: isCognitoMode ? 0 : 28,
    scheduledSessions: isCognitoMode ? 0 : 30,
    meanFatigue: isCognitoMode ? 0 : 1.8,
    totalTherapyHours: isCognitoMode ? 0 : 5.6,
    validatedSessions: isCognitoMode ? 0 : 27,
    totalRecordedSessions: isCognitoMode ? 0 : 28,
  };

  const completedSessions = completedSessionsCount ?? stats.completedSessions ?? 0;
  const scheduledSessions = scheduledSessionsCount ?? stats.scheduledSessions ?? 0;
  const therapyHours = totalTherapyHours !== undefined ? totalTherapyHours : (stats.totalTherapyHours ?? 0);
  const globalAdherence = adherenceRate !== undefined ? adherenceRate : (stats.globalAdherence ?? patient.adherence.rate ?? 0);

  const doctorName =
    treatingDoctor?.fullName ||
    (isCognitoMode
      ? 'Médico Especialista Asignado'
      : patient.treatingDoctor?.name || 'Dra. Elena Ramos Morales, M.D.');
  const doctorSpecialty =
    treatingDoctor?.specialty ||
    (isCognitoMode
      ? 'Neurorrehabilitación'
      : patient.treatingDoctor?.specialty || 'Neuroftalmología');
  const doctorCmp =
    treatingDoctor?.cmpNumber ||
    (isCognitoMode ? undefined : patient.treatingDoctor?.idNumber);
  const doctorHospital =
    treatingDoctor?.hospital ||
    (isCognitoMode
      ? 'NeuroVisión Clinical'
      : patient.treatingDoctor?.hospital || patient.facility || 'NeuroVisión Clinical');

  const metaPercent = scheduledSessions > 0
    ? Math.round((completedSessions / scheduledSessions) * 100)
    : 0;

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
              {!isCognitoMode && (
                <span className="px-2.5 py-0.5 rounded-md text-xs font-semibold bg-[#DBF1FE] text-[#44474C]">
                  DNI: {patient.nationalId}
                </span>
              )}
              {patient.age > 0 ? (
                <span className="px-2.5 py-0.5 rounded-md text-xs font-semibold bg-[#DBF1FE] text-[#44474C]">
                  {patient.age} años ({patient.gender})
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-md text-xs font-semibold bg-[#DBF1FE] text-[#005049]">
                  Estado: {patient.accountStatus === 'PENDING' ? 'Evaluación Pendiente' : 'Activo en Clinical'}
                </span>
              )}
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
              {doctorName} ({doctorSpecialty})
              {doctorCmp && (
                <span className="text-[#74777C] ml-1">· {doctorCmp}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-[#006A62] shrink-0" />
            <div>
              <strong className="text-[#071524] font-semibold">Hospital Afiliado:</strong>{' '}
              {doctorHospital}
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
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs text-[#44474C] font-semibold uppercase tracking-wider">
              {isCognitoMode ? 'Tasa de Finalización' : 'Adherencia Global'}
            </span>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/80 text-[#006A62]">
              {isCognitoMode ? 'Clinical 8083' : 'Demo'}
            </span>
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-[#071524]">
              {isCognitoMode && scheduledSessions === 0 ? 'N/D' : `${globalAdherence}%`}
            </span>
            <span className="inline-flex items-center text-xs font-bold text-[#006A62]">
              <TrendingUp className="w-3.5 h-3.5 mr-0.5" />
              {isCognitoMode && scheduledSessions === 0
                ? 'Sin sesiones'
                : globalAdherence >= 80
                ? 'Óptima'
                : globalAdherence >= 60
                ? 'Aceptable'
                : 'Subóptima'}
            </span>
          </div>
        </div>

        <div className="bg-[#E6F6FF] p-4 rounded-xl border border-[#071524]/10 flex flex-col justify-between">
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs text-[#44474C] font-semibold uppercase tracking-wider">
              {isCognitoMode ? 'Sesiones Completadas' : 'Sesiones Realizadas'}
            </span>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/80 text-[#006A62]">
              {isCognitoMode ? 'Clinical 8083' : 'Demo'}
            </span>
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-[#071524]">
              {completedSessions}{' '}
              <span className="text-sm font-normal text-[#44474C]">/ {scheduledSessions}</span>
            </span>
            <span className="text-xs font-semibold text-[#44474C]">
              {isCognitoMode ? `${metaPercent}% registradas` : `${metaPercent}% meta`}
            </span>
          </div>
        </div>

        <div className="bg-[#E6F6FF] p-4 rounded-xl border border-[#071524]/10 flex flex-col justify-between">
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs text-[#44474C] font-semibold uppercase tracking-wider">
              {isCognitoMode ? 'Estado Clínico' : 'Fatiga Ocular Media'}
            </span>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/80 text-[#006A62]">
              {isCognitoMode ? 'Clinical 8083' : 'Demo'}
            </span>
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            {isCognitoMode ? (
              <>
                <span className="text-lg font-bold text-[#071524]">
                  {patient.accountStatus === 'PENDING' ? 'Pendiente' : 'En Seguimiento'}
                </span>
                <span className="inline-flex items-center text-[11px] font-semibold text-[#44474C]">
                  Fatiga: N/D en API
                </span>
              </>
            ) : (
              <>
                <span className="text-2xl font-bold text-[#071524]">
                  {stats.meanFatigue}{' '}
                  <span className="text-sm font-normal text-[#44474C]">/ 5.0</span>
                </span>
                <span className="inline-flex items-center text-xs font-semibold text-[#006A62]">
                  Bajo impacto
                </span>
              </>
            )}
          </div>
        </div>

        <div className="bg-[#E6F6FF] p-4 rounded-xl border border-[#071524]/10 flex flex-col justify-between">
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs text-[#44474C] font-semibold uppercase tracking-wider">
              Tiempo Activo Terapia
            </span>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/80 text-[#006A62]">
              {isCognitoMode ? 'Clinical 8083' : 'Demo'}
            </span>
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-[#071524]">
              {typeof therapyHours === 'number' ? therapyHours.toFixed(1) : therapyHours}{' '}
              <span className="text-sm font-normal text-[#44474C]">horas</span>
            </span>
            <span className="text-xs font-semibold text-[#44474C]">Acumuladas</span>
          </div>
        </div>
      </div>
    </section>
  );
};
