import React, { useState, useEffect, useCallback } from 'react';
import {
  Brain,
  Pill,
  HeartPulse,
  Clock,
  FileCheck2,
  Save,
  RefreshCw,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Plus,
  X,
  Loader2,
  Stethoscope,
} from 'lucide-react';
import type { Patient } from '../../../../core/domain/Patient';
import { useAppStore } from '../../../../core/store/useAppStore';
import {
  ApiError,
  clinicalApi,
  extractApiErrorMessage,
  type AffectedHemifield,
  type AssignedPatientDetailResponse,
  type RehabilitationContextResponse,
} from '../../../../infrastructure/api';

interface PatientAntecedentsTabProps {
  patient: Patient;
  patientDetail?: AssignedPatientDetailResponse | null;
  rehabilitationContext?: RehabilitationContextResponse | null;
  contextLoading?: boolean;
  contextError?: string | null;
  onContextUpdated?: (updated: RehabilitationContextResponse) => void;
  onReloadContext?: () => void | Promise<void>;
}

function formatDateTime(iso: string | undefined | null): string {
  if (!iso) return 'Sin fecha';
  try {
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return iso;
    return parsed.toLocaleString('es-PE', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export const PatientAntecedentsTab: React.FC<PatientAntecedentsTabProps> = ({
  patient,
  patientDetail,
  rehabilitationContext,
  contextLoading = false,
  contextError = null,
  onContextUpdated,
  onReloadContext,
}) => {
  const { authMode, accessToken } = useAppStore();
  const isCognitoMode = authMode === 'COGNITO' && Boolean(accessToken);

  // Soporte autónomo si el tab se monta sin que el padre provea rehabilitationContext
  const [selfContext, setSelfContext] = useState<RehabilitationContextResponse | null>(null);
  const [selfLoading, setSelfLoading] = useState(false);
  const [selfError, setSelfError] = useState<string | null>(null);

  const effectiveContext =
    rehabilitationContext !== undefined ? rehabilitationContext : selfContext;
  const isLoading = rehabilitationContext !== undefined ? contextLoading : selfLoading;
  const loadError = rehabilitationContext !== undefined ? contextError : selfError;

  // Campos editables del contexto clínico
  const [affectedHemifield, setAffectedHemifield] = useState<AffectedHemifield | null>(null);
  const [previousDiagnosis, setPreviousDiagnosis] = useState('');
  const [sequelae, setSequelae] = useState<string[]>([]);
  const [newSequelaInput, setNewSequelaInput] = useState('');
  const [observations, setObservations] = useState('');

  // Estado de guardado y conflictos
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const fetchSelfContext = useCallback(async () => {
    if (!isCognitoMode || !patient.id) return;
    setSelfLoading(true);
    setSelfError(null);
    try {
      const ctx = await clinicalApi.getRehabilitationContext(patient.id);
      setSelfContext(ctx);
    } catch (err) {
      setSelfError(extractApiErrorMessage(err));
    } finally {
      setSelfLoading(false);
    }
  }, [isCognitoMode, patient.id]);

  useEffect(() => {
    if (isCognitoMode && rehabilitationContext === undefined) {
      void fetchSelfContext();
    }
  }, [isCognitoMode, rehabilitationContext, fetchSelfContext]);

  // Sincronizar campos del formulario cuando llega contexto nuevo
  useEffect(() => {
    if (!effectiveContext) return;
    setAffectedHemifield(effectiveContext.affectedHemifield);
    setPreviousDiagnosis(effectiveContext.previousDiagnosis ?? '');
    setSequelae(effectiveContext.sequelae ?? []);
    setObservations(effectiveContext.observations ?? '');
  }, [effectiveContext]);

  const handleReload = async () => {
    setSaveError(null);
    setSaveSuccess(null);
    if (onReloadContext) {
      await onReloadContext();
    } else {
      await fetchSelfContext();
    }
  };

  const handleAddSequela = () => {
    const trimmed = newSequelaInput.trim();
    if (!trimmed) return;
    if (!sequelae.includes(trimmed)) {
      setSequelae((prev) => [...prev, trimmed]);
    }
    setNewSequelaInput('');
  };

  const handleRemoveSequela = (item: string) => {
    setSequelae((prev) => prev.filter((s) => s !== item));
  };

  const handleSaveContext = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isCognitoMode || !effectiveContext) return;

    setIsSaving(true);
    setSaveError(null);
    setConflictWarning(null);
    setSaveSuccess(null);

    try {
      const updated = await clinicalApi.patchRehabilitationContext(patient.id, {
        expectedVersion: effectiveContext.version,
        affectedHemifield,
        previousDiagnosis: previousDiagnosis.trim() ? previousDiagnosis.trim() : null,
        sequelae,
        observations: observations.trim() ? observations.trim() : null,
      });

      if (rehabilitationContext === undefined) {
        setSelfContext(updated);
      }
      if (onContextUpdated) {
        onContextUpdated(updated);
      }
      setSaveSuccess(`Contexto clínico actualizado correctamente (Versión v${updated.version}).`);
    } catch (err) {
      const isConflict =
        err instanceof ApiError && (err.status === 409 || err.code.includes('CONFLICT'));
      if (isConflict) {
        setConflictWarning(
          'Conflicto de versión (409 Conflict): el contexto clínico fue modificado externamente. Se ha recargado la última versión del servidor para evitar sobrescritura.'
        );
        if (onReloadContext) {
          await onReloadContext();
        } else {
          await fetchSelfContext();
        }
      } else {
        setSaveError(extractApiErrorMessage(err));
      }
    } finally {
      setIsSaving(false);
    }
  };

  if (isCognitoMode) {
    return (
      <div className="space-y-6">
        {/* Resumen del Paciente desde Clinical API */}
        {patientDetail && (
          <div className="bg-white p-5 rounded-xl border border-[#071524]/10 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#071524]/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#DBF1FE] text-[#006A62] flex items-center justify-center">
                  <Stethoscope className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-[#071524]">
                    Detalle Clínico Base del Paciente
                  </h3>
                  <p className="text-xs text-[#44474C]">
                    Información de admisión y diagnóstico de ACV sincronizada desde Clinical Service
                  </p>
                </div>
              </div>
              <span
                className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                  patientDetail.status === 'ACTIVE'
                    ? 'bg-[#81F3E5]/50 text-[#005049]'
                    : 'bg-[#FFDCC4] text-[#6F3800]'
                }`}
              >
                {patientDetail.status === 'ACTIVE' ? 'Estado: ACTIVO' : 'Estado: EVALUACIÓN PENDIENTE'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-3.5 rounded-xl bg-[#F3FAFF] border border-[#071524]/10">
                <span className="text-[#44474C] font-semibold block mb-1">Diagnóstico de ACV Registrado</span>
                <p className="font-bold text-[#071524]">
                  {patientDetail.strokeDiagnosis || 'Sin diagnóstico de ACV registrado'}
                </p>
              </div>
              <div className="p-3.5 rounded-xl bg-[#F3FAFF] border border-[#071524]/10">
                <span className="text-[#44474C] font-semibold block mb-1">Secuelas Reportadas en Admisión</span>
                {patientDetail.sequelae.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {patientDetail.sequelae.map((seq, idx) => (
                      <span
                        key={`${seq}-${idx}`}
                        className="px-2 py-0.5 rounded bg-white border border-[#006A62]/20 text-[#071524] font-semibold"
                      >
                        {seq}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-[#44474C]">Sin secuelas reportadas</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Editor de Contexto de Rehabilitación */}
        <div className="bg-white p-6 rounded-xl border border-[#071524]/10 shadow-xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#071524]/10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#E6F6FF] text-[#006A62] flex items-center justify-center">
                <Brain className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-base text-[#071524]">
                  Contexto de Rehabilitación Visual
                </h3>
                <p className="text-xs text-[#44474C]">
                  Control de concurrencia optimista mediante versión (`expectedVersion`)
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {effectiveContext && (
                <>
                  <span className="px-2.5 py-1 rounded-md bg-[#DBF1FE] text-[#071524] text-xs font-mono font-bold">
                    Versión v{effectiveContext.version}
                  </span>
                  <span className="text-[11px] text-[#44474C]">
                    Actualizado: {formatDateTime(effectiveContext.updatedAt)}
                  </span>
                </>
              )}
              <button
                type="button"
                onClick={() => void handleReload()}
                disabled={isLoading || isSaving}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#C4C6CC] bg-white hover:bg-[#F3FAFF] text-xs font-semibold text-[#071524] disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-[#006A62] ${isLoading ? 'animate-spin' : ''}`} />
                Recargar
              </button>
            </div>
          </div>

          {isLoading && !effectiveContext ? (
            <div className="py-10 flex items-center justify-center gap-2 text-xs font-semibold text-[#006A62]">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Cargando contexto de rehabilitación...</span>
            </div>
          ) : (
            <>
              {loadError && (
                <div className="p-3.5 rounded-xl bg-[#FFDAD6] border border-[#BA1A1A]/30 text-[#93000A] text-xs font-medium flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{loadError}</span>
                </div>
              )}

              {conflictWarning && (
                <div className="p-3.5 rounded-xl bg-[#FFDCC4] border border-[#FFB780] text-[#6F3800] text-xs font-semibold flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[#BA1A1A]" />
                  <span>{conflictWarning}</span>
                </div>
              )}

              {saveError && (
                <div className="p-3.5 rounded-xl bg-[#FFDAD6] border border-[#BA1A1A]/30 text-[#93000A] text-xs font-medium flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{saveError}</span>
                </div>
              )}

              {saveSuccess && (
                <div className="p-3.5 rounded-xl bg-[#81F3E5]/30 border border-[#006A62]/30 text-[#005049] text-xs font-bold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#006A62] shrink-0" />
                  <span>{saveSuccess}</span>
                </div>
              )}

              {effectiveContext && (
                <form onSubmit={(e) => void handleSaveContext(e)} className="space-y-5 text-xs">
                  {/* Hemicampo Afectado (Strictly LEFT | RIGHT | null) */}
                  <div>
                    <label className="block font-bold text-[#071524] mb-2">
                      Hemicampo Afectado (`LEFT` | `RIGHT` | `null`)
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      {(
                        [
                          { value: 'LEFT', label: 'Hemicampo Izquierdo (LEFT)' },
                          { value: 'RIGHT', label: 'Hemicampo Derecho (RIGHT)' },
                          { value: null, label: 'Sin definir (null)' },
                        ] as const
                      ).map((opt) => {
                        const isSelected = affectedHemifield === opt.value;
                        return (
                          <button
                            key={String(opt.value)}
                            type="button"
                            onClick={() => setAffectedHemifield(opt.value)}
                            className={`px-4 py-2.5 rounded-lg border-2 font-bold text-xs transition-all cursor-pointer ${
                              isSelected
                                ? 'border-[#006A62] bg-[#E6F6FF] text-[#006A62]'
                                : 'border-[#C4C6CC]/60 bg-white text-[#44474C] hover:bg-[#F3FAFF]'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Diagnóstico Previo */}
                  <div>
                    <label htmlFor="rehab-prev-diagnosis" className="block font-bold text-[#071524] mb-1.5">
                      Diagnóstico Previo / Resumen Clínico
                    </label>
                    <input
                      id="rehab-prev-diagnosis"
                      type="text"
                      value={previousDiagnosis}
                      onChange={(e) => setPreviousDiagnosis(e.target.value)}
                      placeholder="Ej. ACV isquémico PCA derecha con hemianopsia homónima izquierda"
                      className="w-full px-3.5 py-2.5 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC] text-sm text-[#071524] focus:border-[#006A62] focus:outline-none"
                    />
                  </div>

                  {/* Secuelas */}
                  <div>
                    <label className="block font-bold text-[#071524] mb-1.5">
                      Secuelas Neurológicas / Campimétricas
                    </label>
                    <div className="flex gap-2 mb-2.5">
                      <input
                        type="text"
                        value={newSequelaInput}
                        onChange={(e) => setNewSequelaInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddSequela();
                          }
                        }}
                        placeholder="Añadir secuela (ej. Hemianopsia homónima izquierda)..."
                        className="flex-1 px-3.5 py-2 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC] text-xs sm:text-sm text-[#071524] focus:border-[#006A62] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleAddSequela}
                        className="inline-flex items-center gap-1 px-3.5 py-2 rounded-lg bg-[#1C2A39] text-white font-bold text-xs hover:bg-[#071524] cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Agregar
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {sequelae.length === 0 ? (
                        <span className="text-[#74777C] italic">Sin secuelas registradas en contexto.</span>
                      ) : (
                        sequelae.map((item) => (
                          <span
                            key={item}
                            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#E6F6FF] border border-[#006A62]/20 text-[#071524] font-semibold"
                          >
                            {item}
                            <button
                              type="button"
                              onClick={() => handleRemoveSequela(item)}
                              aria-label={`Eliminar ${item}`}
                              className="text-[#44474C] hover:text-[#BA1A1A] cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </span>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Observaciones Clínicas */}
                  <div>
                    <label htmlFor="rehab-observations" className="block font-bold text-[#071524] mb-1.5">
                      Observaciones Clínicas
                    </label>
                    <textarea
                      id="rehab-observations"
                      rows={4}
                      value={observations}
                      onChange={(e) => setObservations(e.target.value)}
                      placeholder="Observaciones evolutivas, tolerancia al estímulo, metas de compensación..."
                      className="w-full p-3.5 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC] text-sm text-[#071524] focus:border-[#006A62] focus:outline-none"
                    />
                  </div>

                  <div className="pt-3 border-t border-[#071524]/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <span className="text-[11px] text-[#44474C]">
                      Al guardar se enviará <code className="font-mono font-bold">expectedVersion: {effectiveContext.version}</code>.
                    </span>
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-[#006A62] hover:bg-[#005049] text-white font-bold text-xs shadow-xs disabled:opacity-60 cursor-pointer"
                    >
                      {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      {isSaving ? 'Guardando contexto...' : 'Guardar Contexto Clínico'}
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // Modo MOCK: preserva la vista referencial original
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
