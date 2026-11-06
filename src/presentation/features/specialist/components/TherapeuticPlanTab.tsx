import React, { useState } from 'react';
import { 
  Sliders, 
  Target, 
  Sparkles, 
  Save, 
  CheckCircle2, 
  Zap, 
  Clock 
} from 'lucide-react';
import type { Patient } from '../../../../core/domain/Patient';
import { useAppStore } from '../../../../core/store/useAppStore';

interface TherapeuticPlanTabProps {
  patient: Patient;
  onPlanUpdated?: () => void;
}

export const TherapeuticPlanTab: React.FC<TherapeuticPlanTabProps> = ({ 
  patient,
  onPlanUpdated 
}) => {
  const [targetSpeed, setTargetSpeed] = useState(1.2);
  const [visualFieldAmplitude, setVisualFieldAmplitude] = useState(0.85);
  const [minFixationTime, setMinFixationTime] = useState(650);
  const [isSaved, setIsSaved] = useState(false);

  const exercises = patient.activePlan?.exercises || [
    {
      id: 'ex-01',
      name: 'Búsqueda Visual Dinámica',
      category: 'Exploración Periférica',
      level: 3,
      targetSpeed: 1.2,
      visualFieldAmplitude: 0.85,
      minFixationTimeMs: 650,
      dailyTargetMinutes: 15,
    },
    {
      id: 'ex-02',
      name: 'Fijación Foveal y Estabilidad',
      category: 'Anclaje Central',
      level: 2,
      targetSpeed: 0.9,
      visualFieldAmplitude: 0.50,
      minFixationTimeMs: 900,
      dailyTargetMinutes: 10,
    },
    {
      id: 'ex-03',
      name: 'Exploración Sacádica Compensatoria',
      category: 'Amplitud Oculomotora',
      level: 3,
      targetSpeed: 1.4,
      visualFieldAmplitude: 0.90,
      minFixationTimeMs: 500,
      dailyTargetMinutes: 15,
    },
  ];

  const handleSave = () => {
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

    setIsSaved(true);
    if (onPlanUpdated) onPlanUpdated();
    setTimeout(() => setIsSaved(false), 3000);
  };

  return (
    <div className="space-y-6">
      {/* Ejercicios Prescritos Actuales */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {exercises.map((ex) => (
          <div
            key={ex.id}
            className="bg-white p-5 rounded-xl border border-[#071524]/10 shadow-xs flex flex-col justify-between space-y-4 hover:border-[#006A62]/30 transition-all"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-[#DBF1FE] text-[#006A62]">
                  {ex.category}
                </span>
                <span className="text-xs font-bold text-[#071524]">Nivel {ex.level}</span>
              </div>
              <h4 className="font-bold text-sm text-[#071524] mt-2">{ex.name}</h4>
              <p className="text-xs text-[#44474C] mt-1">
                Meta diaria: <strong>{ex.dailyTargetMinutes} minutos</strong> de estímulos sacádicos guiados.
              </p>
            </div>

            <div className="pt-3 border-t border-[#071524]/10 grid grid-cols-3 gap-2 text-center text-[11px]">
              <div className="p-1.5 rounded bg-[#E6F6FF]">
                <span className="text-[#44474C] block">Velocidad</span>
                <strong className="text-[#071524]">{ex.targetSpeed}x</strong>
              </div>
              <div className="p-1.5 rounded bg-[#E6F6FF]">
                <span className="text-[#44474C] block">Amplitud</span>
                <strong className="text-[#071524]">{Math.round(ex.visualFieldAmplitude * 100)}%</strong>
              </div>
              <div className="p-1.5 rounded bg-[#E6F6FF]">
                <span className="text-[#44474C] block">Fijación</span>
                <strong className="text-[#071524]">{ex.minFixationTimeMs}ms</strong>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Editor de Prescripción Dinámica */}
      <div className="bg-white p-6 rounded-xl border border-[#071524]/10 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-[#071524]/10">
          <div>
            <h3 className="font-bold text-base text-[#071524] flex items-center gap-2">
              <Sliders className="w-5 h-5 text-[#006A62]" />
              Ajuste Dinámico de Parámetros de la Terapia
            </h3>
            <p className="text-xs text-[#44474C]">
              Estas variables modifican en tiempo real la física y sensibilidad del motor Serious Games para este paciente.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs font-semibold text-[#006A62] bg-[#DBF1FE] px-3 py-1.5 rounded-lg">
            <Sparkles className="w-4 h-4" />
            <span>Prescripción Médica Directa</span>
          </div>
        </div>

        {/* Sliders */}
        <div className="space-y-4">
          {/* Slider 1: Velocidad */}
          <div className="p-4 rounded-xl bg-[#F3FAFF] border border-[#071524]/10">
            <div className="flex justify-between items-center mb-1">
              <label className="font-bold text-xs sm:text-sm text-[#071524] flex items-center gap-1.5">
                <Zap className="w-4 h-4 text-[#006A62]" />
                Velocidad de Presentación de Estímulos (Target Speed)
              </label>
              <span className="font-mono font-bold text-[#006A62] text-sm bg-white px-2 py-0.5 rounded border border-[#006A62]/20">
                {targetSpeed.toFixed(1)}x
              </span>
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
            <div className="flex justify-between text-[10px] text-[#74777C] mt-1 font-medium">
              <span>0.5x (Fatiga o Iniciación)</span>
              <span>1.0x (Estándar de Recuperación)</span>
              <span>2.5x (Máxima Exigencia Sacádica)</span>
            </div>
          </div>

          {/* Slider 2: Amplitud de Campo Visual */}
          <div className="p-4 rounded-xl bg-[#F3FAFF] border border-[#071524]/10">
            <div className="flex justify-between items-center mb-1">
              <label className="font-bold text-xs sm:text-sm text-[#071524] flex items-center gap-1.5">
                <Target className="w-4 h-4 text-[#006A62]" />
                Amplitud Excéntrica en Pantalla (Visual Field Amplitude)
              </label>
              <span className="font-mono font-bold text-[#006A62] text-sm bg-white px-2 py-0.5 rounded border border-[#006A62]/20">
                {Math.round(visualFieldAmplitude * 100)}%
              </span>
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
            <div className="flex justify-between text-[10px] text-[#74777C] mt-1 font-medium">
              <span>30% (Solo Zona Foveal Central)</span>
              <span>70% (Parafóvea y Media Periferia)</span>
              <span>100% (Exploración Completa del Hemicampo Ciego)</span>
            </div>
          </div>

          {/* Slider 3: Tiempo mínimo de fijación */}
          <div className="p-4 rounded-xl bg-[#F3FAFF] border border-[#071524]/10">
            <div className="flex justify-between items-center mb-1">
              <label className="font-bold text-xs sm:text-sm text-[#071524] flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-[#006A62]" />
                Tiempo de Fijación Requerido por Diana (Dwell Time)
              </label>
              <span className="font-mono font-bold text-[#006A62] text-sm bg-white px-2 py-0.5 rounded border border-[#006A62]/20">
                {minFixationTime} ms
              </span>
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
            <div className="flex justify-between text-[10px] text-[#74777C] mt-1 font-medium">
              <span>300 ms (Fijación Rápida)</span>
              <span>650 ms (Recomendado para Juan Pérez)</span>
              <span>1500 ms (Para pacientes con nistagmo o inestabilidad)</span>
            </div>
          </div>
        </div>

        {/* Footer de Acción */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-[#071524]/10">
          {isSaved ? (
            <span className="text-xs font-bold text-[#006A62] flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-[#006A62]" />
              ¡Prescripción guardada y sincronizada con el motor de juego!
            </span>
          ) : (
            <span className="text-xs text-[#74777C]">
              Los cambios se aplicarán en la próxima sesión que inicie el paciente en su domicilio.
            </span>
          )}

          <button
            onClick={handleSave}
            className="w-full sm:w-auto px-6 py-2.5 rounded-lg bg-[#006A62] hover:bg-[#005049] text-white font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-xs cursor-pointer ml-auto"
          >
            <Save className="w-4 h-4" />
            Guardar y Emitir Prescripción
          </button>
        </div>
      </div>
    </div>
  );
};
