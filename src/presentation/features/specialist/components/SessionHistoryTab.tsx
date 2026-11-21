import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Search,
  FileText,
  CheckCircle2,
  AlertTriangle,
  CalendarDays,
  BadgeCheck,
  Eye,
  Clock,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Award,
  Download,
  RefreshCw,
  Activity,
  XCircle,
  Loader2,
} from 'lucide-react';
import { useAppStore } from '../../../../core/store/useAppStore';
import type { Patient, SessionRecord } from '../../../../core/domain/Patient';
import {
  analyticsApi,
  clinicalApi,
  extractApiErrorMessage,
} from '../../../../infrastructure/api';
import type {
  DoctorTherapySessionDetailResponse,
  DoctorTherapySessionSummary,
  PatientTherapySessionStatus,
  ReportMode,
  TherapyExerciseCode,
} from '../../../../infrastructure/api';

interface SessionHistoryTabProps {
  sessions: SessionRecord[];
  onOpenAnalytics: (session: SessionRecord) => void;
  onDownloadSessionPDF: (session: SessionRecord) => void;
  onDownloadConsolidatedPDF: () => void;
  onIssueCertifiedReport: () => void;
  patientId?: string;
  patient?: Patient;
}

interface SessionEnrichment {
  analyticsChecked: boolean;
  hasAnalytics: boolean;
  streamCount: number;
  sampleTotal: number;
  mode?: ReportMode;
  activeMilliseconds?: number | null;
  completedRepetitions?: number | null;
  target?: number | null;
  criterion?: 'ACTIVE_TIME' | 'REPETITIONS' | null;
  targetReached?: boolean | null;
}

const EXERCISE_LABELS: Record<TherapyExerciseCode, string> = {
  'visual-scanning': 'Exploración Visual (Scanning)',
  'visual-search': 'Búsqueda Visual',
  fixation: 'Fijación Foveal',
};

const MODE_LABELS: Record<ReportMode, string> = {
  STANDARD_SCANNING: 'Exploración Estándar',
  SYSTEMATIC_EXPLORATION: 'Exploración Sistemática',
  COMPENSATORY_SACCADE: 'Sacada Compensatoria',
  TARGET_SEARCH_WITH_DISTRACTORS: 'Búsqueda con Distractores',
  SUSTAINED_TARGET_FIXATION: 'Fijación Sostenida',
};

const STATUS_BADGE_MAP: Record<
  PatientTherapySessionStatus,
  { label: string; className: string }
> = {
  COMPLETED: {
    label: 'Completada',
    className: 'bg-[#81F3E5]/40 text-[#005049] border-[#006A62]/20',
  },
  ACTIVE: {
    label: 'En Curso',
    className: 'bg-[#DBF1FE] text-[#071524] border-[#071524]/20',
  },
  ABANDONED: {
    label: 'Abandonada',
    className: 'bg-[#FFDCC4] text-[#6F3800] border-[#FFB780]',
  },
  CANCELLED: {
    label: 'Cancelada',
    className: 'bg-[#E2E8F0] text-[#334155] border-[#94A3B8]/40',
  },
  FAILED_TECHNICAL: {
    label: 'Fallo Técnico',
    className: 'bg-[#FFDAD6] text-[#93000A] border-[#BA1A1A]/30',
  },
};

function extractModeFromDetail(detail: DoctorTherapySessionDetailResponse): ReportMode {
  if (detail.parameterSchemaVersion === 2) {
    return detail.configurationParameters.parameters.mode;
  }
  return detail.configurationParameters.mode;
}

function formatDurationSeconds(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${String(secs).padStart(2, '0')}s`;
}

function formatDateTime(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: '—', time: 'En curso' };
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return { date: iso, time: '' };
  return {
    date: parsed.toLocaleDateString('es-PE', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }),
    time: parsed.toLocaleTimeString('es-PE', {
      hour: '2-digit',
      minute: '2-digit',
    }),
  };
}

function mapSummaryToSessionRecord(
  summary: DoctorTherapySessionSummary,
  enrichment?: SessionEnrichment
): SessionRecord {
  const startFormatted = formatDateTime(summary.startedAt);
  const hour = new Date(summary.startedAt).getHours();
  const period: SessionRecord['period'] =
    hour < 12 ? 'Mañana' : hour < 19 ? 'Tarde' : 'Noche';
  const durationMinutes = Number((summary.activeDurationSeconds / 60).toFixed(1));
  const isCompleted = summary.status === 'COMPLETED';
  const modeLabel = enrichment?.mode ? MODE_LABELS[enrichment.mode] : undefined;

  let complianceRate = isCompleted ? 100 : 0;
  if (enrichment?.target && enrichment.target > 0) {
    if (enrichment.criterion === 'REPETITIONS' && enrichment.completedRepetitions !== null && enrichment.completedRepetitions !== undefined) {
      complianceRate = Math.min(100, Math.round((enrichment.completedRepetitions / enrichment.target) * 100));
    } else if (enrichment.criterion === 'ACTIVE_TIME' && enrichment.activeMilliseconds !== null && enrichment.activeMilliseconds !== undefined) {
      complianceRate = Math.min(
        100,
        Math.round((enrichment.activeMilliseconds / 1000 / enrichment.target) * 100)
      );
    }
  }

  return {
    id: summary.therapySessionId,
    dateText: startFormatted.date,
    timeText: startFormatted.time,
    period,
    moduleName: EXERCISE_LABELS[summary.exerciseCode] || summary.exerciseCode,
    moduleDetail: modeLabel
      ? `${modeLabel} · Config v${summary.configurationVersion}`
      : `Config v${summary.configurationVersion} · Cuota ${summary.quotaDate}`,
    durationMinutes,
    complianceRate,
    fovealPrecision: 0,
    isValid: isCompleted,
    validationStatus: isCompleted
      ? 'VALID_OPTIMAL'
      : summary.status === 'FAILED_TECHNICAL'
      ? 'CALIBRATION_ISSUE'
      : 'INTERRUPTED_FATIGUE',
    validationLabel: STATUS_BADGE_MAP[summary.status].label,
    interrupted: summary.status === 'ABANDONED' || summary.status === 'FAILED_TECHNICAL',
    notes: `Sesión ${summary.therapySessionId} (${summary.status}) · Plan ${summary.therapyPlanId}`,
  };
}

export const SessionHistoryTab: React.FC<SessionHistoryTabProps> = ({
  sessions,
  onOpenAnalytics,
  onDownloadSessionPDF,
  onDownloadConsolidatedPDF,
  onIssueCertifiedReport,
  patientId: propPatientId,
  patient,
}) => {
  const authMode = useAppStore((state) => state.authMode);
  const accessToken = useAppStore((state) => state.accessToken);
  const isCognito = authMode === 'COGNITO' && Boolean(accessToken);
  const { patientId: routePatientId } = useParams<{ patientId?: string }>();
  const navigate = useNavigate();

  const resolvedPatientId = propPatientId ?? routePatientId ?? patient?.id;

  // === MOCK MODE STATE ===
  const [searchTerm, setSearchTerm] = useState('');
  const [exerciseFilter, setExerciseFilter] = useState('all');
  const [validityFilter, setValidityFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const mockPageSize = 6;

  // === COGNITO MODE STATE ===
  const [apiSessions, setApiSessions] = useState<DoctorTherapySessionSummary[]>([]);
  const [apiTotal, setApiTotal] = useState(0);
  const [apiPage, setApiPage] = useState(0);
  const apiPageSize = 8;
  const [apiLoading, setApiLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const [apiSearchTerm, setApiSearchTerm] = useState('');
  const [apiExerciseFilter, setApiExerciseFilter] = useState<'ALL' | TherapyExerciseCode>('ALL');
  const [apiStatusFilter, setApiStatusFilter] = useState<'ALL' | PatientTherapySessionStatus>('ALL');
  const [apiModeFilter, setApiModeFilter] = useState<'ALL' | ReportMode>('ALL');
  const [apiAnalyticsFilter, setApiAnalyticsFilter] = useState<'ALL' | 'WITH' | 'WITHOUT'>('ALL');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [enrichmentMap, setEnrichmentMap] = useState<Record<string, SessionEnrichment>>({});

  const fetchCognitoSessions = useCallback(
    async (signal?: { cancelled: boolean }) => {
      if (!isCognito || !resolvedPatientId) return;
      setApiLoading(true);
      setApiError(null);
      try {
        const fromIso = fromDate ? new Date(`${fromDate}T00:00:00Z`).toISOString() : undefined;
        const toIso = toDate
          ? new Date(new Date(`${toDate}T00:00:00Z`).getTime() + 86400000).toISOString()
          : undefined;

        const res = await clinicalApi.listDoctorTherapySessions(resolvedPatientId, {
          page: apiPage,
          size: apiPageSize,
          exerciseCode: apiExerciseFilter !== 'ALL' ? apiExerciseFilter : undefined,
          status: apiStatusFilter !== 'ALL' ? apiStatusFilter : undefined,
          from: fromIso,
          to: toIso,
        });

        if (signal?.cancelled) return;
        setApiSessions(res.sessions);
        setApiTotal(res.total);

        // Enrich current page with stream availability & mode/progress safely
        const enrichmentEntries = await Promise.all(
          res.sessions.map(async (s): Promise<[string, SessionEnrichment]> => {
            const [streamsOutcome, detailOutcome] = await Promise.allSettled([
              analyticsApi.listSessionStreams(s.therapySessionId, { page: 0, size: 5 }),
              clinicalApi.getDoctorTherapySessionDetail(resolvedPatientId, s.therapySessionId),
            ]);

            const streamsOk = streamsOutcome.status === 'fulfilled';
            const streamItems = streamsOk ? streamsOutcome.value.items : [];
            const sampleTotal = streamItems.reduce(
              (acc, item) => acc + (item.sampleCounts?.total ?? 0),
              0
            );

            let mode: ReportMode | undefined;
            let activeMilliseconds: number | null = null;
            let completedRepetitions: number | null = null;
            let target: number | null = null;
            let criterion: 'ACTIVE_TIME' | 'REPETITIONS' | null = null;
            let targetReached: boolean | null = null;

            if (detailOutcome.status === 'fulfilled') {
              const detail = detailOutcome.value;
              mode = extractModeFromDetail(detail);
              if (detail.technicalProgress.availability === 'AVAILABLE') {
                activeMilliseconds = detail.technicalProgress.activeMilliseconds;
                completedRepetitions = detail.technicalProgress.completedRepetitions;
                target = detail.technicalProgress.target;
                criterion = detail.technicalProgress.criterion;
                targetReached = detail.technicalProgress.targetReached;
              }
            }

            return [
              s.therapySessionId,
              {
                analyticsChecked: streamsOk,
                hasAnalytics: streamsOk && streamItems.length > 0,
                streamCount: streamItems.length,
                sampleTotal,
                mode,
                activeMilliseconds,
                completedRepetitions,
                target,
                criterion,
                targetReached,
              },
            ];
          })
        );

        if (signal?.cancelled) return;
        setEnrichmentMap((prev) => ({
          ...prev,
          ...Object.fromEntries(enrichmentEntries),
        }));
      } catch (err) {
        if (signal?.cancelled) return;
        setApiError(extractApiErrorMessage(err));
        setApiSessions([]);
        setApiTotal(0);
      } finally {
        if (!signal?.cancelled) {
          setApiLoading(false);
        }
      }
    },
    [
      isCognito,
      resolvedPatientId,
      apiPage,
      apiPageSize,
      apiExerciseFilter,
      apiStatusFilter,
      fromDate,
      toDate,
    ]
  );

  useEffect(() => {
    if (!isCognito) return;
    const signal = { cancelled: false };
    void fetchCognitoSessions(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [isCognito, fetchCognitoSessions, reloadNonce]);

  // === MOCK FILTERING ===
  const filteredMockSessions = useMemo(() => {
    return sessions.filter((s) => {
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const matchModule = s.moduleName.toLowerCase().includes(query);
        const matchDate = s.dateText.toLowerCase().includes(query);
        if (!matchModule && !matchDate) return false;
      }

      if (exerciseFilter !== 'all') {
        if (!s.moduleName.toLowerCase().includes(exerciseFilter.toLowerCase())) {
          return false;
        }
      }

      if (validityFilter === 'valid') {
        if (!s.isValid) return false;
      } else if (validityFilter === 'incidents') {
        if (s.isValid) return false;
      }

      return true;
    });
  }, [sessions, searchTerm, exerciseFilter, validityFilter]);

  const totalMockPages = Math.ceil(filteredMockSessions.length / mockPageSize) || 1;
  const paginatedMockSessions = filteredMockSessions.slice(
    (currentPage - 1) * mockPageSize,
    currentPage * mockPageSize
  );

  // === COGNITO CLIENT-SIDE REFINEMENT (search, mode, hasAnalytics) ===
  const filteredApiSessions = useMemo(() => {
    return apiSessions.filter((s) => {
      const enrich = enrichmentMap[s.therapySessionId];

      if (apiSearchTerm.trim()) {
        const q = apiSearchTerm.toLowerCase().trim();
        const matchId = s.therapySessionId.toLowerCase().includes(q);
        const matchCode = s.exerciseCode.toLowerCase().includes(q);
        const matchPlan = s.therapyPlanId.toLowerCase().includes(q);
        const matchMode = enrich?.mode?.toLowerCase().includes(q) ?? false;
        const matchDate = s.quotaDate.toLowerCase().includes(q);
        if (!matchId && !matchCode && !matchPlan && !matchMode && !matchDate) return false;
      }

      if (apiModeFilter !== 'ALL') {
        if (!enrich?.mode || enrich.mode !== apiModeFilter) return false;
      }

      if (apiAnalyticsFilter === 'WITH') {
        if (!enrich?.analyticsChecked || !enrich.hasAnalytics) return false;
      } else if (apiAnalyticsFilter === 'WITHOUT') {
        if (enrich?.analyticsChecked && enrich.hasAnalytics) return false;
      }

      return true;
    });
  }, [apiSessions, enrichmentMap, apiSearchTerm, apiModeFilter, apiAnalyticsFilter]);

  // === COGNITO RENDER ===
  if (isCognito) {
    const completedOnPage = apiSessions.filter((s) => s.status === 'COMPLETED').length;
    const withAnalyticsOnPage = apiSessions.filter(
      (s) => enrichmentMap[s.therapySessionId]?.hasAnalytics
    ).length;
    const latestSession = apiSessions[0];
    const latestTime = latestSession ? formatDateTime(latestSession.startedAt) : null;
    const totalApiPages = Math.max(1, Math.ceil(apiTotal / apiPageSize));
    const defaultReportSessionId =
      apiSessions.find((s) => s.status === 'COMPLETED')?.therapySessionId ||
      apiSessions[0]?.therapySessionId;

    const handleGoToReportPreview = (sessionId?: string) => {
      if (!resolvedPatientId) {
        onIssueCertifiedReport();
        return;
      }
      const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
      navigate(`/specialist/patients/${encodeURIComponent(resolvedPatientId)}/reporte-pdf${query}`);
    };

    return (
      <section className="flex flex-col gap-6">
        {!resolvedPatientId && (
          <div className="bg-[#FFDCC4] border border-[#FFB780] text-[#6F3800] rounded-xl p-4 text-xs font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              No se detectó un identificador de paciente en la ruta actual. Seleccione un paciente asignado desde el panel principal.
            </span>
          </div>
        )}

        {/* Filter Bar */}
        <div className="bg-white rounded-xl border border-[#071524]/10 p-4 md:p-5 flex flex-col gap-4 shadow-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#74777C]" />
              <input
                type="text"
                value={apiSearchTerm}
                onChange={(e) => setApiSearchTerm(e.target.value)}
                placeholder="Buscar ID sesión, plan o modo..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-[#E6F6FF]/60 border border-[#C4C6CC]/60 rounded-lg text-[#071524] placeholder:text-[#74777C] focus:outline-none focus:ring-2 focus:ring-[#006A62]"
              />
            </div>

            <select
              value={apiStatusFilter}
              onChange={(e) => {
                setApiStatusFilter(e.target.value as 'ALL' | PatientTherapySessionStatus);
                setApiPage(0);
              }}
              aria-label="Filtrar por estado de sesión"
              className="w-full py-2 px-3 text-xs bg-[#E6F6FF]/60 border border-[#C4C6CC]/60 rounded-lg text-[#071524] focus:outline-none focus:ring-2 focus:ring-[#006A62] cursor-pointer"
            >
              <option value="ALL">Estado: Todos</option>
              <option value="COMPLETED">COMPLETED (Completadas)</option>
              <option value="ACTIVE">ACTIVE (En curso)</option>
              <option value="ABANDONED">ABANDONED (Abandonadas)</option>
              <option value="CANCELLED">CANCELLED (Canceladas)</option>
              <option value="FAILED_TECHNICAL">FAILED_TECHNICAL (Fallo técnico)</option>
            </select>

            <select
              value={apiExerciseFilter}
              onChange={(e) => {
                setApiExerciseFilter(e.target.value as 'ALL' | TherapyExerciseCode);
                setApiPage(0);
              }}
              aria-label="Filtrar por ejercicio"
              className="w-full py-2 px-3 text-xs bg-[#E6F6FF]/60 border border-[#C4C6CC]/60 rounded-lg text-[#071524] focus:outline-none focus:ring-2 focus:ring-[#006A62] cursor-pointer"
            >
              <option value="ALL">Ejercicio: Todos</option>
              <option value="visual-scanning">visual-scanning (Exploración)</option>
              <option value="visual-search">visual-search (Búsqueda)</option>
              <option value="fixation">fixation (Fijación Foveal)</option>
            </select>

            <select
              value={apiModeFilter}
              onChange={(e) => setApiModeFilter(e.target.value as 'ALL' | ReportMode)}
              aria-label="Filtrar por modo clínico"
              className="w-full py-2 px-3 text-xs bg-[#E6F6FF]/60 border border-[#C4C6CC]/60 rounded-lg text-[#071524] focus:outline-none focus:ring-2 focus:ring-[#006A62] cursor-pointer"
            >
              <option value="ALL">Modo: Todos</option>
              <option value="STANDARD_SCANNING">STANDARD_SCANNING</option>
              <option value="SYSTEMATIC_EXPLORATION">SYSTEMATIC_EXPLORATION</option>
              <option value="COMPENSATORY_SACCADE">COMPENSATORY_SACCADE</option>
              <option value="TARGET_SEARCH_WITH_DISTRACTORS">TARGET_SEARCH_WITH_DISTRACTORS</option>
              <option value="SUSTAINED_TARGET_FIXATION">SUSTAINED_TARGET_FIXATION</option>
            </select>

            <select
              value={apiAnalyticsFilter}
              onChange={(e) => setApiAnalyticsFilter(e.target.value as 'ALL' | 'WITH' | 'WITHOUT')}
              aria-label="Filtrar por disponibilidad de analítica"
              className="w-full py-2 px-3 text-xs bg-[#E6F6FF]/60 border border-[#C4C6CC]/60 rounded-lg text-[#071524] focus:outline-none focus:ring-2 focus:ring-[#006A62] cursor-pointer"
            >
              <option value="ALL">Analítica: Todas</option>
              <option value="WITH">Con analítica (streams)</option>
              <option value="WITHOUT">Sin analítica registrada</option>
            </select>
          </div>

          <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 pt-2 border-t border-[#071524]/10">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <label className="text-[#44474C] font-semibold">Desde:</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setApiPage(0);
                }}
                className="px-2.5 py-1.5 rounded-lg border border-[#C4C6CC]/70 bg-[#F3FAFF] text-[#071524] text-xs"
              />
              <label className="text-[#44474C] font-semibold ml-1">Hasta:</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                  setApiPage(0);
                }}
                className="px-2.5 py-1.5 rounded-lg border border-[#C4C6CC]/70 bg-[#F3FAFF] text-[#071524] text-xs"
              />
              <button
                type="button"
                onClick={() => setReloadNonce((n) => n + 1)}
                disabled={apiLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#071524]/15 bg-[#E6F6FF] hover:bg-[#D5ECF8] text-[#071524] font-semibold text-xs cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${apiLoading ? 'animate-spin' : ''}`} />
                Actualizar
              </button>
            </div>

            <button
              type="button"
              onClick={() => handleGoToReportPreview(defaultReportSessionId)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-[#071524] text-white hover:bg-[#1C2A39] transition-colors shadow-xs cursor-pointer"
            >
              <Download className="w-4 h-4 text-[#84F5E8]" />
              <span>Visor & PDF Clínico de Sesión</span>
            </button>
          </div>
        </div>

        {/* Error Banner */}
        {apiError && (
          <div className="bg-[#FFDAD6] border border-[#BA1A1A]/30 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-[#93000A]">
            <div className="flex items-center gap-2 font-semibold">
              <XCircle className="w-4 h-4 shrink-0" />
              <span>No se pudo cargar el historial de sesiones: {apiError}</span>
            </div>
            <button
              type="button"
              onClick={() => setReloadNonce((n) => n + 1)}
              className="px-3 py-1.5 rounded-lg bg-[#93000A] text-white font-bold cursor-pointer self-start sm:self-auto"
            >
              Reintentar
            </button>
          </div>
        )}

        {/* Summary KPIs Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-xl border border-[#071524]/10 flex items-center gap-3 shadow-xs">
            <div className="w-12 h-12 rounded-xl bg-[#DBF1FE] text-[#071524] flex items-center justify-center shrink-0">
              <CalendarDays className="w-6 h-6 text-[#006A62]" />
            </div>
            <div>
              <p className="text-xs text-[#44474C] font-semibold">Total Sesiones (Backend)</p>
              <p className="text-xl font-bold text-[#071524]">{apiTotal} sesiones</p>
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-[#071524]/10 flex items-center gap-3 shadow-xs">
            <div className="w-12 h-12 rounded-xl bg-[#DBF1FE] text-[#006A62] flex items-center justify-center shrink-0">
              <BadgeCheck className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-[#44474C] font-semibold">Completadas (Página)</p>
              <p className="text-xl font-bold text-[#071524]">
                {completedOnPage} / {apiSessions.length}
              </p>
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-[#071524]/10 flex items-center gap-3 shadow-xs">
            <div className="w-12 h-12 rounded-xl bg-[#DBF1FE] text-[#071524] flex items-center justify-center shrink-0">
              <Eye className="w-6 h-6 text-[#006A62]" />
            </div>
            <div>
              <p className="text-xs text-[#44474C] font-semibold">Con Analítica 8085</p>
              <p className="text-xl font-bold text-[#071524]">
                {withAnalyticsOnPage} / {apiSessions.length}
              </p>
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-[#071524]/10 flex items-center gap-3 shadow-xs">
            <div className="w-12 h-12 rounded-xl bg-[#DBF1FE] text-[#006A62] flex items-center justify-center shrink-0">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-[#44474C] font-semibold">Última Sesión Listada</p>
              <p className="text-xs sm:text-sm font-bold text-[#071524]">
                {latestTime ? `${latestTime.date} · ${latestTime.time}` : 'Sin registros'}
              </p>
            </div>
          </div>
        </div>

        {/* Real Sessions Table */}
        <div className="bg-white rounded-xl border border-[#071524]/10 shadow-xs overflow-hidden">
          <div className="p-4 md:px-6 md:py-4 bg-[#E6F6FF]/70 border-b border-[#071524]/10 flex flex-wrap justify-between items-center gap-2">
            <div className="flex items-center gap-2">
              <h2 className="text-sm md:text-base font-bold text-[#071524]">
                Historial Clínico de Sesiones (Clinical API)
              </h2>
              <span className="px-2 py-0.5 rounded-md text-xs bg-[#DBF1FE] text-[#071524] font-semibold">
                {filteredApiSessions.length} mostradas · {apiTotal} totales
              </span>
            </div>
            {apiLoading && (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#006A62]">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Consultando microservicios...
              </span>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#071524]/10 bg-[#E6F6FF]/40 text-[11px] font-bold text-[#44474C] uppercase tracking-wider">
                  <th className="py-3 px-3 xl:px-5">Sesión & Inicio / Fin</th>
                  <th className="py-3 px-3 xl:px-4">Ejercicio & Modo</th>
                  <th className="py-3 px-3 xl:px-4">Duración & Repeticiones</th>
                  <th className="py-3 px-3 xl:px-4">Estado</th>
                  <th className="py-3 px-3 xl:px-4">Analítica 8085</th>
                  <th className="py-3 px-3 xl:px-5 text-right">Acciones Clínicas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#071524]/10">
                {apiLoading && apiSessions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-[#44474C]">
                      <div className="inline-flex items-center gap-2 font-semibold">
                        <Loader2 className="w-4 h-4 animate-spin text-[#006A62]" />
                        Cargando sesiones del paciente...
                      </div>
                    </td>
                  </tr>
                ) : filteredApiSessions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-[#74777C]">
                      No se encontraron sesiones para este paciente con los filtros actuales.
                    </td>
                  </tr>
                ) : (
                  filteredApiSessions.map((s) => {
                    const startFmt = formatDateTime(s.startedAt);
                    const endFmt = formatDateTime(s.endedAt);
                    const enrich = enrichmentMap[s.therapySessionId];
                    const statusBadge = STATUS_BADGE_MAP[s.status];
                    const mappedRecord = mapSummaryToSessionRecord(s, enrich);

                    return (
                      <tr key={s.therapySessionId} className="hover:bg-[#E6F6FF]/40 transition-colors">
                        <td className="py-3.5 px-3 xl:px-5 whitespace-nowrap">
                          <div className="font-mono font-bold text-[#071524]" title={s.therapySessionId}>
                            {s.therapySessionId.slice(0, 12)}…
                          </div>
                          <div className="text-[11px] text-[#44474C] mt-0.5">
                            Inicio: {startFmt.date} {startFmt.time}
                          </div>
                          <div className="text-[11px] text-[#74777C]">
                            Fin: {s.endedAt ? `${endFmt.date} ${endFmt.time}` : 'En curso'}
                          </div>
                        </td>

                        <td className="py-3.5 px-3 xl:px-4">
                          <div className="font-bold text-[#071524]">
                            {EXERCISE_LABELS[s.exerciseCode]}
                          </div>
                          <div className="text-[11px] text-[#44474C] mt-0.5 flex flex-wrap items-center gap-1.5">
                            <span className="font-mono bg-[#DBF1FE] text-[#071524] px-1.5 py-0.5 rounded">
                              {s.exerciseCode}
                            </span>
                            {enrich?.mode && (
                              <span className="font-semibold text-[#006A62]">
                                {MODE_LABELS[enrich.mode]}
                              </span>
                            )}
                            <span>· v{s.configurationVersion}</span>
                          </div>
                        </td>

                        <td className="py-3.5 px-3 xl:px-4 whitespace-nowrap">
                          <div className="font-bold text-[#071524]">
                            {formatDurationSeconds(s.activeDurationSeconds)}
                          </div>
                          {enrich?.activeMilliseconds !== null &&
                            enrich?.activeMilliseconds !== undefined && (
                              <div className="text-[11px] text-[#44474C]">
                                Activo: {(enrich.activeMilliseconds / 1000).toFixed(1)}s
                              </div>
                            )}
                          {enrich?.completedRepetitions !== null &&
                            enrich?.completedRepetitions !== undefined && (
                              <div className="text-[11px] text-[#006A62] font-semibold">
                                Reps: {enrich.completedRepetitions}
                                {enrich.criterion === 'REPETITIONS' && enrich.target
                                  ? ` / ${enrich.target}`
                                  : ''}
                                {enrich.targetReached ? ' ✓' : ''}
                              </div>
                            )}
                        </td>

                        <td className="py-3.5 px-3 xl:px-4 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-bold border ${statusBadge.className}`}
                          >
                            {statusBadge.label}
                          </span>
                          <div className="text-[10px] text-[#74777C] font-mono mt-0.5">
                            Cuota: {s.quotaDate}
                          </div>
                        </td>

                        <td className="py-3.5 px-3 xl:px-4 whitespace-nowrap">
                          {!enrich ? (
                            <span className="text-[11px] text-[#74777C]">Verificando...</span>
                          ) : enrich.analyticsChecked && enrich.hasAnalytics ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#81F3E5]/40 text-[#005049] text-[11px] font-bold border border-[#006A62]/20">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {enrich.streamCount} stream(s) · {enrich.sampleTotal} muestras
                            </span>
                          ) : enrich.analyticsChecked ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#F1F5F9] text-[#475569] text-[11px] font-semibold border border-[#CBD5E1]">
                              Sin analítica
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#FFF7ED] text-[#9A3412] text-[11px] font-semibold">
                              Analítica no disponible
                            </span>
                          )}
                        </td>

                        <td className="py-3.5 px-3 xl:px-5 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => onOpenAnalytics(mappedRecord)}
                              className="px-2 xl:px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-[#071524]/20 hover:bg-[#DBF1FE] text-[#071524] transition-colors cursor-pointer"
                            >
                              Ver Analítica
                            </button>
                            {resolvedPatientId && (
                              <>
                                <Link
                                  to={`/specialist/patients/${encodeURIComponent(
                                    resolvedPatientId
                                  )}/auditoria?sessionId=${encodeURIComponent(s.therapySessionId)}`}
                                  className="inline-flex items-center gap-1 px-2 xl:px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-[#E6F6FF] hover:bg-[#D5ECF8] text-[#006A62] border border-[#006A62]/20 transition-colors"
                                  title="Abrir Auditoría 120Hz"
                                >
                                  <Activity className="w-3.5 h-3.5" />
                                  Auditoría
                                </Link>
                                <Link
                                  to={`/specialist/patients/${encodeURIComponent(
                                    resolvedPatientId
                                  )}/reporte-pdf?sessionId=${encodeURIComponent(s.therapySessionId)}`}
                                  className="inline-flex items-center gap-1 px-2 xl:px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-[#071524] hover:bg-[#1C2A39] text-white transition-colors"
                                  title="Vista previa y emisión de PDF oficial"
                                >
                                  <FileText className="w-3.5 h-3.5 text-[#84F5E8]" />
                                  PDF
                                </Link>
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

          {/* Backend Pagination Controls */}
          <div className="px-6 py-4 bg-[#E6F6FF]/50 border-t border-[#071524]/10 flex flex-col sm:flex-row justify-between items-center gap-3">
            <p className="text-xs text-[#44474C]">
              Página <strong className="text-[#071524]">{apiPage + 1}</strong> de{' '}
              <strong className="text-[#071524]">{totalApiPages}</strong> · Total{' '}
              <strong className="text-[#071524]">{apiTotal}</strong> sesiones
            </p>
            <div className="inline-flex items-center gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => setApiPage((p) => Math.max(0, p - 1))}
                disabled={apiPage === 0 || apiLoading}
                className="px-3 py-1.5 rounded-lg border border-[#C4C6CC] bg-white text-[#071524] font-semibold disabled:opacity-40 flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
                Anterior
              </button>
              <button
                type="button"
                onClick={() => setApiPage((p) => (p + 1 < totalApiPages ? p + 1 : p))}
                disabled={apiPage + 1 >= totalApiPages || apiLoading}
                className="px-3 py-1.5 rounded-lg border border-[#C4C6CC] bg-white text-[#071524] font-semibold disabled:opacity-40 flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed"
              >
                Siguiente
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Bottom Quick Export Banner */}
        <div className="bg-[#D5ECF8] rounded-xl border border-[#071524]/15 p-4 md:p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#071524] text-white flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5 text-[#84F5E8]" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#071524]">
                Emisión de Snapshot Oficial y PDF Clínico
              </h3>
              <p className="text-xs text-[#44474C] mt-0.5">
                Previsualice métricas clínicas, emita snapshots inmutables con clave de idempotencia y descargue el PDF oficial certificado.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => handleGoToReportPreview(defaultReportSessionId)}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-lg bg-[#006A62] hover:bg-[#005049] text-white transition-colors shadow-xs cursor-pointer whitespace-nowrap"
          >
            <Award className="w-4 h-4 text-[#84F5E8]" />
            Emitir Informe Certificado
          </button>
        </div>
      </section>
    );
  }

  // === MOCK MODE RENDER (PRESERVED) ===
  return (
    <section className="flex flex-col gap-6">
      {/* Sub-Header & Controls Filter Bar */}
      <div className="bg-white rounded-xl border border-[#071524]/10 p-4 md:p-5 flex flex-col lg:flex-row gap-4 justify-between items-stretch lg:items-center shadow-xs">
        {/* Search and Dropdowns */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 flex-1">
          {/* Search input */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#74777C]" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por módulo o fecha..."
              className="w-full pl-9 pr-3 py-2 text-xs md:text-sm bg-[#E6F6FF]/60 border border-[#C4C6CC]/60 rounded-lg text-[#071524] placeholder:text-[#74777C] focus:outline-none focus:ring-2 focus:ring-[#006A62]"
            />
          </div>

          {/* Exercise Filter */}
          <div className="relative">
            <select
              value={exerciseFilter}
              onChange={(e) => setExerciseFilter(e.target.value)}
              aria-label="Filtrar por ejercicio"
              className="w-full py-2 pl-3 pr-8 text-xs md:text-sm bg-[#E6F6FF]/60 border border-[#C4C6CC]/60 rounded-lg text-[#071524] focus:outline-none focus:ring-2 focus:ring-[#006A62] cursor-pointer"
            >
              <option value="all">Todos los ejercicios</option>
              <option value="Búsqueda Visual">Búsqueda Visual Dinámica</option>
              <option value="Fijación Foveal">Fijación Foveal y Estabilidad</option>
              <option value="Exploración Sacádica">Exploración Sacádica</option>
            </select>
          </div>

          {/* Validity Filter */}
          <div className="flex gap-2">
            <select
              value={validityFilter}
              onChange={(e) => setValidityFilter(e.target.value)}
              aria-label="Validez de telemetría"
              className="w-full py-2 pl-2 pr-6 text-xs bg-[#E6F6FF]/60 border border-[#C4C6CC]/60 rounded-lg text-[#071524] focus:outline-none focus:ring-2 focus:ring-[#006A62] cursor-pointer"
            >
              <option value="all">Validez: Todas las sesiones</option>
              <option value="valid">Solo Válidas (Telemetría Óptima)</option>
              <option value="incidents">Solo con Incidencias / Fatiga</option>
            </select>
          </div>
        </div>

        {/* Batch Action */}
        <div className="shrink-0 flex items-center gap-2 pt-2 lg:pt-0 border-t lg:border-t-0 border-[#071524]/10">
          <button
            onClick={onDownloadConsolidatedPDF}
            className="w-full lg:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-lg bg-[#071524] text-white hover:bg-[#1C2A39] transition-colors shadow-xs cursor-pointer"
          >
            <Download className="w-4 h-4 text-[#84F5E8]" />
            <span>Descargar Reporte Consolidado (PDF Clínico)</span>
          </button>
        </div>
      </div>

      {/* Summary KPIs Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-[#071524]/10 flex items-center gap-3 shadow-xs">
          <div className="w-12 h-12 rounded-xl bg-[#DBF1FE] text-[#071524] flex items-center justify-center shrink-0">
            <CalendarDays className="w-6 h-6 text-[#006A62]" />
          </div>
          <div>
            <p className="text-xs text-[#44474C] font-semibold">Total Sesiones Registradas</p>
            <p className="text-xl font-bold text-[#071524]">{sessions.length} sesiones</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-[#071524]/10 flex items-center gap-3 shadow-xs">
          <div className="w-12 h-12 rounded-xl bg-[#DBF1FE] text-[#006A62] flex items-center justify-center shrink-0">
            <BadgeCheck className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-[#44474C] font-semibold">Tasa de Cumplimiento Promedio</p>
            <p className="text-xl font-bold text-[#071524]">94.8%</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-[#071524]/10 flex items-center gap-3 shadow-xs">
          <div className="w-12 h-12 rounded-xl bg-[#DBF1FE] text-[#071524] flex items-center justify-center shrink-0">
            <Eye className="w-6 h-6 text-[#006A62]" />
          </div>
          <div>
            <p className="text-xs text-[#44474C] font-semibold">Validadas por Algoritmo de Mirada</p>
            <p className="text-xl font-bold text-[#071524]">
              {sessions.filter((s) => s.isValid).length} / {sessions.length}{' '}
              <span className="text-xs font-normal text-[#44474C]">
                ({Math.round((sessions.filter((s) => s.isValid).length / Math.max(1, sessions.length)) * 100)}%)
              </span>
            </p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-[#071524]/10 flex items-center gap-3 shadow-xs">
          <div className="w-12 h-12 rounded-xl bg-[#DBF1FE] text-[#006A62] flex items-center justify-center shrink-0">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-[#44474C] font-semibold">Última Sesión</p>
            <p className="text-xs sm:text-sm font-bold text-[#071524]">
              Hoy, 08:30 AM <span className="text-xs text-[#006A62] font-semibold">(Completada)</span>
            </p>
          </div>
        </div>
      </div>

      {/* Structured Session History Table */}
      <div className="bg-white rounded-xl border border-[#071524]/10 shadow-xs overflow-hidden">
        <div className="p-4 md:px-6 md:py-4 bg-[#E6F6FF]/70 border-b border-[#071524]/10 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <h2 className="text-sm md:text-base font-bold text-[#071524]">
              Registro Detallado de Telemetría Clínica
            </h2>
            <span className="px-2 py-0.5 rounded-md text-xs bg-[#DBF1FE] text-[#071524] font-semibold">
              {filteredMockSessions.length} entradas
            </span>
          </div>
          <span className="text-xs text-[#44474C] font-medium hidden sm:inline-block">
            Algoritmo de Rastreo Ocular v4.2.1 • HL7 FHIR Compliant
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs md:text-sm">
            <thead>
              <tr className="border-b border-[#071524]/10 bg-[#E6F6FF]/40 text-xs font-bold text-[#44474C] uppercase tracking-wider">
                <th className="py-3 px-2.5 xl:px-4" scope="col">Fecha & Hora</th>
                <th className="py-3 px-2.5 xl:px-4" scope="col">Módulo de Ejercicio</th>
                <th className="py-3 px-2.5 xl:px-4" scope="col">Duración</th>
                <th className="py-3 px-2.5 xl:px-4 min-w-[115px] xl:min-w-[140px]" scope="col">Cumplimiento</th>
                <th className="py-3 px-2.5 xl:px-4" scope="col">Fijación Foveal</th>
                <th className="py-3 px-2.5 xl:px-4" scope="col">Validación Técnica</th>
                <th className="py-3 px-2.5 xl:px-4 text-right" scope="col">Acciones Clínicas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#071524]/10 font-normal text-xs md:text-sm">
              {paginatedMockSessions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-[#74777C]">
                    No se encontraron sesiones registradas con los criterios seleccionados.
                  </td>
                </tr>
              ) : (
                paginatedMockSessions.map((session) => {
                  const isInterrupted =
                    session.interrupted || session.validationStatus === 'INTERRUPTED_FATIGUE';

                  return (
                    <tr
                      key={session.id}
                      className={`transition-colors ${
                        isInterrupted
                          ? 'bg-[#FFDCC4]/20 hover:bg-[#FFDCC4]/30'
                          : 'hover:bg-[#E6F6FF]/40'
                      }`}
                    >
                      {/* Fecha & Hora */}
                      <td className="py-4 px-2.5 xl:px-4 whitespace-nowrap">
                        <span className="font-bold text-[#071524] block">{session.dateText}</span>
                        <span className="text-xs text-[#44474C]">
                          {session.timeText} ({session.period})
                        </span>
                      </td>

                      {/* Módulo */}
                      <td className="py-4 px-2.5 xl:px-4">
                        <div className="font-semibold text-[#071524]">{session.moduleName}</div>
                        <span className="text-xs text-[#44474C]">{session.moduleDetail}</span>
                      </td>

                      {/* Duración */}
                      <td className="py-4 px-2.5 xl:px-4 font-semibold text-[#071524] whitespace-nowrap">
                        {session.durationMinutes} min
                        {session.targetDurationMinutes && (
                          <span className="text-xs text-[#44474C] font-normal">
                            {' '}/ {session.targetDurationMinutes}m
                          </span>
                        )}
                      </td>

                      {/* Cumplimiento */}
                      <td className="py-4 px-2.5 xl:px-4">
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-bold text-xs ${
                              isInterrupted ? 'text-[#C97E41]' : 'text-[#006A62]'
                            }`}
                          >
                            {session.complianceRate}%
                          </span>
                          <div className="w-16 xl:w-20 bg-[#DBF1FE] h-2 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${
                                isInterrupted ? 'bg-[#FFB780]' : 'bg-[#006A62]'
                              }`}
                              style={{ width: `${session.complianceRate}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      {/* Fijación Foveal */}
                      <td className="py-4 px-2.5 xl:px-4 whitespace-nowrap">
                        <span className="font-semibold text-[#071524]">
                          {session.fovealPrecision}% precisión
                        </span>
                        {session.microsaccadesPerSec !== undefined && (
                          <span className="block text-[11px] text-[#44474C]">
                            Microsacadas: {session.microsaccadesPerSec}/s
                          </span>
                        )}
                        {session.latencyMs !== undefined && (
                          <span className="block text-[11px] text-[#44474C]">
                            Latencia: {session.latencyMs}ms
                          </span>
                        )}
                        {isInterrupted && (
                          <span className="block text-[11px] text-[#BA1A1A] font-medium">
                            Desviación en cuadrante
                          </span>
                        )}
                      </td>

                      {/* Validación Técnica */}
                      <td className="py-4 px-2.5 xl:px-4 whitespace-nowrap">
                        {isInterrupted ? (
                          <span className="inline-flex items-center gap-1 px-2 xl:px-2.5 py-1 rounded-md bg-[#FFDCC4] text-[#6F3800] text-xs font-semibold border border-[#FFB780]">
                            <AlertTriangle className="w-3.5 h-3.5 text-[#BA1A1A]" />
                            {session.validationLabel}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 xl:px-2.5 py-1 rounded-md bg-[#81F3E5]/40 text-[#005049] text-xs font-semibold border border-[#006A62]/20">
                            <CheckCircle2 className="w-3.5 h-3.5 text-[#006A62]" />
                            {session.validationLabel}
                          </span>
                        )}
                      </td>

                      {/* Acciones */}
                      <td className="py-4 px-2.5 xl:px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5 xl:gap-2">
                          <button
                            onClick={() => onOpenAnalytics(session)}
                            className="px-2 xl:px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#071524]/20 hover:bg-[#DBF1FE] text-[#071524] transition-colors cursor-pointer"
                          >
                            Ver Analítica
                          </button>
                          {resolvedPatientId && (
                            <Link
                              to={`/specialist/patients/${encodeURIComponent(
                                resolvedPatientId
                              )}/auditoria?sessionId=${encodeURIComponent(session.id)}`}
                              className="p-1.5 rounded-lg hover:bg-[#DBF1FE] text-[#071524] transition-colors"
                              title="Auditoría de Sesión"
                            >
                              <Activity className="w-4 h-4 text-[#006A62]" />
                            </Link>
                          )}
                          <button
                            onClick={() => onDownloadSessionPDF(session)}
                            className="p-1.5 rounded-lg hover:bg-[#DBF1FE] text-[#071524] transition-colors cursor-pointer"
                            title="Descargar PDF de Sesión"
                          >
                            <FileText className="w-4 h-4 text-[#006A62]" />
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

        {/* Pagination Controls */}
        <div className="px-6 py-4 bg-[#E6F6FF]/50 border-t border-[#071524]/10 flex flex-col sm:flex-row justify-between items-center gap-3">
          <p className="text-xs text-[#44474C]">
            Mostrando{' '}
            <strong className="font-semibold text-[#071524]">
              {filteredMockSessions.length > 0 ? (currentPage - 1) * mockPageSize + 1 : 0} -{' '}
              {Math.min(currentPage * mockPageSize, filteredMockSessions.length)}
            </strong>{' '}
            de <strong className="font-semibold text-[#071524]">{filteredMockSessions.length}</strong>{' '}
            sesiones registradas
          </p>

          <div className="inline-flex items-center gap-1 text-xs">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="w-8 h-8 rounded-lg border border-[#C4C6CC] bg-white text-[#44474C] disabled:opacity-40 transition-colors flex items-center justify-center cursor-pointer disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            {Array.from({ length: totalMockPages }).map((_, i) => {
              const page = i + 1;
              const isActive = page === currentPage;
              return (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`w-8 h-8 rounded-lg font-bold transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-[#071524] text-white'
                      : 'border border-[#C4C6CC]/60 bg-white text-[#071524] hover:bg-[#DBF1FE]'
                  }`}
                >
                  {page}
                </button>
              );
            })}
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalMockPages, p + 1))}
              disabled={currentPage === totalMockPages}
              className="w-8 h-8 rounded-lg border border-[#C4C6CC] bg-white text-[#44474C] disabled:opacity-40 transition-colors flex items-center justify-center cursor-pointer disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Quick Export Banner */}
      <div className="bg-[#D5ECF8] rounded-xl border border-[#071524]/15 p-4 md:p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#071524] text-white flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-[#84F5E8]" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#071524]">
              Generación de Informe Clínico para Junta Médica o Seguro
            </h3>
            <p className="text-xs text-[#44474C] mt-0.5">
              Firma digital habilitada (Dra. Elena Ramos M. - CMP 48192) con sello de tiempo criptográfico y trazabilidad HL7.
            </p>
          </div>
        </div>

        <button
          onClick={onIssueCertifiedReport}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-lg bg-[#006A62] hover:bg-[#005049] text-white transition-colors shadow-xs cursor-pointer whitespace-nowrap"
        >
          <Award className="w-4 h-4 text-[#84F5E8]" />
          Emitir Informe Certificado
        </button>
      </div>
    </section>
  );
};
