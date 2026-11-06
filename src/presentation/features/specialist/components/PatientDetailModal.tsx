import React, { useState } from 'react';
import { 
  X, 
  ArrowLeft, 
  ArrowRight, 
  CheckCircle2, 
  ShieldCheck, 
  Save
} from 'lucide-react';
import type { Patient } from '../../../../core/domain/Patient';
import { useAppStore } from '../../../../core/store/useAppStore';

interface PatientDetailModalProps {
  patient: Patient | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdatePatient: (updated: Patient) => void;
}

export const PatientDetailModal: React.FC<PatientDetailModalProps> = ({
  patient,
  isOpen,
  onClose,
  onUpdatePatient,
}) => {
  const [activeTab, setActiveTab] = useState<'resumen' | 'prescripcion' | 'historial'>('resumen');
  
  // Parámetros de prescripción dinámica
  const [targetSpeed, setTargetSpeed] = useState(1.0);
  const [visualFieldAmplitude, setVisualFieldAmplitude] = useState(0.85);
  const [minFixationTime, setMinFixationTime] = useState(800);
  const [isSaved, setIsSaved] = useState(false);

  if (!isOpen || !patient) return null;

  const handleSavePrescription = () => {
    // Actualizar en el AppStore la prescripción médica activa
    useAppStore.getState().setPrescription({
      prescriptionId: `rx-${Date.now()}`,
      patientId: patient.id,
      gameId: 'saccadic-explorer',
      parameters: {
        target_speed: targetSpeed,
        visual_field_amplitude: visualFieldAmplitude,
        min_fixation_time: minFixationTime,
      },
    });

    onUpdatePatient({
      ...patient,
      clinicalNotes: `${patient.clinicalNotes || ''} [Prescripción actualizada: Vel ${targetSpeed}x, Amp ${Math.round(visualFieldAmplitude * 100)}%, Dwell ${minFixationTime}ms]`,
    });

    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2500);
  };

  const isLeft = patient.affectedHemifield === 'LEFT';

  return (
    <div className="fixed inset-0 z-50 bg-[#071524]/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-3xl w-full shadow-2xl border border-[#071524]/10 overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-200">
        {/* Header con Perfil Clínico */}
        <div className="bg-[#1C2A39] text-white p-5 flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#26A69A] text-white flex items-center justify-center font-bold text-lg shadow-sm">
              {patient.initials}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold tracking-tight">{patient.name}</h2>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-[#84F5E8] text-[#071524]">
                  {isLeft ? <ArrowLeft className="w-3 h-3" /> : <ArrowRight className="w-3 h-3" />}
                  {isLeft ? 'Hemicampo Izquierdo' : 'Hemicampo Derecho'}
                </span>
              </div>
              <p className="text-xs text-white/80 font-mono mt-0.5">
                HC: {patient.medicalRecordNumber} · DNI: {patient.nationalId} · {patient.age} años · {patient.gender}
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

        {/* Sub-tabs de Navegación Interna */}
        <div className="bg-[#E6F6FF] border-b border-[#071524]/10 px-6 flex items-center gap-4 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('resumen')}
            className={`py-3 px-2 border-b-2 transition-all cursor-pointer ${
              activeTab === 'resumen'
                ? 'border-[#006A62] text-[#006A62] font-bold'
                : 'border-transparent text-[#44474C] hover:text-[#071524]'
            }`}
          >
            Resumen Clínico y Campimetría
          </button>
          <button
            onClick={() => setActiveTab('prescripcion')}
            className={`py-3 px-2 border-b-2 transition-all cursor-pointer ${
              activeTab === 'prescripcion'
                ? 'border-[#006A62] text-[#006A62] font-bold'
                : 'border-transparent text-[#44474C] hover:text-[#071524]'
            }`}
          >
            Parámetros de Prescripción Dinámica
          </button>
          <button
            onClick={() => setActiveTab('historial')}
            className={`py-3 px-2 border-b-2 transition-all cursor-pointer ${
              activeTab === 'historial'
                ? 'border-[#006A62] text-[#006A62] font-bold'
                : 'border-transparent text-[#44474C] hover:text-[#071524]'
            }`}
          >
            Historial de Telemetría Ocular
          </button>
        </div>

        {/* Body Tab Content */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs text-[#071E27]">
          {activeTab === 'resumen' && (
            <div className="space-y-4">
              {/* Card de Diagnóstico */}
              <div className="p-4 rounded-xl bg-[#F3FAFF] border border-[#071524]/10">
                <span className="text-[11px] font-bold text-[#44474C] uppercase tracking-wider block mb-1">
                  Diagnóstico Campimétrico Principal
                </span>
                <p className="text-base font-bold text-[#071524]">{patient.hemifieldDetail}</p>
                <p className="text-xs text-[#44474C] mt-1">
                  {patient.clinicalNotes || 'Déficit visual secundario a lesión retroquiasmática. Se indica terapia de rastreo sacádico intensivo.'}
                </p>
              </div>

              {/* Indicadores Clave */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3.5 rounded-xl bg-white border border-[#071524]/10">
                  <span className="text-[#44474C] font-semibold text-[11px] block">Adherencia Global</span>
                  <div className="text-2xl font-bold text-[#006A62] mt-1">
                    {patient.adherence.rate}%
                  </div>
                  <span className="text-[10px] text-[#006A62] font-semibold">
                    Categoría: {patient.adherence.category}
                  </span>
                </div>

                <div className="p-3.5 rounded-xl bg-white border border-[#071524]/10">
                  <span className="text-[#44474C] font-semibold text-[11px] block">Última Sesión</span>
                  <div className="text-sm font-bold text-[#071524] mt-1">
                    {patient.lastSession.timestampText}
                  </div>
                  <span className="text-[10px] text-[#44474C]">
                    {patient.lastSession.moduleName} ({patient.lastSession.durationMinutes} min)
                  </span>
                </div>

                <div className="p-3.5 rounded-xl bg-white border border-[#071524]/10">
                  <span className="text-[#44474C] font-semibold text-[11px] block">Sede Asistencial</span>
                  <div className="text-sm font-bold text-[#071524] mt-1">
                    {patient.facility}
                  </div>
                  <span className="text-[10px] text-[#44474C]">Turno Mañana / Monitoreado</span>
                </div>
              </div>

              {/* Visualizador Esquemático de Hemicampo */}
              <div className="p-4 rounded-xl border border-[#071524]/10 bg-white">
                <span className="font-bold text-[#071524] block mb-2">
                  Esquema de Campimetría Estimada (Ojo Derecho e Izquierdo)
                </span>
                <div className="flex items-center justify-center gap-6 py-2">
                  {/* Campímetro Izquierdo */}
                  <div className="flex flex-col items-center">
                    <div className="w-24 h-24 rounded-full border-2 border-[#071524] overflow-hidden flex shadow-xs">
                      <div
                        className={`w-1/2 h-full flex items-center justify-center text-[10px] font-bold ${
                          isLeft ? 'bg-[#071524] text-white' : 'bg-[#E6F6FF] text-[#006A62]'
                        }`}
                      >
                        {isLeft ? 'Ciego' : 'Sano'}
                      </div>
                      <div
                        className={`w-1/2 h-full flex items-center justify-center text-[10px] font-bold ${
                          !isLeft ? 'bg-[#071524] text-white' : 'bg-[#E6F6FF] text-[#006A62]'
                        }`}
                      >
                        {!isLeft ? 'Ciego' : 'Sano'}
                      </div>
                    </div>
                    <span className="text-[11px] text-[#44474C] mt-1 font-semibold">Ojo Izquierdo</span>
                  </div>

                  {/* Campímetro Derecho */}
                  <div className="flex flex-col items-center">
                    <div className="w-24 h-24 rounded-full border-2 border-[#071524] overflow-hidden flex shadow-xs">
                      <div
                        className={`w-1/2 h-full flex items-center justify-center text-[10px] font-bold ${
                          isLeft ? 'bg-[#071524] text-white' : 'bg-[#E6F6FF] text-[#006A62]'
                        }`}
                      >
                        {isLeft ? 'Ciego' : 'Sano'}
                      </div>
                      <div
                        className={`w-1/2 h-full flex items-center justify-center text-[10px] font-bold ${
                          !isLeft ? 'bg-[#071524] text-white' : 'bg-[#E6F6FF] text-[#006A62]'
                        }`}
                      >
                        {!isLeft ? 'Ciego' : 'Sano'}
                      </div>
                    </div>
                    <span className="text-[11px] text-[#44474C] mt-1 font-semibold">Ojo Derecho</span>
                  </div>
                </div>
                <div className="text-center text-[11px] text-[#74777C] mt-2">
                  Área oscura representa el hemicampo con escotoma absoluto post-ictus.
                </div>
              </div>
            </div>
          )}

          {activeTab === 'prescripcion' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-[#DBF1FE] text-[#006A62] text-xs font-medium">
                Ajuste fino de la dificultad del Serious Game oculomotor dictada por el especialista facultativo.
              </div>

              {/* Slider 1: Velocidad del estímulo */}
              <div className="p-4 rounded-xl bg-[#F3FAFF] border border-[#071524]/10">
                <div className="flex justify-between items-center mb-1">
                  <label className="font-bold text-[#071524]">Velocidad / Dinámica del Estímulo (Target Speed)</label>
                  <span className="font-mono font-bold text-[#006A62] text-sm">{targetSpeed.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="2.5"
                  step="0.1"
                  value={targetSpeed}
                  onChange={(e) => setTargetSpeed(parseFloat(e.target.value))}
                  className="w-full accent-[#006A62]"
                />
                <div className="flex justify-between text-[10px] text-[#74777C] mt-1">
                  <span>0.5x (Lento / Inicial)</span>
                  <span>1.0x (Estándar)</span>
                  <span>2.5x (Desafío Sacádico)</span>
                </div>
              </div>

              {/* Slider 2: Amplitud de Campo Visual */}
              <div className="p-4 rounded-xl bg-[#F3FAFF] border border-[#071524]/10">
                <div className="flex justify-between items-center mb-1">
                  <label className="font-bold text-[#071524]">Amplitud de Campo Visual (Visual Field Amplitude)</label>
                  <span className="font-mono font-bold text-[#006A62] text-sm">{Math.round(visualFieldAmplitude * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.3"
                  max="1.0"
                  step="0.05"
                  value={visualFieldAmplitude}
                  onChange={(e) => setVisualFieldAmplitude(parseFloat(e.target.value))}
                  className="w-full accent-[#006A62]"
                />
                <div className="flex justify-between text-[10px] text-[#74777C] mt-1">
                  <span>30% (Central / Foveal)</span>
                  <span>70% (Parafoveal)</span>
                  <span>100% (Periferia Extrema)</span>
                </div>
              </div>

              {/* Slider 3: Tiempo mínimo de fijación */}
              <div className="p-4 rounded-xl bg-[#F3FAFF] border border-[#071524]/10">
                <div className="flex justify-between items-center mb-1">
                  <label className="font-bold text-[#071524]">Tiempo Mínimo de Fijación Requerido (Dwell Time)</label>
                  <span className="font-mono font-bold text-[#006A62] text-sm">{minFixationTime} ms</span>
                </div>
                <input
                  type="range"
                  min="300"
                  max="1500"
                  step="50"
                  value={minFixationTime}
                  onChange={(e) => setMinFixationTime(parseInt(e.target.value))}
                  className="w-full accent-[#006A62]"
                />
                <div className="flex justify-between text-[10px] text-[#74777C] mt-1">
                  <span>300 ms (Rápido)</span>
                  <span>800 ms (Recomendado)</span>
                  <span>1500 ms (Baja velocidad oculomotora)</span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                {isSaved && (
                  <span className="text-xs font-bold text-[#006A62] flex items-center gap-1.5 animate-in fade-in">
                    <CheckCircle2 className="w-4 h-4" />
                    ¡Prescripción sincronizada con el motor de juego!
                  </span>
                )}
                {!isSaved && <span />}

                <button
                  onClick={handleSavePrescription}
                  className="px-5 py-2.5 rounded-lg bg-[#006A62] hover:bg-[#005049] text-white font-bold flex items-center gap-2 transition-all shadow-xs cursor-pointer ml-auto"
                >
                  <Save className="w-4 h-4" />
                  Guardar y Emitir Prescripción
                </button>
              </div>
            </div>
          )}

          {activeTab === 'historial' && (
            <div className="space-y-3">
              <span className="text-xs font-bold text-[#071524] block">
                Sesiones Recientes Registradas por el Algoritmo Ocular
              </span>
              <div className="divide-y divide-[#071524]/10 border border-[#071524]/10 rounded-xl overflow-hidden">
                <div className="p-3 bg-white flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-4 h-4 text-[#006A62]" />
                    <div>
                      <div className="font-bold text-[#071524]">Sesión 14 · Módulo Sacádico II</div>
                      <div className="text-[10px] text-[#74777C]">Hoy, 09:15 AM · 15 minutos</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-[#006A62]">96% Aciertos</span>
                    <span className="block text-[10px] text-[#74777C]">Latencia: 240 ms</span>
                  </div>
                </div>

                <div className="p-3 bg-white flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-4 h-4 text-[#006A62]" />
                    <div>
                      <div className="font-bold text-[#071524]">Sesión 13 · Búsqueda Visual</div>
                      <div className="text-[10px] text-[#74777C]">Ayer, 10:30 AM · 12 minutos</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-[#006A62]">92% Aciertos</span>
                    <span className="block text-[10px] text-[#74777C]">Latencia: 265 ms</span>
                  </div>
                </div>

                <div className="p-3 bg-white flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-4 h-4 text-[#006A62]" />
                    <div>
                      <div className="font-bold text-[#071524]">Sesión 12 · Calibración 9 Puntos + OLS</div>
                      <div className="text-[10px] text-[#74777C]">Hace 3 días · 8 minutos</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-[#006A62]">R²: 94%</span>
                    <span className="block text-[10px] text-[#74777C]">Error angular: 0.8°</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="bg-[#E6F6FF] px-6 py-3 border-t border-[#071524]/10 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-[#006A62] font-semibold">
            <ShieldCheck className="w-4 h-4" />
            <span>Auditado por HL7/FHIR Specimen-Eye</span>
          </div>

          <button
            onClick={onClose}
            className="px-5 py-2 rounded-lg bg-[#071524] text-white font-bold hover:bg-[#1C2A39] transition-colors cursor-pointer"
          >
            Cerrar Expediente
          </button>
        </div>
      </div>
    </div>
  );
};
