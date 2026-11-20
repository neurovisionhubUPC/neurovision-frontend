import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  X,
  Activity,
  CheckCircle2,
  Eye,
  ExternalLink,
  FileText,
  Loader2,
  AlertTriangle,
  Grid3X3,
  Target,
} from 'lucide-react';
import type { SessionRecord } from '../../../../core/domain/Patient';
import { useAppStore } from '../../../../core/store/useAppStore';
import {
  analyticsApi,
  ApiError,
  clinicalApi,
  extractApiErrorMessage,
  modeToAnalyticsSlug,
  type AnyTrialSummary,
} from '../../../../infrastructure/api';
import type {
  AnalyticsHeatmapResponse,
  AnalyticsStreamsResponse,
  AnalyticsSummaryResponse,
  DoctorTherapySessionDetailResponse,
  ReportMode,
} from '../../../../infrastructure/api';

interface SessionAnalyticsModalProps {
  session: SessionRecord | null;
  isOpen: boolean;
  onClose: () => void;
  patientId?: string;
  therapySessionId?: string;
}

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

function heatCellColor(ratio: number): string {
  if (ratio <= 0) return '#F3FAFF';
  if (ratio < 0.25) return '#CFFAFE';
  if (ratio < 0.5) return '#81F3E5';
  if (ratio < 0.75) return '#00897B';
  return '#071524';
}

export const SessionAnalyticsModal: React.FC<SessionAnalyticsModalProps> = ({
  session,
  isOpen,
  onClose,
  patientId: propPatientId,
  therapySessionId: propTherapySessionId,
}) => {
  const authMode = useAppStore((state) => state.authMode);
  const accessToken = useAppStore((state) => state.accessToken);
  const isCognito = authMode === 'COGNITO' && Boolean(accessToken);

  const { patientId: routePatientId } = useParams<{ patientId?: string }>();
  const navigate = useNavigate();

  const resolvedPatientId = propPatientId ?? routePatientId;
  const resolvedSessionId = propTherapySessionId ?? session?.id;
  const shouldFetchReal =
    isOpen && isCognito && Boolean(resolvedSessionId) && !resolvedSessionId?.startsWith('#SES-');

  const [loadingOverview, setLoadingOverview] = useState(false);
  const [loadingStream, setLoadingStream] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);

  const [sessionDetail, setSessionDetail] = useState<DoctorTherapySessionDetailResponse | null>(null);
  const [streams, setStreams] = useState<AnalyticsStreamsResponse['items']>([]);
  const [selectedStreamId, setSelectedStreamId] = useState<string>('');
  const [streamSummary, setStreamSummary] = useState<AnalyticsSummaryResponse | null>(null);
  const [streamHeatmap, setStreamHeatmap] = useState<AnalyticsHeatmapResponse | null>(null);
  const [trialSummary, setTrialSummary] = useState<AnyTrialSummary | null>(null);
  const [trialDataOrigin, setTrialDataOrigin] = useState<'PRODUCER_REPORTED' | 'SYNTHETIC'>(
    'PRODUCER_REPORTED'
  );
  const [trialNotice, setTrialNotice] = useState<string | null>(null);
  const [trialError, setTrialError] = useState<string | null>(null);
  const [loadingTrialSummary, setLoadingTrialSummary] = useState(false);

  useEffect(() => {
    if (!shouldFetchReal || !resolvedSessionId) {
      return;
    }

    let cancelled = false;
    setLoadingOverview(true);
    setOverviewError(null);
    setStreamError(null);
    setSessionDetail(null);
    setStreams([]);
    setSelectedStreamId('');
    setStreamSummary(null);
    setStreamHeatmap(null);
    setTrialSummary(null);
    setTrialNotice(null);
    setTrialError(null);

    const loadOverview = async () => {
      try {
        const [detailOutcome, streamsOutcome] = await Promise.allSettled([
          resolvedPatientId
            ? clinicalApi.getDoctorTherapySessionDetail(resolvedPatientId, resolvedSessionId)
            : Promise.resolve(null),
          analyticsApi.listSessionStreams(resolvedSessionId, { page: 0, size: 20 }),
        ]);

        if (cancelled) return;

        if (detailOutcome.status === 'fulfilled') {
          setSessionDetail(detailOutcome.value);
        } else {
          setOverviewError(extractApiErrorMessage(detailOutcome.reason));
        }

        if (streamsOutcome.status === 'fulfilled') {
          const items = streamsOutcome.value.items;
          setStreams(items);
          if (items.length > 0) {
            setSelectedStreamId(items[0].streamId);
          }
        } else if (
          !(streamsOutcome.reason instanceof ApiError && streamsOutcome.reason.status === 404)
        ) {
          setStreamError(
            `Error del servicio Analytics (8085): ${extractApiErrorMessage(streamsOutcome.reason)}`
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingOverview(false);
        }
      }
    };

    void loadOverview();

    return () => {
      cancelled = true;
    };
  }, [shouldFetchReal, resolvedPatientId, resolvedSessionId]);

  useEffect(() => {
    if (!shouldFetchReal || !resolvedSessionId || !sessionDetail) {
      return;
    }

    let cancelled = false;
    setLoadingTrialSummary(true);
    setTrialSummary(null);
    setTrialNotice(null);
    setTrialError(null);

    const mode = extractModeFromDetail(sessionDetail);
    const slug = modeToAnalyticsSlug(mode);

    analyticsApi
      .getTrialSummary(resolvedSessionId, slug, trialDataOrigin)
      .then((trial) => {
        if (!cancelled) {
          setTrialSummary(trial);
        }
      })
      .catch((trialErr) => {
        if (cancelled) return;
        if (trialErr instanceof ApiError && trialErr.status === 404) {
          setTrialNotice(
            `Sin resultados de ensayos (${trialDataOrigin}) para esta sesión.`
          );
        } else {
          setTrialError(
            `Error consultando ensayos en Analytics (8085): ${extractApiErrorMessage(trialErr)}`
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingTrialSummary(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [shouldFetchReal, resolvedSessionId, sessionDetail, trialDataOrigin]);

  useEffect(() => {
    if (!shouldFetchReal || !resolvedSessionId || !selectedStreamId) {
      return;
    }

    let cancelled = false;
    setLoadingStream(true);
    setStreamError(null);
    setStreamSummary(null);
    setStreamHeatmap(null);

    const loadStreamData = async () => {
      try {
        const [summaryOutcome, heatmapOutcome] = await Promise.allSettled([
          analyticsApi.getStreamSummary(resolvedSessionId, selectedStreamId),
          analyticsApi.getStreamHeatmap(resolvedSessionId, selectedStreamId),
        ]);

        if (cancelled) return;

        if (summaryOutcome.status === 'fulfilled') {
          setStreamSummary(summaryOutcome.value);
        } else {
          setStreamError(extractApiErrorMessage(summaryOutcome.reason));
        }

        if (heatmapOutcome.status === 'fulfilled') {
          setStreamHeatmap(heatmapOutcome.value);
        }
      } finally {
        if (!cancelled) {
          setLoadingStream(false);
        }
      }
    };

    void loadStreamData();

    return () => {
      cancelled = true;
    };
  }, [shouldFetchReal, resolvedSessionId, selectedStreamId]);

  if (!isOpen || (!session && !propTherapySessionId)) return null;

  // === COGNITO REAL ANALYTICS MODAL ===
  if (shouldFetchReal && resolvedSessionId) {
    const mode = sessionDetail ? extractModeFromDetail(sessionDetail) : undefined;
    const maxHeatmapCount = streamHeatmap
      ? Math.max(1, ...streamHeatmap.cellCounts)
      : 1;

    const handleNavigateToAudit = () => {
      onClose();
      if (resolvedPatientId) {
        navigate(
          `/specialist/patients/${encodeURIComponent(resolvedPatientId)}/auditoria?sessionId=${encodeURIComponent(resolvedSessionId)}`
        );
      }
    };

    const handleNavigateToReport = () => {
      onClose();
      if (resolvedPatientId) {
        navigate(
          `/specialist/patients/${encodeURIComponent(resolvedPatientId)}/reporte-pdf?sessionId=${encodeURIComponent(resolvedSessionId)}`
        );
      }
    };

    return (
      <div className="fixed inset-0 z-50 bg-[#071524]/60 backdrop-blur-xs flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl max-w-3xl w-full shadow-2xl border border-[#071524]/10 overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-200">
          {/* Header */}
          <div className="bg-[#1C2A39] text-white p-5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-[#26A69A]/20 text-[#84F5E8] flex items-center justify-center border border-[#84F5E8]/30 shrink-0">
                <Activity className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-base sm:text-lg text-white truncate">
                  Analítica de Telemetría Ocular (8085)
                </h3>
                <p className="text-xs text-[#84F5E8]/85 font-mono truncate">
                  Sesión: {resolvedSessionId}
                  {mode ? ` · ${MODE_LABELS[mode]}` : ''}
                  {sessionDetail ? ` · ${sessionDetail.status}` : ''}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
              aria-label="Cerrar modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-5 sm:p-6 overflow-y-auto space-y-5 text-xs text-[#071E27]">
            {loadingOverview && (
              <div className="flex items-center gap-2 p-4 rounded-xl bg-[#E6F6FF] text-[#071524] font-semibold">
                <Loader2 className="w-4 h-4 animate-spin text-[#006A62]" />
                <span>Cargando detalle de sesión, streams y resumen de ensayos...</span>
              </div>
            )}

            {overviewError && (
              <div className="p-3.5 rounded-xl bg-[#FFDAD6] border border-[#BA1A1A]/30 text-[#93000A] flex items-center gap-2 font-semibold">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Detalle clínico no disponible: {overviewError}</span>
              </div>
            )}

            {/* Stream Selector */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-[#F3FAFF] border border-[#071524]/10">
              <div>
                <span className="font-bold text-[#071524] block">Stream de Telemetría Activo</span>
                <span className="text-[11px] text-[#44474C]">
                  {streams.length > 0
                    ? `${streams.length} stream(s) disponibles en Analytics`
                    : loadingOverview
                    ? 'Consultando streams...'
                    : 'Sin streams de analítica registrados para esta sesión'}
                </span>
              </div>
              {streams.length > 0 && (
                <select
                  value={selectedStreamId}
                  onChange={(e) => setSelectedStreamId(e.target.value)}
                  className="bg-white border border-[#071524]/15 rounded-lg px-3 py-1.5 text-xs font-mono font-semibold text-[#071524] focus:outline-none focus:ring-2 focus:ring-[#006A62]"
                >
                  {streams.map((st) => (
                    <option key={st.streamId} value={st.streamId}>
                      {st.streamId} ({st.sampleCounts.total} muestras · rev {st.revision})
                    </option>
                  ))}
                </select>
              )}
            </div>

            {streamError && (
              <div className="p-3 rounded-xl bg-[#FFF7ED] border border-[#FDBA74] text-[#9A3412] flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{streamError}</span>
              </div>
            )}

            {/* Summary KPI Chips */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 bg-[#E6F6FF] rounded-xl border border-[#071524]/10 text-center">
                <span className="text-[#44474C] font-semibold block text-[11px]">Duración Activa</span>
                <strong className="text-base text-[#071524]">
                  {sessionDetail
                    ? `${Math.floor(sessionDetail.activeDurationSeconds / 60)}m ${
                        sessionDetail.activeDurationSeconds % 60
                      }s`
                    : session
                    ? `${session.durationMinutes} min`
                    : '—'}
                </strong>
              </div>

              <div className="p-3 bg-[#E6F6FF] rounded-xl border border-[#071524]/10 text-center">
                <span className="text-[#44474C] font-semibold block text-[11px]">
                  Muestras (Gaze / Total)
                </span>
                <strong className="text-base text-[#006A62]">
                  {streamSummary
                    ? `${streamSummary.completeness.sampleCounts.gaze} / ${streamSummary.completeness.sampleCounts.total}`
                    : '—'}
                </strong>
              </div>

              <div className="p-3 bg-[#E6F6FF] rounded-xl border border-[#071524]/10 text-center">
                <span className="text-[#44474C] font-semibold block text-[11px]">Confianza Media</span>
                <strong className="text-base text-[#071524]">
                  {streamSummary?.metrics.confidence.mean !== null &&
                  streamSummary?.metrics.confidence.mean !== undefined
                    ? `${(streamSummary.metrics.confidence.mean * 100).toFixed(1)}%`
                    : '—'}
                </strong>
              </div>

              <div className="p-3 bg-[#E6F6FF] rounded-xl border border-[#071524]/10 text-center">
                <span className="text-[#44474C] font-semibold block text-[11px]">Cobertura Espacial</span>
                <strong className="text-base text-[#071524]">
                  {streamSummary
                    ? `${(streamSummary.metrics.coverage.occupiedCellRatio * 100).toFixed(1)}%`
                    : '—'}
                </strong>
              </div>
            </div>

            {streamSummary && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
                <div className="p-2.5 rounded-lg bg-white border border-[#071524]/10">
                  <span className="text-[#44474C] block">Distancia Gaze Path</span>
                  <strong className="text-[#071524] font-mono">
                    {streamSummary.metrics.gazePath.totalDistance.toFixed(3)} u
                  </strong>
                </div>
                <div className="p-2.5 rounded-lg bg-white border border-[#071524]/10">
                  <span className="text-[#44474C] block">Rangos Faltantes / Tardíos</span>
                  <strong className="text-[#071524] font-mono">
                    {streamSummary.completeness.missingSequenceRangeCount} /{' '}
                    {streamSummary.completeness.lateArrivalCount}
                  </strong>
                </div>
                <div className="p-2.5 rounded-lg bg-white border border-[#071524]/10">
                  <span className="text-[#44474C] block">Dist. Media Jugador-Objetivo</span>
                  <strong className="text-[#071524] font-mono">
                    {streamSummary.metrics.gameplay.playerTargetDistance.mean !== null
                      ? streamSummary.metrics.gameplay.playerTargetDistance.mean.toFixed(3)
                      : 'N/D'}
                  </strong>
                </div>
                <div className="p-2.5 rounded-lg bg-white border border-[#071524]/10">
                  <span className="text-[#44474C] block">Progreso / Score Final</span>
                  <strong className="text-[#071524] font-mono">
                    {streamSummary.metrics.gameplay.progress.last ?? '—'} /{' '}
                    {streamSummary.metrics.gameplay.score.last ?? '—'}
                  </strong>
                </div>
              </div>
            )}

            {/* Mini Heatmap Matrix */}
            <div className="p-4 rounded-xl bg-[#F3FAFF] border border-[#071524]/10 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-bold text-sm text-[#071524] flex items-center gap-2">
                  <Grid3X3 className="w-4 h-4 text-[#006A62]" />
                  Matriz de Calor de Fijación Ocular
                </h4>
                {streamHeatmap && (
                  <span className="text-[11px] font-mono text-[#44474C]">
                    {streamHeatmap.columns}×{streamHeatmap.rows} · {streamHeatmap.gazeSampleCount} muestras ·{' '}
                    {streamHeatmap.coordinateSpace}
                  </span>
                )}
              </div>

              {loadingStream ? (
                <div className="h-40 bg-white rounded-lg border border-[#071524]/10 flex items-center justify-center text-[#44474C] gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-[#006A62]" />
                  <span>Calculando matriz heatmap...</span>
                </div>
              ) : streamHeatmap && streamHeatmap.columns > 0 && streamHeatmap.rows > 0 ? (
                <div className="bg-white rounded-lg border border-[#071524]/10 p-3 space-y-2">
                  <div
                    className="grid gap-0.5 w-full aspect-[16/9] max-h-52 mx-auto"
                    style={{
                      gridTemplateColumns: `repeat(${streamHeatmap.columns}, minmax(0, 1fr))`,
                      gridTemplateRows: `repeat(${streamHeatmap.rows}, minmax(0, 1fr))`,
                    }}
                  >
                    {streamHeatmap.cellCounts.map((count, idx) => {
                      const col = idx % streamHeatmap.columns;
                      const row = Math.floor(idx / streamHeatmap.columns);
                      const ratio = count / maxHeatmapCount;
                      return (
                        <div
                          key={`${row}-${col}`}
                          title={`Celda (${col}, ${row}): ${count} muestras`}
                          className="rounded-[2px] border border-[#071524]/5 transition-transform hover:scale-105"
                          style={{ backgroundColor: heatCellColor(ratio) }}
                        />
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-[#44474C] font-mono">
                    <span>0 muestras</span>
                    <div className="flex items-center gap-1">
                      <span className="w-3 h-2 rounded-xs bg-[#F3FAFF] border border-[#071524]/10" />
                      <span className="w-3 h-2 rounded-xs bg-[#CFFAFE]" />
                      <span className="w-3 h-2 rounded-xs bg-[#81F3E5]" />
                      <span className="w-3 h-2 rounded-xs bg-[#00897B]" />
                      <span className="w-3 h-2 rounded-xs bg-[#071524]" />
                    </div>
                    <span>Pico: {maxHeatmapCount} muestras</span>
                  </div>
                </div>
              ) : (
                <div className="h-32 bg-white rounded-lg border border-[#071524]/10 flex items-center justify-center text-[#74777C]">
                  No hay matriz de heatmap disponible para el stream seleccionado.
                </div>
              )}
            </div>

            {/* Trial Summary */}
            <div className="p-4 rounded-xl bg-white border border-[#071524]/10 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-bold text-xs text-[#071524] flex items-center gap-1.5">
                  <Target className="w-4 h-4 text-[#006A62]" />
                  Resumen de Ensayos Clínicos ({trialDataOrigin})
                </h4>
                <div className="flex items-center gap-2">
                  <select
                    value={trialDataOrigin}
                    onChange={(e) =>
                      setTrialDataOrigin(e.target.value as 'PRODUCER_REPORTED' | 'SYNTHETIC')
                    }
                    aria-label="Origen de datos de ensayos clínicos"
                    className="bg-[#F3FAFF] border border-[#071524]/15 rounded-lg px-2 py-1 text-[11px] font-semibold text-[#071524] focus:outline-none focus:ring-2 focus:ring-[#006A62] cursor-pointer"
                  >
                    <option value="PRODUCER_REPORTED">PRODUCER_REPORTED (Mirada Webcam)</option>
                    <option value="SYNTHETIC">SYNTHETIC (Contingencia Ratón / Simulación)</option>
                  </select>
                  {loadingTrialSummary && (
                    <span className="text-[11px] text-[#006A62]">Consultando...</span>
                  )}
                </div>
              </div>

              {trialError ? (
                <div className="bg-[#FFDAD6] border border-[#BA1A1A]/30 rounded-lg p-2.5 text-xs text-[#93000A] font-semibold">
                  {trialError}
                </div>
              ) : trialSummary ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] pt-1">
                  <div className="p-2 rounded bg-[#F3FAFF]">
                    <span className="text-[#44474C] block">Ensayos Reportados</span>
                    <strong className="text-[#071524]">{trialSummary.reportedTrialCount}</strong>
                  </div>
                  {'hitCount' in trialSummary && (
                    <>
                      <div className="p-2 rounded bg-[#F3FAFF]">
                        <span className="text-[#44474C] block">Aciertos / Omisiones</span>
                        <strong className="text-[#006A62]">
                          {trialSummary.hitCount} / {trialSummary.omissionCount}
                        </strong>
                      </div>
                      <div className="p-2 rounded bg-[#F3FAFF]">
                        <span className="text-[#44474C] block">Búsquedas Elegibles</span>
                        <strong className="text-[#071524]">{trialSummary.eligibleSearchCount}</strong>
                      </div>
                      <div className="p-2 rounded bg-[#F3FAFF]">
                        <span className="text-[#44474C] block">Mediana Búsqueda</span>
                        <strong className="text-[#071524]">
                          {trialSummary.medianSearchDurationMs !== null
                            ? `${Math.round(trialSummary.medianSearchDurationMs)} ms`
                            : 'N/D'}
                        </strong>
                      </div>
                    </>
                  )}
                  {'detectedTargetCount' in trialSummary && (
                    <>
                      <div className="p-2 rounded bg-[#F3FAFF]">
                        <span className="text-[#44474C] block">Detectados / Omisiones</span>
                        <strong className="text-[#006A62]">
                          {trialSummary.detectedTargetCount} / {trialSummary.omissionCount}
                        </strong>
                      </div>
                      <div className="p-2 rounded bg-[#F3FAFF]">
                        <span className="text-[#44474C] block">Localizaciones Elegibles</span>
                        <strong className="text-[#071524]">
                          {trialSummary.eligibleLocalizationCount}
                        </strong>
                      </div>
                      <div className="p-2 rounded bg-[#F3FAFF]">
                        <span className="text-[#44474C] block">Mediana Localización</span>
                        <strong className="text-[#071524]">
                          {trialSummary.medianLocalizationDurationMs !== null
                            ? `${Math.round(trialSummary.medianLocalizationDurationMs)} ms`
                            : 'N/D'}
                        </strong>
                      </div>
                    </>
                  )}
                  {'totalInsideTargetMs' in trialSummary && (
                    <>
                      <div className="p-2 rounded bg-[#F3FAFF]">
                        <span className="text-[#44474C] block">Tiempo en Objetivo</span>
                        <strong className="text-[#006A62]">
                          {(trialSummary.totalInsideTargetMs / 1000).toFixed(1)} s
                        </strong>
                      </div>
                      <div className="p-2 rounded bg-[#F3FAFF]">
                        <span className="text-[#44474C] block">Objetivos Completados</span>
                        <strong className="text-[#071524]">{trialSummary.completedTargetCount}</strong>
                      </div>
                    </>
                  )}
                  {'reachedTargetCount' in trialSummary && (
                    <>
                      <div className="p-2 rounded bg-[#F3FAFF]">
                        <span className="text-[#44474C] block">Objetivos Alcanzados</span>
                        <strong className="text-[#006A62]">{trialSummary.reachedTargetCount}</strong>
                      </div>
                      <div className="p-2 rounded bg-[#F3FAFF]">
                        <span className="text-[#44474C] block">Mediana Tiempo al Objetivo</span>
                        <strong className="text-[#071524]">
                          {trialSummary.medianTimeToTargetMs !== null
                            ? `${Math.round(trialSummary.medianTimeToTargetMs)} ms`
                            : 'N/D'}
                        </strong>
                      </div>
                    </>
                  )}
                  {'traversals' in trialSummary && (
                    <div className="p-2 rounded bg-[#F3FAFF] col-span-2 sm:col-span-3">
                      <span className="text-[#44474C] block">Recorridos Sistemáticos</span>
                      <strong className="text-[#071524]">
                        {trialSummary.traversals.length} recorrido(s) registrado(s)
                      </strong>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-[#44474C]">
                  {trialNotice || 'Consultando resultados de ensayos...'}
                </p>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="bg-[#E6F6FF] px-6 py-3 border-t border-[#071524]/10 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs text-[#006A62] font-semibold">
              <CheckCircle2 className="w-4 h-4" />
              <span>Telemetría Analytics 8085 · Clinical 8083</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {resolvedPatientId && (
                <>
                  <button
                    type="button"
                    onClick={handleNavigateToReport}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#071524]/20 bg-white hover:bg-[#DBF1FE] text-[#071524] font-bold transition-colors cursor-pointer text-xs"
                  >
                    <FileText className="w-3.5 h-3.5 text-[#006A62]" />
                    Reporte PDF
                  </button>
                  <button
                    type="button"
                    onClick={handleNavigateToAudit}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#006A62] hover:bg-[#005049] text-white font-bold transition-colors cursor-pointer text-xs"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Abrir Auditoría Completa
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-[#071524] text-white font-bold hover:bg-[#1C2A39] transition-colors cursor-pointer text-xs"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // === MOCK MODE MODAL (PRESERVED) ===
  if (!session) return null;

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
              {session.notes ||
                'Sesión ejecutada conforme al protocolo médico. Sin pérdida de calibración facial ni movimientos de cabeza descompensatorios.'}
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
