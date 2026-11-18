import React from 'react';
import { 
  Users, 
  TrendingUp, 
  CheckCircle2, 
  AlertTriangle, 
  ArrowRight, 
  Award,
  CircleDot
} from 'lucide-react';

interface SpecialistStatCardsProps {
  totalPatients: number;
  activePatientsCount: number;
  completedTodayCount: number;
  scheduledTodayCount: number;
  criticalAlertsCount: number;
  globalAdherenceRate: number;
  onFilterCriticalAlerts: () => void;
  isCriticalFilterActive?: boolean;
}

export const SpecialistStatCards: React.FC<SpecialistStatCardsProps> = ({
  activePatientsCount = 24,
  completedTodayCount = 18,
  scheduledTodayCount = 22,
  criticalAlertsCount = 2,
  globalAdherenceRate = 94.2,
  onFilterCriticalAlerts,
  isCriticalFilterActive = false,
}) => {
  const completionPercentage = Math.round((completedTodayCount / Math.max(1, scheduledTodayCount)) * 100);

  return (
    <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      {/* Card 1: Pacientes Activos */}
      <div className="bg-white p-5 rounded-xl border border-[#071524]/10 shadow-xs flex flex-col justify-between transition-all hover:shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-[#44474C] uppercase tracking-wider">
            Pacientes Activos
          </span>
          <div className="p-2 rounded-lg bg-[#DBF1FE] text-[#071524]">
            <Users className="w-5 h-5 text-[#006A62]" />
          </div>
        </div>

        <div className="mt-3 flex items-baseline gap-3">
          <span className="text-4xl font-bold text-[#071524] tracking-tight">
            {activePatientsCount}
          </span>
          <span className="inline-flex items-center gap-1 text-xs font-bold text-[#006A62] bg-[#E6F6FF] px-2 py-0.5 rounded-md">
            <TrendingUp className="w-3.5 h-3.5" />
            +3 este mes
          </span>
        </div>

        <div className="mt-4 pt-3 border-t border-[#071524]/5 flex items-center justify-between text-xs text-[#44474C]">
          <span>Tasa de actividad clínica</span>
          <span className="font-bold text-[#071524]">91.6%</span>
        </div>
      </div>

      {/* Card 2: Sesiones Completadas Hoy */}
      <div className="bg-white p-5 rounded-xl border border-[#071524]/10 shadow-xs flex flex-col justify-between transition-all hover:shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-[#44474C] uppercase tracking-wider">
            Sesiones Completadas Hoy
          </span>
          <div className="p-2 rounded-lg bg-[#DBF1FE] text-[#006A62]">
            <CheckCircle2 className="w-5 h-5 text-[#006A62]" />
          </div>
        </div>

        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-4xl font-bold text-[#071524] tracking-tight">
            {completedTodayCount}
          </span>
          <span className="text-sm text-[#44474C] font-semibold">
            / {scheduledTodayCount} programadas
          </span>
        </div>

        <div className="mt-4 pt-3 border-t border-[#071524]/5">
          <div className="w-full bg-[#E6F6FF] h-2 rounded-full overflow-hidden">
            <div 
              className="bg-[#006A62] h-full rounded-full transition-all duration-500" 
              style={{ width: `${completionPercentage}%` }}
            />
          </div>
          <div className="mt-1.5 flex justify-between text-xs text-[#44474C]">
            <span>{completionPercentage}% cumplido</span>
            <span>Tiempo medio: <strong className="text-[#071524]">14.2 min</strong></span>
          </div>
        </div>
      </div>

      {/* Card 3: Alertas de Adherencia (Warning Card) */}
      <div className={`p-5 rounded-xl border-2 shadow-xs flex flex-col justify-between relative overflow-hidden transition-all hover:shadow-sm ${
        isCriticalFilterActive 
          ? 'bg-[#FFDAD6]/30 border-[#BA1A1A] ring-2 ring-[#BA1A1A]/30' 
          : 'bg-white border-[#BA1A1A]/30'
      }`}>
        <div className="absolute top-0 right-0 w-16 h-16 bg-[#FFDAD6]/40 rounded-bl-full pointer-events-none" />
        
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-[#BA1A1A] uppercase tracking-wider flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-[#BA1A1A]" />
            Alertas de Adherencia
          </span>
          <span className={`px-2 py-0.5 rounded text-xs font-bold ${
            isCriticalFilterActive ? 'bg-[#93000A] text-white' : 'bg-[#BA1A1A] text-white'
          }`}>
            {isCriticalFilterActive ? 'Filtrando' : 'Atención'}
          </span>
        </div>

        <div className="mt-3 flex items-baseline gap-3">
          <span className="text-4xl font-bold text-[#BA1A1A] tracking-tight">
            {criticalAlertsCount}
          </span>
          <span className="text-xs font-medium text-[#44474C]">
            {criticalAlertsCount === 1 ? '1 paciente con alerta o eval. pendiente' : `${criticalAlertsCount} pacientes con alerta o eval. pendiente`}
          </span>
        </div>

        <div className="mt-4 pt-3 border-t border-[#BA1A1A]/20 flex items-center justify-between">
          <button 
            type="button"
            onClick={onFilterCriticalAlerts}
            className="text-xs font-bold text-[#BA1A1A] hover:underline flex items-center gap-1 cursor-pointer transition-colors"
          >
            {isCriticalFilterActive ? 'Quitar Filtro de Alertas' : 'Revisar Alertas Críticas'}
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <span className="text-[11px] font-semibold text-[#74777C]">
            {isCriticalFilterActive ? 'Filtro activo' : 'Acción requerida'}
          </span>
        </div>
      </div>

      {/* Card 4: Tasa Global y Protocolo */}
      <div className="bg-white p-5 rounded-xl border border-[#071524]/10 shadow-xs flex flex-col justify-between transition-all hover:shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-[#44474C] uppercase tracking-wider">
            Tasa Global de Adherencia
          </span>
          <div className="p-2 rounded-lg bg-[#DBF1FE] text-[#071524]">
            <Award className="w-5 h-5 text-[#006A62]" />
          </div>
        </div>

        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-4xl font-bold text-[#006A62] tracking-tight">
            {globalAdherenceRate}%
          </span>
          <span className="text-xs font-bold text-[#006A62] bg-[#DBF1FE] px-2 py-0.5 rounded-md">
            {globalAdherenceRate >= 80 ? 'Óptimo' : globalAdherenceRate >= 60 ? 'Regular' : 'En Observación'}
          </span>
        </div>

        <div className="mt-4 pt-3 border-t border-[#071524]/5 flex items-center justify-between text-xs text-[#44474C]">
          <span className="flex items-center gap-1.5">
            <CircleDot className="w-2.5 h-2.5 text-[#006A62]" />
            FHIR Resource: Specimen-Eye
          </span>
          <span className="font-semibold text-[#071524]">Norma ISO 13485</span>
        </div>
      </div>
    </section>
  );
};
