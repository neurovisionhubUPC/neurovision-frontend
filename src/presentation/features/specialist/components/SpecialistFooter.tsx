import React, { useState } from 'react';
import {
  X,
  ShieldCheck,
  FileText,
  Accessibility,
  Lock,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';

type LegalModalType = 'privacy' | 'terms' | 'accessibility';

export const SpecialistFooter: React.FC = () => {
  const [activeModal, setActiveModal] = useState<LegalModalType | null>(null);

  const closeModal = () => setActiveModal(null);

  return (
    <>
      <footer className="bg-[#E6F6FF] text-[#071E27] w-full py-6 px-4 lg:px-6 xl:px-8 border-t border-[#071524]/10 mt-auto text-xs">
        <div className="max-w-[1536px] mx-auto w-full flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex flex-col sm:flex-row items-center gap-2 text-center sm:text-left">
            <span className="font-bold text-[#071524]">NeuroVisión Rehab</span>
            <span className="text-[#44474C]">
              © {new Date().getFullYear()} NeuroVisión Rehab. Clinical Accessibility Standards Compliant (ISO 13485 / Ley 29733 / WCAG 2.2 AAA).
            </span>
          </div>

          <div className="flex items-center gap-6 flex-wrap justify-center">
            <button
              type="button"
              onClick={() => setActiveModal('privacy')}
              className="text-[#44474C] hover:text-[#071524] hover:underline transition-colors cursor-pointer"
            >
              Privacy Policy
            </button>
            <button
              type="button"
              onClick={() => setActiveModal('terms')}
              className="text-[#44474C] hover:text-[#071524] hover:underline transition-colors cursor-pointer"
            >
              Terms of Service
            </button>
            <button
              type="button"
              onClick={() => setActiveModal('accessibility')}
              className="text-[#006A62] underline font-bold hover:text-[#005049] transition-colors cursor-pointer"
            >
              Accessibility Support
            </button>
          </div>
        </div>
      </footer>

      {/* Accessible Clinical Legal & Compliance Modal */}
      {activeModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="legal-modal-title"
          className="fixed inset-0 z-50 bg-[#071524]/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
        >
          <div className="bg-white rounded-2xl max-w-xl w-full shadow-2xl border border-[#071524]/10 overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="bg-[#1C2A39] text-white p-4 sm:p-5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#26A69A]/20 text-[#84F5E8] flex items-center justify-center border border-[#84F5E8]/30 shrink-0">
                  {activeModal === 'privacy' && <ShieldCheck className="w-4 h-4" />}
                  {activeModal === 'terms' && <FileText className="w-4 h-4" />}
                  {activeModal === 'accessibility' && <Accessibility className="w-4 h-4" />}
                </div>
                <h3 id="legal-modal-title" className="font-bold text-sm sm:text-base text-white">
                  {activeModal === 'privacy' && 'Política de Privacidad y Protección de Datos'}
                  {activeModal === 'terms' && 'Términos Clínicos de Servicio e ISO 13485'}
                  {activeModal === 'accessibility' && 'Soporte y Declaración de Accesibilidad'}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeModal}
                aria-label="Cerrar modal"
                className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Tabs for Quick Navigation */}
            <div className="flex border-b border-[#071524]/10 bg-[#F3FAFF] px-4 pt-2 text-xs font-semibold gap-2">
              <button
                type="button"
                onClick={() => setActiveModal('privacy')}
                className={`py-2 px-3 border-b-2 font-bold transition-all cursor-pointer ${
                  activeModal === 'privacy'
                    ? 'border-[#006A62] text-[#006A62]'
                    : 'border-transparent text-[#44474C] hover:text-[#071524]'
                }`}
              >
                Privacidad (Ley 29733 / HIPAA)
              </button>
              <button
                type="button"
                onClick={() => setActiveModal('terms')}
                className={`py-2 px-3 border-b-2 font-bold transition-all cursor-pointer ${
                  activeModal === 'terms'
                    ? 'border-[#006A62] text-[#006A62]'
                    : 'border-transparent text-[#44474C] hover:text-[#071524]'
                }`}
              >
                Términos Clínicos (ISO 13485)
              </button>
              <button
                type="button"
                onClick={() => setActiveModal('accessibility')}
                className={`py-2 px-3 border-b-2 font-bold transition-all cursor-pointer ${
                  activeModal === 'accessibility'
                    ? 'border-[#006A62] text-[#006A62]'
                    : 'border-transparent text-[#44474C] hover:text-[#071524]'
                }`}
              >
                Accesibilidad (WCAG 2.2 AAA)
              </button>
            </div>

            {/* Modal Body Content */}
            <div className="p-5 sm:p-6 overflow-y-auto space-y-4 text-xs text-[#071E27] leading-relaxed">
              {/* TAB 1: PRIVACY POLICY */}
              {activeModal === 'privacy' && (
                <div className="space-y-3.5">
                  <div className="p-3.5 rounded-xl bg-[#F3FAFF] border border-[#071524]/10 space-y-1.5">
                    <div className="flex items-center gap-2 font-bold text-[#071524]">
                      <Lock className="w-4 h-4 text-[#006A62]" />
                      <span>Ley N° 29733 — Protección de Datos Personales (Perú)</span>
                    </div>
                    <p className="text-[#44474C] text-[11px]">
                      De conformidad con la Ley N° 29733 y su Reglamento (D.S. 003-2013-JUS), todos los datos biométricos oculares, grabaciones de telemetría y diagnósticos de campimetría son clasificados como <strong>datos sensibles de salud</strong>. Se requiere el consentimiento informado expreso del paciente o tutor legal previo a toda sesión de rehabilitación visual.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-[#F3FAFF] border border-[#071524]/10 space-y-1.5">
                    <div className="flex items-center gap-2 font-bold text-[#071524]">
                      <ShieldCheck className="w-4 h-4 text-[#006A62]" />
                      <span>HIPAA Security & Privacy Rule (45 CFR Part 160 y 164)</span>
                    </div>
                    <p className="text-[#44474C] text-[11px]">
                      La plataforma implementa controles técnicos de nivel empresarial para la protección de información de salud electrónica (ePHI):
                    </p>
                    <ul className="list-disc pl-5 text-[11px] text-[#44474C] space-y-1">
                      <li>Cifrado simétrico AES-256 en almacenamiento PostgreSQL y S3.</li>
                      <li>Canales de transmisión seguros cifrados bajo TLS 1.3 con Perfect Forward Secrecy.</li>
                      <li>Autenticación federada en AWS Cognito con verificación de grupos y RBAC.</li>
                      <li>Auditoría inmutable de accesos y visualización de expedientes médicos.</li>
                    </ul>
                  </div>

                  <div className="text-[11px] text-[#74777C] pt-1">
                    Para el ejercicio de derechos ARCO (Acceso, Rectificación, Cancelación y Oposición), comuníquese con el Oficial de Privacidad en <span className="font-semibold text-[#006A62]">privacidad@neurovision.pe</span>.
                  </div>
                </div>
              )}

              {/* TAB 2: TERMS OF SERVICE */}
              {activeModal === 'terms' && (
                <div className="space-y-3.5">
                  <div className="p-3.5 rounded-xl bg-[#F3FAFF] border border-[#071524]/10 space-y-1.5">
                    <div className="flex items-center gap-2 font-bold text-[#071524]">
                      <FileText className="w-4 h-4 text-[#006A62]" />
                      <span>Dispositivo de Software Médico (ISO 13485:2016 / SaMD)</span>
                    </div>
                    <p className="text-[#44474C] text-[11px]">
                      NeuroVisión Rehab es un sistema clasificado como Software as a Medical Device (SaMD) destinado a la asistencia de terapeutas y neuro-oftalmólogos en el entrenamiento sacádico y campimétrico.
                    </p>
                  </div>

                  <div className="space-y-2 text-[11px] text-[#44474C]">
                    <div className="p-3 rounded-lg border border-[#071524]/10">
                      <strong className="text-[#071524] block mb-0.5">1. Responsabilidad Facultativa</strong>
                      El software no sustituye el juicio clínico independiente del facultativo colegiado (CMP). Toda prescripción, cambio de velocidad sacádica o Dwell Time requiere validación y firma digital médica.
                    </div>

                    <div className="p-3 rounded-lg border border-[#071524]/10">
                      <strong className="text-[#071524] block mb-0.5">2. Validez de Sesiones Domiciliarias</strong>
                      Solo se certificarán clínicamente aquellas sesiones que cumplan con la calibración OLS de 9 puntos previa, estabilidad foveal BCEA &lt; 1.5°² y tasa de muestras válidas &gt; 80%.
                    </div>

                    <div className="p-3 rounded-lg border border-[#071524]/10">
                      <strong className="text-[#071524] block mb-0.5">3. Versionado Inmutable FHIR</strong>
                      Toda modificación terapéutica queda registrada como recurso inmutable HL7 FHIR v4.0.1 garantizando la trazabilidad histórica del tratamiento.
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: ACCESSIBILITY SUPPORT */}
              {activeModal === 'accessibility' && (
                <div className="space-y-3.5">
                  <div className="p-3.5 rounded-xl bg-[#F3FAFF] border border-[#071524]/10 space-y-1.5">
                    <div className="flex items-center gap-2 font-bold text-[#071524]">
                      <Accessibility className="w-4 h-4 text-[#006A62]" />
                      <span>Conformidad con Guías de Accesibilidad Web (WCAG 2.2 Nivel AAA)</span>
                    </div>
                    <p className="text-[#44474C] text-[11px]">
                      Diseñado especialmente para pacientes con déficit visual, hemianopsia homónima, visión tubular y estrabismo, cumpliendo con los estándares internacionales de accesibilidad:
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[11px]">
                    <div className="p-3 rounded-lg border border-emerald-100 bg-emerald-50/50 space-y-1">
                      <div className="flex items-center gap-1.5 font-bold text-emerald-900">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Contraste Clínico AAA</span>
                      </div>
                      <p className="text-[#44474C]">
                        Razón de contraste &gt; 7:1 en textos críticos y estímulos luminosos con alta diferenciación foveal.
                      </p>
                    </div>

                    <div className="p-3 rounded-lg border border-emerald-100 bg-emerald-50/50 space-y-1">
                      <div className="flex items-center gap-1.5 font-bold text-emerald-900">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Navegación Total por Teclado</span>
                      </div>
                      <p className="text-[#44474C]">
                        Acceso secuencial estricto mediante Tab/Shift+Tab, confirmación con Enter y cierre con Escape.
                      </p>
                    </div>

                    <div className="p-3 rounded-lg border border-emerald-100 bg-emerald-50/50 space-y-1">
                      <div className="flex items-center gap-1.5 font-bold text-emerald-900">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Lectores de Pantalla</span>
                      </div>
                      <p className="text-[#44474C]">
                        Etiquetado semántico WAI-ARIA, live regions para telemetría y descripciones alternativas en gráficos.
                      </p>
                    </div>

                    <div className="p-3 rounded-lg border border-emerald-100 bg-emerald-50/50 space-y-1">
                      <div className="flex items-center gap-1.5 font-bold text-emerald-900">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Sin Parpadeo Estroboscópico</span>
                      </div>
                      <p className="text-[#44474C]">
                        Estímulos dinámicos controlados a frecuencias seguras (&lt; 3 Hz) para prevenir fotosensibilidad.
                      </p>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-[#DBF1FE] border border-[#006A62]/20 text-[#071E27] text-[11px] flex items-center justify-between">
                    <span>¿Necesita asistencia adicional de accesibilidad clínica?</span>
                    <a
                      href="mailto:accesibilidad@neurovision.pe"
                      className="inline-flex items-center gap-1 font-bold text-[#006A62] hover:underline"
                    >
                      <span>Contactar Soporte</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 bg-[#F3FAFF] border-t border-[#071524]/10 flex justify-end">
              <button
                type="button"
                onClick={closeModal}
                className="px-4 py-2 rounded-lg bg-[#1C2A39] text-white text-xs font-bold hover:bg-[#071524] transition-colors cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
