import React, { useState } from 'react';
import { X, UserPlus, Shield } from 'lucide-react';
import type { Patient, AffectedHemifield } from '../../../../core/domain/Patient';

interface NewPatientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSavePatient: (patient: Patient) => void;
}

export const NewPatientModal: React.FC<NewPatientModalProps> = ({
  isOpen,
  onClose,
  onSavePatient,
}) => {
  const [name, setName] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [medicalRecordNumber, setMedicalRecordNumber] = useState('');
  const [age, setAge] = useState<number>(60);
  const [gender, setGender] = useState<'Masculino' | 'Femenino' | 'Otro'>('Masculino');
  const [affectedHemifield, setAffectedHemifield] = useState<AffectedHemifield>('LEFT');
  const [hemifieldDetail, setHemifieldDetail] = useState('Hemianopsia Homónima Completa');
  const [facility, setFacility] = useState('Sede Rebagliati');
  const [phone, setPhone] = useState('+51 ');
  const [notes, setNotes] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !nationalId) {
      alert('Por favor ingrese el nombre y DNI del paciente.');
      return;
    }

    const initials = name
      .split(' ')
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase();

    const newPatient: Patient = {
      id: `pat-${Date.now()}`,
      initials: initials || 'PX',
      name,
      medicalRecordNumber: medicalRecordNumber ? `#${medicalRecordNumber.replace('#', '')}` : `#${Math.floor(100000 + Math.random() * 900000)}`,
      nationalId,
      age: Number(age),
      gender,
      affectedHemifield,
      hemifieldDetail,
      accountStatus: 'PENDING',
      statusDetail: 'Código SMS Enviado',
      lastSession: {
        timestampText: 'Sin registro inicial',
        durationMinutes: 0,
        moduleName: 'Pendiente de inicio',
      },
      adherence: {
        rate: 0,
        category: 'Deficiente',
      },
      riskAlert: {
        severity: 'PENDING',
        label: 'Calibración pendiente',
      },
      facility,
      shift: 'Turno Mañana',
      phone,
      clinicalNotes: notes,
    };

    onSavePatient(newPatient);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#071524]/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-[#071524]/10 overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="bg-[#1C2A39] text-white p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#26A69A]/20 text-[#84F5E8] flex items-center justify-center border border-[#84F5E8]/30">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-lg text-white">Registrar Nuevo Paciente</h3>
              <p className="text-xs text-[#84F5E8]/80 font-medium">
                Alta clínica y asignación de protocolo de rehabilitación visual
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-bold text-[#071524] mb-1">
                Nombre Completo del Paciente *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej. Jorge Ramírez Castillo"
                className="w-full px-3 py-2 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/60 text-sm text-[#071524] focus:ring-2 focus:ring-[#006A62] outline-none"
              />
            </div>

            <div>
              <label className="block font-bold text-[#071524] mb-1">
                Documento Nacional de Identidad (DNI) *
              </label>
              <input
                type="text"
                required
                value={nationalId}
                onChange={(e) => setNationalId(e.target.value)}
                placeholder="Ej. 42891024"
                className="w-full px-3 py-2 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/60 text-sm text-[#071524] focus:ring-2 focus:ring-[#006A62] outline-none"
              />
            </div>

            <div>
              <label className="block font-bold text-[#071524] mb-1">
                N° Historia Clínica (HC)
              </label>
              <input
                type="text"
                value={medicalRecordNumber}
                onChange={(e) => setMedicalRecordNumber(e.target.value)}
                placeholder="Ej. 850124 (opcional)"
                className="w-full px-3 py-2 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/60 text-sm text-[#071524] focus:ring-2 focus:ring-[#006A62] outline-none"
              />
            </div>

            <div>
              <label className="block font-bold text-[#071524] mb-1">
                Teléfono de Contacto (SMS Activación)
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+51 987 654 321"
                className="w-full px-3 py-2 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/60 text-sm text-[#071524] focus:ring-2 focus:ring-[#006A62] outline-none"
              />
            </div>

            <div>
              <label className="block font-bold text-[#071524] mb-1">Edad</label>
              <input
                type="number"
                min={18}
                max={100}
                value={age}
                onChange={(e) => setAge(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/60 text-sm text-[#071524] focus:ring-2 focus:ring-[#006A62] outline-none"
              />
            </div>

            <div>
              <label className="block font-bold text-[#071524] mb-1">Sexo</label>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value as any)}
                className="w-full px-3 py-2 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/60 text-sm text-[#071524] focus:ring-2 focus:ring-[#006A62] outline-none"
              >
                <option value="Masculino">Masculino</option>
                <option value="Femenino">Femenino</option>
                <option value="Otro">Otro</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-[#071524] mb-1">
                Hemicampo Visual Afectado *
              </label>
              <select
                value={affectedHemifield}
                onChange={(e) => setAffectedHemifield(e.target.value as AffectedHemifield)}
                className="w-full px-3 py-2 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/60 text-sm text-[#071524] focus:ring-2 focus:ring-[#006A62] outline-none"
              >
                <option value="LEFT">Izquierdo [Izq]</option>
                <option value="RIGHT">Derecho [Der]</option>
                <option value="BILATERAL">Bilateral</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-[#071524] mb-1">
                Detalle Diagnóstico / Campimetría
              </label>
              <input
                type="text"
                value={hemifieldDetail}
                onChange={(e) => setHemifieldDetail(e.target.value)}
                placeholder="Ej. Hemianopsia Homónima Completa"
                className="w-full px-3 py-2 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/60 text-sm text-[#071524] focus:ring-2 focus:ring-[#006A62] outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block font-bold text-[#071524] mb-1">Sede Asistencial</label>
            <select
              value={facility}
              onChange={(e) => setFacility(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/60 text-sm text-[#071524] focus:ring-2 focus:ring-[#006A62] outline-none"
            >
              <option value="Sede Rebagliati">Hospital Edgardo Rebagliati Martins</option>
              <option value="Sede Almenara">Hospital Guillermo Almenara Irigoyen</option>
              <option value="Telemedicina Domiciliaria">Telemedicina Domiciliaria</option>
            </select>
          </div>

          <div>
            <label className="block font-bold text-[#071524] mb-1">
              Notas Clínicas Iniciales / Antecedentes
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Detalles sobre ACV, tiempo de evolución, déficit motor o cognitivo concomitante..."
              className="w-full px-3 py-2 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/60 text-sm text-[#071524] focus:ring-2 focus:ring-[#006A62] outline-none"
            />
          </div>

          {/* Compliance notice */}
          <div className="flex items-center gap-2 p-3 rounded-lg bg-[#DBF1FE] text-[#006A62] text-[11px] font-medium">
            <Shield className="w-4 h-4 shrink-0" />
            <span>
              El paciente recibirá un SMS seguro con su enlace de activación conforme a la ley de protección de datos médicos.
            </span>
          </div>

          {/* Modal Footer */}
          <div className="pt-4 border-t border-[#071524]/10 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-[#C4C6CC] text-[#44474C] font-semibold hover:bg-[#F3FAFF] transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-lg bg-[#1C2A39] hover:bg-[#071524] text-white font-bold transition-colors shadow-xs"
            >
              Guardar y Activar Paciente
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
