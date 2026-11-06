import React from 'react';
import { 
  X, 
  Activity, 
  CheckCircle2, 
  Eye
} from 'lucide-react';
import type { SessionRecord } from '../../../../core/domain/Patient';

interface SessionAnalyticsModalProps {
  session: SessionRecord | null;
  isOpen: boolean;
  onClose: () => void;
}

export const SessionAnalyticsModal: React.FC<SessionAnalyticsModalProps> = ({
  session,
  isOpen,
  onClose,
}) => {
  if (!isOpen || !session) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#071524]/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-[#071524]/10 overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-[#1C2A39] text-white p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#26A69A]/20 text-[#84F5E8] flex items-center justify-center border border-[#84F5E8]/30">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-lg text-white">Analítica de Telemetría Ocular</h3>
              <p className="text-xs text-[#84F5E8]/80 font-medium">
                {session.moduleName} · {session.dateText} ({session.timeText})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs text-[#071E27]">
          {/* Key Metric Chips */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 bg-[#E6F6FF] rounded-xl border border-[#071524]/10 text-center">
              <span className="text-[#44474C] font-semibold block text-[11px]">Duración</span>
              <strong className="text-base text-[#071524]">{session.durationMinutes} min</strong>
            </div>

            <div className="p-3 bg-[#E6F6FF] rounded-xl border border-[#071524]/10 text-center">
              <span className="text-[#44474C] font-semibold block text-[11px]">Cumplimiento</span>
              <strong className="text-base text-[#006A62]">{session.complianceRate}%</strong>
            </div>

            <div className="p-3 bg-[#E6F6FF] rounded-xl border border-[#071524]/10 text-center">
              <span className="text-[#44474C] font-semibold block text-[11px]">Precisión Foveal</span>
              <strong className="text-base text-[#071524]">{session.fovealPrecision}%</strong>
            </div>

            <div className="p-3 bg-[#E6F6FF] rounded-xl border border-[#071524]/10 text-center">
              <span className="text-[#44474C] font-semibold block text-[11px]">Validación</span>
              <strong className={`text-xs block mt-1 ${session.isValid ? 'text-[#006A62]' : 'text-[#BA1A1A]'}`}>
                {session.isValid ? 'Óptima' : 'Interrumpida'}
              </strong>
            </div>
          </div>

          {/* Telemetry Visualizer Box */}
          <div className="p-4 rounded-xl bg-[#F3FAFF] border border-[#071524]/10 space-y-3">
            <h4 className="font-bold text-sm text-[#071524] flex items-center gap-2">
              <Eye className="w-4 h-4 text-[#006A62]" />
              Patrones de Fijación y Exploración Sacádica
            </h4>

            <div className="h-44 bg-white rounded-lg border border-[#071524]/10 flex flex-col items-center justify-center p-4 relative overflow-hidden">
              <div className="absolute inset-x-8 top-1/2 h-0.5 bg-[#C4C6CC]/30 pointer-events-none" />
              <div className="absolute inset-y-4 left-1/2 w-0.5 bg-[#C4C6CC]/30 pointer-events-none" />

              {/* Simulación visual de nubes de fijación */}
              <div className="w-16 h-12 rounded-full bg-[#006A62]/20 border border-[#006A62] absolute left-1/3 top-1/3 animate-pulse" />
              <div className="w-24 h-16 rounded-full bg-[#84F5E8]/30 border border-[#84F5E8] absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
              <div className="w-3 h-3 rounded-full bg-[#BA1A1A] absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />

              <span className="text-[11px] font-semibold text-[#071524] z-10 bg-white/90 px-2 py-0.5 rounded shadow-xs mt-auto">
                Dispersión elíptica BCEA: 0.84 deg² · 94% de fijaciones dentro del umbral
              </span>
            </div>
          </div>

          {/* Observations */}
          <div className="p-4 rounded-xl bg-white border border-[#071524]/10 space-y-2">
            <h4 className="font-bold text-xs text-[#071524]">Notas Clínicas de la Sesión</h4>
            <p className="text-xs text-[#44474C] leading-relaxed">
              {session.notes || 'Sesión ejecutada conforme al protocolo médico. Sin pérdida de calibración facial ni movimientos de cabeza descompensatorios.'}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-[#E6F6FF] px-6 py-3 border-t border-[#071524]/10 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-[#006A62] font-semibold">
            <CheckCircle2 className="w-4 h-4" />
            <span>Telemetría verificada por Web Worker</span>
          </div>

          <button
            onClick={onClose}
            className="px-5 py-2 rounded-lg bg-[#071524] text-white font-bold hover:bg-[#1C2A39] transition-colors cursor-pointer text-xs"
          >
            Cerrar Analítica
          </button>
        </div>
      </div>
    </div>
  );
};
