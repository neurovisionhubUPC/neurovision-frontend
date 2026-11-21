import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronRight,
  ShieldCheck,
  Eye,
  Minus,
  Plus,
  Maximize2,
  Target,
  CheckCircle2,
  Stethoscope,
  FileText,
  Link2,
  Code2,
  Printer,
  Mail,
  Download,
  Loader2,
  AlertTriangle,
  Lock,
  Sparkles,
  Activity,
  RefreshCw,
} from 'lucide-react';
import { useAppStore } from '../../../../core/store/useAppStore';
import type { Patient } from '../../../../core/domain/Patient';
import { ClinicalTermTooltip } from '../../../shared/components/ClinicalTermTooltip';
import {
  ApiError,
  clinicalApi,
  createUuid,
  extractApiErrorMessage,
  modeToReportSelectorKey,
} from '../../../../infrastructure/api';
import type {
  AssignedPatientDetailResponse,
  DoctorReportSelectionQuery,
  DoctorReportSnapshotMetadata,
  DoctorReportSnapshotResponse,
  DoctorSessionReport,
  DoctorTherapySessionDetailResponse,
  DoctorTherapySessionSummary,
  ReportDataOrigin,
  ReportMode,
} from '../../../../infrastructure/api';

const MODE_LABELS: Record<ReportMode, string> = {
  STANDARD_SCANNING: 'Exploración Estándar',
  SYSTEMATIC_EXPLORATION: 'Exploración Sistemática',
  COMPENSATORY_SACCADE: 'Sacada Compensatoria',
  TARGET_SEARCH_WITH_DISTRACTORS: 'Búsqueda con Distractores',
  SUSTAINED_TARGET_FIXATION: 'Fijación Sostenida',
};

function extractModeFromDetail(detail: DoctorTherapySessionDetailResponse): ReportMode {
  if (detail.parameterSchemaVersion === 2) {
    return detail.configurationParameters.parameters.mode;
  }
  return detail.configurationParameters.mode;
}

function buildReportSelector(
  mode: ReportMode | undefined,
  origin: 'AUTO' | ReportDataOrigin
): DoctorReportSelectionQuery | undefined {
  if (origin === 'AUTO' || !mode) return undefined;
  const key = modeToReportSelectorKey(mode);
  switch (key) {
    case 'visualSearchDataOrigin':
      return { visualSearchDataOrigin: origin };
    case 'standardScanningDataOrigin':
      return { standardScanningDataOrigin: origin };
    case 'sustainedFixationDataOrigin':
      return { sustainedFixationDataOrigin: origin };
    case 'compensatorySaccadeDataOrigin':
      return { compensatorySaccadeDataOrigin: origin };
    case 'systematicExplorationDataOrigin':
      return { systematicExplorationDataOrigin: origin };
  }
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-PE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins} min ${String(secs).padStart(2, '0')} s`;
}

function clamp01(val: number): number {
  if (!Number.isFinite(val)) return 0.5;
  return Math.min(1, Math.max(0, val));
}

function heatFillColor(ratio: number): string {
  if (ratio <= 0) return '#F3FAFF';
  if (ratio < 0.25) return '#CFFAFE';
  if (ratio < 0.5) return '#81F3E5';
  if (ratio < 0.75) return '#26A69A';
  return '#071524';
}

function formatIdentityName(
  identity: { availability: string; firstName: string | null; lastName: string | null },
  fallbackLabel: string
): string {
  const full = `${identity.firstName ?? ''} ${identity.lastName ?? ''}`.trim();
  if (full) return full;
  return `${fallbackLabel} (${identity.availability})`;
}

export const ClinicalReportPreviewPage: React.FC = () => {
  const { patientId } = useParams<{ patientId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const patients = useAppStore((state) => state.patients);
  const authMode = useAppStore((state) => state.authMode);
  const accessToken = useAppStore((state) => state.accessToken);
  const isCognito = authMode === 'COGNITO' && Boolean(accessToken);

  const querySessionId = searchParams.get('sessionId');

  // === MOCK PATIENT FALLBACK ===
  const currentPatient: Patient = useMemo(() => {
    const found = patients.find(
      (p) => p.id === patientId || p.medicalRecordNumber.replace('#', '') === patientId
    );
    return found || patients[0];
  }, [patients, patientId]);

  const activePatientId = patientId || currentPatient.id;

  // Shared UI controls
  const [scale, setScale] = useState(1.0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Mock controls
  const [selectedVersion, setSelectedVersion] = useState('v1.2');
  const [currentPage, setCurrentPage] = useState(1);

  // === COGNITO STATE ===
  const [patientDetail, setPatientDetail] = useState<AssignedPatientDetailResponse | null>(null);
  const [sessionsList, setSessionsList] = useState<DoctorTherapySessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>(querySessionId || '');
  const [sessionMode, setSessionMode] = useState<ReportMode | undefined>(undefined);
  const [dataOriginChoice, setDataOriginChoice] = useState<'AUTO' | ReportDataOrigin>('AUTO');

  const [loadingInit, setLoadingInit] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewReport, setPreviewReport] = useState<DoctorSessionReport | null>(null);

  const [snapshots, setSnapshots] = useState<DoctorReportSnapshotMetadata[]>([]);
  const [snapshotsTotal, setSnapshotsTotal] = useState(0);
  const [displayedSnapshot, setDisplayedSnapshot] = useState<DoctorReportSnapshotResponse | null>(null);
  const [loadingSnapshotDetail, setLoadingSnapshotDetail] = useState(false);

  const [issuingSnapshot, setIssuingSnapshot] = useState(false);
  const [snapshotActionError, setSnapshotActionError] = useState<string | null>(null);
  const [downloadingPdfId, setDownloadingPdfId] = useState<string | null>(null);
  const [pendingIdempotencyKey, setPendingIdempotencyKey] = useState<string>(() => createUuid());

  const showNotification = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleZoomIn = () => {
    setScale((prev) => Math.min(1.3, Number((prev + 0.1).toFixed(1))));
  };

  const handleZoomOut = () => {
    setScale((prev) => Math.max(0.7, Number((prev - 0.1).toFixed(1))));
  };

  const handleFitWidth = () => {
    setScale(1.0);
    showNotification('Vista ajustada al 100% estándar A4.');
  };

  const querySessionIdRef = useRef(querySessionId);
  querySessionIdRef.current = querySessionId;

  // Sync URL ?sessionId=
  useEffect(() => {
    if (querySessionId && querySessionId !== selectedSessionId) {
      setSelectedSessionId(querySessionId);
    }
  }, [querySessionId, selectedSessionId]);

  const handleSelectSession = useCallback(
    (nextSessionId: string) => {
      setSelectedSessionId(nextSessionId);
      setDisplayedSnapshot(null);
      setSnapshotActionError(null);
      setPendingIdempotencyKey(createUuid());
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (nextSessionId) next.set('sessionId', nextSessionId);
          else next.delete('sessionId');
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  // Load patient & sessions list in COGNITO mode
  const loadPatientAndSessions = useCallback(async () => {
    if (!isCognito || !patientId) return;
    setLoadingInit(true);
    setInitError(null);
    try {
      const [patientOutcome, sessionsOutcome] = await Promise.allSettled([
        clinicalApi.getAssignedPatientDetail(patientId),
        clinicalApi.listDoctorTherapySessions(patientId, { page: 0, size: 50 }),
      ]);

      if (patientOutcome.status === 'fulfilled') {
        setPatientDetail(patientOutcome.value);
      }

      if (sessionsOutcome.status === 'fulfilled') {
        const list = sessionsOutcome.value.sessions;
        setSessionsList(list);

        if (!querySessionIdRef.current && list.length > 0) {
          const defaultSession =
            list.find((s) => s.status === 'COMPLETED')?.therapySessionId ||
            list[0].therapySessionId;
          handleSelectSession(defaultSession);
        }
      } else {
        setInitError(extractApiErrorMessage(sessionsOutcome.reason));
      }
    } finally {
      setLoadingInit(false);
    }
  }, [isCognito, patientId, handleSelectSession]);

  useEffect(() => {
    void loadPatientAndSessions();
  }, [loadPatientAndSessions]);

  // Load session detail (for mode), report preview, and snapshots list
  const loadPreviewAndSnapshots = useCallback(async () => {
    if (!isCognito || !patientId || !selectedSessionId) return;
    setLoadingPreview(true);
    setPreviewError(null);
    setSnapshotActionError(null);

    try {
      // First resolve mode from session detail if needed
      let resolvedMode: ReportMode | undefined;
      try {
        const detail = await clinicalApi.getDoctorTherapySessionDetail(patientId, selectedSessionId);
        resolvedMode = extractModeFromDetail(detail);
        setSessionMode(resolvedMode);
      } catch {
        // Ignore detail error; preview call still surfaces authoritative error
      }

      const selector = buildReportSelector(resolvedMode, dataOriginChoice);

      const [previewOutcome, snapshotsOutcome] = await Promise.allSettled([
        clinicalApi.previewSessionReport(patientId, selectedSessionId, selector),
        clinicalApi.listReportSnapshots(patientId, selectedSessionId, { page: 0, size: 20 }),
      ]);

      if (previewOutcome.status === 'fulfilled') {
        setPreviewReport(previewOutcome.value);
        setSessionMode(previewOutcome.value.mode);
      } else {
        setPreviewReport(null);
        const err = previewOutcome.reason;
        if (err instanceof ApiError && err.status === 409) {
          setPreviewError(
            `Conflicto de selección de origen de datos (${err.code}). Pruebe cambiar el origen de datos a Automático, PRODUCER_REPORTED o SYNTHETIC.`
          );
        } else {
          setPreviewError(extractApiErrorMessage(err));
        }
      }

      if (snapshotsOutcome.status === 'fulfilled') {
        setSnapshots(snapshotsOutcome.value.snapshots);
        setSnapshotsTotal(snapshotsOutcome.value.total);
      } else {
        setSnapshots([]);
        setSnapshotsTotal(0);
      }
    } finally {
      setLoadingPreview(false);
    }
  }, [isCognito, patientId, selectedSessionId, dataOriginChoice]);

  useEffect(() => {
    void loadPreviewAndSnapshots();
  }, [loadPreviewAndSnapshots]);

  const handleDataOriginChange = (nextOrigin: 'AUTO' | ReportDataOrigin) => {
    setDataOriginChoice(nextOrigin);
    setDisplayedSnapshot(null);
    setSnapshotActionError(null);
    setPendingIdempotencyKey(createUuid());
  };

  const handleIssueOfficialSnapshot = async () => {
    if (!patientId || !selectedSessionId) return;
    setIssuingSnapshot(true);
    setSnapshotActionError(null);
    try {
      const effectiveMode = previewReport?.mode || sessionMode;
      const selector = buildReportSelector(effectiveMode, dataOriginChoice);
      const created = await clinicalApi.createReportSnapshot(
        patientId,
        selectedSessionId,
        pendingIdempotencyKey,
        selector
      );
      setDisplayedSnapshot(created);
      setPendingIdempotencyKey(createUuid());
      showNotification(
        `Snapshot oficial emitido: ${created.reportSnapshotId.slice(0, 12)}… (${formatDateTime(
          created.createdAt
        )})`
      );
      // Reload snapshot history list
      try {
        const refreshed = await clinicalApi.listReportSnapshots(patientId, selectedSessionId, {
          page: 0,
          size: 20,
        });
        setSnapshots(refreshed.snapshots);
        setSnapshotsTotal(refreshed.total);
      } catch {
        // Keep created snapshot visible even if list refresh fails
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setSnapshotActionError(
          `Conflicto 409 al emitir snapshot (${err.code}): ${err.message}. Revise la selección de origen de datos o un snapshot previo incompatible.`
        );
      } else {
        setSnapshotActionError(extractApiErrorMessage(err));
      }
    } finally {
      setIssuingSnapshot(false);
    }
  };

  const handleOpenSnapshotDetail = async (snapshotId: string) => {
    if (!patientId || !selectedSessionId) return;
    setLoadingSnapshotDetail(true);
    setSnapshotActionError(null);
    try {
      const detail = await clinicalApi.getReportSnapshotDetail(
        patientId,
        selectedSessionId,
        snapshotId
      );
      setDisplayedSnapshot(detail);
      showNotification(`Visualizando snapshot inmutable ${snapshotId.slice(0, 12)}…`);
    } catch (err) {
      setSnapshotActionError(extractApiErrorMessage(err));
    } finally {
      setLoadingSnapshotDetail(false);
    }
  };

  const handleDownloadOfficialPdf = async (snapshotId: string) => {
    if (!patientId || !selectedSessionId) return;
    setDownloadingPdfId(snapshotId);
    setSnapshotActionError(null);
    try {
      const { blob, filename } = await clinicalApi.downloadReportSnapshotPdf(
        patientId,
        selectedSessionId,
        snapshotId
      );
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      showNotification(`Descarga PDF oficial iniciada: ${filename}`);
    } catch (err) {
      setSnapshotActionError(`No se pudo descargar el PDF oficial: ${extractApiErrorMessage(err)}`);
    } finally {
      setDownloadingPdfId(null);
    }
  };

  const handleExportCognitoFHIR = () => {
    const activeReport = displayedSnapshot?.report ?? previewReport;
    if (!activeReport) return;

    const diagnosticReport = {
      resourceType: 'DiagnosticReport',
      id: displayedSnapshot?.reportSnapshotId || activeReport.execution.therapySessionId,
      status: displayedSnapshot ? 'final' : 'preliminary',
      issued: displayedSnapshot?.createdAt || activeReport.issuedAt,
      subject: {
        reference: `Patient/${activeReport.clinicalPatientId}`,
        display: formatIdentityName(activeReport.patient, 'Paciente'),
      },
      performer: [
        {
          display: formatIdentityName(activeReport.doctor, 'Médico Tratante'),
        },
      ],
      extension: activeReport,
    };

    const blob = new Blob([JSON.stringify(diagnosticReport, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `FHIR_DiagnosticReport_${activeReport.execution.therapySessionId.slice(0, 12)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showNotification('Estructura HL7 FHIR DiagnosticReport JSON exportada.');
  };

  // === MOCK HANDLERS ===
  const handleCopyLink = () => {
    navigator.clipboard?.writeText(
      `https://neurovisionrehab.pe/verify/REP-2024-884-${currentPatient.id}`
    );
    showNotification('Enlace seguro copiado al portapapeles.');
  };

  const handleExportFHIR = () => {
    const diagnosticReport = {
      resourceType: 'DiagnosticReport',
      id: `REP-2024-884-${currentPatient.id}`,
      status: 'final',
      version: selectedVersion,
      issued: new Date().toISOString(),
      subject: {
        reference: `Patient/${currentPatient.id}`,
        display: `${currentPatient.name} (HC ${currentPatient.medicalRecordNumber})`,
      },
      performer: [
        {
          display: 'Dra. Elena Ramos Morales (CMP: 58492 · RNE: 24190)',
        },
      ],
      conclusion:
        'El paciente muestra una notable compensación sacádica adaptativa hacia el hemicampo izquierdo con ensanchamiento voluntario de la ventana de búsqueda periférica. Se autoriza formalmente el avance al Ciclo II.',
    };

    const dataStr =
      'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(diagnosticReport, null, 2));
    const link = document.createElement('a');
    link.setAttribute('href', dataStr);
    link.setAttribute(
      'download',
      `FHIR_DiagnosticReport_${currentPatient.name.replace(/\s+/g, '_')}.json`
    );
    document.body.appendChild(link);
    link.click();
    link.remove();

    showNotification('Estructura HL7 FHIR DiagnosticReport JSON exportada.');
  };

  const handleSendEmail = () => {
    showNotification(`Reporte oficial remitido a ${currentPatient.email || 'j.perez.ramos@email.com'}`);
  };

  const handleDownloadPDF = () => {
    showNotification('Generando archivo PDF con sello criptográfico SHA-256...');
    setTimeout(() => {
      window.print();
      showNotification(
        `Descarga completada: REP-2024-884_${currentPatient.name.replace(/\s+/g, '_')}.pdf`
      );
    }, 800);
  };

  // =====================================================================
  // COGNITO RENDER
  // =====================================================================
  if (isCognito) {
    const displayedReport = displayedSnapshot?.report ?? previewReport;
    const patientFullName =
      patientDetail?.nameStatus === 'AVAILABLE'
        ? `${patientDetail.firstName} ${patientDetail.lastName}`
        : displayedReport
        ? formatIdentityName(displayedReport.patient, 'Paciente')
        : `Paciente ${activePatientId.slice(0, 8)}…`;

    // Build dynamic limitations list from report evidence
    const limitationsList: string[] = [];
    if (displayedReport) {
      if (displayedReport.analyticsNotice) {
        limitationsList.push(displayedReport.analyticsNotice);
      }
      if (displayedReport.analytics.availability === 'CONFIRMED_NO_EVIDENCE') {
        limitationsList.push(
          'No se registraron streams de telemetría ocular admitida (CONFIRMED_NO_EVIDENCE); la evaluación se basa en el cumplimiento técnico de sesión.'
        );
      } else {
        const missingTotal = displayedReport.analytics.streams.reduce(
          (acc, st) => acc + st.summary.completeness.missingSequenceRangeCount,
          0
        );
        const lateTotal = displayedReport.analytics.streams.reduce(
          (acc, st) => acc + st.summary.completeness.lateArrivalCount,
          0
        );
        const unknownBoundary = displayedReport.analytics.streams.some(
          (st) => st.summary.completeness.unknownSessionBoundary
        );
        if (missingTotal > 0) {
          limitationsList.push(
            `Se detectaron ${missingTotal} rango(s) de secuencia faltante(s) en la telemetría ingerida, lo cual puede subestimar fijaciones breves en dichos intervalos.`
          );
        }
        if (lateTotal > 0) {
          limitationsList.push(
            `Se contabilizaron ${lateTotal} paquete(s) con llegada tardía (lateArrivalCount).`
          );
        }
        if (unknownBoundary) {
          limitationsList.push(
            'Al menos un stream reporta frontera de sesión desconocida (unknownSessionBoundary).'
          );
        }
      }
      if (limitationsList.length === 0) {
        limitationsList.push(
          'La telemetría fue capturada mediante sensor webcam calibrado a nivel de escritorio; la precisión angular depende de la estabilidad cefálica e iluminación ambiental del paciente.'
        );
      }
    }

    return (
      <div className="bg-[#C7DDE9] text-[#071E27] antialiased min-h-screen flex flex-col font-sans print:bg-white">
        {toastMessage && (
          <div className="fixed top-20 right-6 z-50 bg-[#071524] text-white px-4 py-3 rounded-lg shadow-xl flex items-center gap-3 border border-[#006A62] print:hidden">
            <CheckCircle2 className="w-4 h-4 text-[#84F5E8] shrink-0" />
            <span className="text-xs sm:text-sm font-medium">{toastMessage}</span>
          </div>
        )}

        {/* TOP NAVIGATION & REPORT CONTROLS */}
        <header className="print:hidden sticky top-0 z-40 bg-white border-b border-[#071524]/10 shadow-xs">
          <div className="max-w-[1536px] mx-auto px-4 md:px-6 py-2.5 flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#071524]/10 pb-2">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => navigate(`/specialist/patients/${encodeURIComponent(activePatientId)}`)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#E6F6FF] text-[#071524] hover:bg-[#D5ECF8] transition-colors font-semibold text-xs sm:text-sm cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Volver al Expediente</span>
                </button>
                <nav
                  aria-label="Breadcrumb"
                  className="hidden md:flex items-center gap-2 text-[#44474C] text-xs font-medium"
                >
                  <button
                    type="button"
                    onClick={() => navigate('/specialist/dashboard')}
                    className="hover:text-[#071524] cursor-pointer"
                  >
                    Portal Clínico
                  </button>
                  <ChevronRight className="w-3.5 h-3.5 text-[#74777C]" />
                  <span className="font-semibold text-[#071524]">{patientFullName}</span>
                  <ChevronRight className="w-3.5 h-3.5 text-[#74777C]" />
                  <span>Reportes Clínicos & PDF (8083)</span>
                </nav>
              </div>

              <div className="flex items-center gap-2">
                {selectedSessionId && (
                  <button
                    type="button"
                    onClick={() =>
                      navigate(
                        `/specialist/patients/${encodeURIComponent(
                          activePatientId
                        )}/auditoria?sessionId=${encodeURIComponent(selectedSessionId)}`
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#E6F6FF] hover:bg-[#D5ECF8] text-[#006A62] text-xs font-bold border border-[#006A62]/20 cursor-pointer"
                  >
                    <Activity className="w-3.5 h-3.5" />
                    Auditoría de Telemetría
                  </button>
                )}
                {displayedSnapshot ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#81F3E5]/50 text-[#005049] rounded-full text-xs font-bold border border-[#006A62]/30">
                    <Lock className="w-3.5 h-3.5" />
                    Snapshot Oficial Inmutable
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#E6F6FF] text-[#071524] rounded-full text-xs font-semibold border border-[#071524]/15">
                    <Eye className="w-3.5 h-3.5 text-[#006A62]" />
                    Vista Previa en Vivo (Sin emitir)
                  </span>
                )}
              </div>
            </div>

            {/* Session Selector, DataOrigin Selector, Zoom */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-[#071524]">Sesión:</span>
                  <select
                    value={selectedSessionId}
                    onChange={(e) => handleSelectSession(e.target.value)}
                    disabled={sessionsList.length === 0 || loadingInit}
                    className="bg-[#E6F6FF] border border-[#071524]/15 rounded-lg px-2.5 py-1.5 text-xs font-mono font-semibold text-[#071524] focus:ring-2 focus:ring-[#006A62] cursor-pointer max-w-[210px] xl:max-w-xs"
                  >
                    {sessionsList.length === 0 ? (
                      <option value="">Sin sesiones disponibles</option>
                    ) : (
                      sessionsList.map((s) => (
                        <option key={s.therapySessionId} value={s.therapySessionId}>
                          {s.therapySessionId.slice(0, 10)}… · {s.exerciseCode} · [{s.status}] ({s.quotaDate})
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-[#44474C]">Origen de Ensayos:</span>
                  <select
                    value={dataOriginChoice}
                    onChange={(e) =>
                      handleDataOriginChange(e.target.value as 'AUTO' | ReportDataOrigin)
                    }
                    className="bg-[#E6F6FF] border border-[#071524]/15 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#071524] focus:ring-2 focus:ring-[#006A62] cursor-pointer"
                  >
                    <option value="AUTO">Automático (Backend default)</option>
                    <option value="PRODUCER_REPORTED">PRODUCER_REPORTED</option>
                    <option value="SYNTHETIC">SYNTHETIC</option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => void loadPreviewAndSnapshots()}
                  disabled={loadingPreview || !selectedSessionId}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#071524]/15 bg-white hover:bg-[#E6F6FF] text-[#071524] font-semibold cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingPreview ? 'animate-spin' : ''}`} />
                  Recargar
                </button>
              </div>

              <div className="flex items-center gap-1.5 bg-[#E6F6FF] rounded-lg p-1 border border-[#071524]/10">
                <button
                  type="button"
                  onClick={handleZoomOut}
                  className="p-1.5 rounded hover:bg-[#D5ECF8] text-[#071524] cursor-pointer"
                  title="Reducir zoom"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="px-2 font-mono text-xs font-bold text-[#071524]">
                  {Math.round(scale * 100)}%
                </span>
                <button
                  type="button"
                  onClick={handleZoomIn}
                  className="p-1.5 rounded hover:bg-[#D5ECF8] text-[#071524] cursor-pointer"
                  title="Aumentar zoom"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                <div className="h-3 w-px bg-[#071524]/15 mx-1" />
                <button
                  type="button"
                  onClick={handleFitWidth}
                  className="px-2 py-1 rounded text-xs font-medium hover:bg-[#D5ECF8] text-[#071524] flex items-center gap-1 cursor-pointer"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  100%
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* SNAPSHOTS CONTROL & HISTORY PANEL (Non-printable) */}
        <section className="print:hidden max-w-[1160px] w-full mx-auto px-4 pt-6 space-y-3">
          {initError && (
            <div className="bg-[#FFDAD6] border border-[#BA1A1A]/30 rounded-xl p-4 text-xs text-[#93000A] font-semibold flex items-center justify-between">
              <span>Error cargando sesiones del paciente: {initError}</span>
              <button
                type="button"
                onClick={() => void loadPatientAndSessions()}
                className="px-3 py-1 rounded-lg bg-[#93000A] text-white font-bold cursor-pointer"
              >
                Reintentar
              </button>
            </div>
          )}

          {snapshotActionError && (
            <div className="bg-[#FFDAD6] border border-[#BA1A1A]/30 rounded-xl p-4 text-xs text-[#93000A] font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{snapshotActionError}</span>
            </div>
          )}

          {previewError && (
            <div className="bg-[#FFDCC4] border border-[#FFB780] rounded-xl p-4 text-xs text-[#6F3800] font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-[#BA1A1A]" />
              <span>Vista previa no disponible para esta sesión: {previewError}</span>
            </div>
          )}

          {/* Snapshots Registry Card */}
          <div className="bg-white rounded-xl border border-[#071524]/10 p-4 shadow-xs space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-[#071524] flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#006A62]" />
                  Snapshots Oficiales Inmutables ({snapshotsTotal})
                </h2>
                <p className="text-[11px] text-[#44474C]">
                  Emita un snapshot inmutable para congelar la evidencia clínica y habilitar la descarga del PDF oficial firmado.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {displayedSnapshot && (
                  <>
                    <button
                      type="button"
                      onClick={() => setDisplayedSnapshot(null)}
                      className="px-3 py-2 rounded-lg border border-[#071524]/20 bg-[#F3FAFF] hover:bg-[#E6F6FF] text-[#071524] text-xs font-semibold cursor-pointer"
                    >
                      Volver a Vista Previa en Vivo
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDownloadOfficialPdf(displayedSnapshot.reportSnapshotId)}
                      disabled={downloadingPdfId === displayedSnapshot.reportSnapshotId}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#071524] hover:bg-[#1C2A39] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                    >
                      {downloadingPdfId === displayedSnapshot.reportSnapshotId ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Download className="w-4 h-4 text-[#84F5E8]" />
                      )}
                      Descargar PDF Oficial
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={handleIssueOfficialSnapshot}
                  disabled={issuingSnapshot || !selectedSessionId}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#006A62] hover:bg-[#005049] text-white text-xs font-bold shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {issuingSnapshot ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  Emitir Snapshot Oficial
                </button>
              </div>
            </div>

            {displayedSnapshot && (
              <div className="p-3 rounded-lg bg-[#81F3E5]/30 border border-[#006A62]/30 text-xs text-[#005049] flex flex-wrap items-center justify-between gap-2">
                <div className="font-mono">
                  <strong>Snapshot Activo:</strong> {displayedSnapshot.reportSnapshotId} ·{' '}
                  <strong>Emitido:</strong> {formatDateTime(displayedSnapshot.createdAt)} ·{' '}
                  <strong>Inmutable:</strong> sí
                </div>
                <button
                  type="button"
                  onClick={() => void handleDownloadOfficialPdf(displayedSnapshot.reportSnapshotId)}
                  disabled={downloadingPdfId === displayedSnapshot.reportSnapshotId}
                  className="inline-flex items-center gap-1 px-3 py-1 rounded bg-[#006A62] text-white font-bold cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Descargar PDF Oficial
                </button>
              </div>
            )}

            {snapshots.length > 0 ? (
              <div className="overflow-x-auto border border-[#071524]/10 rounded-lg">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#E6F6FF] text-[#071524] font-bold">
                    <tr>
                      <th className="py-2 px-3">Snapshot ID</th>
                      <th className="py-2 px-3">Fecha de Emisión</th>
                      <th className="py-2 px-3 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#071524]/10">
                    {snapshots.map((snap) => {
                      const isActive =
                        displayedSnapshot?.reportSnapshotId === snap.reportSnapshotId;
                      return (
                        <tr
                          key={snap.reportSnapshotId}
                          className={isActive ? 'bg-[#81F3E5]/20 font-semibold' : 'hover:bg-[#F3FAFF]'}
                        >
                          <td className="py-2 px-3 font-mono text-[#071524]">
                            {snap.reportSnapshotId}
                          </td>
                          <td className="py-2 px-3 text-[#44474C]">
                            {formatDateTime(snap.createdAt)}
                          </td>
                          <td className="py-2 px-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => void handleOpenSnapshotDetail(snap.reportSnapshotId)}
                                disabled={loadingSnapshotDetail}
                                className="px-2.5 py-1 rounded border border-[#071524]/20 bg-white hover:bg-[#DBF1FE] text-[#071524] font-semibold cursor-pointer disabled:opacity-50"
                              >
                                {isActive ? 'Visualizando' : 'Ver Snapshot'}
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDownloadOfficialPdf(snap.reportSnapshotId)}
                                disabled={downloadingPdfId === snap.reportSnapshotId}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#071524] hover:bg-[#1C2A39] text-white font-bold cursor-pointer disabled:opacity-50"
                              >
                                {downloadingPdfId === snap.reportSnapshotId ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Download className="w-3 h-3 text-[#84F5E8]" />
                                )}
                                Descargar PDF Oficial
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-[#74777C]">
                Aún no se han emitido snapshots oficiales para esta sesión.
              </p>
            )}
          </div>
        </section>

        {/* MAIN DOCUMENT VIEWER CANVAS */}
        <main className="flex-1 overflow-y-auto overflow-x-auto px-4 py-6 md:py-8 pb-12 print:p-0 print:pb-0">
          {loadingPreview || loadingInit || loadingSnapshotDetail ? (
            <div className="mx-auto w-fit bg-white rounded-xl border border-[#071524]/10 p-12 shadow-lg flex items-center gap-3 text-sm font-semibold text-[#071524]">
              <Loader2 className="w-5 h-5 animate-spin text-[#006A62]" />
              <span>Cargando reporte clínico de sesión...</span>
            </div>
          ) : !displayedReport ? (
            <div className="mx-auto bg-white rounded-xl border border-[#071524]/10 p-12 max-w-xl w-full text-center shadow-lg space-y-2">
              <FileText className="w-10 h-10 text-[#006A62] mx-auto" />
              <h3 className="text-base font-bold text-[#071524]">
                Sin vista previa de reporte disponible
              </h3>
              <p className="text-xs text-[#44474C]">
                Seleccione una sesión completada (`COMPLETED`) en la barra superior o emita un snapshot cuando la sesión cumpla los requisitos clínicos.
              </p>
            </div>
          ) : (
            <div
              className={
                scale > 1
                  ? 'mx-auto print:w-full print:max-w-full'
                  : 'mx-auto w-full max-w-[880px] print:w-full print:max-w-full'
              }
              style={scale > 1 ? { width: `${Math.round(880 * scale)}px` } : undefined}
            >
              <article
                id="printable-document"
                style={{
                  transform: `scale(${scale})`,
                  marginBottom: scale > 1 ? `${Math.round((scale - 1) * 900)}px` : undefined,
                }}
                className={`${
                  scale > 1 ? 'w-[880px] origin-top-left' : 'w-full origin-top'
                } bg-white text-[#071E27] shadow-2xl rounded-xs border border-[#071524]/10 p-8 md:p-12 transition-transform duration-200 print:shadow-none print:border-none print:w-full print:max-w-full print:transform-none! print:mb-0!`}
              >
              {/* DOCUMENT HEADER */}
              <header className="border-b-2 border-[#071524]/20 pb-6 mb-6">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-lg bg-[#071524] flex items-center justify-center text-white shrink-0">
                      <Eye className="w-6 h-6 text-[#84F5E8]" />
                    </div>
                    <div>
                      <h1 className="text-xl font-bold text-[#071524] tracking-tight leading-none">
                        NeuroVisión Rehab
                      </h1>
                      <p className="text-xs text-[#44474C] font-medium mt-1">
                        Informe Clínico de Telerrehabilitación Oculomotora (Clinical v{displayedReport.schemaVersion})
                      </p>
                    </div>
                  </div>

                  <div className="text-left md:text-right">
                    <span
                      className={`inline-block text-[10px] uppercase font-bold tracking-wider px-2.5 py-0.5 rounded ${
                        displayedSnapshot
                          ? 'bg-[#006A62] text-white'
                          : 'bg-[#071524] text-white'
                      }`}
                    >
                      {displayedSnapshot
                        ? `Snapshot Oficial Inmutable (${displayedSnapshot.reportSnapshotId.slice(0, 8)}…)`
                        : 'Vista Previa Preliminar'}
                    </span>
                    <div className="text-xs text-[#44474C] font-mono mt-1">
                      Sesión: {displayedReport.execution.therapySessionId}
                    </div>
                    <div className="text-xs text-[#44474C]">
                      Emisión: {formatDateTime(displayedSnapshot?.createdAt || displayedReport.issuedAt)}
                    </div>
                    <div className="text-[10px] text-[#74777C] font-mono">
                      Cuota: {displayedReport.execution.quotaDate} · Config v
                      {displayedReport.configuration.configurationVersion}
                    </div>
                  </div>
                </div>

                <div className="mt-5 pt-4 border-t border-[#071524]/10 text-center">
                  <h2 className="text-base md:text-lg font-bold text-[#071524] uppercase tracking-wide">
                    Reporte Clínico de Sesión · {MODE_LABELS[displayedReport.mode]}
                  </h2>
                  <p className="text-xs text-[#44474C] mt-0.5 font-mono">
                    Modo: {displayedReport.mode} · Plan: {displayedReport.execution.therapyPlanId}
                  </p>
                </div>
              </header>

              {/* PATIENT & DOCTOR METADATA */}
              <section className="bg-[#E6F6FF] border border-[#071524]/10 rounded-lg p-5 mb-7 text-xs">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <span className="text-[11px] font-bold text-[#44474C] uppercase tracking-wider block">
                      Paciente
                    </span>
                    <span className="font-bold text-[#071524] text-sm block mt-0.5">
                      {formatIdentityName(displayedReport.patient, patientFullName)}
                    </span>
                    <div className="text-[11px] font-mono text-[#44474C] mt-0.5">
                      ID: {displayedReport.clinicalPatientId}
                    </div>
                    {patientDetail?.strokeDiagnosis && (
                      <div className="text-[11px] text-[#006A62] font-semibold mt-1">
                        Dx: {patientDetail.strokeDiagnosis}
                      </div>
                    )}
                  </div>

                  <div>
                    <span className="text-[11px] font-bold text-[#44474C] uppercase tracking-wider block">
                      Médico Tratante
                    </span>
                    <span className="font-bold text-[#071524] text-sm block mt-0.5">
                      {formatIdentityName(displayedReport.doctor, 'Especialista')}
                    </span>
                    <div className="text-[11px] text-[#44474C] mt-0.5">
                      {displayedReport.doctor.specialty || 'Neuro-Oftalmología'}
                    </div>
                    <div className="text-[11px] font-mono text-[#44474C]">
                      Colegiatura: {displayedReport.doctor.medicalLicense || 'No registrada'}
                    </div>
                  </div>

                  <div>
                    <span className="text-[11px] font-bold text-[#44474C] uppercase tracking-wider block">
                      Ejecución & Configuración
                    </span>
                    <div className="text-[#071524] font-semibold mt-0.5">
                      Inicio: {formatDateTime(displayedReport.execution.startedAt)}
                    </div>
                    <div className="text-[#071524] font-semibold">
                      Fin: {formatDateTime(displayedReport.execution.endedAt)}
                    </div>
                    <div className="text-[11px] font-mono text-[#44474C] mt-0.5">
                      Schema Param v{displayedReport.configuration.parameterSchemaVersion} · Estado:{' '}
                      {displayedReport.execution.status}
                    </div>
                  </div>
                </div>
              </section>

              <div className="space-y-7">
                {/* SECTION 1: SUMMARY & COMPLIANCE METRICS */}
                <section>
                  <div className="flex items-center gap-2 border-b border-[#071524]/10 pb-2 mb-3">
                    <span className="w-6 h-6 rounded-full bg-[#81F3E5] text-[#005049] flex items-center justify-center font-bold text-xs">
                      1
                    </span>
                    <h3 className="text-base font-bold text-[#071524]">
                      Resumen de Sesión & Métricas de Cumplimiento
                    </h3>
                  </div>

                  {displayedReport.analyticsNotice && (
                    <div className="mb-3 p-3 rounded-lg bg-[#FFF7ED] border border-[#FDBA74] text-xs text-[#9A3412] font-semibold">
                      Aviso de Analítica: {displayedReport.analyticsNotice}
                    </div>
                  )}

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div className="p-3 rounded-lg bg-[#F3FAFF] border border-[#071524]/10">
                      <span className="text-[#44474C] block">Duración Activa</span>
                      <strong className="text-sm text-[#071524]">
                        {formatDuration(displayedReport.execution.activeDurationSeconds)}
                      </strong>
                    </div>
                    <div className="p-3 rounded-lg bg-[#F3FAFF] border border-[#071524]/10">
                      <span className="text-[#44474C] block">Límite Mínimo / Máximo</span>
                      <strong className="text-sm text-[#071524]">
                        {displayedReport.sessionLimits.minimumValidDurationMinutes}m /{' '}
                        {displayedReport.sessionLimits.maximumSessionDurationMinutes}m
                      </strong>
                    </div>
                    <div className="p-3 rounded-lg bg-[#F3FAFF] border border-[#071524]/10">
                      <span className="text-[#44474C] block">Mín. Muestras Válidas</span>
                      <strong className="text-sm text-[#071524]">
                        {displayedReport.sessionLimits.minimumValidSampleCount}
                      </strong>
                    </div>
                    <div className="p-3 rounded-lg bg-[#F3FAFF] border border-[#071524]/10">
                      <span className="text-[#44474C] block">Meta Terapéutica</span>
                      {displayedReport.technicalProgress.availability === 'AVAILABLE' ? (
                        <strong className="text-sm text-[#006A62]">
                          {displayedReport.technicalProgress.completedRepetitions} reps ·{' '}
                          {(displayedReport.technicalProgress.activeMilliseconds / 1000).toFixed(1)}s{' '}
                          {displayedReport.technicalProgress.targetReached ? '(Alcanzada ✓)' : '(Parcial)'}
                        </strong>
                      ) : (
                        <strong className="text-sm text-[#44474C]">No aplicable (v1)</strong>
                      )}
                    </div>
                  </div>
                </section>

                {/* SECTION 2: VISUAL / TRIAL METRICS BY MODE */}
                <section>
                  <div className="flex items-center gap-2 border-b border-[#071524]/10 pb-2 mb-3">
                    <span className="w-6 h-6 rounded-full bg-[#81F3E5] text-[#005049] flex items-center justify-center font-bold text-xs">
                      2
                    </span>
                    <h3 className="text-base font-bold text-[#071524]">
                      Métricas Visuales de Desempeño ({MODE_LABELS[displayedReport.mode]})
                    </h3>
                  </div>

                  {displayedReport.visualSearch && (
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                      <div className="p-3 rounded-lg bg-[#E6F6FF]">
                        <span className="text-[#44474C] flex items-center gap-1">
                          Origen
                          <ClinicalTermTooltip termId="INPUT_ORIGIN" audience="specialist" iconSize={12} />
                        </span>
                        <strong className="font-mono">{displayedReport.visualSearch.dataOrigin}</strong>
                      </div>
                      <div className="p-3 rounded-lg bg-[#E6F6FF]">
                        <span className="text-[#44474C] block">Aciertos</span>
                        <strong className="text-[#006A62] text-sm">
                          {displayedReport.visualSearch.hitCount}
                        </strong>
                      </div>
                      <div className="p-3 rounded-lg bg-[#E6F6FF]">
                        <span className="text-[#44474C] block">Omisiones</span>
                        <strong className="text-sm">{displayedReport.visualSearch.omissionCount}</strong>
                      </div>
                      <div className="p-3 rounded-lg bg-[#E6F6FF]">
                        <span className="text-[#44474C] block">Elegibles / Interr.</span>
                        <strong className="text-sm">
                          {displayedReport.visualSearch.eligibleSearchCount} /{' '}
                          {displayedReport.visualSearch.interruptedCount}
                        </strong>
                      </div>
                      <div className="p-3 rounded-lg bg-[#E6F6FF]">
                        <span className="text-[#44474C] flex items-center gap-1">
                          Mediana Búsqueda
                          <ClinicalTermTooltip termId="MEDIAN_DURATION" audience="specialist" iconSize={12} />
                        </span>
                        <strong className="text-sm">
                          {displayedReport.visualSearch.medianSearchDurationMs !== null
                            ? `${Math.round(displayedReport.visualSearch.medianSearchDurationMs)} ms`
                            : 'N/D'}
                        </strong>
                      </div>
                    </div>
                  )}

                  {displayedReport.standardScanning && (
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                      <div className="p-3 rounded-lg bg-[#E6F6FF]">
                        <span className="text-[#44474C] flex items-center gap-1">
                          Origen
                          <ClinicalTermTooltip termId="INPUT_ORIGIN" audience="specialist" iconSize={12} />
                        </span>
                        <strong className="font-mono">
                          {displayedReport.standardScanning.dataOrigin}
                        </strong>
                      </div>
                      <div className="p-3 rounded-lg bg-[#E6F6FF]">
                        <span className="text-[#44474C] block">Detectados</span>
                        <strong className="text-[#006A62] text-sm">
                          {displayedReport.standardScanning.detectedTargetCount}
                        </strong>
                      </div>
                      <div className="p-3 rounded-lg bg-[#E6F6FF]">
                        <span className="text-[#44474C] block">Omisiones</span>
                        <strong className="text-sm">
                          {displayedReport.standardScanning.omissionCount}
                        </strong>
                      </div>
                      <div className="p-3 rounded-lg bg-[#E6F6FF]">
                        <span className="text-[#44474C] block">Elegibles</span>
                        <strong className="text-sm">
                          {displayedReport.standardScanning.eligibleLocalizationCount}
                        </strong>
                      </div>
                      <div className="p-3 rounded-lg bg-[#E6F6FF]">
                        <span className="text-[#44474C] flex items-center gap-1">
                          Mediana Localización
                          <ClinicalTermTooltip termId="MEDIAN_DURATION" audience="specialist" iconSize={12} />
                        </span>
                        <strong className="text-sm">
                          {displayedReport.standardScanning.medianLocalizationDurationMs !== null
                            ? `${Math.round(
                                displayedReport.standardScanning.medianLocalizationDurationMs
                              )} ms`
                            : 'N/D'}
                        </strong>
                      </div>
                    </div>
                  )}

                  {displayedReport.sustainedFixation && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                      <div className="p-3 rounded-lg bg-[#E6F6FF]">
                        <span className="text-[#44474C] flex items-center gap-1">
                          Origen
                          <ClinicalTermTooltip termId="INPUT_ORIGIN" audience="specialist" iconSize={12} />
                        </span>
                        <strong className="font-mono">
                          {displayedReport.sustainedFixation.dataOrigin}
                        </strong>
                      </div>
                      <div className="p-3 rounded-lg bg-[#E6F6FF]">
                        <span className="text-[#44474C] block">Ensayos Reportados</span>
                        <strong className="text-sm">
                          {displayedReport.sustainedFixation.reportedTrialCount}
                        </strong>
                      </div>
                      <div className="p-3 rounded-lg bg-[#E6F6FF]">
                        <span className="text-[#44474C] block">Tiempo Total en Objetivo</span>
                        <strong className="text-[#006A62] text-sm">
                          {(displayedReport.sustainedFixation.totalInsideTargetMs / 1000).toFixed(1)} s
                        </strong>
                      </div>
                      <div className="p-3 rounded-lg bg-[#E6F6FF]">
                        <span className="text-[#44474C] block">Objetivos Completados</span>
                        <strong className="text-sm">
                          {displayedReport.sustainedFixation.completedTargetCount}
                        </strong>
                      </div>
                    </div>
                  )}

                  {displayedReport.compensatorySaccade && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                      <div className="p-3 rounded-lg bg-[#E6F6FF]">
                        <span className="text-[#44474C] flex items-center gap-1">
                          Origen
                          <ClinicalTermTooltip termId="INPUT_ORIGIN" audience="specialist" iconSize={12} />
                        </span>
                        <strong className="font-mono">
                          {displayedReport.compensatorySaccade.dataOrigin}
                        </strong>
                      </div>
                      <div className="p-3 rounded-lg bg-[#E6F6FF]">
                        <span className="text-[#44474C] block">Ensayos Reportados</span>
                        <strong className="text-sm">
                          {displayedReport.compensatorySaccade.reportedTrialCount}
                        </strong>
                      </div>
                      <div className="p-3 rounded-lg bg-[#E6F6FF]">
                        <span className="text-[#44474C] block">Objetivos Alcanzados</span>
                        <strong className="text-[#006A62] text-sm">
                          {displayedReport.compensatorySaccade.reachedTargetCount}
                        </strong>
                      </div>
                      <div className="p-3 rounded-lg bg-[#E6F6FF]">
                        <span className="text-[#44474C] flex items-center gap-1">
                          Mediana Tiempo al Objetivo
                          <ClinicalTermTooltip termId="MEDIAN_DURATION" audience="specialist" iconSize={12} />
                        </span>
                        <strong className="text-sm">
                          {displayedReport.compensatorySaccade.medianTimeToTargetMs !== null
                            ? `${Math.round(
                                displayedReport.compensatorySaccade.medianTimeToTargetMs
                              )} ms`
                            : 'N/D'}
                        </strong>
                      </div>
                    </div>
                  )}

                  {displayedReport.systematicExploration && (
                    <div className="overflow-x-auto border border-[#071524]/10 rounded-lg text-xs">
                      <table className="w-full text-left">
                        <thead className="bg-[#E6F6FF] font-bold">
                          <tr>
                            <th className="py-2 px-3">Trial ID</th>
                            <th className="py-2 px-3">Resultado</th>
                            <th className="py-2 px-3">Zonas Visitadas</th>
                            <th className="py-2 px-3">Cobertura</th>
                            <th className="py-2 px-3">Duración</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#071524]/10">
                          {displayedReport.systematicExploration.traversals.map((tr) => (
                            <tr key={tr.trialId}>
                              <td className="py-2 px-3 font-mono">{tr.trialId}</td>
                              <td className="py-2 px-3 font-semibold">{tr.outcome}</td>
                              <td className="py-2 px-3">{tr.visitedRegionCount}</td>
                              <td className="py-2 px-3 font-bold text-[#006A62]">
                                {tr.coveragePercent}%
                              </td>
                              <td className="py-2 px-3">{tr.elapsedMs} ms</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {!displayedReport.visualSearch &&
                    !displayedReport.standardScanning &&
                    !displayedReport.sustainedFixation &&
                    !displayedReport.compensatorySaccade &&
                    !displayedReport.systematicExploration && (
                      <div className="p-3 rounded-lg bg-[#F3FAFF] border border-[#071524]/10 text-xs text-[#44474C]">
                        Sin métricas específicas de ensayos disponibles para el origen seleccionado.
                      </div>
                    )}
                </section>

                {/* SECTION 3: TELEMETRY SUMMARY & EMBEDDED HEATMAP / GAZE PLOT */}
                <section>
                  <div className="flex items-center gap-2 border-b border-[#071524]/10 pb-2 mb-3">
                    <span className="w-6 h-6 rounded-full bg-[#81F3E5] text-[#005049] flex items-center justify-center font-bold text-xs">
                      3
                    </span>
                    <h3 className="text-base font-bold text-[#071524]">
                      Resumen de Telemetría Ocular & Evidencia Espacial
                    </h3>
                  </div>

                  {displayedReport.analytics.availability === 'CONFIRMED_NO_EVIDENCE' ? (
                    <div className="p-4 rounded-lg bg-[#F3FAFF] border border-[#071524]/10 text-xs text-[#44474C]">
                      Disponibilidad: <strong>CONFIRMED_NO_EVIDENCE</strong>. No se registraron streams
                      analíticos para esta sesión.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {displayedReport.analytics.streams.map((st) => {
                        const grid = st.heatmap.grid;
                        const peak = Math.max(1, ...grid.cellCounts);
                        const points = st.gazePlot.points;

                        return (
                          <div
                            key={st.summary.source.streamId}
                            className="border border-[#071524]/10 rounded-lg p-4 space-y-4 bg-[#F3FAFF]/50"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                              <span className="font-mono font-bold text-[#071524]">
                                Stream: {st.summary.source.streamId} (rev {st.summary.source.revision})
                              </span>
                              <span className="text-[#44474C] font-mono">
                                Gaze: {st.summary.completeness.sampleCounts.gaze} · Gameplay:{' '}
                                {st.summary.completeness.sampleCounts.gameplay} · Total:{' '}
                                {st.summary.completeness.sampleCounts.total}
                              </span>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                              <div className="p-2.5 rounded bg-white border border-[#071524]/10">
                                <span className="text-[11px] text-[#44474C] flex items-center gap-1">
                                  Confianza Media
                                  <ClinicalTermTooltip termId="CONFIDENCE_MEAN" audience="specialist" iconSize={12} />
                                </span>
                                <strong className="text-[#006A62]">
                                  {st.summary.confidence.mean !== null
                                    ? `${(st.summary.confidence.mean * 100).toFixed(1)}%`
                                    : 'N/D'}
                                </strong>
                              </div>
                              <div className="p-2.5 rounded bg-white border border-[#071524]/10">
                                <span className="text-[11px] text-[#44474C] flex items-center gap-1">
                                  Cobertura Espacial
                                  <ClinicalTermTooltip termId="QUADRANT_COVERAGE" audience="specialist" iconSize={12} />
                                </span>
                                <strong>
                                  {(st.summary.coverage.occupiedCellRatio * 100).toFixed(1)}% (
                                  {st.summary.coverage.occupiedCellCount} celdas)
                                </strong>
                              </div>
                              <div className="p-2.5 rounded bg-white border border-[#071524]/10">
                                <span className="text-[11px] text-[#44474C] flex items-center gap-1">
                                  Distancia Gaze Path
                                  <ClinicalTermTooltip termId="GAZE_PATH_DISTANCE" audience="specialist" iconSize={12} />
                                </span>
                                <strong>{st.summary.gazePath.totalDistance.toFixed(2)} u</strong>
                              </div>
                              <div className="p-2.5 rounded bg-white border border-[#071524]/10">
                                <span className="text-[11px] text-[#44474C] block">Score / Progreso</span>
                                <strong>
                                  {st.summary.gameplay.score.last ?? '—'} /{' '}
                                  {st.summary.gameplay.progress.last ?? '—'}
                                </strong>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {/* Embedded Heatmap */}
                              <div className="bg-white border border-[#071524]/10 rounded-lg p-3 space-y-2">
                                <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px]">
                                  <span className="font-bold text-[#071524] flex items-center gap-1">
                                    Heatmap ({grid.columns}×{grid.rows} · {st.heatmap.coordinateSpace} · 16:9)
                                    <ClinicalTermTooltip termId="HEATMAP" audience="specialist" iconSize={12} />
                                  </span>
                                  <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-[#44474C]">
                                    {st.heatmap.cellWeight && (
                                      <span className="px-1.5 py-0.5 rounded bg-[#E6F6FF] border border-[#071524]/10">
                                        cellWeight: {st.heatmap.cellWeight}
                                      </span>
                                    )}
                                    <span className="px-1.5 py-0.5 rounded bg-[#E6F6FF] border border-[#071524]/10">
                                      confidenceFiltered: {st.heatmap.confidenceFiltered ? 'true' : 'false'}
                                    </span>
                                  </div>
                                </div>
                                {grid.columns > 0 && grid.rows > 0 ? (
                                  <div
                                    className="grid gap-0.5 aspect-video"
                                    style={{
                                      gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))`,
                                      gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
                                    }}
                                  >
                                    {grid.cellCounts.map((count, idx) => (
                                      <div
                                        key={idx}
                                        style={{ backgroundColor: heatFillColor(count / peak) }}
                                        className="rounded-[1px]"
                                        title={`${count} muestras`}
                                      />
                                    ))}
                                  </div>
                                ) : (
                                  <div className="text-[11px] text-[#74777C]">Sin celdas</div>
                                )}
                                <div className="pt-1 border-t border-[#071524]/10 space-y-1 text-[10px] text-[#44474C]">
                                  <div className="flex items-center justify-between gap-2">
                                    <span>0 muestras</span>
                                    <div
                                      className="h-2 flex-1 rounded"
                                      style={{
                                        background: `linear-gradient(to right, ${heatFillColor(0)}, ${heatFillColor(0.5)}, ${heatFillColor(1)})`,
                                      }}
                                    />
                                    <span>Pico relativo ({peak})</span>
                                  </div>
                                  <p>
                                    La intensidad representa conteos relativos de muestras observadas en espacio normalizado 16:9 (no equivale a duración de fijación ni constituye diagnóstico automatizado).
                                  </p>
                                </div>
                              </div>

                              {/* Embedded Gaze Plot */}
                              <div className="bg-white border border-[#071524]/10 rounded-lg p-3 space-y-2">
                                <div className="text-[11px] font-bold text-[#071524] flex items-center gap-1">
                                  Gaze Plot ({points.length} puntos observados · lienzo 16:9)
                                  <ClinicalTermTooltip termId="GAZE_PLOT" audience="specialist" iconSize={12} />
                                </div>
                                <svg
                                  viewBox="0 0 400 225"
                                  className="w-full aspect-video bg-[#F3FAFF] rounded border border-[#071524]/10"
                                >
                                  <line x1={200} y1={0} x2={200} y2={225} stroke="#071524" strokeOpacity={0.12} />
                                  <line x1={0} y1={112.5} x2={400} y2={112.5} stroke="#071524" strokeOpacity={0.12} />
                                  {points.map((pt, idx) => {
                                    if (idx === 0 || pt.segmentBreakBefore) return null;
                                    const prev = points[idx - 1];
                                    return (
                                      <line
                                        key={`l-${idx}`}
                                        x1={clamp01(prev.x) * 400}
                                        y1={clamp01(prev.y) * 225}
                                        x2={clamp01(pt.x) * 400}
                                        y2={clamp01(pt.y) * 225}
                                        stroke="#006A62"
                                        strokeWidth={1.2}
                                        strokeOpacity={0.5}
                                      />
                                    );
                                  })}
                                  {points.map((pt, idx) => (
                                    <circle
                                      key={`p-${idx}`}
                                      cx={clamp01(pt.x) * 400}
                                      cy={clamp01(pt.y) * 225}
                                      r={3}
                                      fill={pt.confidence >= 0.7 ? '#006A62' : '#C97E41'}
                                      fillOpacity={0.75}
                                    />
                                  ))}
                                </svg>
                                {st.gazePlot?.hasNext && (
                                  <div className="p-2 rounded bg-[#FFF4E5] border border-[#FFE0B2] text-[#8C4A00] text-[10px] font-semibold">
                                    Vista previa acotada: solo se muestra la primera página de puntos de mirada ({points.length} puntos
                                    {st.gazePlot.pageSize ? `, límite ${st.gazePlot.pageSize}` : ''}). Existen más puntos en la auditoría de telemetría.
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                {/* SECTION 4: LIMITATIONS & CLINICAL DISCLAIMER */}
                <section>
                  <div className="flex items-center gap-2 border-b border-[#071524]/10 pb-2 mb-3">
                    <span className="w-6 h-6 rounded-full bg-[#81F3E5] text-[#005049] flex items-center justify-center font-bold text-xs">
                      4
                    </span>
                    <h3 className="text-base font-bold text-[#071524]">
                      Limitaciones Técnicas y Aviso Clínico (Disclaimer)
                    </h3>
                  </div>

                  <div className="bg-[#E6F6FF]/70 border-l-4 border-[#006A62] p-4 rounded-r-lg space-y-2 text-xs text-[#071E27]">
                    <ul className="list-disc pl-4 space-y-1">
                      {limitationsList.map((item, idx) => (
                        <li key={idx}>{item}</li>
                      ))}
                    </ul>
                    <p className="pt-2 border-t border-[#071524]/10 text-[11px] text-[#44474C] font-medium">
                      <strong>Descargo Clínico:</strong> Los indicadores cuantitativos de telemetría ocular y
                      cumplimiento reflejan la evidencia registrada durante la sesión y constituyen un apoyo
                      diagnóstico complementario; la interpretación definitiva y las decisiones terapéuticas
                      corresponden exclusivamente al médico tratante responsable.
                    </p>
                  </div>
                </section>
              </div>

              {/* DOCUMENT FOOTER */}
              <footer className="mt-10 pt-5 border-t-2 border-[#071524]/10 flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 text-[11px] text-[#44474C]">
                <div>
                  <div className="font-bold text-[#071524]">
                    {formatIdentityName(displayedReport.doctor, 'Médico Tratante')}
                  </div>
                  <div>
                    {displayedReport.doctor.specialty || 'Especialista en Neuro-Oftalmología'} ·{' '}
                    {displayedReport.doctor.medicalLicense || 'CMP'}
                  </div>
                </div>
                <div className="font-mono text-left sm:text-right">
                  <div>
                    <strong>Estado Documento:</strong>{' '}
                    {displayedSnapshot ? `Snapshot ${displayedSnapshot.reportSnapshotId}` : 'Preview (Borrador)'}
                  </div>
                  <div>
                    <strong>IssuedAt:</strong> {displayedReport.issuedAt}
                  </div>
                </div>
              </footer>
              </article>
            </div>
          )}
        </main>

        {/* FLOATING ACTIONS BAR */}
        <aside className="print:hidden sticky bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-[#071524]/10 py-3 px-4 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
          <div className="max-w-[1536px] mx-auto flex flex-wrap items-center justify-between gap-3">
            <div className="hidden sm:flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-[#E6F6FF] flex items-center justify-center text-[#071524]">
                <FileText className="w-5 h-5 text-[#006A62]" />
              </div>
              <div className="text-xs">
                <div className="font-bold text-[#071524]">
                  {displayedSnapshot
                    ? `Snapshot ${displayedSnapshot.reportSnapshotId.slice(0, 12)}…`
                    : selectedSessionId
                    ? `Sesión ${selectedSessionId.slice(0, 12)}…`
                    : 'Sin sesión seleccionada'}
                </div>
                <div className="text-[11px] text-[#44474C]">
                  {displayedSnapshot
                    ? 'Documento inmutable certificado · Listo para descarga PDF oficial'
                    : 'Vista previa clínica · Emita un snapshot para generar el PDF oficial'}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
              <button
                type="button"
                onClick={handleExportCognitoFHIR}
                disabled={!displayedReport}
                className="px-3 py-2 rounded-lg border border-[#071524]/20 hover:bg-[#D5ECF8] text-[#071524] font-semibold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Code2 className="w-4 h-4" />
                Exportar FHIR JSON
              </button>

              <button
                type="button"
                onClick={() => window.print()}
                disabled={!displayedReport}
                className="px-3 py-2 rounded-lg border border-[#071524] text-[#071524] hover:bg-[#D5ECF8] font-semibold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Printer className="w-4 h-4" />
                Imprimir Local
              </button>

              {displayedSnapshot && (
                <button
                  type="button"
                  onClick={() => void handleDownloadOfficialPdf(displayedSnapshot.reportSnapshotId)}
                  disabled={downloadingPdfId === displayedSnapshot.reportSnapshotId}
                  className="px-4 py-2 rounded-lg bg-[#071524] hover:bg-[#1C2A39] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {downloadingPdfId === displayedSnapshot.reportSnapshotId ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4 text-[#84F5E8]" />
                  )}
                  Descargar PDF Oficial
                </button>
              )}

              <button
                type="button"
                onClick={handleIssueOfficialSnapshot}
                disabled={issuingSnapshot || !selectedSessionId}
                className="px-4 py-2 rounded-lg bg-[#006A62] hover:bg-[#005049] text-white text-xs font-bold shadow-md flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {issuingSnapshot ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                Emitir Snapshot Oficial
              </button>
            </div>
          </div>
        </aside>
      </div>
    );
  }

  // =====================================================================
  // MOCK MODE RENDER (PRESERVED)
  // =====================================================================
  const isLeftHemifield = currentPatient.affectedHemifield === 'LEFT';

  return (
    <div className="bg-[#C7DDE9] text-[#071E27] antialiased min-h-screen flex flex-col font-sans select-none print:bg-white">
      {/* Interactive Toast Notification */}
      {toastMessage && (
        <div className="fixed top-20 right-6 z-50 bg-[#071524] text-white px-4 py-3 rounded-lg shadow-xl flex items-center gap-3 border border-[#006A62] print:hidden animate-in slide-in-from-top-3 duration-200">
          <CheckCircle2 className="w-4 h-4 text-[#84F5E8]" />
          <span className="text-xs sm:text-sm font-medium">{toastMessage}</span>
        </div>
      )}

      {/* CLINICAL TOP NAVIGATION BAR */}
      <header className="print:hidden sticky top-0 z-40 bg-white border-b border-[#071524]/10 shadow-xs">
        <div className="max-w-[1536px] mx-auto px-4 md:px-6 py-2.5 flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#071524]/10 pb-2">
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate(`/specialist/patients/${currentPatient.id}`)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#E6F6FF] text-[#071524] hover:bg-[#D5ECF8] transition-colors font-semibold text-xs sm:text-sm cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Volver al Expediente / Sesiones</span>
              </button>
              <div className="h-4 w-px bg-[#071524]/20 hidden md:block" />
              <nav
                aria-label="Breadcrumb"
                className="hidden md:flex items-center gap-2 text-[#44474C] text-xs font-medium"
              >
                <button
                  onClick={() => navigate('/specialist/dashboard')}
                  className="hover:text-[#071524] cursor-pointer"
                >
                  Portal Clínico
                </button>
                <ChevronRight className="w-3.5 h-3.5 text-[#74777C]" />
                <button
                  onClick={() => navigate('/specialist/dashboard')}
                  className="hover:text-[#071524] cursor-pointer"
                >
                  Pacientes
                </button>
                <ChevronRight className="w-3.5 h-3.5 text-[#74777C]" />
                <button
                  onClick={() => navigate(`/specialist/patients/${currentPatient.id}`)}
                  className="font-semibold text-[#071524] hover:underline cursor-pointer"
                >
                  {currentPatient.name} (HC {currentPatient.medicalRecordNumber})
                </button>
                <ChevronRight className="w-3.5 h-3.5 text-[#74777C]" />
                <span>Expediente</span>
                <ChevronRight className="w-3.5 h-3.5 text-[#74777C]" />
                <span className="bg-[#CFE6F2] text-[#071524] px-2 py-0.5 rounded text-xs font-mono font-bold">
                  #REP-2024-884
                </span>
              </nav>
            </div>

            <div className="flex items-center gap-2">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#81F3E5]/40 text-[#005049] rounded-full text-xs font-semibold border border-[#006A62]/20">
                <ShieldCheck className="w-4 h-4 text-[#006A62]" />
                <span>Firma Digital y Hash SHA-256 Verificado ✓</span>
              </div>
              <span className="text-xs text-[#44474C] font-mono hidden xl:inline-block">
                HL7 FHIR v4.0.1 Conforme
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs md:text-sm">
            <div className="flex items-center gap-2">
              <span className="font-bold text-[#071524] flex items-center gap-1.5 text-sm sm:text-base tracking-tight">
                <Eye className="w-4 h-4 text-[#006A62]" />
                Visor Clínico
              </span>
              <div className="h-5 w-px bg-[#071524]/10 mx-1" />
              <div className="relative inline-block">
                <select
                  value={selectedVersion}
                  onChange={(e) => {
                    setSelectedVersion(e.target.value);
                    showNotification(`Cargando documento versión ${e.target.value}...`);
                  }}
                  className="bg-[#E6F6FF] border border-[#071524]/10 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#071524] focus:ring-2 focus:ring-[#006A62] focus:outline-none cursor-pointer"
                >
                  <option value="v1.2">Versión Oficial Certificada v1.2 (Actual)</option>
                  <option value="v1.1">Versión Preliminar v1.1 (12 Nov 2024)</option>
                  <option value="v1.0">Borrador de Telemetría v1.0 (10 Nov 2024)</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-1.5 bg-[#E6F6FF] rounded-lg p-1 border border-[#071524]/10">
              <button
                onClick={handleZoomOut}
                className="p-1.5 rounded hover:bg-[#D5ECF8] text-[#071524] cursor-pointer"
                title="Reducir zoom"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="px-2 font-mono text-xs font-bold text-[#071524]">
                {Math.round(scale * 100)}%
              </span>
              <button
                onClick={handleZoomIn}
                className="p-1.5 rounded hover:bg-[#D5ECF8] text-[#071524] cursor-pointer"
                title="Aumentar zoom"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <div className="h-3 w-px bg-[#071524]/15 mx-1" />
              <button
                onClick={handleFitWidth}
                className="px-2 py-1 rounded text-xs font-medium hover:bg-[#D5ECF8] text-[#071524] flex items-center gap-1 cursor-pointer"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                Ajustar al ancho
              </button>
              <div className="h-3 w-px bg-[#071524]/15 mx-1" />
              <div className="flex items-center gap-1.5 px-2 font-mono text-xs text-[#44474C] font-medium">
                <button
                  onClick={() => setCurrentPage((p) => (p === 1 ? 2 : 1))}
                  className="text-[#071524] font-bold hover:underline cursor-pointer"
                >
                  Página {currentPage}
                </button>{' '}
                de 2
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* MAIN DOCUMENT VIEWER CANVAS */}
      <main className="flex-1 overflow-y-auto overflow-x-auto px-4 py-8 md:py-12 pb-12 print:p-0 print:pb-0">
        <div
          className={
            scale > 1
              ? 'mx-auto print:w-full print:max-w-full'
              : 'mx-auto w-full max-w-[840px] print:w-full print:max-w-full'
          }
          style={scale > 1 ? { width: `${Math.round(840 * scale)}px` } : undefined}
        >
          <article
            id="printable-document"
            style={{
              transform: `scale(${scale})`,
              marginBottom: scale > 1 ? `${Math.round((scale - 1) * 900)}px` : undefined,
            }}
            className={`${
              scale > 1 ? 'w-[840px] origin-top-left' : 'w-full origin-top'
            } bg-white text-[#071E27] shadow-2xl rounded-xs border border-[#071524]/10 p-8 md:p-14 transition-transform duration-200 print:shadow-none print:border-none print:w-full print:max-w-full print:transform-none! print:mb-0!`}
          >
          <header className="border-b-2 border-[#071524]/20 pb-6 mb-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-[#071524] flex items-center justify-center text-white shrink-0">
                  <Eye className="w-6 h-6 text-[#84F5E8]" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-[#071524] tracking-tight leading-none">
                    NeuroVisión Rehab
                  </h1>
                  <p className="text-xs text-[#44474C] font-medium mt-1">
                    Centro Especializado en Neuro-Oftalmología & Neurorrehabilitación Oculomotora
                  </p>
                </div>
              </div>

              <div className="text-left md:text-right">
                <span className="inline-block bg-[#071524] text-white text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded">
                  Documento Oficial Validado ({selectedVersion})
                </span>
                <div className="text-xs text-[#44474C] font-mono mt-1">ID: REP-2024-884</div>
                <div className="text-xs text-[#44474C]">Emisión: 15 de Noviembre, 2024</div>
                <div className="text-[10px] text-[#74777C] font-mono">HL7 FHIR v4.0.1 / ISO 13485</div>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-[#071524]/10">
              <h2 className="text-center text-base md:text-lg font-bold text-[#071524] uppercase tracking-wide">
                Reporte Clínico de Telerrehabilitación Visual y Telemetría Biométrica
              </h2>
              <p className="text-center text-xs text-[#44474C] mt-0.5">
                Seguimiento Protocolizado de Hemianopsia Homónima y Déficit Campimétrico Oculomotor
              </p>
            </div>
          </header>

          <section className="bg-[#E6F6FF] border border-[#071524]/10 rounded-lg p-5 mb-8 text-xs md:text-sm">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <span className="text-xs font-bold text-[#44474C] uppercase tracking-wider block">
                  Paciente
                </span>
                <span className="font-bold text-[#071524] text-sm md:text-base">{currentPatient.name}</span>
                <div className="text-xs text-[#44474C] mt-0.5">
                  {currentPatient.age} años • Sexo: {currentPatient.gender}
                </div>
                <div className="text-xs text-[#44474C] font-mono">
                  DNI: {currentPatient.nationalId} • HC: {currentPatient.medicalRecordNumber}
                </div>
              </div>

              <div>
                <span className="text-xs font-bold text-[#44474C] uppercase tracking-wider block">
                  Médico Tratante
                </span>
                <span className="font-bold text-[#071524]">
                  {currentPatient.treatingDoctor?.name || 'Dra. Elena Ramos Morales'}
                </span>
                <div className="text-xs text-[#44474C]">CMP: 58492 • RNE: 24190</div>
                <div className="text-xs text-[#44474C]">Neuro-Oftalmología Clínica</div>
              </div>

              <div className="lg:col-span-2">
                <span className="text-xs font-bold text-[#44474C] uppercase tracking-wider block">
                  Diagnóstico Principal
                </span>
                <p className="font-semibold text-[#071524]">
                  {currentPatient.primaryDiagnosisDetail ||
                    `Hemianopsia Homónima ${
                      isLeftHemifield ? 'Izquierda' : 'Derecha'
                    } congruente secuela de ACV Isquémico de arteria cerebral posterior (PCA) derecha.`}
                </p>
                <div className="mt-1 text-xs text-[#44474C]">
                  <span className="font-medium">Protocolo Aplicado:</span> Plan NeuroVisión {selectedVersion}{' '}
                  Inmutable (Fijación Foveal, Exploración Sacádica y Búsqueda Visual Dinámica).
                </div>
              </div>
            </div>
          </section>

          <div className="space-y-8">
            <section>
              <div className="flex items-center gap-2 border-b border-[#071524]/10 pb-2 mb-4">
                <span className="w-6 h-6 rounded-full bg-[#81F3E5] text-[#005049] flex items-center justify-center font-bold text-xs">
                  1
                </span>
                <h3 className="text-base font-bold text-[#071524]">
                  Análisis Topográfico y Mapas de Fijación Ocular
                </h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                <div className="bg-[#C7DDE9]/40 border border-[#071524]/10 rounded-lg p-4 flex flex-col items-center">
                  <div className="text-xs font-semibold text-[#071524] mb-2 self-start flex items-center gap-1.5">
                    <Target className="w-4 h-4 text-[#006A62]" />
                    Campimetría de Escaneo Sacádico (Muestras Oculares Webcam)
                  </div>

                  <div className="relative w-56 h-56 rounded-full border-2 border-[#071524]/20 bg-white flex items-center justify-center overflow-hidden my-2 shadow-inner">
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-full h-px bg-[#071524]/15" />
                    </div>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="h-full w-px bg-[#071524]/15" />
                    </div>
                    <div className="w-40 h-40 rounded-full border border-dashed border-[#071524]/20" />
                    <div className="w-24 h-24 rounded-full border border-dashed border-[#071524]/20" />
                    <div className="w-10 h-10 rounded-full border border-[#071524]/30" />

                    <div
                      className={`absolute top-0 bottom-0 w-1/2 ${
                        isLeftHemifield ? 'left-0 bg-gradient-to-r' : 'right-0 bg-gradient-to-l'
                      } from-[#84F5E8]/50 via-[#81F3E5]/30 to-transparent flex items-center justify-center`}
                    >
                      <span className="text-[9px] font-mono text-[#44474C] font-bold opacity-75 -rotate-90">
                        Hemicampo {isLeftHemifield ? 'Izquierdo' : 'Derecho'} (Déficit)
                      </span>
                    </div>

                    <div className="absolute left-14 top-20 w-8 h-8 rounded-full bg-[#006A62]/40 blur-[3px]" />
                    <div className="absolute left-20 top-24 w-5 h-5 rounded-full bg-[#006A62] blur-[2px]" />
                    <div className="w-3 h-3 rounded-full bg-[#BA1A1A] border border-white shadow-xs z-10" />

                    <svg
                      className="absolute inset-0 w-full h-full pointer-events-none stroke-[#006A62]"
                      fill="none"
                      strokeDasharray="2 2"
                      strokeWidth="1.5"
                    >
                      <path d="M 112 112 L 80 90 L 55 110 L 70 140 L 112 112" />
                    </svg>
                  </div>

                  <div className="flex justify-between w-full text-[11px] text-[#44474C] px-2 mt-1">
                    <span>0° Fóvea Central</span>
                    <span className="text-[#006A62] font-bold">Muestras Oculares Webcam</span>
                  </div>
                </div>

                <div className="space-y-3 text-xs md:text-sm text-[#44474C]">
                  <div className="p-3 bg-[#E6F6FF] rounded border border-[#071524]/10">
                    <span className="font-bold text-[#071524] block">
                      Ampliación de Ventana de Exploración
                    </span>
                    Se constata un desplazamiento compensatorio del vector de rastreo hacia el hemicampo
                    anópsico {isLeftHemifield ? 'izquierdo' : 'derecho'} de +18.4°, superando el reflejo
                    restrictivo inicial post-ictus.
                  </div>
                  <div className="p-3 bg-[#E6F6FF] rounded border border-[#071524]/10">
                    <span className="font-bold text-[#071524] block">
                      Convergencia y Fijación Estable
                    </span>
                    El micro-nistagmo basal ha disminuido significativamente dentro del área de elipse de
                    contorno bivariado (BCEA), con fijación foveal estable mantenida durante estímulos
                    dinámicos.
                  </div>
                  <div className="flex items-center gap-2 text-xs font-mono text-[#44474C]">
                    <CheckCircle2 className="w-4 h-4 text-[#006A62]" />
                    Validación por Sensor Oculomotor Remoto calibrado a 9 puntos (OLS + Glabela).
                  </div>
                </div>
              </div>
            </section>

            <section>
              <div className="flex items-center gap-2 border-b border-[#071524]/10 pb-2 mb-4">
                <span className="w-6 h-6 rounded-full bg-[#81F3E5] text-[#005049] flex items-center justify-center font-bold text-xs">
                  2
                </span>
                <h3 className="text-base font-bold text-[#071524]">
                  Tabla Cuantitativa de Biomarcadores Oculomotores
                </h3>
              </div>

              <div className="overflow-x-auto border border-[#071524]/10 rounded-lg">
                <table className="w-full text-left text-xs md:text-sm">
                  <thead className="bg-[#E6F6FF] text-[#071524] font-bold border-b border-[#071524]/10">
                    <tr>
                      <th className="py-2.5 px-4">Biomarcador Telemetrizado</th>
                      <th className="py-2.5 px-3">Estado Basal</th>
                      <th className="py-2.5 px-3">Estado Actual</th>
                      <th className="py-2.5 px-3">Delta (Δ)</th>
                      <th className="py-2.5 px-4 text-right">Interpretación Clínica</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#071524]/5">
                    <tr className="hover:bg-[#E6F6FF]/50">
                      <td className="py-2.5 px-4 font-semibold text-[#071524]">
                        <span className="inline-flex items-center gap-1.5">
                          Tasa de Omisión en Hemicampo Ciego
                          <ClinicalTermTooltip termId="TRIAL_SUCCESS_OMISSIONS" audience="specialist" iconSize={13} />
                        </span>
                        <span className="block text-[11px] font-normal text-[#44474C]">
                          Estímulos periféricos no detectados
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[#44474C]">48.5%</td>
                      <td className="py-2.5 px-3 font-mono font-bold text-[#006A62]">14.2%</td>
                      <td className="py-2.5 px-3 font-mono font-bold text-[#006A62]">-34.3%</td>
                      <td className="py-2.5 px-4 text-right">
                        <span className="inline-block bg-[#81F3E5]/40 text-[#005049] px-2 py-0.5 rounded text-xs font-bold">
                          Mejora Significativa
                        </span>
                      </td>
                    </tr>
                    <tr className="hover:bg-[#E6F6FF]/50">
                      <td className="py-2.5 px-4 font-semibold text-[#071524]">
                        <span className="inline-flex items-center gap-1.5">
                          Estabilidad de Fijación Foveal
                          <ClinicalTermTooltip termId="BCEA" audience="specialist" iconSize={13} />
                        </span>
                        <span className="block text-[11px] font-normal text-[#44474C]">
                          Área BCEA 68% (grados cuadrados)
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[#44474C]">1.94°²</td>
                      <td className="py-2.5 px-3 font-mono font-bold text-[#071524]">0.78°²</td>
                      <td className="py-2.5 px-3 font-mono font-bold text-[#006A62]">-1.16°²</td>
                      <td className="py-2.5 px-4 text-right">
                        <span className="inline-block bg-[#81F3E5]/40 text-[#005049] px-2 py-0.5 rounded text-xs font-bold">
                          Desviación Óptima (&lt;1.5°)
                        </span>
                      </td>
                    </tr>
                    <tr className="hover:bg-[#E6F6FF]/50">
                      <td className="py-2.5 px-4 font-semibold text-[#071524]">
                        <span className="inline-flex items-center gap-1.5">
                          Latencia Sacádica Hacia Hemicampo Afectado
                          <ClinicalTermTooltip termId="SACCADIC_LATENCY" audience="specialist" iconSize={13} />
                        </span>
                        <span className="block text-[11px] font-normal text-[#44474C]">
                          Tiempo de respuesta a estímulo visual súbito
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[#44474C]">380 ms</td>
                      <td className="py-2.5 px-3 font-mono font-bold text-[#071524]">215 ms</td>
                      <td className="py-2.5 px-3 font-mono font-bold text-[#006A62]">Ganancia 165 ms</td>
                      <td className="py-2.5 px-4 text-right">
                        <span className="inline-block bg-[#81F3E5]/40 text-[#005049] px-2 py-0.5 rounded text-xs font-bold">
                          Compensación Sacádica
                        </span>
                      </td>
                    </tr>
                    <tr className="hover:bg-[#E6F6FF]/50">
                      <td className="py-2.5 px-4 font-semibold text-[#071524]">
                        <span className="inline-flex items-center gap-1.5">
                          Adherencia y Calidad de Muestreo
                          <ClinicalTermTooltip termId="CONFIDENCE_MEAN" audience="specialist" iconSize={13} />
                        </span>
                        <span className="block text-[11px] font-normal text-[#44474C]">
                          Validez continua de muestras oculares webcam
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[#44474C]">--</td>
                      <td className="py-2.5 px-3 font-mono font-bold text-[#071524]">32 sesiones</td>
                      <td className="py-2.5 px-3 font-mono font-bold text-[#071524]">
                        {currentPatient.adherence.rate || 94.6}%
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <span className="inline-block bg-[#D5ECF8] text-[#071524] px-2 py-0.5 rounded text-xs font-bold">
                          Alta Fidelidad Biométrica
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <div className="flex items-center gap-2 border-b border-[#071524]/10 pb-2 mb-4">
                <span className="w-6 h-6 rounded-full bg-[#81F3E5] text-[#005049] flex items-center justify-center font-bold text-xs">
                  3
                </span>
                <h3 className="text-base font-bold text-[#071524]">
                  Conclusiones Cualitativas y Juicio del Médico Tratante
                </h3>
              </div>

              <div className="bg-[#E6F6FF]/70 border-l-4 border-[#006A62] p-4 md:p-5 rounded-r-lg">
                <div className="flex items-start gap-3">
                  <Stethoscope className="w-6 h-6 text-[#006A62] mt-0.5 shrink-0" />
                  <div className="space-y-2 text-xs md:text-sm leading-relaxed text-[#071E27]">
                    <p className="font-medium">
                      &ldquo;El paciente muestra una notable compensación sacádica adaptativa hacia el hemicampo{' '}
                      {isLeftHemifield ? 'izquierdo' : 'derecho'} con ensanchamiento voluntario de la ventana de
                      búsqueda periférica. Se observa reducción drástica del tiempo de latencia foveal y mínima
                      fatiga retiniana.&rdquo;
                    </p>
                    <p className="font-bold text-[#071524]">
                      Dictamen: Se autoriza formalmente el avance al Ciclo II de Estimulación Compleja y se
                      prescribe la continuidad del protocolo ambulatorio de telerrehabilitación durante 6
                      semanas adicionales.
                    </p>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <footer className="mt-12 pt-6 border-t-2 border-[#071524]/10">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
              <div className="space-y-2">
                <div className="border-b border-[#071524]/40 pb-1 w-48">
                  <div className="font-serif italic text-lg text-[#071524] select-none opacity-80 h-9 flex items-end">
                    Elena Ramos M.
                  </div>
                </div>
                <div>
                  <div className="font-bold text-xs md:text-sm text-[#071524]">Dra. Elena Ramos Morales</div>
                  <div className="text-[11px] text-[#44474C]">
                    Especialista en Neuroftalmología Clínica
                  </div>
                  <div className="text-[11px] font-mono text-[#74777C]">CMP: 58492 • RNE: 24190</div>
                  <div className="text-[10px] text-[#006A62] font-semibold mt-0.5">
                    Certificado PKI Activo • Válido
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-center text-center p-2 rounded bg-[#E6F6FF]/50 border border-[#071524]/10">
                <div className="w-20 h-20 bg-white border border-[#071524]/30 p-1 flex items-center justify-center">
                  <div className="w-full h-full grid grid-cols-4 grid-rows-4 gap-0.5 bg-[#071524]/10 p-0.5">
                    <div className="bg-[#071524]" />
                    <div className="bg-[#071524]" />
                    <div className="bg-transparent" />
                    <div className="bg-[#071524]" />
                    <div className="bg-[#071524]" />
                    <div className="bg-transparent" />
                    <div className="bg-[#071524]" />
                    <div className="bg-transparent" />
                    <div className="bg-transparent" />
                    <div className="bg-[#071524]" />
                    <div className="bg-[#071524]" />
                    <div className="bg-[#071524]" />
                    <div className="bg-[#071524]" />
                    <div className="bg-[#071524]" />
                    <div className="bg-transparent" />
                    <div className="bg-[#071524]" />
                  </div>
                </div>
                <span className="text-[9px] font-mono text-[#44474C] mt-1.5 leading-tight">
                  Escanee para verificar autenticidad en:
                  <br />
                  <strong className="text-[#071524]">neurovisionrehab.pe/verify/REP-2024-884</strong>
                </span>
              </div>

              <div className="text-left md:text-right space-y-1 text-[10px] text-[#44474C] font-mono">
                <div>
                  <strong className="text-[#071524]">Timestamp HL7:</strong> 2024-11-15T10:45:00Z
                </div>
                <div>
                  <strong className="text-[#071524]">Seguridad:</strong> TLS 1.3 / Encriptado en Reposo
                </div>
                <div className="break-all">
                  <strong className="text-[#071524]">SHA-256 Hash:</strong>{' '}
                  e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
                </div>
                  <div className="text-[9px] text-[#74777C] pt-1">
                    Hoja {currentPage} de 2 • NeuroVisión Rehab Clinical Engine v4.8
                  </div>
                </div>
              </div>
            </footer>
          </article>
        </div>
      </main>

      {/* FLOATING ACTIONS BAR */}
      <aside className="print:hidden sticky bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-[#071524]/10 py-3 px-4 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
        <div className="max-w-[1536px] mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="hidden sm:flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#E6F6FF] flex items-center justify-center text-[#071524]">
              <FileText className="w-5 h-5 text-[#006A62]" />
            </div>
            <div>
              <div className="text-xs font-bold text-[#071524]">
                REP-2024-884_{currentPatient.name.replace(/\s+/g, '_')}.pdf
              </div>
              <div className="text-[11px] text-[#44474C]">
                PDF/A-1b Clínico Certificado • 1.4 MB con firma digital
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto justify-end">
            <button
              onClick={handleCopyLink}
              className="px-3 py-2 rounded-lg border-2 border-[#071524]/20 hover:bg-[#D5ECF8] text-[#071524] font-semibold text-xs md:text-sm flex items-center gap-1.5 transition-all cursor-pointer"
              title="Copiar enlace seguro"
            >
              <Link2 className="w-4 h-4" />
              <span className="hidden md:inline">Copiar Enlace</span>
            </button>

            <button
              onClick={handleExportFHIR}
              className="px-3 py-2 rounded-lg border-2 border-[#071524]/20 hover:bg-[#D5ECF8] text-[#071524] font-semibold text-xs md:text-sm flex items-center gap-1.5 transition-all cursor-pointer"
              title="Exportar estructura HL7 FHIR en formato JSON"
            >
              <Code2 className="w-4 h-4" />
              <span className="hidden lg:inline">Exportar</span> FHIR JSON
            </button>

            <button
              onClick={() => window.print()}
              className="px-3 py-2 rounded-lg border-2 border-[#071524] text-[#071524] hover:bg-[#D5ECF8] font-semibold text-xs md:text-sm flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>Imprimir</span>
            </button>

            <button
              onClick={handleSendEmail}
              className="px-4 py-2 rounded-lg bg-[#D5ECF8] hover:bg-[#CFE6F2] text-[#071524] font-semibold text-xs md:text-sm flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Mail className="w-4 h-4" />
              <span>Enviar a Paciente</span>
            </button>

            <button
              onClick={handleDownloadPDF}
              className="min-h-[42px] px-5 py-2 rounded-lg bg-[#006A62] text-white hover:bg-[#005049] text-xs md:text-sm font-bold shadow-md hover:shadow-lg flex items-center gap-2 transition-all active:scale-95 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Descargar PDF Certificado</span>
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
};
