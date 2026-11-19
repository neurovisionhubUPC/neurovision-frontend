import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Eye,
  Activity,
  Award,
  ShieldAlert,
  Edit3,
  RefreshCw,
  Crosshair,
  Layers,
  Compass,
  AlertCircle,
  CheckCircle2,
  Sliders,
  ChevronRight,
  TrendingUp,
} from 'lucide-react';
import type { Patient } from '../../../../core/domain/Patient';
import { useAppStore } from '../../../../core/store/useAppStore';
import {
  analyticsApi,
  clinicalApi,
  extractApiErrorMessage,
  modeToAnalyticsSlug,
  type AnyTrialSummary,
} from '../../../../infrastructure/api';
import type {
  AnalyticsGazePlotResponse,
  AnalyticsHeatmapResponse,
  AnalyticsSummaryResponse,
  DoctorTherapySessionDetailResponse,
  RehabilitationContextResponse,
  ReportMode,
} from '../../../../infrastructure/api';

export type PatientRecord = Patient;

export interface CampimetryTabProps {
  patient?: PatientRecord;
  rehabilitationContext?: RehabilitationContextResponse | null;
  patientId?: string;
  latestSessionId?: string | null;
  latestStreamId?: string | null;
  onEditContext?: () => void;
  onOpenAudit?: () => void;
}

export type CampimetryViewMode = 'goldmann_60' | 'fixation_30' | 'heatmap_120';

interface StreamItem {
  streamId: string;
  calculationVersion: string;
  revision: number;
  sampleCounts: { gaze: number; gameplay: number; total: number };
}

function extractModeFromSessionDetail(detail: DoctorTherapySessionDetailResponse): ReportMode {
  if (detail.parameterSchemaVersion === 2) {
    return detail.configurationParameters.parameters.mode;
  }
  return detail.configurationParameters.mode;
}

export const CampimetryTab: React.FC<CampimetryTabProps> = ({
  patient,
  rehabilitationContext,
  patientId,
  latestSessionId,
  latestStreamId,
  onEditContext,
  onOpenAudit,
}) => {
  const { authMode, accessToken } = useAppStore();
  const isCognitoMode = authMode === 'COGNITO' && Boolean(accessToken);

  // Selector de Modo Visual
  const [viewMode, setViewMode] = useState<CampimetryViewMode>('goldmann_60');

  // Estado de streams y telemetría 120Hz
  const [streams, setStreams] = useState<StreamItem[]>([]);
  const [selectedStreamId, setSelectedStreamId] = useState<string | null>(latestStreamId || null);
  const [streamSummary, setStreamSummary] = useState<AnalyticsSummaryResponse | null>(null);
  const [streamHeatmap, setStreamHeatmap] = useState<AnalyticsHeatmapResponse | null>(null);
  const [streamGazePlot, setStreamGazePlot] = useState<AnalyticsGazePlotResponse | null>(null);
  const [trialSummary, setTrialSummary] = useState<AnyTrialSummary | null>(null);
  const [resolvedMode, setResolvedMode] = useState<ReportMode | null>(null);
  const [isLoadingTelemetry, setIsLoadingTelemetry] = useState(false);
  const [telemetryNotice, setTelemetryNotice] = useState<string | null>(null);

  // Identificador de sesión y paciente efectivos
  const effectiveSessionId = latestSessionId || patient?.sessionHistory?.[0]?.id || null;
  const effectivePatientId = patientId || patient?.id || null;

  // Carga paralela de streams y métricas de analítica 120Hz
  const loadAnalyticsData = useCallback(async () => {
    if (!isCognitoMode || !effectiveSessionId) {
      setStreams([]);
      setSelectedStreamId(null);
      setStreamSummary(null);
      setStreamHeatmap(null);
      setStreamGazePlot(null);
      setTrialSummary(null);
      setResolvedMode(null);
      return;
    }

    setIsLoadingTelemetry(true);
    setTelemetryNotice(null);

    try {
      // 1. Consultar lista de streams y detalle de sesión en paralelo para resolver el modo real
      const [streamsOutcome, detailOutcome] = await Promise.allSettled([
        analyticsApi.listSessionStreams(effectiveSessionId, { page: 0, size: 20 }),
        effectivePatientId
          ? clinicalApi.getDoctorTherapySessionDetail(effectivePatientId, effectiveSessionId)
          : Promise.resolve(null),
      ]);

      const streamItems =
        streamsOutcome.status === 'fulfilled' ? streamsOutcome.value.items || [] : [];
      setStreams(streamItems);

      let modeForTrials: ReportMode | null = null;
      if (detailOutcome.status === 'fulfilled' && detailOutcome.value) {
        modeForTrials = extractModeFromSessionDetail(detailOutcome.value);
      }
      setResolvedMode(modeForTrials);
      const trialSlug = modeForTrials ? modeToAnalyticsSlug(modeForTrials) : 'standard-scanning';

      const streamToQuery =
        selectedStreamId && streamItems.some((s) => s.streamId === selectedStreamId)
          ? selectedStreamId
          : streamItems[0]?.streamId || null;

      setSelectedStreamId(streamToQuery);

      if (streamToQuery) {
        // 2. Consultar en paralelo summary, heatmap, gaze-plot y trial-summary (PRODUCER_REPORTED)
        const [summaryOutcome, heatmapOutcome, gazePlotOutcome, trialOutcome] =
          await Promise.allSettled([
            analyticsApi.getStreamSummary(effectiveSessionId, streamToQuery),
            analyticsApi.getStreamHeatmap(effectiveSessionId, streamToQuery),
            analyticsApi.getStreamGazePlot(effectiveSessionId, streamToQuery, { pageSize: 200 }),
            analyticsApi.getTrialSummary(
              effectiveSessionId,
              trialSlug,
              'PRODUCER_REPORTED'
            ),
          ]);

        if (summaryOutcome.status === 'fulfilled') {
          setStreamSummary(summaryOutcome.value);
        } else {
          setStreamSummary(null);
        }

        if (heatmapOutcome.status === 'fulfilled') {
          setStreamHeatmap(heatmapOutcome.value);
        } else {
          setStreamHeatmap(null);
        }

        if (gazePlotOutcome.status === 'fulfilled') {
          setStreamGazePlot(gazePlotOutcome.value);
        } else {
          setStreamGazePlot(null);
        }

        if (trialOutcome.status === 'fulfilled') {
          setTrialSummary(trialOutcome.value);
        } else {
          setTrialSummary(null);
        }
      } else {
        setStreamSummary(null);
        setStreamHeatmap(null);
        setStreamGazePlot(null);
        try {
          const trialRes = await analyticsApi.getTrialSummary(
            effectiveSessionId,
            trialSlug,
            'PRODUCER_REPORTED'
          );
          setTrialSummary(trialRes);
        } catch {
          setTrialSummary(null);
        }
        setTelemetryNotice('La sesión seleccionada no cuenta con streams de telemetría 120Hz asociados en Analytics (8085).');
      }
    } catch (err) {
      setTelemetryNotice(extractApiErrorMessage(err));
      setStreamSummary(null);
      setStreamHeatmap(null);
      setStreamGazePlot(null);
      setTrialSummary(null);
    } finally {
      setIsLoadingTelemetry(false);
    }
  }, [isCognitoMode, effectiveSessionId, effectivePatientId, selectedStreamId]);

  useEffect(() => {
    void loadAnalyticsData();
  }, [loadAnalyticsData]);

  // Manejo de cambio de stream
  const handleSelectStream = (streamId: string) => {
    setSelectedStreamId(streamId);
  };

  // Interpretación clínica del contexto y hemisferio/cuadrante deficitario
  const rawCtx = rehabilitationContext as unknown as {
    diagnosis?: string;
    lesionSide?: string;
    affectedVisualField?: string;
    visualAcuityLeft?: string;
    visualAcuityRight?: string;
    dominantEye?: string;
  } | null;

  const diagnosis = isCognitoMode
    ? rehabilitationContext?.previousDiagnosis ||
      patient?.primaryDiagnosisTitle ||
      'No consignado en contexto clínico (8083)'
    : rawCtx?.diagnosis ||
      rehabilitationContext?.previousDiagnosis ||
      patient?.primaryDiagnosisTitle ||
      'Defecto campimétrico post-ACV isquémico';

  const lesionSide = isCognitoMode
    ? rehabilitationContext?.affectedHemifield || patient?.affectedHemifield || 'LEFT'
    : rawCtx?.lesionSide ||
      rehabilitationContext?.affectedHemifield ||
      patient?.affectedHemifield ||
      'LEFT';

  const isLeftDeficit =
    String(lesionSide).toUpperCase().includes('LEFT') ||
    String(lesionSide).toUpperCase() === 'IZQUIERDA';

  const affectedFieldLabel = isCognitoMode
    ? rehabilitationContext?.affectedHemifield
      ? isLeftDeficit
        ? 'Hemicampo Izquierdo (affectedHemifield: LEFT)'
        : 'Hemicampo Derecho (affectedHemifield: RIGHT)'
      : 'No consignado en contexto clínico (8083)'
    : rawCtx?.affectedVisualField ||
      (isLeftDeficit
        ? 'Hemicampo Izquierdo (Hemianopsia Homónima)'
        : 'Hemicampo Derecho (Hemianopsia Homónima)');

  const visualAcuityLeft = isCognitoMode
    ? 'No consignado en contexto clínico'
    : rawCtx?.visualAcuityLeft || '20/25 (OS)';
  const visualAcuityRight = isCognitoMode
    ? 'No consignado en contexto clínico'
    : rawCtx?.visualAcuityRight || '20/20 (OD)';
  const dominantEye = isCognitoMode
    ? 'No consignado en contexto clínico'
    : rawCtx?.dominantEye || 'OD (Ojo Derecho)';

  // Distribución porcentual Hemicampo Izquierdo vs Derecho
  const hemifieldDistribution = useMemo(() => {
    let leftCount = 0;
    let rightCount = 0;
    let isFromTelemetry = false;

    if (streamHeatmap && streamHeatmap.columns > 0 && streamHeatmap.cellCounts?.length > 0) {
      const { rows, columns, cellCounts } = streamHeatmap;
      const midCol = Math.floor(columns / 2);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < columns; c++) {
          const count = cellCounts[r * columns + c] || 0;
          if (c < midCol) {
            leftCount += count;
          } else {
            rightCount += count;
          }
        }
      }
      if (leftCount + rightCount > 0) isFromTelemetry = true;
    } else if (streamGazePlot && streamGazePlot.points?.length > 0) {
      for (const pt of streamGazePlot.points) {
        if (pt.x < 0.5) leftCount++;
        else rightCount++;
      }
      if (leftCount + rightCount > 0) isFromTelemetry = true;
    }

    if (isFromTelemetry && leftCount + rightCount > 0) {
      const total = leftCount + rightCount;
      const leftPct = Math.round((leftCount / total) * 100);
      return {
        leftPercent: leftPct,
        rightPercent: 100 - leftPct,
        source: 'TELEMETRY_120HZ' as const,
        originBadge: '[Origen: Analytics 8085]' as const,
        totalSamples: total,
      };
    }

    if (isCognitoMode) {
      return {
        leftPercent: 0,
        rightPercent: 0,
        source: 'NO_TELEMETRY' as const,
        originBadge: '[Sin muestras en Analytics 8085]' as const,
        totalSamples: 0,
      };
    }

    // Fallback de demostración solo en modo Mock
    const defaultLeft = isLeftDeficit ? 18 : 82;
    return {
      leftPercent: defaultLeft,
      rightPercent: 100 - defaultLeft,
      source: 'CLINICAL_ESTIMATE' as const,
      originBadge: '[Datos Demo / Mock]' as const,
      totalSamples: 0,
    };
  }, [streamHeatmap, streamGazePlot, isLeftDeficit, isCognitoMode]);

  // Cálculo transparente de indicadores (separando Analytics 8085, Ensayos PRODUCER_REPORTED, Heurística GazePlot y Mock)
  const physiologicalMetrics = useMemo(() => {
    const hasTelemetry = Boolean(streamSummary || trialSummary || streamGazePlot);

    // 1. Dispersión Estimada (BCEA heurística sobre puntos GazePlot [0..1])
    let bcea: number | null = isCognitoMode
      ? null
      : patient?.campimetryData?.fixationStabilityBCEA ?? 0.82;
    let bceaSource: 'TELEMETRY_HEURISTIC' | 'NO_DATA' | 'MOCK_BASELINE' = isCognitoMode
      ? 'NO_DATA'
      : 'MOCK_BASELINE';

    let centralFixationPct: number | null = isCognitoMode ? null : 94.8;
    let centralPointCount = 0;
    const totalGazePoints = streamGazePlot?.points?.length ?? 0;

    if (streamGazePlot && streamGazePlot.points && streamGazePlot.points.length > 0) {
      const pts = streamGazePlot.points;
      centralPointCount = pts.filter(
        (p) => Math.abs(p.x - 0.5) <= 0.15 && Math.abs(p.y - 0.5) <= 0.15
      ).length;
      centralFixationPct = Number(((centralPointCount / pts.length) * 100).toFixed(1));

      if (pts.length >= 10) {
        const meanX = pts.reduce((acc, p) => acc + p.x, 0) / pts.length;
        const meanY = pts.reduce((acc, p) => acc + p.y, 0) / pts.length;
        const varX = pts.reduce((acc, p) => acc + Math.pow(p.x - meanX, 2), 0) / pts.length;
        const varY = pts.reduce((acc, p) => acc + Math.pow(p.y - meanY, 2), 0) / pts.length;
        const stdDegX = Math.sqrt(varX) * 60;
        const stdDegY = Math.sqrt(varY) * 60;
        const computedBcea = Number((2 * 1.14 * Math.PI * stdDegX * stdDegY * 0.1).toFixed(2));
        if (Number.isFinite(computedBcea) && computedBcea > 0) {
          bcea = computedBcea;
          bceaSource = 'TELEMETRY_HEURISTIC';
        }
      }
    }

    // 2. Cobertura espacial real (occupiedCellRatio) y Confianza media real (Analytics 8085)
    const occupiedCellRatio = streamSummary?.metrics.coverage.occupiedCellRatio ?? null;
    const confidenceMean = streamSummary?.metrics.confidence.mean ?? null;
    const meanVelocity = streamSummary?.metrics.gazePath.velocity.mean ?? null;
    const totalDistance = streamSummary?.metrics.gazePath.totalDistance ?? null;

    // En modo Mock se conserva saccadicGain basal
    const saccadicGain = patient?.campimetryData?.saccadicGain ?? 0.94;

    // 3. Mediana de localización / búsqueda desde Ensayos PRODUCER_REPORTED (Analytics 8085)
    let trialMetricLabel = 'Mediana de Localización / Búsqueda';
    let trialMetricValueText = isCognitoMode
      ? 'N/D — Sin ensayos reportados'
      : `${patient?.campimetryData?.fovealSearchLatencyMs ?? 225} ms`;
    let fovealLatency: number | null = isCognitoMode
      ? null
      : patient?.campimetryData?.fovealSearchLatencyMs ?? 225;
    let latencySource: 'PRODUCER_REPORTED' | 'NO_DATA' | 'MOCK_BASELINE' = isCognitoMode
      ? 'NO_DATA'
      : 'MOCK_BASELINE';

    if (trialSummary) {
      if ('medianLocalizationDurationMs' in trialSummary) {
        trialMetricLabel = 'Mediana de Localización (Standard Scanning)';
        if (trialSummary.medianLocalizationDurationMs !== null) {
          fovealLatency = Math.round(trialSummary.medianLocalizationDurationMs);
          trialMetricValueText = `${fovealLatency} ms`;
          latencySource = 'PRODUCER_REPORTED';
        } else {
          trialMetricValueText = `N/D (${trialSummary.reportedTrialCount} ensayos)`;
        }
      } else if ('medianSearchDurationMs' in trialSummary) {
        trialMetricLabel = 'Mediana de Búsqueda (Target Search)';
        if (trialSummary.medianSearchDurationMs !== null) {
          fovealLatency = Math.round(trialSummary.medianSearchDurationMs);
          trialMetricValueText = `${fovealLatency} ms`;
          latencySource = 'PRODUCER_REPORTED';
        } else {
          trialMetricValueText = `N/D (${trialSummary.reportedTrialCount} ensayos)`;
        }
      } else if ('medianTimeToTargetMs' in trialSummary) {
        trialMetricLabel = 'Mediana de Tiempo al Objetivo (Sacadas)';
        if (trialSummary.medianTimeToTargetMs !== null) {
          fovealLatency = Math.round(trialSummary.medianTimeToTargetMs);
          trialMetricValueText = `${fovealLatency} ms`;
          latencySource = 'PRODUCER_REPORTED';
        } else {
          trialMetricValueText = `N/D (${trialSummary.reportedTrialCount} ensayos)`;
        }
      } else if ('totalInsideTargetMs' in trialSummary) {
        trialMetricLabel = 'Tiempo Dentro del Objetivo (Fijación)';
        fovealLatency = Math.round(trialSummary.totalInsideTargetMs);
        trialMetricValueText = `${(trialSummary.totalInsideTargetMs / 1000).toFixed(1)} s (${trialSummary.completedTargetCount} obj.)`;
        latencySource = 'PRODUCER_REPORTED';
      } else if ('traversals' in trialSummary) {
        trialMetricLabel = 'Recorridos Sistemáticos';
        trialMetricValueText = `${trialSummary.traversals.length} recorrido(s)`;
        latencySource = 'PRODUCER_REPORTED';
      }
    }

    return {
      bcea,
      bceaSource,
      centralFixationPct,
      centralPointCount,
      totalGazePoints,
      occupiedCellRatio,
      confidenceMean,
      meanVelocity,
      totalDistance,
      saccadicGain,
      fovealLatency,
      trialMetricLabel,
      trialMetricValueText,
      latencySource,
      hasTelemetry,
    };
  }, [streamSummary, trialSummary, streamGazePlot, patient?.campimetryData, isCognitoMode]);

  return (
    <div className="space-y-6">
      {/* Barra superior de modo de visualización y control de streams */}
      <div className="bg-white p-4 sm:p-5 rounded-xl border border-[#071524]/10 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Selector de modo */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-[#44474C] uppercase tracking-wider mr-1">
            Modo de Análisis:
          </span>
          <button
            type="button"
            onClick={() => setViewMode('goldmann_60')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
              viewMode === 'goldmann_60'
                ? 'bg-[#006A62] text-white shadow-xs'
                : 'bg-[#F3FAFF] text-[#071524] hover:bg-[#DBF1FE] border border-[#071524]/10'
            }`}
          >
            <Compass className="w-3.5 h-3.5" />
            <span>Campimetría 60° Goldmann</span>
          </button>

          <button
            type="button"
            onClick={() => setViewMode('fixation_30')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
              viewMode === 'fixation_30'
                ? 'bg-[#006A62] text-white shadow-xs'
                : 'bg-[#F3FAFF] text-[#071524] hover:bg-[#DBF1FE] border border-[#071524]/10'
            }`}
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span>Fijación Central 30°</span>
          </button>

          <button
            type="button"
            onClick={() => setViewMode('heatmap_120')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
              viewMode === 'heatmap_120'
                ? 'bg-[#006A62] text-white shadow-xs'
                : 'bg-[#F3FAFF] text-[#071524] hover:bg-[#DBF1FE] border border-[#071524]/10'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Heatmap Ocular 120Hz</span>
          </button>
        </div>

        {/* Acciones y selector de Stream */}
        <div className="flex flex-wrap items-center gap-2.5">
          {streams.length > 0 && (
            <div className="inline-flex items-center gap-1.5 bg-[#F3FAFF] border border-[#071524]/10 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#071524]">
              <Activity className="w-3.5 h-3.5 text-[#006A62]" />
              <span className="text-[11px] text-[#44474C]">Stream:</span>
              <select
                value={selectedStreamId || ''}
                onChange={(e) => handleSelectStream(e.target.value)}
                className="bg-transparent border-none text-xs font-bold text-[#071524] outline-none cursor-pointer max-w-[130px] truncate"
              >
                {streams.map((s, idx) => (
                  <option key={s.streamId} value={s.streamId}>
                    Stream #{idx + 1} ({s.sampleCounts.total} pts)
                  </option>
                ))}
              </select>
            </div>
          )}

          {isCognitoMode && (
            <button
              type="button"
              onClick={() => void loadAnalyticsData()}
              disabled={isLoadingTelemetry}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-[#006A62]/30 hover:bg-[#E6F6FF] text-[#006A62] transition-colors shadow-xs disabled:opacity-60 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingTelemetry ? 'animate-spin' : ''}`} />
              <span>Sincronizar 120Hz</span>
            </button>
          )}

          {onOpenAudit && (
            <button
              type="button"
              onClick={onOpenAudit}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg bg-[#071524] hover:bg-[#1C2A39] text-white transition-colors shadow-xs cursor-pointer"
            >
              <Activity className="w-3.5 h-3.5 text-[#81F3E5]" />
              <span>Auditoría 120Hz</span>
            </button>
          )}
        </div>
      </div>

      {/* Notificación diagnóstica clara cuando no hay telemetría en vivo */}
      {telemetryNotice && (
        <div className="bg-[#FFF4E5] border border-[#FFE0B2] text-[#B76E00] rounded-xl p-3.5 flex items-center gap-2.5 text-xs font-semibold">
          <AlertCircle className="w-4 h-4 shrink-0 text-[#E65100]" />
          <span>{telemetryNotice}</span>
        </div>
      )}

      {/* ÁREA PRINCIPAL: Render dinámico según el modo seleccionado */}
      <div className="bg-white p-6 rounded-xl border border-[#071524]/10 shadow-xs space-y-6">
        {/* Cabecera del visualizador */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#071524]/10">
          <div>
            <h3 className="font-bold text-base text-[#071524] flex items-center gap-2">
              <Eye className="w-5 h-5 text-[#006A62]" />
              {viewMode === 'goldmann_60' && 'Campimetría Computarizada 60° (Goldmann / Humphrey)'}
              {viewMode === 'fixation_30' && 'Mapa de Fijación Foveal y Estabilidad Macular (30°)'}
              {viewMode === 'heatmap_120' && 'Densidad Oculomotora Retinotópica 120Hz (Scanpath & Heatmap)'}
            </h3>
            <p className="text-xs text-[#44474C] mt-0.5">
              {viewMode === 'goldmann_60' &&
                'Isópteros periféricos y zona de escotoma homónimo absoluto con preservación macular'}
              {viewMode === 'fixation_30' &&
                'Elipse de contorno bivariado (BCEA 68%) y microrrastreo de fijación foveal central'}
              {viewMode === 'heatmap_120' &&
                'Matriz de densidad de muestras de mirada y trayectorias sacádicas sobre la cuadrícula retinotópica'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`px-3 py-1 rounded-full text-xs font-bold border ${
                isLeftDeficit
                  ? 'bg-[#FFDAD6] text-[#93000A] border-[#BA1A1A]/20'
                  : 'bg-[#FFDCC4] text-[#6F3800] border-[#FFB780]'
              }`}
            >
              Déficit: {isLeftDeficit ? 'Hemicampo Izquierdo' : 'Hemicampo Derecho'}
            </span>

            <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#E6F6FF] text-[#006A62] border border-[#071524]/10">
              {isCognitoMode
                ? physiologicalMetrics.hasTelemetry
                  ? `Origen: Analytics 8085${resolvedMode ? ` (${resolvedMode})` : ''}`
                  : 'Sin telemetría en Analytics 8085'
                : 'Datos Demo / Línea Base Mock'}
            </span>
          </div>
        </div>

        {/* 1. MODO: Campimetría 60° Goldmann */}
        {viewMode === 'goldmann_60' && (
          <div className="flex flex-col lg:flex-row items-center justify-around gap-8 py-4">
            {/* Ojo Izquierdo (OS) */}
            <div className="flex flex-col items-center">
              <div className="relative w-64 h-64 sm:w-72 sm:h-72 bg-[#071524] rounded-full p-2 shadow-inner border-4 border-[#071524]/80 flex items-center justify-center">
                <svg viewBox="0 0 200 200" className="w-full h-full">
                  {/* Círculos concéntricos de isópteros: 60°, 40°, 20° */}
                  <circle cx="100" cy="100" r="92" fill="#0A1D2B" stroke="#81F3E5" strokeWidth="0.8" opacity="0.4" />
                  <circle cx="100" cy="100" r="62" fill="none" stroke="#81F3E5" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.5" />
                  <circle cx="100" cy="100" r="32" fill="none" stroke="#81F3E5" strokeWidth="0.8" strokeDasharray="2 2" opacity="0.6" />

                  {/* Meridianos ortogonales y oblicuos */}
                  <line x1="8" y1="100" x2="192" y2="100" stroke="#81F3E5" strokeWidth="0.6" opacity="0.4" />
                  <line x1="100" y1="8" x2="100" y2="192" stroke="#81F3E5" strokeWidth="0.6" opacity="0.4" />
                  <line x1="35" y1="35" x2="165" y2="165" stroke="#81F3E5" strokeWidth="0.4" opacity="0.25" />
                  <line x1="165" y1="35" x2="35" y2="165" stroke="#81F3E5" strokeWidth="0.4" opacity="0.25" />

                  {/* Zona de escotoma homónimo sombreada */}
                  {isLeftDeficit ? (
                    <path
                      d="M 100 8 A 92 92 0 0 0 100 192 Z"
                      fill="#FF5252"
                      fillOpacity="0.32"
                      stroke="#FF5252"
                      strokeWidth="1.5"
                    />
                  ) : (
                    <path
                      d="M 100 8 A 92 92 0 0 1 100 192 Z"
                      fill="#FF5252"
                      fillOpacity="0.32"
                      stroke="#FF5252"
                      strokeWidth="1.5"
                    />
                  )}

                  {/* Mancha ciega de Mariotte fisiológica (OS: temporal a la izquierda ~ -15°) */}
                  <ellipse cx="64" cy="102" rx="7" ry="11" fill="#FF1744" opacity="0.75" />

                  {/* Respeto Macular Central (Fóvea ~2.5°) */}
                  <circle cx="100" cy="100" r="8" fill="#81F3E5" fillOpacity="0.25" stroke="#81F3E5" strokeWidth="1" />
                  <circle cx="100" cy="100" r="3" fill="#BA1A1A" />

                  {/* Muestras de mirada sobrepuestas si existen */}
                  {streamGazePlot?.points &&
                    streamGazePlot.points.slice(0, 45).map((pt, i) => (
                      <circle
                        key={i}
                        cx={Math.max(12, Math.min(188, pt.x * 200))}
                        cy={Math.max(12, Math.min(188, pt.y * 200))}
                        r="1.8"
                        fill="#00E5FF"
                        opacity="0.7"
                      />
                    ))}
                </svg>

                {/* Etiquetas de grados */}
                <span className="absolute top-2 text-[9px] font-mono text-[#81F3E5]/70">90° Sup</span>
                <span className="absolute bottom-2 text-[9px] font-mono text-[#81F3E5]/70">270° Inf</span>
                <span className="absolute left-2 text-[9px] font-mono text-[#81F3E5]/70">180° Temp</span>
                <span className="absolute right-2 text-[9px] font-mono text-[#81F3E5]/70">0° Nasal</span>
              </div>

              <div className="text-center mt-3">
                <span className="font-bold text-sm text-[#071524]">Ojo Izquierdo (OS)</span>
                <p className="text-xs text-[#44474C]">
                  {isLeftDeficit ? 'Escotoma Temporal (Hemicampo Izq.)' : 'Hemicampo Nasal Afectado'} ·{' '}
                  {isCognitoMode
                    ? streamGazePlot?.points?.length
                      ? `${streamGazePlot.points.length} pts [GazePlot 8085]`
                      : 'Esquema Contexto Clínico [8083]'
                    : 'Fóvea 2.1° [Demo]'}
                </p>
              </div>
            </div>

            {/* Ojo Derecho (OD) */}
            <div className="flex flex-col items-center">
              <div className="relative w-64 h-64 sm:w-72 sm:h-72 bg-[#071524] rounded-full p-2 shadow-inner border-4 border-[#071524]/80 flex items-center justify-center">
                <svg viewBox="0 0 200 200" className="w-full h-full">
                  {/* Círculos concéntricos de isópteros */}
                  <circle cx="100" cy="100" r="92" fill="#0A1D2B" stroke="#81F3E5" strokeWidth="0.8" opacity="0.4" />
                  <circle cx="100" cy="100" r="62" fill="none" stroke="#81F3E5" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.5" />
                  <circle cx="100" cy="100" r="32" fill="none" stroke="#81F3E5" strokeWidth="0.8" strokeDasharray="2 2" opacity="0.6" />

                  {/* Meridianos */}
                  <line x1="8" y1="100" x2="192" y2="100" stroke="#81F3E5" strokeWidth="0.6" opacity="0.4" />
                  <line x1="100" y1="8" x2="100" y2="192" stroke="#81F3E5" strokeWidth="0.6" opacity="0.4" />
                  <line x1="35" y1="35" x2="165" y2="165" stroke="#81F3E5" strokeWidth="0.4" opacity="0.25" />
                  <line x1="165" y1="35" x2="35" y2="165" stroke="#81F3E5" strokeWidth="0.4" opacity="0.25" />

                  {/* Zona de escotoma homónimo */}
                  {isLeftDeficit ? (
                    <path
                      d="M 100 8 A 92 92 0 0 0 100 192 Z"
                      fill="#FF5252"
                      fillOpacity="0.32"
                      stroke="#FF5252"
                      strokeWidth="1.5"
                    />
                  ) : (
                    <path
                      d="M 100 8 A 92 92 0 0 1 100 192 Z"
                      fill="#FF5252"
                      fillOpacity="0.32"
                      stroke="#FF5252"
                      strokeWidth="1.5"
                    />
                  )}

                  {/* Mancha ciega de Mariotte fisiológica (OD: temporal a la derecha ~ +15°) */}
                  <ellipse cx="136" cy="102" rx="7" ry="11" fill="#FF1744" opacity="0.75" />

                  {/* Respeto Macular */}
                  <circle cx="100" cy="100" r="8" fill="#81F3E5" fillOpacity="0.25" stroke="#81F3E5" strokeWidth="1" />
                  <circle cx="100" cy="100" r="3" fill="#BA1A1A" />

                  {/* Muestras de mirada */}
                  {streamGazePlot?.points &&
                    streamGazePlot.points.slice(0, 45).map((pt, i) => (
                      <circle
                        key={i}
                        cx={Math.max(12, Math.min(188, pt.x * 200))}
                        cy={Math.max(12, Math.min(188, pt.y * 200))}
                        r="1.8"
                        fill="#00E5FF"
                        opacity="0.7"
                      />
                    ))}
                </svg>

                {/* Etiquetas */}
                <span className="absolute top-2 text-[9px] font-mono text-[#81F3E5]/70">90° Sup</span>
                <span className="absolute bottom-2 text-[9px] font-mono text-[#81F3E5]/70">270° Inf</span>
                <span className="absolute left-2 text-[9px] font-mono text-[#81F3E5]/70">0° Nasal</span>
                <span className="absolute right-2 text-[9px] font-mono text-[#81F3E5]/70">180° Temp</span>
              </div>

              <div className="text-center mt-3">
                <span className="font-bold text-sm text-[#071524]">Ojo Derecho (OD)</span>
                <p className="text-xs text-[#44474C]">
                  {isLeftDeficit ? 'Hemicampo Nasal Afectado' : 'Escotoma Temporal (Hemicampo Der.)'} ·{' '}
                  {isCognitoMode
                    ? streamGazePlot?.points?.length
                      ? `${streamGazePlot.points.length} pts [GazePlot 8085]`
                      : 'Esquema Contexto Clínico [8083]'
                    : 'Fóvea 2.3° [Demo]'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 2. MODO: Fijación Central 30° */}
        {viewMode === 'fixation_30' && (
          <div className="flex flex-col lg:flex-row items-center justify-around gap-8 py-4">
            <div className="relative w-72 h-72 sm:w-80 sm:h-80 bg-[#071524] rounded-2xl p-4 shadow-xl border border-[#81F3E5]/20 flex items-center justify-center">
              <svg viewBox="0 0 200 200" className="w-full h-full">
                {/* Cuadrícula concéntrica central: 30°, 20°, 10°, 5°, 2° */}
                <circle cx="100" cy="100" r="90" fill="#0A1D2B" stroke="#81F3E5" strokeWidth="0.7" opacity="0.3" />
                <circle cx="100" cy="100" r="60" fill="none" stroke="#81F3E5" strokeWidth="0.7" strokeDasharray="3 3" opacity="0.4" />
                <circle cx="100" cy="100" r="30" fill="none" stroke="#81F3E5" strokeWidth="0.8" opacity="0.5" />
                <circle cx="100" cy="100" r="15" fill="#81F3E5" fillOpacity="0.1" stroke="#81F3E5" strokeWidth="1" />
                <circle cx="100" cy="100" r="6" fill="#00E5FF" fillOpacity="0.2" stroke="#00E5FF" strokeWidth="1" />

                {/* Ejes de mira foveal */}
                <line x1="10" y1="100" x2="190" y2="100" stroke="#81F3E5" strokeWidth="0.8" opacity="0.6" />
                <line x1="100" y1="10" x2="100" y2="190" stroke="#81F3E5" strokeWidth="0.8" opacity="0.6" />

                {/* Elipse BCEA (solo si hay estimación disponible) */}
                {physiologicalMetrics.bcea !== null && (
                  <ellipse
                    cx="100"
                    cy="100"
                    rx={Math.max(10, Math.min(45, physiologicalMetrics.bcea * 18))}
                    ry={Math.max(8, Math.min(38, physiologicalMetrics.bcea * 14))}
                    fill="#81F3E5"
                    fillOpacity="0.22"
                    stroke="#81F3E5"
                    strokeWidth="1.8"
                    strokeDasharray="4 2"
                  />
                )}

                {/* Punto foveal */}
                <circle cx="100" cy="100" r="2.5" fill="#FF1744" />

                {/* Puntos de fijación del stream */}
                {streamGazePlot?.points &&
                  streamGazePlot.points.slice(0, 60).map((pt, i) => (
                    <circle
                      key={i}
                      cx={100 + (pt.x - 0.5) * 120}
                      cy={100 + (pt.y - 0.5) * 120}
                      r="1.4"
                      fill="#81F3E5"
                      opacity="0.8"
                    />
                  ))}
              </svg>

              <span className="absolute top-3 left-4 text-[10px] font-mono text-[#81F3E5]">Campo 30° Macular</span>
              <span className="absolute bottom-3 right-4 text-[10px] font-mono text-[#81F3E5]">
                {isCognitoMode ? 'GazePlot [0..1]' : 'BCEA 68% [Demo]'}
              </span>
            </div>

            {/* Panel de métricas de fijación central */}
            <div className="flex-1 max-w-md space-y-4 text-xs text-[#071524]">
              <div className="p-4 rounded-xl bg-[#E6F6FF] border border-[#071524]/10 space-y-2">
                <div className="flex items-center justify-between font-bold text-sm">
                  <span>
                    {isCognitoMode
                      ? 'Dispersión Estimada (Heurística GazePlot)'
                      : 'Estabilidad de Fijación Foveal'}
                  </span>
                  <span className="text-[#006A62]">
                    {physiologicalMetrics.bcea !== null
                      ? `BCEA: ${physiologicalMetrics.bcea} deg²`
                      : 'N/D (Sin puntos de mirada)'}
                  </span>
                </div>
                <p className="text-[#44474C]">
                  {isCognitoMode
                    ? physiologicalMetrics.bcea !== null
                      ? `Estimación heurística calculada sobre ${physiologicalMetrics.totalGazePoints} puntos normalizados [0..1] del endpoint GazePlot (Analytics 8085).`
                      : 'No existen suficientes puntos de mirada (mínimo 10 muestras en GazePlot 8085) para estimar dispersión espacial en esta sesión.'
                    : `El 68% de las fijaciones se concentran dentro del anillo central de ${(
                        (physiologicalMetrics.bcea ?? 0.82) * 1.2
                      ).toFixed(2)}° de radio [Datos Demo / Mock].`}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-[#F3FAFF] rounded-lg border border-[#071524]/10">
                  <span className="text-[#74777C] text-[11px] font-semibold block">
                    {isCognitoMode
                      ? 'Muestras en Región Central (±15%)'
                      : 'Tiempo en Fóvea (< 2°)'}
                  </span>
                  <p className="font-bold text-base text-[#071524] mt-0.5">
                    {isCognitoMode
                      ? physiologicalMetrics.centralFixationPct !== null
                        ? `${physiologicalMetrics.centralFixationPct}% (${physiologicalMetrics.centralPointCount}/${physiologicalMetrics.totalGazePoints})`
                        : 'N/D (Sin puntos)'
                      : '94.8%'}
                  </p>
                  <span className="text-[10px] text-[#006A62] font-semibold block mt-1">
                    {isCognitoMode
                      ? '[Estimación heurística sobre GazePlot]'
                      : '[Datos Demo / Mock]'}
                  </span>
                </div>
                <div className="p-3 bg-[#F3FAFF] rounded-lg border border-[#071524]/10">
                  <span className="text-[#74777C] text-[11px] font-semibold block">
                    {isCognitoMode ? 'Velocidad Media de Mirada' : 'Tasa Microsacadas'}
                  </span>
                  <p className="font-bold text-base text-[#071524] mt-0.5">
                    {isCognitoMode
                      ? physiologicalMetrics.meanVelocity !== null
                        ? `${physiologicalMetrics.meanVelocity.toFixed(3)} u/s`
                        : 'N/D'
                      : '1.3 / seg'}
                  </p>
                  <span className="text-[10px] text-[#006A62] font-semibold block mt-1">
                    {isCognitoMode ? '[Origen: Analytics 8085]' : '[Datos Demo / Mock]'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 3. MODO: Heatmap Ocular 120Hz */}
        {viewMode === 'heatmap_120' && (
          <div className="space-y-4">
            <div className="relative w-full max-w-2xl mx-auto h-80 bg-[#071524] rounded-2xl overflow-hidden p-4 border border-[#81F3E5]/20 flex flex-col justify-between">
              {/* Cuadrícula retinotópica real desde streamHeatmap o demo en modo Mock */}
              {streamHeatmap &&
              streamHeatmap.columns > 0 &&
              streamHeatmap.rows > 0 &&
              streamHeatmap.cellCounts?.length > 0 ? (
                <div
                  className="absolute inset-0 grid gap-1 p-3 pointer-events-none"
                  style={{
                    gridTemplateColumns: `repeat(${streamHeatmap.columns}, minmax(0, 1fr))`,
                    gridTemplateRows: `repeat(${streamHeatmap.rows}, minmax(0, 1fr))`,
                  }}
                >
                  {(() => {
                    const maxCell = Math.max(1, ...streamHeatmap.cellCounts);
                    const midCol = Math.floor(streamHeatmap.columns / 2);
                    return streamHeatmap.cellCounts.map((count, idx) => {
                      const col = idx % streamHeatmap.columns;
                      const isLeftCol = col < midCol;
                      const isDeficitCell = isLeftDeficit ? isLeftCol : !isLeftCol;
                      const ratio = count / maxCell;
                      const alpha = count > 0 ? Math.max(0.12, Math.min(0.9, ratio * 0.85)) : 0.03;
                      return (
                        <div
                          key={idx}
                          className="rounded transition-all"
                          style={{
                            backgroundColor: isDeficitCell
                              ? `rgba(255, 82, 82, ${alpha})`
                              : `rgba(0, 229, 255, ${alpha})`,
                          }}
                        />
                      );
                    });
                  })()}
                </div>
              ) : isCognitoMode ? (
                <div className="absolute inset-0 flex items-center justify-center p-6 text-center pointer-events-none">
                  <div className="bg-[#071524]/85 border border-[#81F3E5]/30 rounded-xl px-4 py-3 text-xs text-[#81F3E5] max-w-md">
                    Sin matriz de Heatmap disponible en Analytics Service (8085) para esta sesión. No se muestran celdas sintéticas en modo clínico.
                  </div>
                </div>
              ) : (
                <div className="absolute inset-0 grid grid-cols-8 grid-rows-6 gap-1 p-3 pointer-events-none">
                  {Array.from({ length: 48 }).map((_, idx) => {
                    const col = idx % 8;
                    const isLeftCol = col < 4;
                    const isDeficitCell = isLeftDeficit ? isLeftCol : !isLeftCol;
                    const weight = isDeficitCell ? 0.08 : 0.65;
                    return (
                      <div
                        key={idx}
                        className="rounded transition-all"
                        style={{
                          backgroundColor: isDeficitCell
                            ? `rgba(255, 82, 82, ${weight * 0.45})`
                            : `rgba(0, 229, 255, ${weight * 0.55})`,
                        }}
                      />
                    );
                  })}
                </div>
              )}

              {/* Trazado SVG del Scanpath 120Hz */}
              <svg viewBox="0 0 400 240" className="absolute inset-0 w-full h-full pointer-events-none p-3">
                {/* Cuadrantes clínicos */}
                <line x1="200" y1="10" x2="200" y2="230" stroke="#81F3E5" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
                <line x1="10" y1="120" x2="390" y2="120" stroke="#81F3E5" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />

                {/* Puntos y scanpath */}
                {streamGazePlot?.points && streamGazePlot.points.length > 1 && (
                  <polyline
                    fill="none"
                    stroke="#84F5E8"
                    strokeWidth="1.6"
                    opacity="0.8"
                    points={streamGazePlot.points
                      .slice(0, 50)
                      .map((p) => `${Math.max(10, Math.min(390, p.x * 400))},${Math.max(10, Math.min(230, p.y * 240))}`)
                      .join(' ')}
                  />
                )}
              </svg>

              {/* Indicadores de Cuadrantes Deficitarios */}
              <div className="relative z-10 flex justify-between text-[11px] font-mono text-white/80">
                <span className={isLeftDeficit ? 'text-[#FF8A80] font-bold' : 'text-[#81F3E5]'}>
                  Q1: Sup-Izq {isLeftDeficit ? '(Déficit)' : '(Normo)'}
                </span>
                <span className={!isLeftDeficit ? 'text-[#FF8A80] font-bold' : 'text-[#81F3E5]'}>
                  Q2: Sup-Der {!isLeftDeficit ? '(Déficit)' : '(Normo)'}
                </span>
              </div>

              <div className="relative z-10 flex justify-between text-[11px] font-mono text-white/80">
                <span className={isLeftDeficit ? 'text-[#FF8A80] font-bold' : 'text-[#81F3E5]'}>
                  Q3: Inf-Izq {isLeftDeficit ? '(Déficit)' : '(Normo)'}
                </span>
                <span className={!isLeftDeficit ? 'text-[#FF8A80] font-bold' : 'text-[#81F3E5]'}>
                  Q4: Inf-Der {!isLeftDeficit ? '(Déficit)' : '(Normo)'}
                </span>
              </div>
            </div>

            <p className="text-center text-xs text-[#44474C]">
              {streamHeatmap
                ? `Matriz activa: ${streamHeatmap.rows} filas x ${streamHeatmap.columns} columnas · Muestras reales: ${streamHeatmap.gazeSampleCount ?? 0} pts [Origen: Analytics 8085]`
                : isCognitoMode
                ? 'N/D — Sin matriz de heatmap disponible en Analytics (8085) para esta sesión.'
                : 'Proyección oculomotora de demostración [Datos Demo / Mock].'}
            </p>
          </div>
        )}

        {/* Distribución Asimétrica Hemicampo Izquierdo vs Derecho */}
        <div className="p-4 bg-[#F3FAFF] rounded-xl border border-[#071524]/10 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-[#071524]">
            <span className="flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-[#006A62]" />
              Distribución Exploratoria Ocular (Hemicampos)
            </span>
            <span className="text-[11px] text-[#006A62] font-semibold">
              {hemifieldDistribution.source === 'TELEMETRY_120HZ'
                ? `${hemifieldDistribution.originBadge} (${hemifieldDistribution.totalSamples} muestras)`
                : hemifieldDistribution.source === 'NO_TELEMETRY'
                ? `${hemifieldDistribution.originBadge} (0 muestras)`
                : `${hemifieldDistribution.originBadge} (Estimación Demo)`}
            </span>
          </div>

          {hemifieldDistribution.source === 'NO_TELEMETRY' ? (
            <div className="py-2 px-3 rounded-lg bg-white border border-[#071524]/10 text-xs text-[#44474C]">
              N/D — Sin muestras de mirada en Analytics (8085) para calcular distribución izquierda/derecha. Hemicampo deficitario consignado en contexto clínico (8083):{' '}
              <strong className="text-[#071524]">
                {isLeftDeficit ? 'Hemicampo Izquierdo (LEFT)' : 'Hemicampo Derecho (RIGHT)'}
              </strong>
              .
            </div>
          ) : (
            <>
              {/* Barra de Progreso Bicolor */}
              <div className="h-4 w-full rounded-full bg-[#E0E2EC] overflow-hidden flex shadow-inner">
                <div
                  style={{ width: `${hemifieldDistribution.leftPercent}%` }}
                  className={`h-full flex items-center justify-center text-[10px] font-bold text-white transition-all ${
                    isLeftDeficit ? 'bg-[#BA1A1A]' : 'bg-[#006A62]'
                  }`}
                >
                  {hemifieldDistribution.leftPercent}%
                </div>
                <div
                  style={{ width: `${hemifieldDistribution.rightPercent}%` }}
                  className={`h-full flex items-center justify-center text-[10px] font-bold text-white transition-all ${
                    !isLeftDeficit ? 'bg-[#BA1A1A]' : 'bg-[#006A62]'
                  }`}
                >
                  {hemifieldDistribution.rightPercent}%
                </div>
              </div>

              <div className="flex justify-between text-[11px] font-semibold text-[#44474C]">
                <span className={isLeftDeficit ? 'text-[#93000A] font-bold' : 'text-[#006A62]'}>
                  Hemicampo Izquierdo: {hemifieldDistribution.leftPercent}% {isLeftDeficit && '(Déficit)'}
                </span>
                <span className={!isLeftDeficit ? 'text-[#93000A] font-bold' : 'text-[#006A62]'}>
                  Hemicampo Derecho: {hemifieldDistribution.rightPercent}% {!isLeftDeficit && '(Déficit)'}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Indicadores Visuales Transparentes con Etiqueta de Origen Real */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: BCEA / Dispersión GazePlot */}
        <div className="bg-white p-5 rounded-xl border border-[#071524]/10 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-[#44474C] font-semibold uppercase tracking-wider">
              {isCognitoMode ? 'Dispersión Estimada (BCEA)' : 'Estabilidad BCEA'}
            </span>
            <Activity className="w-4 h-4 text-[#006A62] shrink-0" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[#071524]">
              {physiologicalMetrics.bcea !== null
                ? `${physiologicalMetrics.bcea} deg²`
                : 'N/D (Sin puntos de mirada)'}
            </span>
          </div>
          <div className="mt-2 flex flex-col gap-1 text-xs">
            <span className="text-[#44474C] text-[11px]">
              {physiologicalMetrics.bcea !== null
                ? `Sobre ${physiologicalMetrics.totalGazePoints} pts normalizados`
                : 'Requiere ≥ 10 puntos en GazePlot'}
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-[#DBF1FE] text-[#071524] font-bold self-start">
              {isCognitoMode
                ? '[Estimación heurística sobre GazePlot]'
                : '[Datos Demo / Mock]'}
            </span>
          </div>
        </div>

        {/* Card 2: Cobertura Espacial Real (occupiedCellRatio) y Confianza Media */}
        <div className="bg-white p-5 rounded-xl border border-[#071524]/10 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-[#44474C] font-semibold uppercase tracking-wider">
              {isCognitoMode
                ? 'Cobertura Espacial (occupiedCellRatio)'
                : 'Ganancia Sacádica'}
            </span>
            <Award className="w-4 h-4 text-[#006A62] shrink-0" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[#071524]">
              {isCognitoMode
                ? physiologicalMetrics.occupiedCellRatio !== null
                  ? `${(physiologicalMetrics.occupiedCellRatio * 100).toFixed(1)}%`
                  : 'N/D'
                : `${physiologicalMetrics.saccadicGain} / 1.0`}
            </span>
          </div>
          <div className="mt-2 flex flex-col gap-1 text-xs">
            <span className="text-[#006A62] font-semibold text-[11px]">
              {isCognitoMode
                ? `Confianza Media: ${
                    physiologicalMetrics.confidenceMean !== null
                      ? `${(physiologicalMetrics.confidenceMean * 100).toFixed(1)}%`
                      : 'N/D'
                  }`
                : 'Precisión de Salto Demo'}
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-[#DBF1FE] text-[#071524] font-bold self-start">
              {isCognitoMode ? '[Origen: Analytics 8085]' : '[Datos Demo / Mock]'}
            </span>
          </div>
        </div>

        {/* Card 3: Velocidad Media de Mirada (Analytics 8085) */}
        <div className="bg-white p-5 rounded-xl border border-[#071524]/10 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-[#44474C] font-semibold uppercase tracking-wider">
              Velocidad Media de Mirada
            </span>
            <TrendingUp className="w-4 h-4 text-[#006A62] shrink-0" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[#071524]">
              {physiologicalMetrics.meanVelocity !== null
                ? `${physiologicalMetrics.meanVelocity.toFixed(3)} u/s`
                : isCognitoMode
                ? 'N/D'
                : '1.42 u/s'}
            </span>
          </div>
          <div className="mt-2 flex flex-col gap-1 text-xs">
            <span className="text-[#44474C] text-[11px]">
              {physiologicalMetrics.totalDistance !== null
                ? `Recorrido total: ${physiologicalMetrics.totalDistance.toFixed(2)} u`
                : isCognitoMode
                ? 'Sin trayectoria en stream'
                : 'Recorrido simulado'}
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-[#DBF1FE] text-[#071524] font-bold self-start">
              {isCognitoMode ? '[Origen: Analytics 8085]' : '[Datos Demo / Mock]'}
            </span>
          </div>
        </div>

        {/* Card 4: Mediana de Localización / Búsqueda (Ensayos PRODUCER_REPORTED) */}
        <div className="bg-white p-5 rounded-xl border border-[#071524]/10 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-[#44474C] font-semibold uppercase tracking-wider">
              {isCognitoMode ? physiologicalMetrics.trialMetricLabel : 'Latencia de Búsqueda'}
            </span>
            <ShieldAlert className="w-4 h-4 text-[#006A62] shrink-0" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[#071524]">
              {physiologicalMetrics.trialMetricValueText}
            </span>
          </div>
          <div className="mt-2 flex flex-col gap-1 text-xs">
            <span className="text-[#006A62] font-semibold text-[11px]">
              {trialSummary
                ? `${trialSummary.reportedTrialCount} ensayo(s) reportado(s)`
                : isCognitoMode
                ? 'Endpoint trial-results/summary'
                : 'Percentil Clínico 88 (Demo)'}
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-[#DBF1FE] text-[#071524] font-bold self-start">
              {isCognitoMode
                ? '[Origen: Ensayos PRODUCER_REPORTED]'
                : '[Datos Demo / Mock]'}
            </span>
          </div>
        </div>
      </div>

      {/* Tarjeta de Contexto Clínico Integrado */}
      <section className="bg-white p-5 sm:p-6 rounded-xl border border-[#071524]/10 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#071524]/10">
          <div>
            <h4 className="font-bold text-sm text-[#071524] flex items-center gap-2">
              <Sliders className="w-4 h-4 text-[#006A62]" />
              Contexto Clínico de Neurorrehabilitación Visual
              <span className="text-[10px] px-2 py-0.5 rounded bg-[#E6F6FF] text-[#006A62] font-bold">
                {isCognitoMode ? '[Origen: Contexto Clínico 8083]' : '[Datos Demo / Mock]'}
              </span>
            </h4>
            <p className="text-xs text-[#44474C]">
              Parámetros oftalmológicos y neurológicos registrados en Clinical Service (8083)
            </p>
          </div>

          <div className="flex items-center gap-2">
            {onEditContext && (
              <button
                type="button"
                onClick={onEditContext}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#E6F6FF] text-[#006A62] hover:bg-[#DBF1FE] transition-colors border border-[#006A62]/20 cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Editar Contexto Clínico</span>
              </button>
            )}

            {onOpenAudit && (
              <button
                type="button"
                onClick={onOpenAudit}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#F3FAFF] text-[#071524] hover:bg-[#E6F6FF] transition-colors border border-[#071524]/10 cursor-pointer"
              >
                <span>Auditoría 120Hz</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div className="p-3 bg-[#F3FAFF] rounded-lg border border-[#071524]/10">
            <span className="text-[#74777C] font-semibold text-[11px] block">
              Diagnóstico Neurológico (previousDiagnosis)
            </span>
            <span className="font-bold text-[#071524] mt-0.5 line-clamp-2">{diagnosis}</span>
          </div>

          <div className="p-3 bg-[#F3FAFF] rounded-lg border border-[#071524]/10">
            <span className="text-[#74777C] font-semibold text-[11px] block">
              Hemicampo Afectado (affectedHemifield)
            </span>
            <span className="font-bold text-[#071524] mt-0.5 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#006A62]" />
              {lesionSide === 'LEFT'
                ? 'Hemicampo Izquierdo (LEFT)'
                : lesionSide === 'RIGHT'
                ? 'Hemicampo Derecho (RIGHT)'
                : lesionSide}
            </span>
          </div>

          <div className="p-3 bg-[#F3FAFF] rounded-lg border border-[#071524]/10">
            <span className="text-[#74777C] font-semibold text-[11px] block">
              {isCognitoMode ? 'Secuelas Registradas (sequelae)' : 'Campo Visual Afectado'}
            </span>
            <span className="font-bold text-[#071524] mt-0.5 line-clamp-2 block">
              {isCognitoMode
                ? rehabilitationContext?.sequelae?.length
                  ? rehabilitationContext.sequelae.join(' · ')
                  : 'No consignado en contexto clínico'
                : affectedFieldLabel}
            </span>
          </div>

          <div className="p-3 bg-[#F3FAFF] rounded-lg border border-[#071524]/10">
            <span className="text-[#74777C] font-semibold text-[11px] block">
              {isCognitoMode
                ? 'Observaciones / Agudeza Visual'
                : 'Agudeza Visual & Dominancia'}
            </span>
            <span className="font-bold text-[#071524] mt-0.5 line-clamp-2 block">
              {isCognitoMode
                ? rehabilitationContext?.observations
                  ? `${rehabilitationContext.observations} (Agudeza/Dominancia: No consignado en contexto clínico)`
                  : 'No consignado en contexto clínico'
                : `OS: ${visualAcuityLeft} · OD: ${visualAcuityRight} (${dominantEye})`}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
};
