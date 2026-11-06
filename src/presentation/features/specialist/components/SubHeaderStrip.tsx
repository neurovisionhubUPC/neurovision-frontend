import React from 'react';
import { Home, ChevronRight, ShieldCheck, RefreshCw } from 'lucide-react';

export const SubHeaderStrip: React.FC = () => {
  return (
    <div className="bg-white border-b border-[#071524]/5">
      <div className="max-w-[1440px] mx-auto px-4 lg:px-6 xl:px-8 py-2 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 text-xs text-[#44474C]">
        {/* Breadcrumb Strip */}
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
          <Home className="w-3.5 h-3.5 text-[#74777C] shrink-0" />
          <span className="hidden md:inline whitespace-nowrap">Portal Clínico</span>
          <ChevronRight className="w-3 h-3 text-[#74777C] hidden md:inline shrink-0" />
          <span className="font-semibold text-[#071524] truncate">Panel de Control de Pacientes</span>
          <ChevronRight className="w-3 h-3 text-[#74777C] shrink-0" />
          <span className="text-[#006A62] font-semibold truncate hidden sm:inline">Servicio de Neuro-Oftalmología</span>
        </div>

        {/* Sync & Compliance Status */}
        <div className="flex items-center gap-3 sm:gap-4 shrink-0 text-[11px] sm:text-xs">
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <RefreshCw className="w-3 h-3 text-[#006A62] shrink-0" />
            <span>Última sincr.: <strong className="text-[#071524]">Hace 3 min</strong></span>
          </span>
          <span className="text-[#C4C6CC] hidden sm:inline">|</span>
          <span className="hidden sm:flex items-center gap-1 text-[#006A62] font-semibold whitespace-nowrap">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            <span>HIPAA / Ley 29733</span>
          </span>
        </div>
      </div>
    </div>
  );
};
