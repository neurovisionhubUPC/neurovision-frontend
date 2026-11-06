import React from 'react';
import { 
  Brain, 
  Pill, 
  HeartPulse, 
  Clock, 
  FileCheck2 
} from 'lucide-react';
import type { Patient } from '../../../../core/domain/Patient';

interface PatientAntecedentsTabProps {
  patient: Patient;
}

export const PatientAntecedentsTab: React.FC<PatientAntecedentsTabProps> = ({ patient }) => {
  const antecedents = patient.antecedents || {
    strokeDate: '15 de Junio, 2024',
    strokeType: 'Ictus Isquémico Aterotrombótico',
    affectedArtery: 'Arteria Cerebral Posterior Derecha (Segmento P2)',
    motorDeficit: 'Hemiparesia izquierda leve remanente (Fuerza 4+/5)',
    cognitiveDeficit: 'Sin deterioro cognitivo mayor (MoCA: 27/30)',
    hypertension: true,
    diabetes: false,
    currentMedications: [
      'Atorvastatina 40mg/día',
      'AAS 100mg/día',
      'Losartán 50mg c/12h'
    ]
  };

  return (
    <div className="space-y-6">
      {/* Grid de Antecedentes Neurológicos */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Card 1: Evento Vascular Cerebral */}
        <div className="bg-white p-5 rounded-xl border border-[#071524]/10 shadow-xs space-y-4">
          <div className="flex items-center gap-3 pb-3 border-b border-[#071524]/10">
            <div className="w-10 h-10 rounded-lg bg-[#DBF1FE] text-[#006A62] flex items-center justify-center">
              <Brain className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#071524]">Evento Vascular Cerebral (ACV)</h3>
              <p className="text-xs text-[#44474C]">Etiología y territorio vascular documentado</p>
            </div>
          </div>

          <div className="space-y-2.5 text-xs text-[#071E27]">
            <div className="flex justify-between py-1 border-b border-[#071524]/5">
              <span className="text-[#44474C] font-medium">Fecha del evento:</span>
              <strong className="text-[#071524]">{antecedents.strokeDate}</strong>
            </div>
            <div className="flex justify-between py-1 border-b border-[#071524]/5">
              <span className="text-[#44474C] font-medium">Tipo de ictus:</span>
              <strong className="text-[#071524]">{antecedents.strokeType}</strong>
            </div>
            <div className="flex justify-between py-1 border-b border-[#071524]/5">
              <span className="text-[#44474C] font-medium">Territorio vascular:</span>
              <strong className="text-[#006A62]">{antecedents.affectedArtery}</strong>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-[#44474C] font-medium">Resonancia Cerebral (RMN):</span>
              <span className="text-xs text-[#071524] font-medium">Infarto en cuña occipital medial</span>
            </div>
          </div>
        </div>

        {/* Card 2: Déficits Funcionales y Comorbilidades */}
        <div className="bg-white p-5 rounded-xl border border-[#071524]/10 shadow-xs space-y-4">
          <div className="flex items-center gap-3 pb-3 border-b border-[#071524]/10">
            <div className="w-10 h-10 rounded-lg bg-[#DBF1FE] text-[#006A62] flex items-center justify-center">
              <HeartPulse className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#071524]">Estado Funcional y Comorbilidades</h3>
              <p className="text-xs text-[#44474C]">Evaluación multidisciplinaria de ingreso</p>
            </div>
          </div>

          <div className="space-y-2.5 text-xs text-[#071E27]">
            <div className="flex justify-between py-1 border-b border-[#071524]/5">
              <span className="text-[#44474C] font-medium">Déficit Motor:</span>
              <span className="text-[#071524] font-semibold">{antecedents.motorDeficit}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-[#071524]/5">
              <span className="text-[#44474C] font-medium">Evaluación Cognitiva:</span>
              <span className="text-[#071524] font-semibold">{antecedents.cognitiveDeficit}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-[#071524]/5">
              <span className="text-[#44474C] font-medium">Hipertensión Arterial:</span>
              <span className={`font-bold ${antecedents.hypertension ? 'text-[#BA1A1A]' : 'text-[#006A62]'}`}>
                {antecedents.hypertension ? 'Sí (Bajo tratamiento)' : 'No'}
              </span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-[#44474C] font-medium">Diabetes Mellitus:</span>
              <span className={`font-bold ${antecedents.diabetes ? 'text-[#BA1A1A]' : 'text-[#006A62]'}`}>
                {antecedents.diabetes ? 'Sí (Controlado)' : 'No'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Medicación Actual y Farmacoterapia */}
      <div className="bg-white p-5 rounded-xl border border-[#071524]/10 shadow-xs space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-[#071524]/10">
          <div className="flex items-center gap-2">
            <Pill className="w-4 h-4 text-[#006A62]" />
            <h3 className="font-bold text-sm text-[#071524]">Farmacoterapia Activa</h3>
          </div>
          <span className="text-xs text-[#44474C]">Prescripción hospitalaria sincronizada</span>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          {antecedents.currentMedications.map((med, idx) => (
            <span
              key={idx}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#E6F6FF] text-[#071524] text-xs font-semibold border border-[#006A62]/20"
            >
              <FileCheck2 className="w-3.5 h-3.5 text-[#006A62]" />
              {med}
            </span>
          ))}
        </div>
      </div>

      {/* Línea de Tiempo Clínica */}
      <div className="bg-white p-5 rounded-xl border border-[#071524]/10 shadow-xs space-y-4">
        <h3 className="font-bold text-sm text-[#071524] flex items-center gap-2">
          <Clock className="w-4 h-4 text-[#006A62]" />
          Línea de Tiempo del Tratamiento
        </h3>

        <div className="relative border-l-2 border-[#006A62]/30 pl-4 ml-2 space-y-4 text-xs">
          <div className="relative">
            <div className="w-3 h-3 rounded-full bg-[#006A62] absolute -left-[23px] top-1" />
            <span className="text-[#44474C] font-mono text-[11px]">15 Jun 2024</span>
            <p className="font-bold text-[#071524]">Ictus Isquémico PCA</p>
            <p className="text-[#44474C]">Ingreso a emergencias Hospital Edgardo Rebagliati Martins.</p>
          </div>

          <div className="relative">
            <div className="w-3 h-3 rounded-full bg-[#006A62] absolute -left-[23px] top-1" />
            <span className="text-[#44474C] font-mono text-[11px]">12 Sep 2024</span>
            <p className="font-bold text-[#071524]">Enrolamiento en NeuroVisión Rehab</p>
            <p className="text-[#44474C]">Evaluación de campimetría basal y asignación de protocolo sacádico.</p>
          </div>

          <div className="relative">
            <div className="w-3 h-3 rounded-full bg-[#006A62] absolute -left-[23px] top-1 animate-pulse" />
            <span className="text-[#44474C] font-mono text-[11px]">Hoy (Semana 6)</span>
            <p className="font-bold text-[#006A62]">Fase Avanzada de Compensación Sacádica</p>
            <p className="text-[#44474C]">28 sesiones completadas con 92.4% de adherencia y respuesta foveal favorable.</p>
          </div>
        </div>
      </div>
    </div>
  );
};
