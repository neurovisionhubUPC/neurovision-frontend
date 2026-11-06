import React from 'react';
import { Eye, Activity, ShieldAlert, Award } from 'lucide-react';
import type { Patient } from '../../../../core/domain/Patient';

interface CampimetryTabProps {
  patient: Patient;
}

export const CampimetryTab: React.FC<CampimetryTabProps> = ({ patient }) => {
  const isLeft = patient.affectedHemifield === 'LEFT';
  const campimetry = patient.campimetryData || {
    leftEyeDefect: 'HOMONYMOUS_LEFT',
    rightEyeDefect: 'HOMONYMOUS_LEFT',
    fixationStabilityBCEA: 0.82,
    saccadicGain: 0.94,
    fovealSearchLatencyMs: 225,
  };

  return (
    <div className="space-y-6">
      {/* Campimetría Esquemática Bilateral */}
      <div className="bg-white p-6 rounded-xl border border-[#071524]/10 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[#071524]/10">
          <div>
            <h3 className="font-bold text-base text-[#071524] flex items-center gap-2">
              <Eye className="w-5 h-5 text-[#006A62]" />
              Campimetría Computarizada Estimada (Goldmann / Humphrey)
            </h3>
            <p className="text-xs text-[#44474C]">
              Representación visual del campo visual de 60° con zona de anopsia sombreada
            </p>
          </div>

          <span className="px-3 py-1 rounded-full text-xs font-bold bg-[#FFDAD6] text-[#93000A] border border-[#BA1A1A]/20">
            Escotoma Homónimo {isLeft ? 'Izquierdo' : 'Derecho'}
          </span>
        </div>

        {/* Círculos Campimétricos */}
        <div className="flex flex-col md:flex-row items-center justify-center gap-12 py-6">
          {/* Ojo Izquierdo */}
          <div className="flex flex-col items-center">
            <div className="w-48 h-48 rounded-full border-4 border-[#071524] relative overflow-hidden shadow-md flex">
              {/* Líneas de mira central */}
              <div className="absolute inset-x-0 top-1/2 h-0.5 bg-[#C4C6CC]/40 pointer-events-none" />
              <div className="absolute inset-y-0 left-1/2 w-0.5 bg-[#C4C6CC]/40 pointer-events-none" />
              <div className="absolute w-2 h-2 rounded-full bg-[#BA1A1A] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10" />

              {/* Hemicampo Izquierdo */}
              <div
                className={`w-1/2 h-full flex flex-col items-center justify-center text-xs font-bold transition-all ${
                  isLeft
                    ? 'bg-[#071524] text-white/80'
                    : 'bg-[#E6F6FF] text-[#006A62]'
                }`}
              >
                {isLeft ? (
                  <>
                    <span className="text-red-400">ESCOTOMA</span>
                    <span className="text-[10px] text-white/60">Anopsia Absoluta</span>
                  </>
                ) : (
                  <span>Normovisual</span>
                )}
              </div>

              {/* Hemicampo Derecho */}
              <div
                className={`w-1/2 h-full flex flex-col items-center justify-center text-xs font-bold transition-all ${
                  !isLeft
                    ? 'bg-[#071524] text-white/80'
                    : 'bg-[#E6F6FF] text-[#006A62]'
                }`}
              >
                {!isLeft ? (
                  <>
                    <span className="text-red-400">ESCOTOMA</span>
                    <span className="text-[10px] text-white/60">Anopsia Absoluta</span>
                  </>
                ) : (
                  <span>Normovisual</span>
                )}
              </div>
            </div>
            <span className="font-bold text-sm text-[#071524] mt-3">Ojo Izquierdo (OS)</span>
            <span className="text-xs text-[#44474C]">Fóvea preservada 2.1°</span>
          </div>

          {/* Ojo Derecho */}
          <div className="flex flex-col items-center">
            <div className="w-48 h-48 rounded-full border-4 border-[#071524] relative overflow-hidden shadow-md flex">
              {/* Líneas de mira central */}
              <div className="absolute inset-x-0 top-1/2 h-0.5 bg-[#C4C6CC]/40 pointer-events-none" />
              <div className="absolute inset-y-0 left-1/2 w-0.5 bg-[#C4C6CC]/40 pointer-events-none" />
              <div className="absolute w-2 h-2 rounded-full bg-[#BA1A1A] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10" />

              {/* Hemicampo Izquierdo */}
              <div
                className={`w-1/2 h-full flex flex-col items-center justify-center text-xs font-bold transition-all ${
                  isLeft
                    ? 'bg-[#071524] text-white/80'
                    : 'bg-[#E6F6FF] text-[#006A62]'
                }`}
              >
                {isLeft ? (
                  <>
                    <span className="text-red-400">ESCOTOMA</span>
                    <span className="text-[10px] text-white/60">Anopsia Absoluta</span>
                  </>
                ) : (
                  <span>Normovisual</span>
                )}
              </div>

              {/* Hemicampo Derecho */}
              <div
                className={`w-1/2 h-full flex flex-col items-center justify-center text-xs font-bold transition-all ${
                  !isLeft
                    ? 'bg-[#071524] text-white/80'
                    : 'bg-[#E6F6FF] text-[#006A62]'
                }`}
              >
                {!isLeft ? (
                  <>
                    <span className="text-red-400">ESCOTOMA</span>
                    <span className="text-[10px] text-white/60">Anopsia Absoluta</span>
                  </>
                ) : (
                  <span>Normovisual</span>
                )}
              </div>
            </div>
            <span className="font-bold text-sm text-[#071524] mt-3">Ojo Derecho (OD)</span>
            <span className="text-xs text-[#44474C]">Fóvea preservada 2.3°</span>
          </div>
        </div>

        <div className="p-3 bg-[#F3FAFF] rounded-lg border border-[#071524]/10 text-center text-xs text-[#44474C]">
          El sombreado oscuro indica el déficit campimétrico homónimo retroquiasmático ocasionado por el ACV.
        </div>
      </div>

      {/* Métricas Oculomotoras Fisiológicas */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-xl border border-[#071524]/10 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#44474C] font-semibold uppercase">Estabilidad BCEA</span>
            <Activity className="w-4 h-4 text-[#006A62]" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-[#071524]">{campimetry.fixationStabilityBCEA}</span>
            <span className="text-xs text-[#44474C]">deg² (68%)</span>
          </div>
          <p className="text-xs text-[#006A62] font-semibold mt-1">Fijación Foveal Estable</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-[#071524]/10 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#44474C] font-semibold uppercase">Ganancia Sacádica</span>
            <Award className="w-4 h-4 text-[#006A62]" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-[#071524]">{campimetry.saccadicGain}</span>
            <span className="text-xs text-[#44474C]">/ 1.0</span>
          </div>
          <p className="text-xs text-[#006A62] font-semibold mt-1">Precisión de Salto Óptima</p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-[#071524]/10 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#44474C] font-semibold uppercase">Latencia de Búsqueda</span>
            <ShieldAlert className="w-4 h-4 text-[#006A62]" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-[#071524]">{campimetry.fovealSearchLatencyMs}</span>
            <span className="text-xs text-[#44474C]">ms</span>
          </div>
          <p className="text-xs text-[#006A62] font-semibold mt-1">Percentil 88 Clínico</p>
        </div>
      </div>
    </div>
  );
};
