import React from 'react';
import { Search, FilterX } from 'lucide-react';

interface PatientFilterToolbarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  selectedDiagnosis: string;
  onDiagnosisChange: (d: string) => void;
  selectedStatus: string;
  onStatusChange: (s: string) => void;
  selectedFacility: string;
  onFacilityChange: (f: string) => void;
  onResetFilters: () => void;
}

export const PatientFilterToolbar: React.FC<PatientFilterToolbarProps> = ({
  searchQuery,
  onSearchChange,
  selectedDiagnosis,
  onDiagnosisChange,
  selectedStatus,
  onStatusChange,
  selectedFacility,
  onFacilityChange,
  onResetFilters,
}) => {
  return (
    <section className="bg-white p-3 sm:p-4 rounded-xl border border-[#071524]/10 shadow-xs flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3">
      {/* Search Input */}
      <div className="relative flex-1 min-w-[240px]">
        <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#74777C]" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Buscar por nombre de paciente, DNI o N° de historia clínica (HC)..."
          className="w-full pl-10 pr-4 py-2 sm:py-2.5 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/60 text-xs sm:text-sm text-[#071524] placeholder:text-[#74777C] focus:outline-none focus:ring-2 focus:ring-[#006A62] focus:border-[#006A62] transition-all"
        />
      </div>

      {/* Select Filters Cluster */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        {/* Diagnostic Filter */}
        <div className="flex items-center text-xs text-[#44474C] font-medium flex-1 sm:flex-initial">
          <label className="sr-only" htmlFor="filter-diagnostic">
            Diagnóstico Clínico
          </label>
          <select
            id="filter-diagnostic"
            value={selectedDiagnosis}
            onChange={(e) => onDiagnosisChange(e.target.value)}
            className="w-full sm:w-auto bg-[#F3FAFF] border border-[#C4C6CC]/60 rounded-lg px-2.5 sm:px-3 py-2 text-xs font-semibold text-[#071524] focus:outline-none focus:ring-2 focus:ring-[#006A62] cursor-pointer"
          >
            <option value="ALL">Diagnóstico: Todos</option>
            <option value="Hemianopsia Izquierda Homónima">Hemianopsia Izq. Homónima</option>
            <option value="Hemianopsia Derecha Homónima">Hemianopsia Der. Homónima</option>
            <option value="Cuadrantanopsia Homónima Superior">Cuadrantanopsia Sup.</option>
            <option value="Cuadrantanopsia Homónima Inferior">Cuadrantanopsia Inf.</option>
            <option value="Defecto Campimétrico Post-ACV Isquémico">Defecto Campimétrico Post-ACV</option>
          </select>
        </div>

        {/* Account Status Filter */}
        <div className="flex items-center text-xs text-[#44474C] font-medium flex-1 sm:flex-initial">
          <label className="sr-only" htmlFor="filter-status">
            Estado de Cuenta
          </label>
          <select
            id="filter-status"
            value={selectedStatus}
            onChange={(e) => onStatusChange(e.target.value)}
            className="w-full sm:w-auto bg-[#F3FAFF] border border-[#C4C6CC]/60 rounded-lg px-2.5 sm:px-3 py-2 text-xs font-semibold text-[#071524] focus:outline-none focus:ring-2 focus:ring-[#006A62] cursor-pointer"
          >
            <option value="ALL">Estado: Todas</option>
            <option value="ACTIVE">Activa (Verificado)</option>
            <option value="PENDING">Pendiente de Verificación</option>
            <option value="SUSPENDED">Suspensa por Fatiga</option>
          </select>
        </div>

        {/* Facility / Shift Selector */}
        <div className="flex items-center text-xs text-[#44474C] font-medium flex-1 sm:flex-initial">
          <label className="sr-only" htmlFor="filter-site">
            Sede Asistencial
          </label>
          <select
            id="filter-site"
            value={selectedFacility}
            onChange={(e) => onFacilityChange(e.target.value)}
            className="w-full sm:w-auto bg-[#F3FAFF] border border-[#C4C6CC]/60 rounded-lg px-2.5 sm:px-3 py-2 text-xs font-semibold text-[#071524] focus:outline-none focus:ring-2 focus:ring-[#006A62] cursor-pointer"
          >
            <option value="ALL">Sede: Todas</option>
            <option value="Sede Rebagliati">Sede Rebagliati (Mañana)</option>
            <option value="Sede Almenara">Sede Almenara (Tarde)</option>
            <option value="Telemedicina Domiciliaria">Telemedicina Domiciliaria</option>
          </select>
        </div>

        {/* Filter Reset Button */}
        <button
          onClick={onResetFilters}
          className="p-2 rounded-lg border border-[#C4C6CC]/60 hover:bg-[#F3FAFF] text-[#44474C] hover:text-[#071524] transition-colors cursor-pointer shrink-0"
          title="Limpiar Filtros"
        >
          <FilterX className="w-4 h-4" />
        </button>
      </div>
    </section>
  );
};
