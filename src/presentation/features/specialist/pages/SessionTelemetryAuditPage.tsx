import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronRight,
  Download,
  FileText,
  Calendar,
  Eye,
  Ruler,
  CheckCircle2,
  AlertTriangle,
  WifiOff,
  Search,
  FilterX,
  Play,
  Pause,
  Code2,
  ShieldCheck,
  Video,
  Hospital,
  ChevronLeft,
  X,
  Loader2,
  RefreshCw,
  Grid3X3,
  Crosshair,
  Film,
  Database,
  Activity,
} from 'lucide-react';
import { useAppStore } from '../../../../core/store/useAppStore';
import type { Patient, SessionRecord } from '../../../../core/domain/Patient';
import { ClinicalTermTooltip } from '../../../shared/components/ClinicalTermTooltip';
import { SpecialistHeader } from '../components/SpecialistHeader';
import { SpecialistFooter } from '../components/SpecialistFooter';
import { SessionAnalyticsModal } from '../components/SessionAnalyticsModal';
import {
  analyticsApi,
  ApiError,
  clinicalApi,
  extractApiErrorMessage,
  modeToAnalyticsSlug,
  telemetryApi,
  type AnyTrialSummary,
} from '../../../../infrastructure/api';
import type {
  AnalyticsGazePlotResponse,
  AnalyticsHeatmapResponse,
  AnalyticsReplayResponse,
  AnalyticsStreamsResponse,
  AnalyticsSummaryResponse,
  AssignedPatientDetailResponse,
  DoctorTherapySessionDetailResponse,
  DoctorTherapySessionSummary,
  ParametersByExercise,
  PatientTherapySessionStatus,
  RehabilitationContextResponse,
  ReportMode,
  TelemetryHistoricalSample,
  TherapyExerciseCode,
} from '../../../../infrastructure/api';

interface ExtendedAuditSession extends SessionRecord {
  planVersion: string;
  gazeQualityIndex: number;
  angularErrorDeg: number;
  hemifieldTarget: string;
  qualityNote: string;
  angularNote: string;
}

type GazePlotPoint = AnalyticsGazePlotResponse['points'][number];
type GazeReplaySample = AnalyticsReplayResponse['gazeSamples']['samples'][number];
type GameplayReplaySample = AnalyticsReplayResponse['gameplaySamples']['samples'][number];

const MODE_LABELS: Record<ReportMode, string> = {
  STANDARD_SCANNING: 'Exploración Estándar',
  SYSTEMATIC_EXPLORATION: 'Exploración Sistemática',
  COMPENSATORY_SACCADE: 'Sacada Compensatoria',
  TARGET_SEARCH_WITH_DISTRACTORS: 'Búsqueda con Distractores',
  SUSTAINED_TARGET_FIXATION: 'Fijación Sostenida',
};

const EXERCISE_LABELS: Record<TherapyExerciseCode, string> = {
  'visual-scanning': 'Exploración Visual',
  'visual-search': 'Búsqueda Visual',
  fixation: 'Fijación Foveal',
};

function extractExerciseParams(
  detail: DoctorTherapySessionDetailResponse
): ParametersByExercise[TherapyExerciseCode] {
  if (detail.parameterSchemaVersion === 2) {
    return detail.configurationParameters.parameters;
  }
  return detail.configurationParameters;
}

function extractModeFromDetail(detail: DoctorTherapySessionDetailResponse): ReportMode {
  return extractExerciseParams(detail).mode;
}

function formatPatientDisplayName(patient: AssignedPatientDetailResponse | null, fallbackId: string): string {
  if (!patient) return `Paciente ${fallbackId.slice(0, 8)}…`;
  if (patient.nameStatus === 'AVAILABLE') {
    return `${patient.firstName} ${patient.lastName}`;
  }
  return `Paciente (${patient.nameStatus})`;
}

function formatPatientInitials(patient: AssignedPatientDetailResponse | null): string {
  if (!patient || patient.nameStatus !== 'AVAILABLE') return 'NV';
  return `${patient.firstName.charAt(0)}${patient.lastName.charAt(0)}`.toUpperCase();
}

function formatDurationSeconds(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
}

function formatIsoShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-PE', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function clamp01(val: number): number {
  if (!Number.isFinite(val)) return 0.5;
  return Math.min(1, Math.max(0, val));
}

function heatFillColor(ratio: number): string {
  if (ratio <= 0) return '#F3FAFF';
  if (ratio < 0.2) return '#CFFAFE';
  if (ratio < 0.45) return '#81F3E5';
  if (ratio < 0.7) return '#26A69A';
  if (ratio < 0.9) return '#006A62';
  return '#071524';
}

function computeGazePointDurations(points: GazePlotPoint[]): number[] {
  return points.map((pt, idx) => {
    if (idx + 1 < points.length && !points[idx + 1].segmentBreakBefore) {
      const t1 = new Date(pt.effectiveTime).getTime();
      const t2 = new Date(points[idx + 1].effectiveTime).getTime();
      const dt = t2 - t1;
      if (Number.isFinite(dt) && dt > 0) {
        return Math.min(2000, dt);
      }
    }
    return 16;
  });
}

export const SessionTelemetryAuditPage: React.FC = () => {
  const { patientId } = useParams<{ patientId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const patients = useAppStore((state) => state.patients);
  const authMode = useAppStore((state) => state.authMode);
  const accessToken = useAppStore((state) => state.accessToken);
  const isCognito = authMode === 'COGNITO' && Boolean(accessToken);

  const querySessionId = searchParams.get('sessionId');

  // === MOCK PATIENT RESOLUTION ===
  const currentPatient: Patient = useMemo(() => {
    const found = patients.find(
      (p) => p.id === patientId || p.medicalRecordNumber.replace('#', '') === patientId
    );
    return found || patients[0];
  }, [patients, patientId]);

  const activePatientId = patientId || currentPatient.id;

  // === TOAST ===
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3200);
  };

  // =====================================================================
  // COGNITO STATE
  // =====================================================================
  const [patientDetail, setPatientDetail] = useState<AssignedPatientDetailResponse | null>(null);
  const [rehabContext, setRehabContext] = useState<RehabilitationContextResponse | null>(null);
  const [sessionsList, setSessionsList] = useState<DoctorTherapySessionSummary[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const [selectedSessionId, setSelectedSessionId] = useState<string>(querySessionId || '');
  const [sessionFilterStatus, setSessionFilterStatus] = useState<'ALL' | PatientTherapySessionStatus>('ALL');
  const [sessionFilterExercise, setSessionFilterExercise] = useState<'ALL' | TherapyExerciseCode>('ALL');
  const [sessionSearch, setSessionSearch] = useState('');

  // Session detail + streams + trial summary
  const [sessionDetail, setSessionDetail] = useState<DoctorTherapySessionDetailResponse | null>(null);
  const [streams, setStreams] = useState<AnalyticsStreamsResponse['items']>([]);
  const [selectedStreamId, setSelectedStreamId] = useState<string>('');
  const [loadingSessionDetail, setLoadingSessionDetail] = useState(false);
  const [sessionDetailError, setSessionDetailError] = useState<string | null>(null);
  const [trialSummary, setTrialSummary] = useState<AnyTrialSummary | null>(null);
  const [trialDataOrigin, setTrialDataOrigin] = useState<'PRODUCER_REPORTED' | 'SYNTHETIC'>(
    'PRODUCER_REPORTED'
  );
  const [trialNotice, setTrialNotice] = useState<string | null>(null);
  const [trialError, setTrialError] = useState<string | null>(null);
  const [loadingTrialSummary, setLoadingTrialSummary] = useState(false);

  // Stream analytics: Summary, Heatmap, GazePlot, Replay
  const [streamSummary, setStreamSummary] = useState<AnalyticsSummaryResponse | null>(null);
  const [streamHeatmap, setStreamHeatmap] = useState<AnalyticsHeatmapResponse | null>(null);
  const [hoveredHeatCell, setHoveredHeatCell] = useState<{
    col: number;
    row: number;
    count: number;
  } | null>(null);

  const [gazePlotMeta, setGazePlotMeta] = useState<AnalyticsGazePlotResponse | null>(null);
  const [gazePlotPoints, setGazePlotPoints] = useState<GazePlotPoint[]>([]);
  const [gazePlotNextCursor, setGazePlotNextCursor] = useState<string | null>(null);
  const [loadingMoreGazePlot, setLoadingMoreGazePlot] = useState(false);
  const [selectedGazePointIdx, setSelectedGazePointIdx] = useState<number | null>(null);

  const [replayMeta, setReplayMeta] = useState<AnalyticsReplayResponse | null>(null);
  const [replayGazeSamples, setReplayGazeSamples] = useState<GazeReplaySample[]>([]);
  const [replayGameplaySamples, setReplayGameplaySamples] = useState<GameplayReplaySample[]>([]);
  const [replayGazeCursor, setReplayGazeCursor] = useState<string | null>(null);
  const [replayGameplayCursor, setReplayGameplayCursor] = useState<string | null>(null);
  const [loadingMoreReplay, setLoadingMoreReplay] = useState(false);
  const [replayLaneTab, setReplayLaneTab] = useState<'gaze' | 'gameplay'>('gaze');
  const [replayFrameIdx, setReplayFrameIdx] = useState(0);
  const [isReplayPlaying, setIsReplayPlaying] = useState(false);

  const [loadingStreamBundle, setLoadingStreamBundle] = useState(false);
  const [streamBundleError, setStreamBundleError] = useState<string | null>(null);

  // Historical raw telemetry samples (8084)
  const [rawSamples, setRawSamples] = useState<TelemetryHistoricalSample[]>([]);
  const [rawNextCursor, setRawNextCursor] = useState<string | null>(null);
  const [rawFromIso, setRawFromIso] = useState<string>('');
  const [rawToIso, setRawToIso] = useState<string>('');
  const [loadingRawSamples, setLoadingRawSamples] = useState(false);
  const [loadingMoreRaw, setLoadingMoreRaw] = useState(false);
  const [rawSamplesError, setRawSamplesError] = useState<string | null>(null);

  // Inspector & Modal
  const [cognitoModalOpen, setCognitoModalOpen] = useState(false);
  const [cognitoJsonInspectorOpen, setCognitoJsonInspectorOpen] = useState(false);

  const querySessionIdRef = useRef(querySessionId);
  querySessionIdRef.current = querySessionId;
  const sessionDetailRef = useRef(sessionDetail);
  sessionDetailRef.current = sessionDetail;

  // Sync URL querySessionId changes into state
  useEffect(() => {
    if (querySessionId && querySessionId !== selectedSessionId) {
      setSelectedSessionId(querySessionId);
    }
  }, [querySessionId, selectedSessionId]);

  const handleSelectSession = useCallback(
    (nextSessionId: string) => {
      setSelectedSessionId(nextSessionId);
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

  // Load patient info + sessions list in COGNITO mode
  const loadPatientAndSessions = useCallback(async () => {
    if (!isCognito || !patientId) return;
    setLoadingSessions(true);
    setSessionsError(null);
    try {
      const [patientOutcome, contextOutcome, sessionsOutcome] = await Promise.allSettled([
        clinicalApi.getAssignedPatientDetail(patientId),
        clinicalApi.getRehabilitationContext(patientId),
        clinicalApi.listDoctorTherapySessions(patientId, { page: 0, size: 50 }),
      ]);

      if (patientOutcome.status === 'fulfilled') {
        setPatientDetail(patientOutcome.value);
      }
      if (contextOutcome.status === 'fulfilled') {
        setRehabContext(contextOutcome.value);
      }
      if (sessionsOutcome.status === 'fulfilled') {
        const list = sessionsOutcome.value.sessions;
        setSessionsList(list);

        if (!querySessionIdRef.current && list.length > 0) {
          // Try picking latest session with analytics, otherwise latest COMPLETED or first
          let pickedId = '';
          const probeSubset = list.slice(0, 6);
          const streamChecks = await Promise.allSettled(
            probeSubset.map((s) => analyticsApi.listSessionStreams(s.therapySessionId, { page: 0, size: 1 }))
          );
          for (let i = 0; i < probeSubset.length; i++) {
            const check = streamChecks[i];
            if (check.status === 'fulfilled' && check.value.items.length > 0) {
              pickedId = probeSubset[i].therapySessionId;
              break;
            }
          }
          if (!pickedId) {
            pickedId =
              list.find((s) => s.status === 'COMPLETED')?.therapySessionId ||
              list[0].therapySessionId;
          }
          if (pickedId) {
            handleSelectSession(pickedId);
          }
        }
      } else {
        setSessionsError(extractApiErrorMessage(sessionsOutcome.reason));
      }
    } finally {
      setLoadingSessions(false);
    }
  }, [isCognito, patientId, handleSelectSession]);

  useEffect(() => {
    void loadPatientAndSessions();
  }, [loadPatientAndSessions]);

  // Load selected session detail + streams
  useEffect(() => {
    if (!isCognito || !patientId || !selectedSessionId) return;

    let cancelled = false;
    setLoadingSessionDetail(true);
    setSessionDetailError(null);
    setStreamBundleError(null);
    setSessionDetail(null);
    setStreams([]);
    setSelectedStreamId('');
    setTrialSummary(null);
    setTrialNotice(null);
    setTrialError(null);

    const loadSession = async () => {
      try {
        const [detailOutcome, streamsOutcome] = await Promise.allSettled([
          clinicalApi.getDoctorTherapySessionDetail(patientId, selectedSessionId),
          analyticsApi.listSessionStreams(selectedSessionId, { page: 0, size: 50 }),
        ]);

        if (cancelled) return;

        if (detailOutcome.status === 'fulfilled') {
          setSessionDetail(detailOutcome.value);
        } else {
          setSessionDetailError(extractApiErrorMessage(detailOutcome.reason));
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
          setStreamBundleError(
            `Error del servicio Analytics (8085): ${extractApiErrorMessage(streamsOutcome.reason)}`
          );
        }
      } finally {
        if (!cancelled) setLoadingSessionDetail(false);
      }
    };

    void loadSession();
    return () => {
      cancelled = true;
    };
  }, [isCognito, patientId, selectedSessionId]);

  // Load trial summary for the selected trialDataOrigin
  useEffect(() => {
    if (!isCognito || !selectedSessionId || !sessionDetail) return;

    let cancelled = false;
    setLoadingTrialSummary(true);
    setTrialSummary(null);
    setTrialNotice(null);
    setTrialError(null);

    const mode = extractModeFromDetail(sessionDetail);
    const slug = modeToAnalyticsSlug(mode);

    analyticsApi
      .getTrialSummary(selectedSessionId, slug, trialDataOrigin)
      .then((summary) => {
        if (!cancelled) setTrialSummary(summary);
      })
      .catch((trialErr) => {
        if (cancelled) return;
        if (trialErr instanceof ApiError && trialErr.status === 404) {
          setTrialNotice(`Sin resultados de ensayos (${trialDataOrigin}) para esta sesión.`);
        } else {
          setTrialError(
            `Error consultando ensayos en Analytics (8085): ${extractApiErrorMessage(trialErr)}`
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingTrialSummary(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isCognito, selectedSessionId, sessionDetail, trialDataOrigin]);

  // Load stream summary, heatmap, gaze plot, replay, and initial raw samples when stream changes
  useEffect(() => {
    if (!isCognito || !selectedSessionId || !selectedStreamId) {
      setStreamSummary(null);
      setStreamHeatmap(null);
      setGazePlotMeta(null);
      setGazePlotPoints([]);
      setGazePlotNextCursor(null);
      setReplayMeta(null);
      setReplayGazeSamples([]);
      setReplayGameplaySamples([]);
      setReplayGazeCursor(null);
      setReplayGameplayCursor(null);
      setRawSamples([]);
      setRawNextCursor(null);
      return;
    }

    let cancelled = false;
    setLoadingStreamBundle(true);
    setStreamBundleError(null);
    setHoveredHeatCell(null);
    setSelectedGazePointIdx(null);
    setIsReplayPlaying(false);
    setReplayFrameIdx(0);

    const loadStreamBundle = async () => {
      try {
        const [summaryRes, heatmapRes, gazePlotRes, replayRes] = await Promise.allSettled([
          analyticsApi.getStreamSummary(selectedSessionId, selectedStreamId),
          analyticsApi.getStreamHeatmap(selectedSessionId, selectedStreamId),
          analyticsApi.getStreamGazePlot(selectedSessionId, selectedStreamId, { pageSize: 200 }),
          analyticsApi.getStreamReplay(selectedSessionId, selectedStreamId, { pageSize: 200 }),
        ]);

        if (cancelled) return;

        let loadedSummary: AnalyticsSummaryResponse | null = null;
        if (summaryRes.status === 'fulfilled') {
          loadedSummary = summaryRes.value;
          setStreamSummary(loadedSummary);
        } else {
          setStreamBundleError(extractApiErrorMessage(summaryRes.reason));
        }

        if (heatmapRes.status === 'fulfilled') {
          setStreamHeatmap(heatmapRes.value);
        } else {
          setStreamHeatmap(null);
        }

        if (gazePlotRes.status === 'fulfilled') {
          setGazePlotMeta(gazePlotRes.value);
          setGazePlotPoints(gazePlotRes.value.points);
          setGazePlotNextCursor(gazePlotRes.value.nextCursor);
        } else {
          setGazePlotMeta(null);
          setGazePlotPoints([]);
          setGazePlotNextCursor(null);
        }

        if (replayRes.status === 'fulfilled') {
          setReplayMeta(replayRes.value);
          setReplayGazeSamples(replayRes.value.gazeSamples.samples);
          setReplayGameplaySamples(replayRes.value.gameplaySamples.samples);
          setReplayGazeCursor(replayRes.value.gazeSamples.nextCursor);
          setReplayGameplayCursor(replayRes.value.gameplaySamples.nextCursor);
        } else {
          setReplayMeta(null);
          setReplayGazeSamples([]);
          setReplayGameplaySamples([]);
          setReplayGazeCursor(null);
          setReplayGameplayCursor(null);
        }

        // Derive [from, to) ISO instants for telemetryApi.getHistoricalSamples (8084)
        const currentDetail = sessionDetailRef.current;
        const observedRange = loadedSummary?.completeness.observedTimeRange;
        const fromBound =
          observedRange?.minimum ||
          currentDetail?.startedAt ||
          new Date(Date.now() - 86400000).toISOString();
        const maxMs = observedRange?.maximum
          ? new Date(observedRange.maximum).getTime() + 1000
          : currentDetail?.endedAt
          ? new Date(currentDetail.endedAt).getTime() + 60000
          : Date.now() + 60000;
        const toBound = new Date(maxMs).toISOString();

        setRawFromIso(fromBound);
        setRawToIso(toBound);

        setLoadingRawSamples(true);
        setRawSamplesError(null);
        try {
          const rawPage = await telemetryApi.getHistoricalSamples(selectedSessionId, {
            streamId: selectedStreamId,
            from: fromBound,
            to: toBound,
            limit: 100,
          });
          if (!cancelled) {
            setRawSamples(rawPage.samples);
            setRawNextCursor(rawPage.nextCursor);
          }
        } catch (rawErr) {
          if (!cancelled) {
            setRawSamples([]);
            setRawNextCursor(null);
            setRawSamplesError(extractApiErrorMessage(rawErr));
          }
        } finally {
          if (!cancelled) setLoadingRawSamples(false);
        }
      } finally {
        if (!cancelled) setLoadingStreamBundle(false);
      }
    };

    void loadStreamBundle();
    return () => {
      cancelled = true;
    };
  }, [isCognito, selectedSessionId, selectedStreamId]);

  // Replay playback timer
  const activeReplayLength =
    replayLaneTab === 'gaze' ? replayGazeSamples.length : replayGameplaySamples.length;

  useEffect(() => {
    if (!isReplayPlaying || activeReplayLength === 0) return;
    const timer = window.setInterval(() => {
      setReplayFrameIdx((prev) => {
        if (prev + 1 >= activeReplayLength) {
          setIsReplayPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 120);
    return () => window.clearInterval(timer);
  }, [isReplayPlaying, activeReplayLength]);

  const handleLoadMoreGazePlot = async () => {
    if (!selectedSessionId || !selectedStreamId || !gazePlotNextCursor) return;
    setLoadingMoreGazePlot(true);
    try {
      const next = await analyticsApi.getStreamGazePlot(selectedSessionId, selectedStreamId, {
        pageSize: 200,
        cursor: gazePlotNextCursor,
      });
      setGazePlotMeta(next);
      setGazePlotPoints((prev) => [...prev, ...next.points]);
      setGazePlotNextCursor(next.nextCursor);
    } catch (err) {
      showToast(`Error cargando Gaze Plot: ${extractApiErrorMessage(err)}`);
    } finally {
      setLoadingMoreGazePlot(false);
    }
  };

  const handleLoadMoreReplay = async () => {
    if (!selectedSessionId || !selectedStreamId || (!replayGazeCursor && !replayGameplayCursor)) {
      return;
    }
    setLoadingMoreReplay(true);
    try {
      const next = await analyticsApi.getStreamReplay(selectedSessionId, selectedStreamId, {
        pageSize: 200,
        gazeCursor: replayGazeCursor ?? undefined,
        gameplayCursor: replayGameplayCursor ?? undefined,
      });
      setReplayMeta(next);
      setReplayGazeSamples((prev) => [...prev, ...next.gazeSamples.samples]);
      setReplayGameplaySamples((prev) => [...prev, ...next.gameplaySamples.samples]);
      setReplayGazeCursor(next.gazeSamples.nextCursor);
      setReplayGameplayCursor(next.gameplaySamples.nextCursor);
    } catch (err) {
      showToast(`Error cargando siguiente página de replay: ${extractApiErrorMessage(err)}`);
    } finally {
      setLoadingMoreReplay(false);
    }
  };

  const handleReloadRawSamples = async () => {
    if (!selectedSessionId || !selectedStreamId || !rawFromIso || !rawToIso) return;
    setLoadingRawSamples(true);
    setRawSamplesError(null);
    try {
      const rawPage = await telemetryApi.getHistoricalSamples(selectedSessionId, {
        streamId: selectedStreamId,
        from: rawFromIso,
        to: rawToIso,
        limit: 100,
      });
      setRawSamples(rawPage.samples);
      setRawNextCursor(rawPage.nextCursor);
    } catch (err) {
      setRawSamplesError(extractApiErrorMessage(err));
    } finally {
      setLoadingRawSamples(false);
    }
  };

  const handleLoadMoreRawSamples = async () => {
    if (!selectedSessionId || !selectedStreamId || !rawNextCursor || !rawFromIso || !rawToIso) {
      return;
    }
    setLoadingMoreRaw(true);
    try {
      const rawPage = await telemetryApi.getHistoricalSamples(selectedSessionId, {
        streamId: selectedStreamId,
        from: rawFromIso,
        to: rawToIso,
        limit: 100,
        cursor: rawNextCursor,
      });
      setRawSamples((prev) => [...prev, ...rawPage.samples]);
      setRawNextCursor(rawPage.nextCursor);
    } catch (err) {
      setRawSamplesError(extractApiErrorMessage(err));
    } finally {
      setLoadingMoreRaw(false);
    }
  };

  const handleExportCognitoCSV = () => {
    if (rawSamples.length === 0) {
      showToast('No hay muestras crudas cargadas para exportar.');
      return;
    }
    const headers = [
      'sampleTime',
      'kind',
      'sequenceNumber',
      'index',
      'offsetMs',
      'x',
      'y',
      'confidence',
      'playerX',
      'playerY',
      'targetX',
      'targetY',
      'score',
      'speed',
      'progress',
      'batchId',
    ];
    const rows = rawSamples.map((s) =>
      [
        s.sampleTime,
        s.kind,
        s.sequenceNumber,
        s.index,
        s.offsetMs,
        s.x ?? '',
        s.y ?? '',
        s.confidence ?? '',
        s.playerX ?? '',
        s.playerY ?? '',
        s.targetX ?? '',
        s.targetY ?? '',
        s.score ?? '',
        s.speed ?? '',
        s.progress ?? '',
        s.batchId,
      ].join(',')
    );
    const blob = new Blob([[headers.join(','), ...rows].join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Telemetria_${selectedSessionId.slice(0, 12)}_${selectedStreamId || 'stream'}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast(`Exportadas ${rawSamples.length} muestras crudas en CSV.`);
  };

  const filteredCognitoSessions = useMemo(() => {
    return sessionsList.filter((s) => {
      if (sessionFilterStatus !== 'ALL' && s.status !== sessionFilterStatus) return false;
      if (sessionFilterExercise !== 'ALL' && s.exerciseCode !== sessionFilterExercise) return false;
      if (sessionSearch.trim()) {
        const q = sessionSearch.toLowerCase().trim();
        if (
          !s.therapySessionId.toLowerCase().includes(q) &&
          !s.exerciseCode.toLowerCase().includes(q) &&
          !s.quotaDate.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [sessionsList, sessionFilterStatus, sessionFilterExercise, sessionSearch]);

  const gazePointDurations = useMemo(
    () => computeGazePointDurations(gazePlotPoints),
    [gazePlotPoints]
  );

  // =====================================================================
  // MOCK DATA & STATE (PRESERVED)
  // =====================================================================
  const auditSessions: ExtendedAuditSession[] = useMemo(() => {
    const baseSessions = currentPatient.sessionHistory || [];
    const defaultAuditRows: ExtendedAuditSession[] = [
      {
        id: '#SES-9821',
        dateText: 'Hoy, 08:30 AM',
        timeText: '08:30 AM',
        period: 'Mañana',
        moduleName: 'Exploración Sacádica Visual',
        moduleDetail: 'Hemicampo Izq (Déficit PCA)',
        hemifieldTarget: 'Hemicampo Izq (Déficit PCA)',
        planVersion: 'v1.2 (Inmutable)',
        durationMinutes: 14.75,
        targetDurationMinutes: 15,
        complianceRate: 98,
        fovealPrecision: 96,
        gazeQualityIndex: 96.4,
        qualityNote: '120Hz estable',
        angularErrorDeg: 0.7,
        angularNote: 'Alta precisión',
        isValid: true,
        validationStatus: 'VALID_OPTIMAL',
        validationLabel: 'Completada',
      },
      {
        id: '#SES-9818',
        dateText: 'Ayer, 04:15 PM',
        timeText: '04:15 PM',
        period: 'Tarde',
        moduleName: 'Búsqueda Visual Guiada',
        moduleDetail: 'Hemicampo Izq + Central',
        hemifieldTarget: 'Hemicampo Izq + Central',
        planVersion: 'v1.2 (Inmutable)',
        durationMinutes: 15,
        targetDurationMinutes: 15,
        complianceRate: 100,
        fovealPrecision: 94,
        gazeQualityIndex: 94.1,
        qualityNote: '120Hz estable',
        angularErrorDeg: 0.9,
        angularNote: 'Dentro de norma',
        isValid: true,
        validationStatus: 'VALID_OPTIMAL',
        validationLabel: 'Completada',
      },
      {
        id: '#SES-9804',
        dateText: '12 Nov, 06:10 PM',
        timeText: '06:10 PM',
        period: 'Tarde',
        moduleName: 'Exploración Sacádica Visual',
        moduleDetail: 'Hemicampo Izq (Déficit PCA)',
        hemifieldTarget: 'Hemicampo Izq (Déficit PCA)',
        planVersion: 'v1.2 (Inmutable)',
        durationMinutes: 6.2,
        targetDurationMinutes: 15,
        complianceRate: 41,
        fovealPrecision: 78,
        gazeQualityIndex: 78.2,
        qualityNote: 'Parpadeo frecuente',
        angularErrorDeg: 1.6,
        angularNote: 'Desviación foveal',
        isValid: false,
        interrupted: true,
        validationStatus: 'INTERRUPTED_FATIGUE',
        validationLabel: 'Abortada / Fatiga Nvl 4',
        notes:
          'Sesión abortada automáticamente por el protocolo de seguridad debido a fatiga ocular (caída de velocidad microsacádica e incremento de parpadeo).',
      },
      {
        id: '#SES-9791',
        dateText: '11 Nov, 09:00 AM',
        timeText: '09:00 AM',
        period: 'Mañana',
        moduleName: 'Fijación Foveal Dinámica',
        moduleDetail: 'Línea Media & Central',
        hemifieldTarget: 'Línea Media & Central',
        planVersion: 'v1.2 (Inmutable)',
        durationMinutes: 15,
        targetDurationMinutes: 15,
        complianceRate: 100,
        fovealPrecision: 98,
        gazeQualityIndex: 98.2,
        qualityNote: 'Sin pérdida de señal',
        angularErrorDeg: 0.5,
        angularNote: 'Excelente foveación',
        isValid: true,
        validationStatus: 'VALID_OPTIMAL',
        validationLabel: 'Completada',
      },
      {
        id: '#SES-9770',
        dateText: '09 Nov, 03:40 PM',
        timeText: '03:40 PM',
        period: 'Tarde',
        moduleName: 'Ampliación de Campo Visual',
        moduleDetail: 'Hemicampo Izq Extremo',
        hemifieldTarget: 'Hemicampo Izq Extremo',
        planVersion: 'v1.1',
        durationMinutes: 4.5,
        targetDurationMinutes: 15,
        complianceRate: 30,
        fovealPrecision: 64,
        gazeQualityIndex: 64.0,
        qualityNote: 'Postura corporal alterada',
        angularErrorDeg: 2.1,
        angularNote: 'Filtro no convergente',
        isValid: false,
        interrupted: true,
        validationStatus: 'CALIBRATION_ISSUE',
        validationLabel: 'Pérdida de Rastreador',
        notes:
          'Desplazamiento cefálico fuera del umbral de compensación de glabela. Se requirió recalibración.',
      },
      {
        id: '#SES-9755',
        dateText: '08 Nov, 08:35 AM',
        timeText: '08:35 AM',
        period: 'Mañana',
        moduleName: 'Exploración Sacádica Visual',
        moduleDetail: 'Hemicampo Izq (Déficit PCA)',
        hemifieldTarget: 'Hemicampo Izq (Déficit PCA)',
        planVersion: 'v1.1',
        durationMinutes: 15,
        targetDurationMinutes: 15,
        complianceRate: 100,
        fovealPrecision: 96,
        gazeQualityIndex: 95.8,
        qualityNote: '120Hz estable',
        angularErrorDeg: 0.8,
        angularNote: 'Alta precisión',
        isValid: true,
        validationStatus: 'VALID_OPTIMAL',
        validationLabel: 'Completada',
      },
      {
        id: '#SES-9732',
        dateText: '06 Nov, 08:20 AM',
        timeText: '08:20 AM',
        period: 'Mañana',
        moduleName: 'Búsqueda Visual Guiada',
        moduleDetail: 'Hemicampo Izq + Central',
        hemifieldTarget: 'Hemicampo Izq + Central',
        planVersion: 'v1.1',
        durationMinutes: 15,
        targetDurationMinutes: 15,
        complianceRate: 100,
        fovealPrecision: 93,
        gazeQualityIndex: 92.7,
        qualityNote: '120Hz estable',
        angularErrorDeg: 1.0,
        angularNote: 'Dentro de norma',
        isValid: true,
        validationStatus: 'VALID_OPTIMAL',
        validationLabel: 'Completada',
      },
      {
        id: '#SES-9710',
        dateText: '04 Nov, 04:00 PM',
        timeText: '04:00 PM',
        period: 'Tarde',
        moduleName: 'Exploración Sacádica Visual',
        moduleDetail: 'Hemicampo Izq (Déficit PCA)',
        hemifieldTarget: 'Hemicampo Izq (Déficit PCA)',
        planVersion: 'v1.0',
        durationMinutes: 14.8,
        targetDurationMinutes: 15,
        complianceRate: 99,
        fovealPrecision: 96,
        gazeQualityIndex: 96.1,
        qualityNote: '120Hz estable',
        angularErrorDeg: 0.9,
        angularNote: 'Alta precisión',
        isValid: true,
        validationStatus: 'VALID_OPTIMAL',
        validationLabel: 'Completada',
      },
    ];

    if (baseSessions.length === 0) return defaultAuditRows;

    const mapped = baseSessions.map((s, idx): ExtendedAuditSession => ({
      ...s,
      id: s.id.startsWith('#') ? s.id : `#SES-${9821 - idx * 7}`,
      hemifieldTarget:
        s.moduleDetail ||
        (currentPatient.affectedHemifield === 'LEFT'
          ? 'Hemicampo Izq (Déficit PCA)'
          : 'Hemicampo Der'),
      planVersion: idx < 4 ? 'v1.2 (Inmutable)' : 'v1.1',
      gazeQualityIndex: s.isValid ? Number((s.fovealPrecision + 0.4).toFixed(1)) : 76.4,
      qualityNote: s.isValid ? '120Hz estable' : 'Parpadeo frecuente',
      angularErrorDeg: s.isValid ? Number((1.5 - (s.fovealPrecision - 85) * 0.06).toFixed(1)) : 1.7,
      angularNote: s.isValid ? 'Alta precisión' : 'Desviación foveal',
      validationLabel: s.isValid
        ? 'Completada'
        : s.validationStatus === 'CALIBRATION_ISSUE'
        ? 'Pérdida de Rastreador'
        : 'Abortada / Fatiga Nvl 4',
    }));

    return mapped.length >= 6 ? mapped : defaultAuditRows;
  }, [currentPatient]);

  const [dateRangePreset, setDateRangePreset] = useState<'7d' | '30d' | 'all'>('30d');
  const [exerciseFilter, setExerciseFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyValidGaze, setOnlyValidGaze] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 6;

  const [selectedSessionForAnalytics, setSelectedSessionForAnalytics] = useState<SessionRecord | null>(null);
  const [fhirJsonModalSession, setFhirJsonModalSession] = useState<ExtendedAuditSession | null>(null);

  const filteredSessions = useMemo(() => {
    let list = [...auditSessions];

    if (dateRangePreset === '7d') {
      list = list.slice(0, 4);
    }

    if (exerciseFilter !== 'ALL') {
      list = list.filter((s) => s.moduleName.toLowerCase().includes(exerciseFilter.toLowerCase()));
    }

    if (statusFilter !== 'ALL') {
      if (statusFilter === 'COMPLETED')
        list = list.filter((s) => s.validationStatus === 'VALID_OPTIMAL');
      if (statusFilter === 'FATIGUE')
        list = list.filter((s) => s.validationStatus === 'INTERRUPTED_FATIGUE');
      if (statusFilter === 'CALIBRATION')
        list = list.filter((s) => s.validationStatus === 'CALIBRATION_ISSUE');
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (s) =>
          s.id.toLowerCase().includes(q) ||
          s.moduleName.toLowerCase().includes(q) ||
          s.dateText.toLowerCase().includes(q)
      );
    }

    if (onlyValidGaze) {
      list = list.filter((s) => s.gazeQualityIndex >= 80);
    }

    return list;
  }, [auditSessions, dateRangePreset, exerciseFilter, statusFilter, searchQuery, onlyValidGaze]);

  const totalPages = Math.ceil(filteredSessions.length / pageSize) || 1;
  const paginatedSessions = filteredSessions.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const handleResetFilters = () => {
    setDateRangePreset('30d');
    setExerciseFilter('ALL');
    setStatusFilter('ALL');
    setSearchQuery('');
    setOnlyValidGaze(false);
    setCurrentPage(1);
    showToast('Filtros de auditoría restablecidos.');
  };

  const handleExportLogCSV = () => {
    const headers = [
      'ID Sesion',
      'Fecha',
      'Periodo',
      'Ejercicio',
      'Hemicampo',
      'Version Plan',
      'Duracion (min)',
      'Gaze Quality (%)',
      'Error Angular (deg)',
      'Estado',
    ];
    const rows = filteredSessions.map((s) => [
      s.id,
      `"${s.dateText}"`,
      s.period,
      `"${s.moduleName}"`,
      `"${s.hemifieldTarget}"`,
      `"${s.planVersion}"`,
      s.durationMinutes,
      `${s.gazeQualityIndex}%`,
      `${s.angularErrorDeg} deg`,
      `"${s.validationLabel}"`,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute(
      'download',
      `Auditoria_Telemetria_${currentPatient.medicalRecordNumber.replace('#', '')}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast('Log de telemetría exportado en formato FHIR / CSV.');
  };

  const formatDurationText = (minutes: number, target = 15) => {
    const mins = Math.floor(minutes);
    const secs = Math.round((minutes - mins) * 60);
    const minStr = String(mins).padStart(2, '0');
    const secStr = String(secs).padStart(2, '0');
    return `${minStr} min ${secStr} s / ${target} min`;
  };

  // =====================================================================
  // COGNITO RENDER
  // =====================================================================
  if (isCognito) {
    const patientDisplayName = formatPatientDisplayName(patientDetail, activePatientId);
    const selectedMode = sessionDetail ? extractModeFromDetail(sessionDetail) : undefined;
    const maxHeatCount = streamHeatmap ? Math.max(1, ...streamHeatmap.cellCounts) : 1;
    const activeGazeReplayFrame = replayGazeSamples[replayFrameIdx] || null;
    const activeGameplayReplayFrame = replayGameplaySamples[replayFrameIdx] || null;

    return (
      <div className="min-h-screen bg-[#F3FAFF] text-[#071E27] font-sans flex flex-col justify-between antialiased selection:bg-[#81F3E5] selection:text-[#00201D]">
        {toastMessage && (
          <div className="fixed bottom-6 right-6 z-50 bg-[#071524] text-white px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-xs font-semibold border border-[#006A62]">
            <CheckCircle2 className="w-4 h-4 text-[#84F5E8]" />
            <span>{toastMessage}</span>
          </div>
        )}

        <SpecialistHeader
          activeTab="telemetria"
          onTabChange={(tab) => {
            if (tab === 'pacientes') navigate('/specialist/dashboard');
            else if (tab === 'protocolos')
              navigate(`/specialist/patients/${encodeURIComponent(activePatientId)}/parametros`);
            else if (tab === 'interconsultas')
              navigate(
                `/specialist/patients/${encodeURIComponent(activePatientId)}/reporte-pdf${
                  selectedSessionId ? `?sessionId=${encodeURIComponent(selectedSessionId)}` : ''
                }`
              );
          }}
          onOpenNotifications={() => showToast('Telemetría (8084) y Analítica (8085) conectadas.')}
        />

        <main className="flex-1 w-full max-w-[1536px] mx-auto px-4 md:px-8 py-6 flex flex-col gap-6">
          {/* Breadcrumb & Header */}
          <div className="flex flex-col gap-3">
            <nav className="flex items-center gap-2 text-xs font-medium text-[#44474C] overflow-x-auto whitespace-nowrap py-1">
              <button
                type="button"
                onClick={() => navigate('/specialist/dashboard')}
                className="hover:text-[#071524] transition-colors flex items-center gap-1 cursor-pointer"
              >
                <Hospital className="w-3.5 h-3.5 text-[#006A62]" />
                Portal Clínico
              </button>
              <ChevronRight className="w-3.5 h-3.5 text-[#74777C]" />
              <button
                type="button"
                onClick={() => navigate(`/specialist/patients/${encodeURIComponent(activePatientId)}`)}
                className="hover:text-[#071524] transition-colors cursor-pointer"
              >
                {patientDisplayName}
              </button>
              <ChevronRight className="w-3.5 h-3.5 text-[#74777C]" />
              <span className="text-[#071524] font-bold">Auditoría de Telemetría (8084 + 8085)</span>
            </nav>

            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pt-1 border-b border-[#071524]/10 pb-4">
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => navigate(`/specialist/patients/${encodeURIComponent(activePatientId)}`)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-[#071524] bg-[#E6F6FF] hover:bg-[#D5ECF8] border border-[#071524]/10 rounded-xl transition-all cursor-pointer shrink-0"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Volver al Expediente
                </button>
                <div>
                  <h1 className="text-xl sm:text-2xl font-bold text-[#071524] tracking-tight">
                    Auditoría Forense de Telemetría & Analítica Oculomotora
                  </h1>
                  <p className="text-xs text-[#44474C]">
                    Heatmap, Gaze Plot [0..1], Replay Sincronizado y Muestras Crudas (8084 + 8085)
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5 text-[10px] font-mono">
                    <span className="px-2 py-0.5 rounded bg-[#E6F6FF] text-[#071524] border border-[#071524]/15">
                      Sesión y Progreso: Clinical 8083
                    </span>
                    <span className="px-2 py-0.5 rounded bg-[#DCF8F2] text-[#005049] border border-[#006A62]/20">
                      Heatmap / GazePlot / Replay / Ensayos: Analytics 8085
                    </span>
                    <span className="px-2 py-0.5 rounded bg-[#FEF3C7] text-[#92400E] border border-[#F59E0B]/30">
                      Muestras Crudas (sampleTime = capturedAt + offsetMs): Telemetry 8084
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleExportCognitoCSV}
                  className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-[#071524] bg-[#E6F6FF] hover:bg-[#D5ECF8] border border-[#071524]/20 rounded-xl transition-all cursor-pointer"
                >
                  <Download className="w-4 h-4 text-[#006A62]" />
                  Exportar Muestras CSV
                </button>
                <button
                  type="button"
                  onClick={() => setCognitoJsonInspectorOpen(true)}
                  disabled={!sessionDetail && !streamSummary}
                  className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-[#071524] bg-white hover:bg-[#DBF1FE] border border-[#071524]/20 rounded-xl transition-all cursor-pointer disabled:opacity-50"
                >
                  <Code2 className="w-4 h-4 text-[#006A62]" />
                  Inspector JSON
                </button>
                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      `/specialist/patients/${encodeURIComponent(activePatientId)}/reporte-pdf${
                        selectedSessionId ? `?sessionId=${encodeURIComponent(selectedSessionId)}` : ''
                      }`
                    )
                  }
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-[#006A62] hover:bg-[#005049] rounded-xl transition-all shadow-xs cursor-pointer"
                >
                  <FileText className="w-4 h-4" />
                  Visor & PDF Clínico
                </button>
              </div>
            </div>
          </div>

          {/* Patient & Session Selector Card */}
          <div className="bg-[#E6F6FF] border border-[#071524]/10 rounded-xl p-5 shadow-xs space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-center">
              <div className="flex items-center gap-3 pr-4 border-r-0 lg:border-r border-[#071524]/10">
                <div className="w-12 h-12 rounded-xl bg-[#1C2A39] text-[#84F5E8] flex items-center justify-center font-bold text-base shrink-0">
                  {formatPatientInitials(patientDetail)}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-[#071524] truncate">{patientDisplayName}</div>
                  <div className="text-[11px] font-mono text-[#44474C] truncate">
                    ID: {activePatientId}
                  </div>
                  {patientDetail && (
                    <span className="inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-bold bg-[#81F3E5] text-[#005049]">
                      {patientDetail.status}
                    </span>
                  )}
                </div>
              </div>

              <div className="pr-4 border-r-0 lg:border-r border-[#071524]/10">
                <div className="text-[11px] font-semibold text-[#44474C] uppercase tracking-wider">
                  Diagnóstico & Contexto
                </div>
                <div className="text-xs font-bold text-[#071524] mt-1">
                  {patientDetail?.strokeDiagnosis ||
                    rehabContext?.previousDiagnosis ||
                    'Diagnóstico en evaluación'}
                </div>
                <div className="text-[11px] text-[#006A62] font-semibold mt-0.5">
                  Hemicampo:{' '}
                  {rehabContext?.affectedHemifield ||
                    (patientDetail?.sequelae?.length ? patientDetail.sequelae.join(', ') : 'No especificado')}
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[#44474C] uppercase tracking-wider block mb-1">
                  Sesión Auditada
                </label>
                <select
                  value={selectedSessionId}
                  onChange={(e) => handleSelectSession(e.target.value)}
                  disabled={sessionsList.length === 0}
                  className="w-full bg-white border border-[#071524]/15 rounded-lg px-2.5 py-2 text-xs font-mono font-semibold text-[#071524] focus:outline-none focus:ring-2 focus:ring-[#006A62]"
                >
                  {sessionsList.length === 0 ? (
                    <option value="">Sin sesiones registradas</option>
                  ) : (
                    sessionsList.map((s) => (
                      <option key={s.therapySessionId} value={s.therapySessionId}>
                        {s.therapySessionId.slice(0, 10)}… · {s.exerciseCode} · {s.status} ({s.quotaDate})
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[#44474C] uppercase tracking-wider block mb-1">
                  Stream Analítico (8085)
                </label>
                <div className="flex items-center gap-2">
                  <select
                    value={selectedStreamId}
                    onChange={(e) => setSelectedStreamId(e.target.value)}
                    disabled={streams.length === 0}
                    className="w-full bg-white border border-[#071524]/15 rounded-lg px-2.5 py-2 text-xs font-mono font-semibold text-[#071524] focus:outline-none focus:ring-2 focus:ring-[#006A62]"
                  >
                    {streams.length === 0 ? (
                      <option value="">Sin streams disponibles</option>
                    ) : (
                      streams.map((st) => (
                        <option key={st.streamId} value={st.streamId}>
                          {st.streamId} ({st.sampleCounts.total} muestras · rev {st.revision})
                        </option>
                      ))
                    )}
                  </select>
                  {selectedSessionId && (
                    <button
                      type="button"
                      onClick={() => setCognitoModalOpen(true)}
                      className="p-2 rounded-lg bg-[#071524] text-white hover:bg-[#1C2A39] cursor-pointer shrink-0"
                      title="Abrir resumen rápido en modal"
                    >
                      <Activity className="w-4 h-4 text-[#84F5E8]" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {sessionsError && (
            <div className="bg-[#FFDAD6] border border-[#BA1A1A]/30 rounded-xl p-4 flex items-center justify-between text-xs text-[#93000A]">
              <span className="font-semibold">Error cargando sesiones: {sessionsError}</span>
              <button
                type="button"
                onClick={() => void loadPatientAndSessions()}
                className="px-3 py-1.5 rounded-lg bg-[#93000A] text-white font-bold cursor-pointer"
              >
                Reintentar
              </button>
            </div>
          )}

          {sessionDetailError && (
            <div className="bg-[#FFDAD6] border border-[#BA1A1A]/30 rounded-xl p-4 text-xs text-[#93000A] font-semibold">
              Error cargando detalle de sesión: {sessionDetailError}
            </div>
          )}

          {loadingSessions && sessionsList.length === 0 ? (
            <div className="bg-white rounded-xl border border-[#071524]/10 p-10 flex items-center justify-center gap-2 text-sm text-[#44474C]">
              <Loader2 className="w-5 h-5 animate-spin text-[#006A62]" />
              <span>Cargando sesiones clínicas del paciente...</span>
            </div>
          ) : !selectedSessionId ? (
            <div className="bg-white rounded-xl border border-[#071524]/10 p-10 text-center text-sm text-[#44474C]">
              El paciente aún no tiene sesiones registradas para auditar.
            </div>
          ) : (
            <>
              {/* Session Detail + Stream Summary KPIs */}
              <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white border border-[#071524]/10 rounded-xl p-4 shadow-xs">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[#44474C]">
                    Configuración & Modo
                  </div>
                  <div className="text-sm font-extrabold text-[#071524] mt-1">
                    {selectedMode ? MODE_LABELS[selectedMode] : 'Cargando...'}
                  </div>
                  <div className="text-[11px] text-[#44474C] font-mono mt-1">
                    {sessionDetail
                      ? `${sessionDetail.exerciseCode} · v${sessionDetail.configurationVersion} · ${sessionDetail.status}`
                      : '—'}
                  </div>
                </div>

                <div className="bg-white border border-[#071524]/10 rounded-xl p-4 shadow-xs">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[#44474C]">
                    Duración & Progreso Técnico
                  </div>
                  <div className="text-xl font-extrabold text-[#071524] mt-1">
                    {sessionDetail ? formatDurationSeconds(sessionDetail.activeDurationSeconds) : '—'}
                  </div>
                  <div className="text-[11px] text-[#006A62] font-semibold mt-1">
                    {sessionDetail?.technicalProgress.availability === 'AVAILABLE'
                      ? `${sessionDetail.technicalProgress.completedRepetitions} reps · Meta ${sessionDetail.technicalProgress.target} (${sessionDetail.technicalProgress.criterion}) ${
                          sessionDetail.technicalProgress.targetReached ? '✓' : ''
                        }`
                      : 'Esquema v1 / Sin progreso técnico'}
                  </div>
                </div>

                <div className="bg-white border border-[#071524]/10 rounded-xl p-4 shadow-xs">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[#44474C] flex items-center gap-1">
                    Muestras & Completitud (8085)
                    <ClinicalTermTooltip termId="SEQUENCE_COMPLETENESS" audience="specialist" iconSize={12} />
                  </div>
                  <div className="text-xl font-extrabold text-[#071524] mt-1">
                    {streamSummary
                      ? `${streamSummary.completeness.sampleCounts.gaze} gaze / ${streamSummary.completeness.sampleCounts.gameplay} game`
                      : loadingStreamBundle
                      ? 'Cargando...'
                      : 'Sin datos'}
                  </div>
                  <div className="text-[11px] text-[#44474C] mt-1">
                    {streamSummary
                      ? `Seq [${streamSummary.completeness.minimumSequence}..${streamSummary.completeness.maximumSequence}] · Faltantes: ${streamSummary.completeness.missingSequenceRangeCount} · Tardíos: ${streamSummary.completeness.lateArrivalCount}`
                      : 'Seleccione un stream con proyecciones'}
                  </div>
                </div>

                <div className="bg-white border border-[#071524]/10 rounded-xl p-4 shadow-xs">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[#44474C] flex items-center gap-1">
                    Confianza & Trayectoria Ocular
                    <ClinicalTermTooltip termId="CONFIDENCE_MEAN" audience="specialist" iconSize={12} />
                  </div>
                  <div className="text-xl font-extrabold text-[#006A62] mt-1">
                    {streamSummary?.metrics.confidence.mean !== null &&
                    streamSummary?.metrics.confidence.mean !== undefined
                      ? `${(streamSummary.metrics.confidence.mean * 100).toFixed(1)}%`
                      : '—'}
                  </div>
                  <div className="text-[11px] text-[#44474C] mt-1">
                    {streamSummary
                      ? `Distancia: ${streamSummary.metrics.gazePath.totalDistance.toFixed(2)} · Cobertura: ${(
                          streamSummary.metrics.coverage.occupiedCellRatio * 100
                        ).toFixed(1)}%`
                      : '—'}
                  </div>
                </div>
              </section>

              {/* Trial Summary Banner */}
              <section className="bg-white border border-[#071524]/10 rounded-xl p-4 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <h2 className="text-sm font-bold text-[#071524] flex items-center gap-2">
                    <Ruler className="w-4 h-4 text-[#006A62]" />
                    Resumen de Ensayos Clínicos ({trialDataOrigin})
                    <ClinicalTermTooltip termId="INPUT_ORIGIN" audience="specialist" />
                  </h2>
                  <div className="flex items-center gap-2">
                    <select
                      value={trialDataOrigin}
                      onChange={(e) =>
                        setTrialDataOrigin(e.target.value as 'PRODUCER_REPORTED' | 'SYNTHETIC')
                      }
                      aria-label="Origen de datos de ensayos clínicos"
                      className="bg-[#F3FAFF] border border-[#071524]/15 rounded-lg px-2.5 py-1 text-xs font-semibold text-[#071524] focus:outline-none focus:ring-2 focus:ring-[#006A62] cursor-pointer"
                    >
                      <option value="PRODUCER_REPORTED">
                        PRODUCER_REPORTED (Mirada Webcam)
                      </option>
                      <option value="SYNTHETIC">
                        SYNTHETIC (Contingencia Ratón / Simulación)
                      </option>
                    </select>
                    {(loadingSessionDetail || loadingTrialSummary) && (
                      <span className="text-xs text-[#006A62] inline-flex items-center gap-1">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Consultando...
                      </span>
                    )}
                  </div>
                </div>

                {trialError ? (
                  <div className="bg-[#FFDAD6] border border-[#BA1A1A]/30 rounded-lg p-3 text-xs text-[#93000A] font-semibold">
                    {trialError}
                  </div>
                ) : trialSummary ? (
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                    <div className="p-2.5 rounded-lg bg-[#E6F6FF]">
                      <span className="text-[11px] text-[#44474C] block">Ensayos Reportados</span>
                      <strong className="text-[#071524]">{trialSummary.reportedTrialCount}</strong>
                    </div>
                    <div className="p-2.5 rounded-lg bg-[#E6F6FF]">
                      <span className="text-[11px] text-[#44474C] block">Versión Cálculo</span>
                      <strong className="font-mono text-[#071524]">{trialSummary.calculationVersion}</strong>
                    </div>
                    {'hitCount' in trialSummary && (
                      <>
                        <div className="p-2.5 rounded-lg bg-[#E6F6FF]">
                          <span className="text-[11px] text-[#44474C] block">Aciertos / Omisiones</span>
                          <strong className="text-[#006A62]">
                            {trialSummary.hitCount} / {trialSummary.omissionCount}
                          </strong>
                        </div>
                        <div className="p-2.5 rounded-lg bg-[#E6F6FF]">
                          <span className="text-[11px] text-[#44474C] block">Interrupciones / Elegibles</span>
                          <strong className="text-[#071524]">
                            {trialSummary.interruptedCount} / {trialSummary.eligibleSearchCount}
                          </strong>
                        </div>
                        <div className="p-2.5 rounded-lg bg-[#E6F6FF]">
                          <span className="text-[11px] text-[#44474C] flex items-center gap-1">
                            Mediana Búsqueda
                            <ClinicalTermTooltip termId="MEDIAN_DURATION" audience="specialist" iconSize={12} />
                          </span>
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
                        <div className="p-2.5 rounded-lg bg-[#E6F6FF]">
                          <span className="text-[11px] text-[#44474C] block">Detectados / Omisiones</span>
                          <strong className="text-[#006A62]">
                            {trialSummary.detectedTargetCount} / {trialSummary.omissionCount}
                          </strong>
                        </div>
                        <div className="p-2.5 rounded-lg bg-[#E6F6FF]">
                          <span className="text-[11px] text-[#44474C] block">Interrupciones / Elegibles</span>
                          <strong className="text-[#071524]">
                            {trialSummary.interruptedCount} / {trialSummary.eligibleLocalizationCount}
                          </strong>
                        </div>
                        <div className="p-2.5 rounded-lg bg-[#E6F6FF]">
                          <span className="text-[11px] text-[#44474C] flex items-center gap-1">
                            Mediana Localización
                            <ClinicalTermTooltip termId="MEDIAN_DURATION" audience="specialist" iconSize={12} />
                          </span>
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
                        <div className="p-2.5 rounded-lg bg-[#E6F6FF]">
                          <span className="text-[11px] text-[#44474C] block">Tiempo Dentro</span>
                          <strong className="text-[#006A62]">
                            {(trialSummary.totalInsideTargetMs / 1000).toFixed(1)} s
                          </strong>
                        </div>
                        <div className="p-2.5 rounded-lg bg-[#E6F6FF]">
                          <span className="text-[11px] text-[#44474C] block">Objetivos Completados</span>
                          <strong className="text-[#071524]">{trialSummary.completedTargetCount}</strong>
                        </div>
                      </>
                    )}
                    {'reachedTargetCount' in trialSummary && (
                      <>
                        <div className="p-2.5 rounded-lg bg-[#E6F6FF]">
                          <span className="text-[11px] text-[#44474C] block">Objetivos Alcanzados</span>
                          <strong className="text-[#006A62]">{trialSummary.reachedTargetCount}</strong>
                        </div>
                        <div className="p-2.5 rounded-lg bg-[#E6F6FF]">
                          <span className="text-[11px] text-[#44474C] flex items-center gap-1">
                            Mediana Tiempo
                            <ClinicalTermTooltip termId="MEDIAN_DURATION" audience="specialist" iconSize={12} />
                          </span>
                          <strong className="text-[#071524]">
                            {trialSummary.medianTimeToTargetMs !== null
                              ? `${Math.round(trialSummary.medianTimeToTargetMs)} ms`
                              : 'N/D'}
                          </strong>
                        </div>
                      </>
                    )}
                    {'traversals' in trialSummary && (
                      <div className="p-2.5 rounded-lg bg-[#E6F6FF] col-span-2 sm:col-span-3">
                        <span className="text-[11px] text-[#44474C] block">Recorridos</span>
                        <strong className="text-[#071524]">
                          {trialSummary.traversals
                            .map((t) => `${t.outcome} (${t.coveragePercent}% · ${t.visitedRegionCount} zonas)`)
                            .join(' | ') || 'Sin recorridos'}
                        </strong>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-[#44474C]">
                    {trialNotice || 'Sin resultados de ensayos reportados para esta sesión.'}
                  </p>
                )}
              </section>

              {streamBundleError && (
                <div className="bg-[#FFF7ED] border border-[#FDBA74] text-[#9A3412] rounded-xl p-4 text-xs font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{streamBundleError}</span>
                </div>
              )}

              {/* HEATMAP & GAZE PLOT GRID */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* 1. Normalized [0..1] SVG Heatmap */}
                <section className="bg-white border border-[#071524]/10 rounded-xl p-5 shadow-xs flex flex-col gap-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-bold text-[#071524] flex items-center gap-2">
                        <Grid3X3 className="w-4 h-4 text-[#006A62]" />
                        Mapa de Calor Normalizado [0..1]
                        <ClinicalTermTooltip termId="HEATMAP" audience="specialist" />
                      </h2>
                      <p className="text-[11px] text-[#44474C]">
                        {streamHeatmap
                          ? `${streamHeatmap.columns}×${streamHeatmap.rows} celdas · ${streamHeatmap.gazeSampleCount} muestras · ${streamHeatmap.coordinateSpace} · Peso: ${streamHeatmap.cellWeight}`
                          : 'Distribución espacial de densidad de mirada'}
                      </p>
                    </div>
                    {streamHeatmap && (
                      <span className="px-2 py-0.5 rounded bg-[#E6F6FF] text-[10px] font-mono font-bold text-[#071524]">
                        {streamHeatmap.confidenceFiltered ? 'Filtrado confianza ✓' : 'Sin filtro conf.'}
                      </span>
                    )}
                  </div>

                  {streamHeatmap && streamHeatmap.columns > 0 && streamHeatmap.rows > 0 ? (
                    <>
                      <div className="bg-[#F3FAFF] border border-[#071524]/10 rounded-xl p-3">
                        <svg
                          viewBox="0 0 1000 620"
                          className="w-full h-auto rounded-lg bg-white border border-[#071524]/10"
                          role="img"
                          aria-label="Heatmap normalizado de fijación ocular"
                        >
                          {/* Axes & Normalized Grid Ticks */}
                          {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
                            const x = 50 + tick * 900;
                            const y = 30 + tick * 540;
                            return (
                              <g key={tick}>
                                <text
                                  x={x}
                                  y={598}
                                  textAnchor="middle"
                                  fontSize="18"
                                  fill="#44474C"
                                  fontFamily="monospace"
                                >
                                  {tick.toFixed(2)}
                                </text>
                                <text
                                  x={40}
                                  y={y + 6}
                                  textAnchor="end"
                                  fontSize="16"
                                  fill="#44474C"
                                  fontFamily="monospace"
                                >
                                  {tick.toFixed(2)}
                                </text>
                              </g>
                            );
                          })}

                          {/* Heatmap Cells */}
                          {streamHeatmap.cellCounts.map((count, idx) => {
                            const col = idx % streamHeatmap.columns;
                            const row = Math.floor(idx / streamHeatmap.columns);
                            const cellW = 900 / streamHeatmap.columns;
                            const cellH = 540 / streamHeatmap.rows;
                            const x = 50 + col * cellW;
                            const y = 30 + row * cellH;
                            const ratio = count / maxHeatCount;
                            const isHovered =
                              hoveredHeatCell?.col === col && hoveredHeatCell?.row === row;

                            return (
                              <rect
                                key={`${row}-${col}`}
                                x={x}
                                y={y}
                                width={cellW - 1}
                                height={cellH - 1}
                                rx={3}
                                fill={heatFillColor(ratio)}
                                stroke={isHovered ? '#BA1A1A' : '#071524'}
                                strokeOpacity={isHovered ? 0.9 : 0.08}
                                strokeWidth={isHovered ? 3 : 1}
                                onMouseEnter={() => setHoveredHeatCell({ col, row, count })}
                                onMouseLeave={() => setHoveredHeatCell(null)}
                              >
                                <title>{`Celda (${col}, ${row}): ${count} muestras`}</title>
                              </rect>
                            );
                          })}

                          {/* Central Crosshair (0.5, 0.5) */}
                          <line
                            x1={500}
                            y1={30}
                            x2={500}
                            y2={570}
                            stroke="#071524"
                            strokeOpacity={0.25}
                            strokeDasharray="6 6"
                          />
                          <line
                            x1={50}
                            y1={300}
                            x2={950}
                            y2={300}
                            stroke="#071524"
                            strokeOpacity={0.25}
                            strokeDasharray="6 6"
                          />
                        </svg>
                      </div>

                      {/* Legend & Hover Telemetry */}
                      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                        <div className="flex items-center gap-1.5 font-mono text-[11px] text-[#44474C]">
                          <span>0</span>
                          <span className="w-4 h-3 rounded-xs bg-[#F3FAFF] border border-[#071524]/15" />
                          <span className="w-4 h-3 rounded-xs bg-[#CFFAFE]" />
                          <span className="w-4 h-3 rounded-xs bg-[#81F3E5]" />
                          <span className="w-4 h-3 rounded-xs bg-[#26A69A]" />
                          <span className="w-4 h-3 rounded-xs bg-[#006A62]" />
                          <span className="w-4 h-3 rounded-xs bg-[#071524]" />
                          <span>Máx: {maxHeatCount}</span>
                        </div>
                        <div className="text-[11px] font-mono text-[#071524] font-semibold">
                          {hoveredHeatCell
                            ? `Celda (${hoveredHeatCell.col}, ${hoveredHeatCell.row}) · [${(
                                hoveredHeatCell.col / streamHeatmap.columns
                              ).toFixed(2)}..${(
                                (hoveredHeatCell.col + 1) /
                                streamHeatmap.columns
                              ).toFixed(2)}] × [${(
                                hoveredHeatCell.row / streamHeatmap.rows
                              ).toFixed(2)}..${(
                                (hoveredHeatCell.row + 1) /
                                streamHeatmap.rows
                              ).toFixed(2)}]: ${hoveredHeatCell.count} muestras`
                            : 'Pase el cursor sobre una celda para inspeccionar'}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="h-64 bg-[#F3FAFF] rounded-xl border border-[#071524]/10 flex items-center justify-center text-xs text-[#74777C]">
                      {loadingStreamBundle
                        ? 'Cargando matriz de calor...'
                        : 'Sin matriz de calor disponible para este stream.'}
                    </div>
                  )}

                  {/* Confidence Histogram */}
                  {streamSummary && streamSummary.metrics.confidenceHistogram.length > 0 && (
                    <div className="pt-2 border-t border-[#071524]/10">
                      <div className="text-[11px] font-bold text-[#44474C] mb-1.5 flex items-center gap-1">
                        Histograma de Confianza (bins 0..1)
                        <ClinicalTermTooltip termId="CONFIDENCE_MEAN" audience="specialist" iconSize={12} />
                      </div>
                      <div className="flex items-end gap-1 h-12">
                        {streamSummary.metrics.confidenceHistogram.map((binCount, idx) => {
                          const peak = Math.max(1, ...streamSummary.metrics.confidenceHistogram);
                          const heightPct = Math.max(6, Math.round((binCount / peak) * 100));
                          return (
                            <div
                              key={idx}
                              className="flex-1 bg-[#006A62]/80 rounded-t-xs transition-all"
                              style={{ height: `${heightPct}%` }}
                              title={`Bin ${idx + 1}: ${binCount} muestras`}
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}
                </section>

                {/* 2. Normalized [0..1] SVG Gaze Plot (Fixation Circles + Saccade Vectors) */}
                <section className="bg-white border border-[#071524]/10 rounded-xl p-5 shadow-xs flex flex-col gap-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-bold text-[#071524] flex items-center gap-2">
                        <Crosshair className="w-4 h-4 text-[#006A62]" />
                        Gaze Plot Vectorial [0..1] (Fijaciones & Sacadas)
                        <ClinicalTermTooltip termId="GAZE_PLOT" audience="specialist" />
                      </h2>
                      <p className="text-[11px] text-[#44474C]">
                        {gazePlotPoints.length} punto(s) cargados
                        {gazePlotMeta
                          ? ` · Observados: ${gazePlotMeta.completeness.observedGazePointCount}`
                          : ''}
                      </p>
                    </div>
                    {gazePlotNextCursor && (
                      <button
                        type="button"
                        onClick={handleLoadMoreGazePlot}
                        disabled={loadingMoreGazePlot}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#071524] text-white text-xs font-bold hover:bg-[#1C2A39] cursor-pointer disabled:opacity-50"
                      >
                        {loadingMoreGazePlot && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        Cargar más puntos Gaze Plot
                      </button>
                    )}
                  </div>

                  {gazePlotPoints.length > 0 ? (
                    <>
                      <div className="bg-[#F3FAFF] border border-[#071524]/10 rounded-xl p-3">
                        <svg
                          viewBox="0 0 1000 620"
                          className="w-full h-auto rounded-lg bg-white border border-[#071524]/10"
                          role="img"
                          aria-label="Gaze Plot normalizado de fijaciones y vectores sacádicos"
                        >
                          {/* Normalized [0..1] Gridlines */}
                          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
                            const gx = 50 + t * 900;
                            const gy = 30 + t * 540;
                            return (
                              <g key={t}>
                                <line
                                  x1={gx}
                                  y1={30}
                                  x2={gx}
                                  y2={570}
                                  stroke="#071524"
                                  strokeOpacity={t === 0.5 ? 0.25 : 0.08}
                                  strokeDasharray={t === 0.5 ? '5 5' : undefined}
                                />
                                <line
                                  x1={50}
                                  y1={gy}
                                  x2={950}
                                  y2={gy}
                                  stroke="#071524"
                                  strokeOpacity={t === 0.5 ? 0.25 : 0.08}
                                  strokeDasharray={t === 0.5 ? '5 5' : undefined}
                                />
                                <text
                                  x={gx}
                                  y={598}
                                  textAnchor="middle"
                                  fontSize="18"
                                  fill="#44474C"
                                  fontFamily="monospace"
                                >
                                  {t.toFixed(2)}
                                </text>
                              </g>
                            );
                          })}

                          {/* Saccade Vectors (break cleanly on segmentBreakBefore) */}
                          {gazePlotPoints.map((pt, idx) => {
                            if (idx === 0) return null;
                            const prev = gazePlotPoints[idx - 1];
                            const x1 = 50 + clamp01(prev.x) * 900;
                            const y1 = 30 + clamp01(prev.y) * 540;
                            const x2 = 50 + clamp01(pt.x) * 900;
                            const y2 = 30 + clamp01(pt.y) * 540;

                            if (pt.segmentBreakBefore) {
                              return (
                                <line
                                  key={`break-${idx}`}
                                  x1={x1}
                                  y1={y1}
                                  x2={x2}
                                  y2={y2}
                                  stroke="#BA1A1A"
                                  strokeWidth={1.5}
                                  strokeDasharray="6 6"
                                  strokeOpacity={0.55}
                                />
                              );
                            }

                            return (
                              <line
                                key={`vec-${idx}`}
                                x1={x1}
                                y1={y1}
                                x2={x2}
                                y2={y2}
                                stroke="#006A62"
                                strokeWidth={1.8}
                                strokeOpacity={0.55}
                              />
                            );
                          })}

                          {/* Fixation Circles (radius scaled by durationMs proxy) */}
                          {gazePlotPoints.map((pt, idx) => {
                            const cx = 50 + clamp01(pt.x) * 900;
                            const cy = 30 + clamp01(pt.y) * 540;
                            const durMs = gazePointDurations[idx] || 16;
                            const radius = Math.max(4, Math.min(18, 3.5 + Math.sqrt(durMs) * 0.38));
                            const isSelected = selectedGazePointIdx === idx;

                            return (
                              <g key={`pt-${pt.sequence}-${pt.gazeSampleIndex}-${idx}`}>
                                {pt.segmentBreakBefore && (
                                  <circle
                                    cx={cx}
                                    cy={cy}
                                    r={radius + 5}
                                    fill="none"
                                    stroke="#BA1A1A"
                                    strokeWidth={2}
                                    strokeDasharray="3 3"
                                  />
                                )}
                                <circle
                                  cx={cx}
                                  cy={cy}
                                  r={radius}
                                  fill={pt.confidence >= 0.7 ? '#006A62' : '#C97E41'}
                                  fillOpacity={Math.max(0.35, Math.min(0.9, pt.confidence))}
                                  stroke={isSelected ? '#BA1A1A' : '#071524'}
                                  strokeWidth={isSelected ? 3 : 1}
                                  className="cursor-pointer"
                                  onClick={() => setSelectedGazePointIdx(idx)}
                                >
                                  <title>{`Seq #${pt.sequence} (idx ${pt.gazeSampleIndex}) · (${pt.x.toFixed(
                                    3
                                  )}, ${pt.y.toFixed(3)}) · conf ${(pt.confidence * 100).toFixed(
                                    0
                                  )}% · ~${Math.round(durMs)}ms`}</title>
                                </circle>
                              </g>
                            );
                          })}
                        </svg>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#44474C]">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="inline-flex items-center gap-1">
                            <span className="w-2.5 h-2.5 rounded-full bg-[#006A62]" />
                            Confianza ≥ 70%
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <span className="w-2.5 h-2.5 rounded-full bg-[#C97E41]" />
                            Baja confianza
                          </span>
                          <span className="inline-flex items-center gap-1 text-[#BA1A1A] font-semibold">
                            <span className="w-3 h-0.5 border-t-2 border-dashed border-[#BA1A1A]" />
                            Salto (segmentBreakBefore)
                          </span>
                        </div>
                        <div className="font-mono text-[#071524] font-semibold">
                          {selectedGazePointIdx !== null && gazePlotPoints[selectedGazePointIdx]
                            ? `Seq #${gazePlotPoints[selectedGazePointIdx].sequence} · (${gazePlotPoints[
                                selectedGazePointIdx
                              ].x.toFixed(3)}, ${gazePlotPoints[selectedGazePointIdx].y.toFixed(
                                3
                              )}) · ~${Math.round(gazePointDurations[selectedGazePointIdx] || 16)}ms`
                            : 'Clic en un círculo para inspeccionar fijación'}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="h-64 bg-[#F3FAFF] rounded-xl border border-[#071524]/10 flex items-center justify-center text-xs text-[#74777C]">
                      {loadingStreamBundle
                        ? 'Cargando puntos Gaze Plot...'
                        : 'Sin puntos Gaze Plot disponibles para este stream.'}
                    </div>
                  )}
                </section>
              </div>

              {/* 3. STREAM REPLAY WITH GAP HANDLING (segmentBreakBefore) */}
              <section className="bg-white border border-[#071524]/10 rounded-xl p-5 shadow-xs space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-bold text-[#071524] flex items-center gap-2">
                      <Film className="w-4 h-4 text-[#006A62]" />
                      Replay Sincronizado de Sesión & Detección de Huecos (8085)
                    </h2>
                    <p className="text-[11px] text-[#44474C]">
                      {replayMeta
                        ? `Fuente: ${replayMeta.source} · Seq [${replayMeta.minimumSequence}..${replayMeta.maximumSequence}] · ${
                            replayMeta.unknownSessionBoundary
                              ? 'Frontera de sesión desconocida'
                              : 'Frontera verificada'
                          }`
                        : 'Reproducción temporal de muestras admitidas'}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex rounded-lg bg-[#E6F6FF] p-1 border border-[#071524]/10 text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          setReplayLaneTab('gaze');
                          setReplayFrameIdx(0);
                          setIsReplayPlaying(false);
                        }}
                        className={`px-3 py-1 rounded-md font-bold cursor-pointer ${
                          replayLaneTab === 'gaze'
                            ? 'bg-white text-[#071524] shadow-xs'
                            : 'text-[#44474C]'
                        }`}
                      >
                        Gaze ({replayGazeSamples.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setReplayLaneTab('gameplay');
                          setReplayFrameIdx(0);
                          setIsReplayPlaying(false);
                        }}
                        className={`px-3 py-1 rounded-md font-bold cursor-pointer ${
                          replayLaneTab === 'gameplay'
                            ? 'bg-white text-[#071524] shadow-xs'
                            : 'text-[#44474C]'
                        }`}
                      >
                        Gameplay ({replayGameplaySamples.length})
                      </button>
                    </div>

                    {(replayGazeCursor || replayGameplayCursor) && (
                      <button
                        type="button"
                        onClick={handleLoadMoreReplay}
                        disabled={loadingMoreReplay}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#071524] text-white text-xs font-bold hover:bg-[#1C2A39] cursor-pointer disabled:opacity-50"
                      >
                        {loadingMoreReplay && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        Siguiente página de replay
                      </button>
                    )}
                  </div>
                </div>

                {/* Known Missing Sequence Ranges Alert */}
                {replayMeta &&
                  (replayMeta.gazeSamples.knownMissingSequenceRanges.length > 0 ||
                    replayMeta.gameplaySamples.knownMissingSequenceRanges.length > 0) && (
                    <div className="p-3 rounded-xl bg-[#FFDCC4]/60 border border-[#FFB780] text-xs text-[#6F3800] flex flex-wrap items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 text-[#BA1A1A]" />
                      <span className="font-bold">Rangos de secuencia faltantes conocidos:</span>
                      {[
                        ...replayMeta.gazeSamples.knownMissingSequenceRanges,
                        ...replayMeta.gameplaySamples.knownMissingSequenceRanges,
                      ]
                        .slice(0, 8)
                        .map((r, i) => (
                          <span key={i} className="font-mono bg-white/80 px-2 py-0.5 rounded border border-[#FFB780]">
                            [{r.fromInclusive}..{r.toInclusive}]
                          </span>
                        ))}
                    </div>
                  )}

                {activeReplayLength > 0 ? (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {/* Interactive Scrubber & Spatial Preview */}
                    <div className="bg-[#F3FAFF] border border-[#071524]/10 rounded-xl p-4 flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => setIsReplayPlaying((p) => !p)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#006A62] text-white text-xs font-bold cursor-pointer"
                        >
                          {isReplayPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                          {isReplayPlaying ? 'Pausar' : 'Reproducir'}
                        </button>
                        <span className="font-mono text-xs font-bold text-[#071524]">
                          Frame {replayFrameIdx + 1} / {activeReplayLength}
                        </span>
                      </div>

                      <input
                        type="range"
                        min={0}
                        max={Math.max(0, activeReplayLength - 1)}
                        value={Math.min(replayFrameIdx, Math.max(0, activeReplayLength - 1))}
                        onChange={(e) => {
                          setIsReplayPlaying(false);
                          setReplayFrameIdx(Number(e.target.value));
                        }}
                        className="w-full accent-[#006A62]"
                      />

                      <svg viewBox="0 0 200 130" className="w-full bg-white rounded-lg border border-[#071524]/10">
                        <line x1={100} y1={0} x2={100} y2={130} stroke="#071524" strokeOpacity={0.12} />
                        <line x1={0} y1={65} x2={200} y2={65} stroke="#071524" strokeOpacity={0.12} />
                        {replayLaneTab === 'gaze' &&
                          activeGazeReplayFrame &&
                          activeGazeReplayFrame.x !== null &&
                          activeGazeReplayFrame.y !== null && (
                            <circle
                              cx={clamp01(activeGazeReplayFrame.x) * 200}
                              cy={clamp01(activeGazeReplayFrame.y) * 130}
                              r={6}
                              fill="#006A62"
                              stroke="#071524"
                              strokeWidth={1.5}
                            />
                          )}
                        {replayLaneTab === 'gameplay' && activeGameplayReplayFrame && (
                          <>
                            {activeGameplayReplayFrame.targetX !== null &&
                              activeGameplayReplayFrame.targetY !== null && (
                                <circle
                                  cx={clamp01(activeGameplayReplayFrame.targetX) * 200}
                                  cy={clamp01(activeGameplayReplayFrame.targetY) * 130}
                                  r={7}
                                  fill="none"
                                  stroke="#BA1A1A"
                                  strokeWidth={2}
                                />
                              )}
                            {activeGameplayReplayFrame.playerX !== null &&
                              activeGameplayReplayFrame.playerY !== null && (
                                <circle
                                  cx={clamp01(activeGameplayReplayFrame.playerX) * 200}
                                  cy={clamp01(activeGameplayReplayFrame.playerY) * 130}
                                  r={5}
                                  fill="#006A62"
                                />
                              )}
                          </>
                        )}
                      </svg>

                      <div className="text-[11px] font-mono text-[#44474C] space-y-1">
                        {replayLaneTab === 'gaze' && activeGazeReplayFrame && (
                          <>
                            <div>
                              Seq #{activeGazeReplayFrame.sequence} · idx{' '}
                              {activeGazeReplayFrame.sourceArrayIndex}
                            </div>
                            <div>
                              xy: ({activeGazeReplayFrame.x?.toFixed(3) ?? 'null'},{' '}
                              {activeGazeReplayFrame.y?.toFixed(3) ?? 'null'}) · conf{' '}
                              {activeGazeReplayFrame.confidence?.toFixed(2) ?? 'null'}
                            </div>
                            {activeGazeReplayFrame.segmentBreakBefore && (
                              <div className="text-[#BA1A1A] font-bold">
                                ⚠ segmentBreakBefore: hueco antes de esta muestra
                              </div>
                            )}
                          </>
                        )}
                        {replayLaneTab === 'gameplay' && activeGameplayReplayFrame && (
                          <>
                            <div>
                              Seq #{activeGameplayReplayFrame.sequence} · score:{' '}
                              {activeGameplayReplayFrame.score ?? '—'} · prog:{' '}
                              {activeGameplayReplayFrame.progress ?? '—'}
                            </div>
                            <div>
                              Target: ({activeGameplayReplayFrame.targetX?.toFixed(2) ?? '—'},{' '}
                              {activeGameplayReplayFrame.targetY?.toFixed(2) ?? '—'})
                            </div>
                            {activeGameplayReplayFrame.segmentBreakBefore && (
                              <div className="text-[#BA1A1A] font-bold">
                                ⚠ segmentBreakBefore: hueco antes de esta muestra
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {/* Replay Samples Table with Visual Gap Dividers */}
                    <div className="lg:col-span-2 overflow-x-auto max-h-72 border border-[#071524]/10 rounded-xl">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead className="sticky top-0 bg-[#E6F6FF] text-[11px] font-bold text-[#071524] uppercase">
                          <tr>
                            <th className="py-2 px-3">Seq / Idx</th>
                            <th className="py-2 px-3">Tiempo Efectivo</th>
                            <th className="py-2 px-3">Offset</th>
                            <th className="py-2 px-3">Coordenadas / Estado</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#071524]/10 font-mono text-[11px]">
                          {replayLaneTab === 'gaze'
                            ? replayGazeSamples.slice(0, 120).map((s, idx) => (
                                <React.Fragment key={`${s.sequence}-${s.sourceArrayIndex}-${idx}`}>
                                  {s.segmentBreakBefore && (
                                    <tr className="bg-[#FFDCC4] text-[#6F3800]">
                                      <td colSpan={4} className="py-1.5 px-3 font-sans font-bold text-[11px]">
                                        ⚡ Discontinuidad de telemetría (segmentBreakBefore) antes de seq #{s.sequence}
                                      </td>
                                    </tr>
                                  )}
                                  <tr
                                    onClick={() => setReplayFrameIdx(idx)}
                                    className={`cursor-pointer ${
                                      idx === replayFrameIdx ? 'bg-[#81F3E5]/40' : 'hover:bg-[#F3FAFF]'
                                    }`}
                                  >
                                    <td className="py-1.5 px-3">
                                      #{s.sequence} [{s.sourceArrayIndex}]
                                    </td>
                                    <td className="py-1.5 px-3">{formatIsoShort(s.effectiveTime)}</td>
                                    <td className="py-1.5 px-3">{s.offsetMs} ms</td>
                                    <td className="py-1.5 px-3">
                                      x:{s.x?.toFixed(3) ?? 'null'} y:{s.y?.toFixed(3) ?? 'null'} conf:
                                      {s.confidence?.toFixed(2) ?? 'null'}
                                    </td>
                                  </tr>
                                </React.Fragment>
                              ))
                            : replayGameplaySamples.slice(0, 120).map((s, idx) => (
                                <React.Fragment key={`${s.sequence}-${s.sourceArrayIndex}-${idx}`}>
                                  {s.segmentBreakBefore && (
                                    <tr className="bg-[#FFDCC4] text-[#6F3800]">
                                      <td colSpan={4} className="py-1.5 px-3 font-sans font-bold text-[11px]">
                                        ⚡ Discontinuidad de telemetría (segmentBreakBefore) antes de seq #{s.sequence}
                                      </td>
                                    </tr>
                                  )}
                                  <tr
                                    onClick={() => setReplayFrameIdx(idx)}
                                    className={`cursor-pointer ${
                                      idx === replayFrameIdx ? 'bg-[#81F3E5]/40' : 'hover:bg-[#F3FAFF]'
                                    }`}
                                  >
                                    <td className="py-1.5 px-3">
                                      #{s.sequence} [{s.sourceArrayIndex}]
                                    </td>
                                    <td className="py-1.5 px-3">{formatIsoShort(s.effectiveTime)}</td>
                                    <td className="py-1.5 px-3">{s.offsetMs} ms</td>
                                    <td className="py-1.5 px-3">
                                      P({s.playerX?.toFixed(2) ?? '—'},{s.playerY?.toFixed(2) ?? '—'}) T(
                                      {s.targetX?.toFixed(2) ?? '—'},{s.targetY?.toFixed(2) ?? '—'}) sc:
                                      {s.score ?? '—'}
                                    </td>
                                  </tr>
                                </React.Fragment>
                              ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="py-8 text-center text-xs text-[#74777C] bg-[#F3FAFF] rounded-xl border border-[#071524]/10">
                    {loadingStreamBundle
                      ? 'Cargando replay del stream...'
                      : 'Sin muestras de replay para el stream seleccionado.'}
                  </div>
                )}
              </section>

              {/* 4. HISTORICAL RAW TELEMETRY SAMPLES (8084) */}
              <section className="bg-white border border-[#071524]/10 rounded-xl p-5 shadow-xs space-y-4">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-bold text-[#071524] flex items-center gap-2">
                      <Database className="w-4 h-4 text-[#006A62]" />
                      Muestras Crudas Históricas (Telemetry Service 8084)
                    </h2>
                    <p className="text-[11px] text-[#44474C]">
                      {rawSamples.length} muestras cargadas · Stream: {selectedStreamId || '—'}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <input
                      type="text"
                      value={rawFromIso}
                      onChange={(e) => setRawFromIso(e.target.value)}
                      placeholder="from ISO"
                      aria-label="Rango desde ISO"
                      className="px-2.5 py-1.5 rounded-lg border border-[#071524]/15 bg-[#F3FAFF] font-mono text-[11px] w-48"
                    />
                    <input
                      type="text"
                      value={rawToIso}
                      onChange={(e) => setRawToIso(e.target.value)}
                      placeholder="to ISO"
                      aria-label="Rango hasta ISO"
                      className="px-2.5 py-1.5 rounded-lg border border-[#071524]/15 bg-[#F3FAFF] font-mono text-[11px] w-48"
                    />
                    <button
                      type="button"
                      onClick={handleReloadRawSamples}
                      disabled={loadingRawSamples || !selectedStreamId}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#E6F6FF] border border-[#071524]/15 text-[#071524] font-bold cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${loadingRawSamples ? 'animate-spin' : ''}`} />
                      Consultar
                    </button>
                    {rawNextCursor && (
                      <button
                        type="button"
                        onClick={handleLoadMoreRawSamples}
                        disabled={loadingMoreRaw}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#071524] text-white font-bold hover:bg-[#1C2A39] cursor-pointer disabled:opacity-50"
                      >
                        {loadingMoreRaw && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        Cargar más muestras crudas
                      </button>
                    )}
                  </div>
                </div>

                {rawSamplesError && (
                  <div className="p-3 rounded-xl bg-[#FFDAD6] border border-[#BA1A1A]/30 text-xs text-[#93000A] font-semibold">
                    Error consultando muestras crudas: {rawSamplesError}
                  </div>
                )}

                <div className="overflow-x-auto max-h-80 border border-[#071524]/10 rounded-xl">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="sticky top-0 bg-[#E6F6FF] text-[11px] font-bold text-[#071524] uppercase">
                      <tr>
                        <th className="py-2.5 px-3">Tipo</th>
                        <th className="py-2.5 px-3">Sample Time</th>
                        <th className="py-2.5 px-3">Seq / Idx</th>
                        <th className="py-2.5 px-3">Offset</th>
                        <th className="py-2.5 px-3">Gaze (x, y, conf)</th>
                        <th className="py-2.5 px-3">Gameplay (Player / Target / Score)</th>
                        <th className="py-2.5 px-3">Batch ID</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#071524]/10 font-mono text-[11px]">
                      {loadingRawSamples && rawSamples.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center font-sans text-[#44474C]">
                            Cargando muestras históricas...
                          </td>
                        </tr>
                      ) : rawSamples.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center font-sans text-[#74777C]">
                            No se encontraron muestras crudas en el rango temporal indicado.
                          </td>
                        </tr>
                      ) : (
                        rawSamples.map((s, idx) => (
                          <tr key={`${s.batchId}-${s.kind}-${s.sequenceNumber}-${s.index}-${idx}`} className="hover:bg-[#F3FAFF]">
                            <td className="py-2 px-3">
                              <span
                                className={`px-1.5 py-0.5 rounded font-sans font-bold text-[10px] ${
                                  s.kind === 'GAZE'
                                    ? 'bg-[#81F3E5]/50 text-[#005049]'
                                    : 'bg-[#DBF1FE] text-[#071524]'
                                }`}
                              >
                                {s.kind}
                              </span>
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap">{formatIsoShort(s.sampleTime)}</td>
                            <td className="py-2 px-3">
                              #{s.sequenceNumber} / {s.index}
                            </td>
                            <td className="py-2 px-3">{s.offsetMs} ms</td>
                            <td className="py-2 px-3">
                              {s.kind === 'GAZE'
                                ? `(${s.x?.toFixed(3) ?? '—'}, ${s.y?.toFixed(3) ?? '—'}) · c=${
                                    s.confidence?.toFixed(2) ?? '—'
                                  }`
                                : '—'}
                            </td>
                            <td className="py-2 px-3">
                              {s.kind === 'GAMEPLAY'
                                ? `P(${s.playerX?.toFixed(2) ?? '—'},${s.playerY?.toFixed(2) ?? '—'}) T(${
                                    s.targetX?.toFixed(2) ?? '—'
                                  },${s.targetY?.toFixed(2) ?? '—'}) · sc:${s.score ?? '—'} spd:${
                                    s.speed?.toFixed(1) ?? '—'
                                  }`
                                : '—'}
                            </td>
                            <td className="py-2 px-3 truncate max-w-[120px]" title={s.batchId}>
                              {s.batchId.slice(0, 10)}…
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* 5. PATIENT SESSION DIRECTORY FOR QUICK SWITCHING */}
              <section className="bg-white border border-[#071524]/10 rounded-xl p-5 shadow-xs space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-sm font-bold text-[#071524]">
                    Sesiones del Paciente ({filteredCognitoSessions.length})
                  </h2>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <input
                      type="text"
                      value={sessionSearch}
                      onChange={(e) => setSessionSearch(e.target.value)}
                      placeholder="Filtrar sesión..."
                      className="px-3 py-1.5 rounded-lg border border-[#071524]/15 bg-[#F3FAFF]"
                    />
                    <select
                      value={sessionFilterStatus}
                      onChange={(e) =>
                        setSessionFilterStatus(e.target.value as 'ALL' | PatientTherapySessionStatus)
                      }
                      className="px-2.5 py-1.5 rounded-lg border border-[#071524]/15 bg-[#F3FAFF]"
                    >
                      <option value="ALL">Todos los estados</option>
                      <option value="COMPLETED">COMPLETED</option>
                      <option value="ACTIVE">ACTIVE</option>
                      <option value="ABANDONED">ABANDONED</option>
                      <option value="CANCELLED">CANCELLED</option>
                      <option value="FAILED_TECHNICAL">FAILED_TECHNICAL</option>
                    </select>
                    <select
                      value={sessionFilterExercise}
                      onChange={(e) =>
                        setSessionFilterExercise(e.target.value as 'ALL' | TherapyExerciseCode)
                      }
                      className="px-2.5 py-1.5 rounded-lg border border-[#071524]/15 bg-[#F3FAFF]"
                    >
                      <option value="ALL">Todos los ejercicios</option>
                      <option value="visual-scanning">visual-scanning</option>
                      <option value="visual-search">visual-search</option>
                      <option value="fixation">fixation</option>
                    </select>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-[#E6F6FF] text-[11px] font-bold text-[#071524] uppercase border-b border-[#071524]/10">
                        <th className="py-2.5 px-3">Sesión ID</th>
                        <th className="py-2.5 px-3">Ejercicio</th>
                        <th className="py-2.5 px-3">Inicio</th>
                        <th className="py-2.5 px-3">Duración</th>
                        <th className="py-2.5 px-3">Estado</th>
                        <th className="py-2.5 px-3 text-right">Seleccionar</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#071524]/10">
                      {filteredCognitoSessions.map((s) => {
                        const isSelected = s.therapySessionId === selectedSessionId;
                        return (
                          <tr
                            key={s.therapySessionId}
                            className={isSelected ? 'bg-[#81F3E5]/25 font-semibold' : 'hover:bg-[#F3FAFF]'}
                          >
                            <td className="py-2.5 px-3 font-mono">{s.therapySessionId}</td>
                            <td className="py-2.5 px-3">{EXERCISE_LABELS[s.exerciseCode]}</td>
                            <td className="py-2.5 px-3">{formatIsoShort(s.startedAt)}</td>
                            <td className="py-2.5 px-3">{formatDurationSeconds(s.activeDurationSeconds)}</td>
                            <td className="py-2.5 px-3">{s.status}</td>
                            <td className="py-2.5 px-3 text-right">
                              <button
                                type="button"
                                onClick={() => handleSelectSession(s.therapySessionId)}
                                className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                                  isSelected
                                    ? 'bg-[#006A62] text-white'
                                    : 'bg-[#071524] text-white hover:bg-[#1C2A39]'
                                }`}
                              >
                                {isSelected ? 'Auditando' : 'Auditar'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </main>

        <SpecialistFooter />

        <SessionAnalyticsModal
          session={null}
          patientId={activePatientId}
          therapySessionId={selectedSessionId}
          isOpen={cognitoModalOpen}
          onClose={() => setCognitoModalOpen(false)}
        />

        {cognitoJsonInspectorOpen && (
          <div className="fixed inset-0 z-50 bg-[#071524]/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-3xl w-full shadow-2xl border border-[#071524]/10 overflow-hidden flex flex-col max-h-[85vh]">
              <div className="bg-[#1C2A39] text-white p-4 px-6 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Code2 className="w-5 h-5 text-[#84F5E8]" />
                  <div>
                    <h3 className="font-bold text-sm">Payload Real de Sesión & Stream Summary</h3>
                    <p className="text-[11px] text-[#84F5E8]/80 font-mono">{selectedSessionId}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setCognitoJsonInspectorOpen(false)}
                  className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-5 overflow-y-auto bg-[#071524] text-[#84F5E8] font-mono text-xs leading-relaxed">
                <pre className="whitespace-pre-wrap break-all">
                  {JSON.stringify({ sessionDetail, streamSummary, trialSummary }, null, 2)}
                </pre>
              </div>
              <div className="p-4 bg-[#E6F6FF] border-t border-[#071524]/10 flex justify-end">
                <button
                  type="button"
                  onClick={() => setCognitoJsonInspectorOpen(false)}
                  className="px-4 py-2 rounded-lg bg-[#071524] text-white text-xs font-bold cursor-pointer"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // =====================================================================
  // MOCK MODE RENDER (PRESERVED)
  // =====================================================================
  return (
    <div className="min-h-screen bg-[#F3FAFF] text-[#071E27] font-sans flex flex-col justify-between antialiased selection:bg-[#81F3E5] selection:text-[#00201D]">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#071524] text-white px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-xs font-semibold border border-[#006A62]">
          <CheckCircle2 className="w-4 h-4 text-[#84F5E8]" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Navigation Bar */}
      <SpecialistHeader
        activeTab="telemetria"
        onTabChange={(tab) => {
          if (tab === 'pacientes') navigate('/specialist/dashboard');
          else if (tab === 'protocolos') navigate(`/specialist/patients/${activePatientId}/parametros`);
          else if (tab === 'interconsultas') navigate(`/specialist/patients/${activePatientId}/reporte-pdf`);
        }}
        onOpenNotifications={() => showToast('Auditoría HL7 sincronizada sin alertas pendientes.')}
      />

      {/* Main Content Container */}
      <main className="flex-1 w-full max-w-[1360px] mx-auto px-4 md:px-8 py-6 flex flex-col gap-6">
        {/* BREADCRUMB & CONTEXT HEADER */}
        <div className="flex flex-col gap-3">
          <nav className="flex items-center gap-2 text-xs font-medium text-[#44474C] overflow-x-auto whitespace-nowrap py-1">
            <button
              onClick={() => navigate('/specialist/dashboard')}
              className="hover:text-[#071524] transition-colors flex items-center gap-1 cursor-pointer"
            >
              <Hospital className="w-3.5 h-3.5 text-[#006A62]" />
              Portal Clínico
            </button>
            <ChevronRight className="w-3.5 h-3.5 text-[#74777C]" />
            <button
              onClick={() => navigate('/specialist/dashboard')}
              className="hover:text-[#071524] transition-colors cursor-pointer"
            >
              Pacientes
            </button>
            <ChevronRight className="w-3.5 h-3.5 text-[#74777C]" />
            <button
              onClick={() => navigate(`/specialist/patients/${activePatientId}`)}
              className="hover:text-[#071524] transition-colors cursor-pointer"
            >
              {currentPatient.name} (HC {currentPatient.medicalRecordNumber})
            </button>
            <ChevronRight className="w-3.5 h-3.5 text-[#74777C]" />
            <span className="text-[#071524] font-bold">Auditoría de Telemetría y Sesiones</span>
          </nav>

          {/* Back Action & Header Action Bar */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pt-1 border-b border-[#071524]/10 pb-4">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate(`/specialist/patients/${activePatientId}`)}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-[#071524] bg-[#E6F6FF] hover:bg-[#D5ECF8] border border-[#071524]/10 rounded-xl transition-all cursor-pointer shrink-0"
              >
                <ArrowLeft className="w-4 h-4" />
                Volver al Expediente
              </button>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-[#071524] tracking-tight">
                  Registro Maestro de Telemetría y Sesiones
                </h1>
                <p className="text-xs text-[#44474C]">
                  Auditoría continua de muestras oculares a 120Hz con sellado temporal HL7
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={handleExportLogCSV}
                type="button"
                className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-[#071524] bg-[#E6F6FF] hover:bg-[#D5ECF8] border border-[#071524]/20 rounded-xl transition-all shadow-xs cursor-pointer"
              >
                <Download className="w-4 h-4 text-[#006A62]" />
                Exportar Log FHIR/CSV
              </button>
              <button
                onClick={() => navigate(`/specialist/patients/${activePatientId}/reporte-pdf`)}
                type="button"
                className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-[#006A62] hover:bg-[#005049] rounded-xl transition-all shadow-xs cursor-pointer"
              >
                <FileText className="w-4 h-4" />
                Generar Dictamen de Calidad (PDF)
              </button>
            </div>
          </div>
        </div>

        {/* QUICK PATIENT SUMMARY CARD */}
        <div className="bg-[#E6F6FF] border border-[#071524]/10 rounded-xl p-5 shadow-xs">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-center">
            {/* Patient ID & Age */}
            <div className="flex items-center gap-3 pr-4 border-r-0 lg:border-r border-[#071524]/10">
              <div className="w-12 h-12 rounded-xl bg-[#1C2A39] text-white flex items-center justify-center font-bold text-base shrink-0">
                {currentPatient.initials}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold text-[#071524]">{currentPatient.name}</span>
                  <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-[#81F3E5] text-[#005049]">
                    {currentPatient.age} años
                  </span>
                </div>
                <div className="text-xs text-[#44474C] mt-0.5">
                  HC {currentPatient.medicalRecordNumber} • Adm: {currentPatient.enrollmentDate || '12/09/2024'}
                </div>
              </div>
            </div>

            {/* Diagnosis Details */}
            <div className="pr-4 border-r-0 lg:border-r border-[#071524]/10">
              <div className="text-[11px] font-semibold text-[#44474C] uppercase tracking-wider">
                Diagnóstico Oftalmológico
              </div>
              <div className="text-xs font-bold text-[#071524] mt-1 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#BA1A1A] inline-block shrink-0" />
                {currentPatient.primaryDiagnosisTitle ||
                  `Hemianopsia Homónima ${currentPatient.affectedHemifield === 'LEFT' ? 'Izquierda' : 'Derecha'}`}
              </div>
              <div className="text-[11px] text-[#44474C]">Etiología: Isquemia post-ACV PCA derecha</div>
            </div>

            {/* Protocol & Active Plan */}
            <div className="pr-4 border-r-0 lg:border-r border-[#071524]/10">
              <div className="text-[11px] font-semibold text-[#44474C] uppercase tracking-wider">
                Protocolo Prescrito
              </div>
              <div className="text-xs font-bold text-[#071524] mt-1 flex items-center gap-2">
                <span>Plan Clínico NeuroVisión</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#1C2A39] text-white">
                  v1.2 Inmutable
                </span>
              </div>
              <div className="text-[11px] text-[#006A62] font-medium">
                Meta diaria: 30 min (2 tandas foveales)
              </div>
            </div>

            {/* Sensor & Calibration Status */}
            <div>
              <div className="text-[11px] font-semibold text-[#44474C] uppercase tracking-wider">
                Hardware Telemetría
              </div>
              <div className="text-xs font-bold text-[#071524] mt-1 flex items-center gap-1.5">
                <Video className="w-4 h-4 text-[#006A62]" />
                Sensor Ocular WebRTC / MediaPipe (120 Hz)
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-[#005049] mt-0.5 font-medium">
                <span className="w-2 h-2 rounded-full bg-[#006A62] inline-block" />
                Calibración Óptima (Δ 0.4° Foveal)
              </div>
            </div>
          </div>
        </div>

        {/* SUMMARY KPI CARDS ROW */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-[#E6F6FF] border border-[#071524]/10 rounded-xl p-4 flex flex-col justify-between shadow-xs">
            <div className="flex justify-between items-start">
              <span className="text-xs font-bold uppercase tracking-wider text-[#44474C]">
                Total Sesiones Auditadas
              </span>
              <span className="p-1.5 rounded-lg bg-[#DBF1FE] text-[#071524]">
                <Calendar className="w-4 h-4" />
              </span>
            </div>
            <div className="mt-2">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-extrabold text-[#071524]">32</span>
                <span className="text-xs font-semibold text-[#44474C]">sesiones totales</span>
              </div>
              <div className="text-[11px] text-[#44474C] mt-1">Acumulado en 26 días de rehabilitación</div>
            </div>
          </div>

          <div className="bg-[#E6F6FF] border border-[#071524]/10 rounded-xl p-4 flex flex-col justify-between shadow-xs">
            <div className="flex justify-between items-start">
              <span className="text-xs font-bold uppercase tracking-wider text-[#44474C] flex items-center gap-1">
                Índice Medio de Mirada
                <ClinicalTermTooltip termId="CONFIDENCE_MEAN" audience="specialist" iconSize={13} />
              </span>
              <span className="p-1.5 rounded-lg bg-[#81F3E5] text-[#005049]">
                <Eye className="w-4 h-4" />
              </span>
            </div>
            <div className="mt-2">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-extrabold text-[#071524]">94.6%</span>
                <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-[#006A62]/15 text-[#006A62]">
                  Óptimo clínico
                </span>
              </div>
              <div className="text-[11px] text-[#44474C] mt-1">Muestras válidas &gt;80% en 91% del tiempo</div>
            </div>
          </div>

          <div className="bg-[#E6F6FF] border border-[#071524]/10 rounded-xl p-4 flex flex-col justify-between shadow-xs">
            <div className="flex justify-between items-start">
              <span className="text-xs font-bold uppercase tracking-wider text-[#44474C] flex items-center gap-1">
                Error Angular Medio
                <ClinicalTermTooltip termId="ANGULAR_ERROR" audience="specialist" iconSize={13} />
              </span>
              <span className="p-1.5 rounded-lg bg-[#DBF1FE] text-[#071524]">
                <Ruler className="w-4 h-4" />
              </span>
            </div>
            <div className="mt-2">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-extrabold text-[#071524]">0.82°</span>
                <span className="text-[11px] font-semibold text-[#006A62]">Umbral foveal &lt; 1.5°</span>
              </div>
              <div className="text-[11px] text-[#44474C] mt-1">Fijaciones estables en fóvea central</div>
            </div>
          </div>

          <div className="bg-[#E6F6FF] border border-[#071524]/10 rounded-xl p-4 flex flex-col justify-between shadow-xs">
            <div className="flex justify-between items-start">
              <span className="text-xs font-bold uppercase tracking-wider text-[#44474C]">
                Finalización Exitosa
              </span>
              <span className="p-1.5 rounded-lg bg-[#D5ECF8] text-[#071524]">
                <CheckCircle2 className="w-4 h-4" />
              </span>
            </div>
            <div className="mt-2">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-extrabold text-[#071524]">87.5%</span>
                <span className="text-xs font-bold text-[#44474C]">28 / 32</span>
              </div>
              <div className="text-[11px] text-[#BA1A1A] font-medium mt-1">
                4 abortadas por astenopía o fatiga
              </div>
            </div>
          </div>
        </section>

        {/* FILTER TOOLBAR */}
        <section className="bg-white border border-[#071524]/10 rounded-xl p-4 shadow-xs flex flex-col gap-3">
          <div className="flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 px-3 py-2 bg-[#E6F6FF] border border-[#071524]/15 rounded-xl text-xs font-semibold text-[#071524]">
                <Calendar className="w-4 h-4 text-[#071524]" />
                <span>
                  {dateRangePreset === '7d'
                    ? '08 Nov, 2024 - 15 Nov, 2024'
                    : dateRangePreset === '30d'
                    ? '20 Oct, 2024 - 15 Nov, 2024'
                    : '12 Sep, 2024 - 15 Nov, 2024'}
                </span>
              </div>
              <div className="flex items-center bg-[#E6F6FF] rounded-xl p-1 border border-[#071524]/10 text-xs">
                <button
                  type="button"
                  onClick={() => setDateRangePreset('7d')}
                  className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                    dateRangePreset === '7d'
                      ? 'font-bold text-[#071524] bg-white shadow-xs'
                      : 'font-medium text-[#44474C] hover:text-[#071524]'
                  }`}
                >
                  7 días
                </button>
                <button
                  type="button"
                  onClick={() => setDateRangePreset('30d')}
                  className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                    dateRangePreset === '30d'
                      ? 'font-bold text-[#071524] bg-white shadow-xs'
                      : 'font-medium text-[#44474C] hover:text-[#071524]'
                  }`}
                >
                  30 días
                </button>
                <button
                  type="button"
                  onClick={() => setDateRangePreset('all')}
                  className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                    dateRangePreset === 'all'
                      ? 'font-bold text-[#071524] bg-white shadow-xs'
                      : 'font-medium text-[#44474C] hover:text-[#071524]'
                  }`}
                >
                  Todo el tto.
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <label className="text-xs font-bold text-[#44474C] whitespace-nowrap">Ejercicio:</label>
                <select
                  value={exerciseFilter}
                  onChange={(e) => setExerciseFilter(e.target.value)}
                  className="text-xs bg-[#E6F6FF] border border-[#071524]/15 text-[#071524] rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-[#006A62] focus:outline-none cursor-pointer"
                >
                  <option value="ALL">Todos los ejercicios</option>
                  <option value="Exploración Sacádica">Exploración Sacádica Visual</option>
                  <option value="Búsqueda Visual">Búsqueda Visual Guiada</option>
                  <option value="Fijación Foveal">Fijación Foveal Dinámica</option>
                  <option value="Ampliación">Ampliación de Campo Visual</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <label className="text-xs font-bold text-[#44474C] whitespace-nowrap">Estado:</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="text-xs bg-[#E6F6FF] border border-[#071524]/15 text-[#071524] rounded-xl px-3 py-2 font-medium focus:ring-2 focus:ring-[#006A62] focus:outline-none cursor-pointer"
                >
                  <option value="ALL">Todos los estados</option>
                  <option value="COMPLETED">Completadas</option>
                  <option value="FATIGUE">Abortadas por Fatiga</option>
                  <option value="CALIBRATION">Calibración Perdida</option>
                </select>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-3 border-t border-[#071524]/10">
            <div className="flex flex-wrap items-center gap-4">
              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#44474C]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar ID de sesión (e.g. #SES-9821)..."
                  className="w-full text-xs bg-[#E6F6FF] border border-[#071524]/15 rounded-xl pl-9 pr-3 py-2 font-medium text-[#071524] placeholder:text-[#44474C]/70 focus:ring-2 focus:ring-[#006A62] focus:outline-none"
                />
              </div>

              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={onlyValidGaze}
                  onChange={(e) => setOnlyValidGaze(e.target.checked)}
                  className="w-4 h-4 accent-[#006A62] rounded border-[#071524]/20"
                />
                <span className="text-xs font-semibold text-[#071524]">
                  Solo sesiones válidas (Gaze Samples &gt; 80%)
                </span>
              </label>
            </div>

            <button
              type="button"
              onClick={handleResetFilters}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#44474C] hover:text-[#071524] hover:bg-[#E6F6FF] rounded-xl border border-transparent hover:border-[#071524]/10 transition-colors cursor-pointer"
            >
              <FilterX className="w-3.5 h-3.5" />
              Restablecer Filtros
            </button>
          </div>
        </section>

        {/* DENSE CLINICAL AUDIT TABLE */}
        <div className="bg-white border border-[#071524]/10 rounded-xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#E6F6FF] border-b border-[#071524]/15 text-[11px] font-bold text-[#071524] uppercase tracking-wider">
                  <th className="py-3.5 px-4 whitespace-nowrap" scope="col">ID & Fecha / Hora</th>
                  <th className="py-3.5 px-4 whitespace-nowrap" scope="col">Ejercicio & Hemicampo</th>
                  <th className="py-3.5 px-4 whitespace-nowrap" scope="col">Plan Config</th>
                  <th className="py-3.5 px-4 whitespace-nowrap" scope="col">Duración Real</th>
                  <th className="py-3.5 px-4 whitespace-nowrap" scope="col">Quality Index (Gaze)</th>
                  <th className="py-3.5 px-4 whitespace-nowrap" scope="col">Error Angular</th>
                  <th className="py-3.5 px-4 whitespace-nowrap" scope="col">Estado Clínico</th>
                  <th className="py-3.5 px-4 whitespace-nowrap text-right" scope="col">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#071524]/10 text-xs">
                {paginatedSessions.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-[#74777C]">
                      No se encontraron registros de telemetría con los filtros seleccionados.
                    </td>
                  </tr>
                ) : (
                  paginatedSessions.map((session) => {
                    const isFatigue = session.validationStatus === 'INTERRUPTED_FATIGUE';
                    const isTrackerLoss = session.validationStatus === 'CALIBRATION_ISSUE';

                    return (
                      <tr
                        key={session.id}
                        className={`transition-colors ${
                          isFatigue ? 'bg-[#FFDAD6]/15 hover:bg-[#FFDAD6]/25' : 'hover:bg-[#E6F6FF]/60'
                        }`}
                      >
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="font-bold text-[#071524]">{session.id}</div>
                          <div className="text-[11px] text-[#44474C] flex items-center gap-1 mt-0.5">
                            <span className="px-1.5 py-0.5 rounded bg-[#DBF1FE] text-[#071524] font-bold text-[10px] uppercase">
                              {session.period}
                            </span>
                            {session.dateText}
                          </div>
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="font-bold text-[#071524] leading-tight">{session.moduleName}</div>
                          <span
                            className={`inline-flex items-center gap-1 text-[11px] font-semibold mt-0.5 ${
                              session.hemifieldTarget.includes('Línea Media')
                                ? 'text-[#006A62]'
                                : 'text-[#BA1A1A]'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                session.hemifieldTarget.includes('Línea Media')
                                  ? 'bg-[#006A62]'
                                  : 'bg-[#BA1A1A]'
                              }`}
                            />
                            {session.hemifieldTarget}
                          </span>
                        </td>

                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-bold border ${
                              session.planVersion.includes('Inmutable')
                                ? 'bg-[#1C2A39] text-white border-[#071524]/20'
                                : 'bg-[#DBF1FE] text-[#071524] border-[#071524]/15 font-medium'
                            }`}
                          >
                            {session.planVersion}
                          </span>
                        </td>

                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className={`font-bold ${isFatigue ? 'text-[#BA1A1A]' : 'text-[#071524]'}`}>
                            {formatDurationText(session.durationMinutes, session.targetDurationMinutes)}
                          </div>
                          <div className="w-28 bg-[#D5ECF8] h-1.5 rounded-full mt-1 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                isFatigue
                                  ? 'bg-[#BA1A1A]'
                                  : isTrackerLoss
                                  ? 'bg-[#FFB780]'
                                  : 'bg-[#006A62]'
                              }`}
                              style={{ width: `${session.complianceRate}%` }}
                            />
                          </div>
                        </td>

                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <span
                            className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                              isFatigue
                                ? 'bg-[#FFDAD6] text-[#93000A]'
                                : isTrackerLoss
                                ? 'bg-[#FFDCC4] text-[#2F1400]'
                                : 'bg-[#81F3E5] text-[#005049]'
                            }`}
                          >
                            {session.gazeQualityIndex}%
                          </span>
                          <span
                            className={`text-[10px] block mt-0.5 ${
                              isFatigue
                                ? 'text-[#BA1A1A] font-semibold'
                                : isTrackerLoss
                                ? 'text-[#431F00]'
                                : 'text-[#44474C]'
                            }`}
                          >
                            {session.qualityNote}
                          </span>
                        </td>

                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <span className="font-bold text-[#071524]">{session.angularErrorDeg}°</span>
                          <span
                            className={`text-[10px] block ${
                              isFatigue
                                ? 'text-[#BA1A1A]'
                                : isTrackerLoss
                                ? 'text-[#431F00]'
                                : 'text-[#006A62]'
                            }`}
                          >
                            {session.angularNote}
                          </span>
                        </td>

                        <td className="py-3.5 px-4 whitespace-nowrap">
                          {isFatigue ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-bold bg-[#FFDAD6] text-[#93000A] border border-[#BA1A1A]/20">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              {session.validationLabel}
                            </span>
                          ) : isTrackerLoss ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-bold bg-[#FFDCC4] text-[#2F1400] border border-[#FFB780]">
                              <WifiOff className="w-3.5 h-3.5" />
                              {session.validationLabel}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-bold bg-[#006A62]/15 text-[#006A62] border border-[#006A62]/20">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {session.validationLabel}
                            </span>
                          )}
                        </td>

                        <td className="py-3.5 px-4 whitespace-nowrap text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setSelectedSessionForAnalytics(session)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#071524] text-white hover:bg-[#1C2A39] rounded-lg text-xs font-bold transition-all shadow-xs cursor-pointer"
                            >
                              Abrir Analítica
                              <Play className="w-3 h-3 fill-current" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setFhirJsonModalSession(session)}
                              className="p-1.5 text-[#44474C] hover:text-[#071524] hover:bg-[#DBF1FE] rounded-lg transition-colors border border-[#071524]/10 cursor-pointer"
                              title="Ver Telemetría FHIR/JSON"
                            >
                              <Code2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="p-4 bg-[#E6F6FF] border-t border-[#071524]/10 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-xs font-semibold text-[#44474C]">
              Mostrando{' '}
              <span className="text-[#071524] font-bold">
                {filteredSessions.length > 0 ? (currentPage - 1) * pageSize + 1 : 0} -{' '}
                {Math.min(currentPage * pageSize, filteredSessions.length)}
              </span>{' '}
              de <span className="text-[#071524] font-bold">{filteredSessions.length}</span> sesiones auditadas
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="p-2 rounded-lg border border-[#071524]/10 text-[#071524] disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed bg-white"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              {Array.from({ length: totalPages }).map((_, idx) => {
                const page = idx + 1;
                return (
                  <button
                    key={page}
                    type="button"
                    onClick={() => setCurrentPage(page)}
                    className={`w-8 h-8 rounded-lg font-bold text-xs flex items-center justify-center transition-colors cursor-pointer ${
                      page === currentPage
                        ? 'bg-[#071524] text-white shadow-xs'
                        : 'bg-white hover:bg-[#DBF1FE] text-[#44474C]'
                    }`}
                  >
                    {page}
                  </button>
                );
              })}
              <button
                type="button"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="p-2 rounded-lg border border-[#071524]/10 text-[#071524] disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed bg-white"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* CRYPTOGRAPHIC AUDIT TRAIL FOOTNOTE */}
        <div className="bg-[#E6F6FF] border border-[#071524]/10 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-[11px] text-[#44474C]">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#006A62] shrink-0" />
            <span>
              <strong className="text-[#071524] font-bold">Sellado Criptográfico Activo:</strong> Registros
              biométricos inmutables verificados bajo norma{' '}
              <span className="font-bold text-[#071524]">HL7 FHIR v4.0.1</span> y Ley de Protección de Datos de
              Salud. Hashing SHA-256 verificado.
            </span>
          </div>
          <div className="font-mono text-[10px] text-[#44474C] bg-[#DBF1FE] px-2.5 py-1 rounded border border-[#071524]/10 whitespace-nowrap">
            SHA-256: 4f8b9d21e892c...910a3
          </div>
        </div>
      </main>

      <SpecialistFooter />

      {/* Session Analytics Modal */}
      <SessionAnalyticsModal
        session={selectedSessionForAnalytics}
        isOpen={Boolean(selectedSessionForAnalytics)}
        onClose={() => setSelectedSessionForAnalytics(null)}
      />

      {/* FHIR / JSON Telemetry Inspector Modal */}
      {fhirJsonModalSession && (
        <div className="fixed inset-0 z-50 bg-[#071524]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-[#071524]/10 overflow-hidden flex flex-col max-h-[85vh]">
            <div className="bg-[#1C2A39] text-white p-4 px-6 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Code2 className="w-5 h-5 text-[#84F5E8]" />
                <div>
                  <h3 className="font-bold text-sm">
                    Estructura HL7 FHIR Observation · {fhirJsonModalSession.id}
                  </h3>
                  <p className="text-[11px] text-[#84F5E8]/80">Recurso de telemetría oculomotora serializado</p>
                </div>
              </div>
              <button
                onClick={() => setFhirJsonModalSession(null)}
                className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto bg-[#071524] text-[#84F5E8] font-mono text-xs leading-relaxed">
              <pre className="whitespace-pre-wrap break-all">
                {JSON.stringify(
                  {
                    resourceType: 'Observation',
                    id: fhirJsonModalSession.id.replace('#', ''),
                    status: fhirJsonModalSession.isValid ? 'final' : 'amended',
                    category: [
                      {
                        coding: [
                          {
                            system: 'http://terminology.hl7.org/CodeSystem/observation-category',
                            code: 'procedure',
                            display: 'Oculomotor Telemetry',
                          },
                        ],
                      },
                    ],
                    subject: {
                      reference: `Patient/${currentPatient.id}`,
                      display: `${currentPatient.name} (${currentPatient.medicalRecordNumber})`,
                    },
                    effectiveDateTime: new Date().toISOString(),
                    protocolVersion: fhirJsonModalSession.planVersion,
                    component: [
                      { code: { text: 'ExerciseModule' }, valueString: fhirJsonModalSession.moduleName },
                      {
                        code: { text: 'TargetHemifield' },
                        valueString: fhirJsonModalSession.hemifieldTarget,
                      },
                      {
                        code: { text: 'GazeQualityIndex' },
                        valueQuantity: { value: fhirJsonModalSession.gazeQualityIndex, unit: '%' },
                      },
                      {
                        code: { text: 'MeanAngularError' },
                        valueQuantity: { value: fhirJsonModalSession.angularErrorDeg, unit: 'deg' },
                      },
                      {
                        code: { text: 'DurationMinutes' },
                        valueQuantity: { value: fhirJsonModalSession.durationMinutes, unit: 'min' },
                      },
                    ],
                  },
                  null,
                  2
                )}
              </pre>
            </div>
            <div className="p-4 bg-[#E6F6FF] border-t border-[#071524]/10 flex justify-end gap-2">
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(JSON.stringify(fhirJsonModalSession, null, 2));
                  showToast('Payload FHIR JSON copiado al portapapeles.');
                }}
                className="px-4 py-2 rounded-lg border border-[#071524]/20 bg-white text-[#071524] text-xs font-bold hover:bg-[#DBF1FE] cursor-pointer"
              >
                Copiar JSON
              </button>
              <button
                onClick={() => setFhirJsonModalSession(null)}
                className="px-4 py-2 rounded-lg bg-[#071524] text-white text-xs font-bold hover:bg-[#1C2A39] cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
