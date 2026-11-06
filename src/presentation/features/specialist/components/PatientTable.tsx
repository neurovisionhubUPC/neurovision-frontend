import React from 'react';
import { 
  ArrowLeft, 
  ArrowRight, 
  CheckCircle2, 
  Clock, 
  AlertTriangle, 
  AlertCircle, 
  FileText, 
  Sliders, 
  Activity, 
  PhoneCall, 
  Send, 
  ChevronLeft, 
  ChevronRight, 
  CloudCheck,
  Star,
  Frown
} from 'lucide-react';
import type { Patient } from '../../../../core/domain/Patient';

interface PatientTableProps {
  patients: Patient[];
  onSelectPatient: (patient: Patient) => void;
  onPrescribePlan: (patient: Patient) => void;
  onOpenAnalytics: (patient: Patient) => void;
  onContactPatient: (patient: Patient) => void;
  onResendSMS: (patient: Patient) => void;
}

export const PatientTable: React.FC<PatientTableProps> = ({
  patients,
  onSelectPatient,
  onPrescribePlan,
  onOpenAnalytics,
  onContactPatient,
  onResendSMS,
}) => {
  return (
    <section className="bg-white rounded-xl border border-[#071524]/10 overflow-hidden shadow-xs flex flex-col">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-[#E6F6FF] border-b border-[#071524]/10 text-[#44474C] font-bold uppercase tracking-wider text-[11px]">
              <th className="py-3.5 px-4" scope="col">
                Paciente / Historia Clínica
              </th>
              <th className="py-3.5 px-3" scope="col">Edad / Sexo</th>
              <th className="py-3.5 px-3" scope="col">Hemicampo Afectado</th>
              <th className="py-3.5 px-3" scope="col">Estado de Cuenta</th>
              <th className="py-3.5 px-3" scope="col">Última Sesión</th>
              <th className="py-3.5 px-3" scope="col">Adherencia Terapéutica</th>
              <th className="py-3.5 px-3" scope="col">Riesgo / Alerta</th>
              <th className="py-3.5 px-4 text-right" scope="col">Acciones Clínicas</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#071524]/5 font-normal text-[#071E27]">
            {patients.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-[#74777C]">
                  No se encontraron pacientes con los filtros seleccionados.
                </td>
              </tr>
            ) : (
              patients.map((patient) => {
                const isCritical = patient.riskAlert.severity === 'CRITICAL';
                const isPending = patient.accountStatus === 'PENDING';
                const isLeftHemifield = patient.affectedHemifield === 'LEFT';

                return (
                  <tr
                    key={patient.id}
                    className={`transition-colors ${
                      isCritical
                        ? 'bg-[#FFDAD6]/20 hover:bg-[#FFDAD6]/30 border-l-4 border-l-[#BA1A1A]'
                        : 'hover:bg-[#E6F6FF]/50'
                    }`}
                  >
                    {/* Paciente / HC */}
                    <td className="py-3.5 px-4 font-medium">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${
                            isCritical
                              ? 'bg-[#BA1A1A] text-white'
                              : 'bg-[#071524] text-white'
                          }`}
                        >
                          {patient.initials}
                        </div>
                        <div>
                          <button
                            onClick={() => onSelectPatient(patient)}
                            className="font-bold text-[#071524] text-sm hover:underline cursor-pointer flex items-center gap-1.5 text-left"
                          >
                            <span>{patient.name}</span>
                            {isCritical && (
                              <AlertCircle className="w-4 h-4 text-[#BA1A1A] shrink-0" />
                            )}
                          </button>
                          <div className="text-[11px] text-[#44474C] font-mono">
                            HC: {patient.medicalRecordNumber} · DNI: {patient.nationalId}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Edad / Sexo */}
                    <td className="py-3.5 px-3">
                      <span className="font-semibold text-[#071524]">{patient.age} años</span>
                      <span className="text-[#44474C] text-[11px] block">{patient.gender}</span>
                    </td>

                    {/* Hemicampo Afectado */}
                    <td className="py-3.5 px-3">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-[#1C2A39] text-[#84F5E8]">
                        {isLeftHemifield ? (
                          <>
                            <ArrowLeft className="w-3 h-3 text-[#84F5E8]" />
                            Izq
                          </>
                        ) : (
                          <>
                            Der
                            <ArrowRight className="w-3 h-3 text-[#84F5E8]" />
                          </>
                        )}
                      </span>
                      <span className="block text-[10px] text-[#44474C] mt-0.5 font-medium">
                        {patient.hemifieldDetail}
                      </span>
                    </td>

                    {/* Estado de Cuenta */}
                    <td className="py-3.5 px-3">
                      {isPending ? (
                        <div>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#FFDCC4] text-[#6F3800] border border-[#FFB780]">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#431F00] animate-pulse"></span>
                            Pendiente
                          </span>
                          {patient.statusDetail && (
                            <span className="block text-[10px] text-[#44474C] mt-0.5">
                              {patient.statusDetail}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#006A62]/10 text-[#006A62] border border-[#006A62]/20">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#006A62]"></span>
                          Activa
                        </span>
                      )}
                    </td>

                    {/* Última Sesión */}
                    <td className="py-3.5 px-3">
                      <span className="font-semibold text-[#071524]">
                        {patient.lastSession.timestampText}
                      </span>
                      <span
                        className={`block text-[11px] ${
                          patient.lastSession.interrupted
                            ? 'text-[#BA1A1A] font-medium'
                            : 'text-[#44474C]'
                        }`}
                      >
                        {patient.lastSession.durationMinutes > 0
                          ? `${patient.lastSession.durationMinutes} min · `
                          : ''}
                        {patient.lastSession.moduleName}
                      </span>
                    </td>

                    {/* Adherencia Terapéutica */}
                    <td className="py-3.5 px-3">
                      {patient.adherence.rate === 0 ? (
                        <span className="text-[#74777C] font-semibold text-xs">-- (Sin telemetría)</span>
                      ) : (
                        <div className="w-28">
                          <div className="flex justify-between items-center mb-1">
                            <span
                              className={`font-bold ${
                                isCritical ? 'text-[#BA1A1A]' : 'text-[#071524]'
                              }`}
                            >
                              {patient.adherence.rate}%
                            </span>
                            <span
                              className={`text-[10px] font-bold ${
                                isCritical
                                  ? 'text-[#BA1A1A]'
                                  : patient.adherence.category === 'Excelente'
                                  ? 'text-[#006A62]'
                                  : 'text-[#74777C]'
                              }`}
                            >
                              {patient.adherence.category}
                            </span>
                          </div>
                          <div className="w-full bg-[#E6F6FF] h-1.5 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${
                                isCritical ? 'bg-[#BA1A1A]' : 'bg-[#006A62]'
                              }`}
                              style={{ width: `${patient.adherence.rate}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </td>

                    {/* Riesgo / Alerta */}
                    <td className="py-3.5 px-3">
                      {isCritical ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#BA1A1A] bg-[#FFDAD6] px-2 py-0.5 rounded border border-[#BA1A1A]/20">
                          <AlertTriangle className="w-3 h-3 text-[#BA1A1A]" />
                          {patient.riskAlert.label}
                        </span>
                      ) : patient.riskAlert.severity === 'WARNING' ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#6F3800] bg-[#FFDCC4] px-2 py-0.5 rounded border border-[#FFB780]">
                          <Frown className="w-3 h-3 text-[#BA1A1A]" />
                          {patient.riskAlert.label}
                        </span>
                      ) : patient.riskAlert.severity === 'PENDING' ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#6F3800] bg-[#FFDCC4]/60 px-2 py-0.5 rounded">
                          <Clock className="w-3 h-3 text-[#6F3800]" />
                          {patient.riskAlert.label}
                        </span>
                      ) : patient.riskAlert.label.includes('Progreso') ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#006A62] bg-[#DBF1FE] px-2 py-0.5 rounded">
                          <Star className="w-3 h-3 text-[#006A62]" />
                          {patient.riskAlert.label}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#44474C] bg-[#DBF1FE]/60 px-2 py-0.5 rounded">
                          <CheckCircle2 className="w-3 h-3 text-[#006A62]" />
                          {patient.riskAlert.label}
                        </span>
                      )}
                    </td>

                    {/* Acciones Clínicas */}
                    <td className="py-3.5 px-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        {isCritical ? (
                          <>
                            <button
                              onClick={() => onContactPatient(patient)}
                              className="px-2.5 py-1 rounded-lg bg-[#BA1A1A] text-white font-semibold text-xs hover:bg-[#93000A] transition-colors flex items-center gap-1 shadow-xs"
                              title="Contactar Paciente / Protocolo de Rescate"
                            >
                              <PhoneCall className="w-3.5 h-3.5" />
                              Contactar
                            </button>
                            <button
                              onClick={() => onPrescribePlan(patient)}
                              className="p-1.5 rounded-lg hover:bg-[#E6F6FF] text-[#071524] transition-colors"
                              title="Modificar Umbral de Dificultad"
                            >
                              <Sliders className="w-4 h-4" />
                            </button>
                          </>
                        ) : isPending ? (
                          <>
                            <button
                              onClick={() => onResendSMS(patient)}
                              className="px-2.5 py-1 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/60 text-[#071524] font-semibold text-xs hover:bg-[#DBF1FE] transition-colors flex items-center gap-1"
                              title="Reenviar Código de Activación"
                            >
                              <Send className="w-3.5 h-3.5 text-[#006A62]" />
                              Reenviar SMS
                            </button>
                            <button
                              onClick={() => onSelectPatient(patient)}
                              className="p-1.5 rounded-lg hover:bg-[#E6F6FF] text-[#071524] transition-colors"
                              title="Expediente Clínico"
                            >
                              <FileText className="w-4 h-4" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => onSelectPatient(patient)}
                              className="p-1.5 rounded-lg hover:bg-[#E6F6FF] text-[#071524] hover:text-[#006A62] transition-colors"
                              title="Ver Expediente Completo"
                            >
                              <FileText className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => onPrescribePlan(patient)}
                              className="p-1.5 rounded-lg hover:bg-[#E6F6FF] text-[#071524] hover:text-[#006A62] transition-colors"
                              title="Prescribir / Modificar Plan"
                            >
                              <Sliders className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => onOpenAnalytics(patient)}
                              className="p-1.5 rounded-lg hover:bg-[#E6F6FF] text-[#071524] hover:text-[#006A62] transition-colors"
                              title="Analítica Sacádica"
                            >
                              <Activity className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Table Footer & Pagination */}
      <div className="bg-[#E6F6FF] px-4 py-3 border-t border-[#071524]/10 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="text-xs text-[#44474C] font-medium">
          Mostrando <span className="font-bold text-[#071524]">{patients.length > 0 ? 1 : 0} - {patients.length}</span> de{' '}
          <span className="font-bold text-[#071524]">24</span> pacientes registrados
        </div>

        {/* Pagination Buttons */}
        <div className="flex items-center gap-1 text-xs">
          <button
            disabled
            className="px-2.5 py-1.5 rounded-lg border border-[#C4C6CC]/60 bg-white text-[#74777C] disabled:opacity-50 transition-colors flex items-center gap-1 cursor-not-allowed"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Anterior
          </button>
          <button className="w-8 h-8 rounded-lg bg-[#071524] text-white font-bold flex items-center justify-center">
            1
          </button>
          <button className="w-8 h-8 rounded-lg bg-white border border-[#C4C6CC]/60 text-[#071524] hover:bg-[#DBF1FE] flex items-center justify-center font-medium transition-colors">
            2
          </button>
          <button className="w-8 h-8 rounded-lg bg-white border border-[#C4C6CC]/60 text-[#071524] hover:bg-[#DBF1FE] flex items-center justify-center font-medium transition-colors">
            3
          </button>
          <button className="w-8 h-8 rounded-lg bg-white border border-[#C4C6CC]/60 text-[#071524] hover:bg-[#DBF1FE] flex items-center justify-center font-medium transition-colors">
            4
          </button>
          <button className="px-2.5 py-1.5 rounded-lg border border-[#C4C6CC]/60 bg-white text-[#071524] hover:bg-[#DBF1FE] transition-colors flex items-center gap-1">
            Siguiente
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Clinical Coding / HL7 Notation Footer Bar */}
      <div className="px-4 py-2.5 bg-[#F3FAFF] text-[11px] text-[#44474C] border-t border-[#071524]/5 flex flex-col md:flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-bold text-[#071524]">Leyenda Hemicampo:</span>
          <span><strong>[Izq]</strong> Cuadrante / Hemicampo Izquierdo</span>
          <span className="text-[#C4C6CC]">·</span>
          <span><strong>[Der]</strong> Hemicampo Derecho</span>
        </div>
        <div className="flex items-center gap-1.5 text-[#006A62] font-medium">
          <CloudCheck className="w-3.5 h-3.5" />
          <span>Protocolo sincronizado vía FHIR HL7 con Hospital Nacional Edgardo Rebagliati Martins</span>
        </div>
      </div>
    </section>
  );
};
