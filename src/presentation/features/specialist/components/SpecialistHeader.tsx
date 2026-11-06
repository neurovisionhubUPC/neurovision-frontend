import React, { useState } from 'react';
import { 
  Eye, 
  Bell, 
  HelpCircle, 
  Settings, 
  LogOut, 
  Menu,
  X
} from 'lucide-react';
import { useAppStore } from '../../../../core/store/useAppStore';

interface SpecialistHeaderProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onOpenNotifications?: () => void;
}

export const SpecialistHeader: React.FC<SpecialistHeaderProps> = ({
  activeTab,
  onTabChange,
  onOpenNotifications,
}) => {
  const { logout } = useAppStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navTabs = [
    { id: 'pacientes', label: 'Pacientes y Casos' },
    { id: 'protocolos', label: 'Protocolos Sacádicos' },
    { id: 'telemetria', label: 'Telemetría Ocular' },
    { id: 'interconsultas', label: 'Interconsultas FHIR' },
  ];

  return (
    <header className="bg-white border-b border-[#071524]/10 sticky top-0 z-40 shadow-xs">
      <div className="max-w-[1440px] mx-auto flex justify-between items-center w-full px-4 lg:px-6 xl:px-8 h-16 gap-3">
        {/* Brand & Hospital Unit Context */}
        <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[#1C2A39] flex items-center justify-center text-[#26A69A] shadow-xs shrink-0">
            <Eye className="w-5 h-5 stroke-[2.5]" />
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="text-base sm:text-lg xl:text-xl font-bold text-[#071524] tracking-tight whitespace-nowrap">
                NeuroVisión Rehab
              </span>
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] xl:text-xs font-semibold bg-[#D5ECF8] text-[#006A62] border border-[#006A62]/20 whitespace-nowrap">
                PRO v4.8-FHIR
              </span>
            </div>
            <p className="text-[11px] text-[#44474C] font-medium leading-tight truncate hidden lg:block max-w-[280px] xl:max-w-none">
              <span className="hidden 2xl:inline">Portal Facultativo · Unidad de Rehabilitación Visual y Campimetría</span>
              <span className="2xl:hidden">Portal Facultativo · Neuro-Oftalmología</span>
            </p>
          </div>
        </div>

        {/* Center Clinical Navigation Tabs (Laptop & Desktop) */}
        <nav className="hidden lg:flex items-center gap-1 xl:gap-3 2xl:gap-6 h-full text-xs xl:text-sm font-semibold shrink min-w-0">
          {navTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`h-full flex items-center px-2 xl:px-2.5 pt-1 whitespace-nowrap transition-all relative cursor-pointer ${
                  isActive
                    ? 'text-[#071524] font-bold border-b-4 border-[#006A62]'
                    : 'text-[#44474C] hover:text-[#071524]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Trailing Action Icons & Doctor Pill Profile */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 xl:gap-3 shrink-0">
          {/* Live Interop Status indicator */}
          <div className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#DBF1FE] border border-[#C4C6CC]/30 text-[11px] xl:text-xs">
            <span className="w-2 h-2 rounded-full bg-[#006A62] animate-pulse shrink-0"></span>
            <span className="font-semibold text-[#071E27] whitespace-nowrap">
              <span className="hidden 2xl:inline">HL7/FHIR Rebagliati Sincronizado</span>
              <span className="2xl:hidden">HL7/FHIR Activo</span>
            </span>
          </div>

          {/* Clinical Alert Bell with Badge */}
          <button
            onClick={onOpenNotifications}
            className="relative p-2 rounded-lg hover:bg-[#F3FAFF] text-[#071524] transition-colors focus:outline-none cursor-pointer"
            title="Alertas de pacientes"
          >
            <Bell className="w-4 h-4 sm:w-5 sm:h-5 text-[#44474C]" />
            <span className="absolute top-1 right-1 w-3.5 h-3.5 bg-[#BA1A1A] text-white text-[9px] font-bold rounded-full flex items-center justify-center">
              2
            </span>
          </button>

          {/* Help Action */}
          <button
            onClick={() => alert('Abriendo Guía Clínica de Rehabilitación Campimétrica...')}
            className="p-2 rounded-lg hover:bg-[#F3FAFF] text-[#44474C] hover:text-[#071524] transition-colors cursor-pointer hidden sm:flex"
            title="Soporte y Guías Clínicas"
          >
            <HelpCircle className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>

          {/* Settings Action */}
          <button
            onClick={() => alert('Configuración del servicio clínico')}
            className="p-2 rounded-lg hover:bg-[#F3FAFF] text-[#44474C] hover:text-[#071524] transition-colors cursor-pointer hidden sm:flex"
            title="Configuración de guardia"
          >
            <Settings className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>

          {/* Doctor Profile Pill */}
          <div className="flex items-center gap-2 sm:gap-2.5 pl-1.5 sm:pl-2.5 border-l border-[#C4C6CC]/40 shrink-0">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-[#1C2A39] text-[#84F5E8] flex items-center justify-center font-bold text-xs border border-[#006A62]/30 shrink-0">
              ER
            </div>
            <div className="hidden lg:block text-left text-xs leading-tight whitespace-nowrap">
              <div className="font-bold text-[#071E27]">
                <span className="hidden 2xl:inline">Dra. Elena Ramos Morales, M.D.</span>
                <span className="2xl:hidden">Dra. Elena Ramos M.</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-[#44474C]">
                <span>Neuroftalmología</span>
                <span className="w-1.5 h-1.5 rounded-full bg-[#006A62]"></span>
                <span className="text-[#006A62] font-semibold">En Turno</span>
              </div>
            </div>

            <button
              onClick={() => logout()}
              title="Cerrar sesión"
              className="p-1.5 sm:p-2 rounded-lg text-[#BA1A1A] hover:bg-[#FFDAD6]/50 transition-colors ml-0.5 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>

          {/* Mobile Menu Toggle Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 rounded-lg lg:hidden text-[#071524] hover:bg-[#F3FAFF] transition-colors cursor-pointer"
            aria-label="Abrir menú"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Navigation (Visible on screen < lg) */}
      {mobileMenuOpen && (
        <div className="lg:hidden bg-white border-t border-[#071524]/10 px-4 py-3 flex flex-col gap-2 shadow-md animate-in slide-in-from-top-2 duration-150">
          {navTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  onTabChange(tab.id);
                  setMobileMenuOpen(false);
                }}
                className={`py-2 px-3 text-left rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-[#DBF1FE] text-[#006A62] font-bold'
                    : 'text-[#44474C] hover:bg-[#F3FAFF] text-[#071524]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}
    </header>
  );
};
