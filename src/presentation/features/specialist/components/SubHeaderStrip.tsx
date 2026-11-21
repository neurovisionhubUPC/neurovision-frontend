import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Home,
  ChevronRight,
  ShieldCheck,
  RefreshCw,
  X,
  Lock,
  FileCheck,
} from 'lucide-react';

export interface SubHeaderBreadcrumbItem {
  label: string;
  to?: string;
}

export interface SubHeaderStripProps {
  lastSyncedAt?: string | null;
  onRefreshSync?: () => void;
  isRefreshing?: boolean;
  breadcrumbs?: SubHeaderBreadcrumbItem[];
}

function formatSyncTimestamp(syncTime?: string | null): string {
  if (syncTime) {
    // If it's an ISO timestamp or date
    if (syncTime.includes('T') || syncTime.includes('-')) {
      try {
        const d = new Date(syncTime);
        if (!isNaN(d.getTime())) {
          return d.toLocaleTimeString('es-PE', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          });
        }
      } catch {
        return syncTime;
      }
    }
    return syncTime;
  }
  // Default to current local time
  return new Date().toLocaleTimeString('es-PE', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

const DEFAULT_BREADCRUMBS: SubHeaderBreadcrumbItem[] = [
  { label: 'Portal Clínico', to: '/specialist/dashboard' },
  { label: 'Panel de Control de Pacientes', to: '/specialist/dashboard' },
  { label: 'Servicio de Neuro-Oftalmología' },
];

export const SubHeaderStrip: React.FC<SubHeaderStripProps> = ({
  lastSyncedAt,
  onRefreshSync,
  isRefreshing = false,
  breadcrumbs = DEFAULT_BREADCRUMBS,
}) => {
  const navigate = useNavigate();
  const [complianceModalOpen, setComplianceModalOpen] = useState(false);
  const [internalRefreshing, setInternalRefreshing] = useState(false);

  const formattedTime = useMemo(
    () => formatSyncTimestamp(lastSyncedAt),
    [lastSyncedAt]
  );

  const handleRefreshClick = () => {
    if (onRefreshSync) {
      onRefreshSync();
    } else {
      setInternalRefreshing(true);
      setTimeout(() => setInternalRefreshing(false), 800);
    }
  };

  const isSpinning = isRefreshing || internalRefreshing;

  return (
    <>
      <div className="bg-white border-b border-[#071524]/5">
        <div className="max-w-[1536px] mx-auto px-4 lg:px-6 xl:px-8 py-2 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 text-xs text-[#44474C]">
          {/* Breadcrumb Navigation Strip */}
          <nav aria-label="Ruta de navegación" className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-wrap">
            <button
              type="button"
              onClick={() => navigate('/specialist/dashboard')}
              className="p-1 rounded hover:bg-[#F3FAFF] text-[#74777C] hover:text-[#071524] transition-colors cursor-pointer shrink-0"
              title="Inicio Facultativo"
            >
              <Home className="w-3.5 h-3.5" />
            </button>

            {breadcrumbs.map((item, index) => {
              const isLast = index === breadcrumbs.length - 1;
              return (
                <React.Fragment key={`${item.label}-${index}`}>
                  <ChevronRight className="w-3 h-3 text-[#74777C] shrink-0" />
                  {item.to && !isLast ? (
                    <button
                      type="button"
                      onClick={() => navigate(item.to!)}
                      className="hover:text-[#006A62] hover:underline font-medium transition-colors truncate cursor-pointer"
                    >
                      {item.label}
                    </button>
                  ) : (
                    <span
                      className={`truncate ${
                        isLast
                          ? 'font-bold text-[#071524]'
                          : 'font-medium text-[#44474C]'
                      }`}
                    >
                      {item.label}
                    </span>
                  )}
                </React.Fragment>
              );
            })}
          </nav>

          {/* Sync & Interactive Compliance Status */}
          <div className="flex items-center gap-3 sm:gap-4 shrink-0 text-[11px] sm:text-xs">
            {/* Refresh / Sync Action Button */}
            <button
              type="button"
              onClick={handleRefreshClick}
              disabled={isSpinning}
              className="flex items-center gap-1.5 hover:text-[#071524] p-1 rounded hover:bg-[#F3FAFF] transition-colors cursor-pointer disabled:opacity-75"
              title="Actualizar sincronización de telemetría y pacientes"
            >
              <RefreshCw
                className={`w-3 h-3 text-[#006A62] shrink-0 ${
                  isSpinning ? 'animate-spin' : ''
                }`}
              />
              <span className="whitespace-nowrap">
                Última sincr.:{' '}
                <strong className="text-[#071524] font-semibold">
                  {formattedTime}
                </strong>
              </span>
            </button>

            <span className="text-[#C4C6CC] hidden sm:inline">|</span>

            {/* Interactive HIPAA / Ley 29733 Compliance Button */}
            <button
              type="button"
              onClick={() => setComplianceModalOpen(true)}
              className="hidden sm:inline-flex items-center gap-1 text-[#006A62] hover:text-[#005049] font-semibold whitespace-nowrap px-2 py-0.5 rounded hover:bg-[#DBF1FE]/50 transition-colors cursor-pointer border border-transparent hover:border-[#006A62]/20"
              title="Ver especificaciones de cumplimiento normativo y privacidad de datos"
            >
              <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-[#006A62]" />
              <span>HIPAA / Ley 29733</span>
            </button>
          </div>
        </div>
      </div>

      {/* Compliance / Privacy Policy Modal */}
      {complianceModalOpen && (
        <div className="fixed inset-0 z-50 bg-[#071524]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-[#071524]/10 overflow-hidden">
            <div className="bg-[#1C2A39] text-white p-4 px-6 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="w-5 h-5 text-[#84F5E8]" />
                <h3 className="font-bold text-sm">
                  Marco Normativo de Seguridad y Privacidad Clínica
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setComplianceModalOpen(false)}
                className="p-1 rounded-lg text-white/70 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-3.5 text-xs text-[#071E27]">
              <div className="p-3.5 rounded-xl bg-[#F3FAFF] border border-[#071524]/10 space-y-1">
                <div className="flex items-center gap-2 font-bold text-[#071524]">
                  <Lock className="w-4 h-4 text-[#006A62]" />
                  <span>Ley N° 29733 — Protección de Datos Personales (Perú)</span>
                </div>
                <p className="text-[11px] text-[#44474C] leading-relaxed">
                  Los registros oculomotores, datos biométricos de mirada y expedientes clínicos son clasificados como <strong>datos sensibles de salud</strong>. El almacenamiento en reposo cuenta con cifrado AES-256 y la transmisión utiliza canales TLS 1.3 certificados bajo lineamientos del MINSA.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-[#F3FAFF] border border-[#071524]/10 space-y-1">
                <div className="flex items-center gap-2 font-bold text-[#071524]">
                  <ShieldCheck className="w-4 h-4 text-[#006A62]" />
                  <span>HIPAA Security & Privacy Rule (ePHI)</span>
                </div>
                <p className="text-[11px] text-[#44474C] leading-relaxed">
                  Control estricto de acceso basado en roles (RBAC) mediante identidades federadas en AWS Cognito (DOCTOR / ADMIN / PATIENT). Cada consulta de telemetría y prescripción terapéutica genera pistas de auditoría inmutables.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-[#F3FAFF] border border-[#071524]/10 space-y-1">
                <div className="flex items-center gap-2 font-bold text-[#071524]">
                  <FileCheck className="w-4 h-4 text-[#006A62]" />
                  <span>HL7 FHIR v4.0.1 & Dispositivos Médicos ISO 13485</span>
                </div>
                <p className="text-[11px] text-[#44474C] leading-relaxed">
                  Interoperabilidad con sistemas de historia clínica electrónica (HIS/EHR) mediante recursos FHIR estandarizados. Trazabilidad de calibración OLS y ganancia sacádica según buenas prácticas de software médico.
                </p>
              </div>
            </div>

            <div className="px-6 py-3 bg-[#F3FAFF] border-t border-[#071524]/10 flex justify-end">
              <button
                type="button"
                onClick={() => setComplianceModalOpen(false)}
                className="px-4 py-2 rounded-lg bg-[#071524] text-white text-xs font-bold hover:bg-[#1C2A39] transition-colors cursor-pointer"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
