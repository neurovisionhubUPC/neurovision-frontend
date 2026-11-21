import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import type {
  FrozenClinicalExerciseParameters,
  MedicalPrescription,
} from '../../../../core/domain/Prescription';
import { useAppStore, type GamePhase } from '../../../../core/store/useAppStore';
import {
  type TrajectoryPoint,
  type ClinicalEvaluationReport,
  generateClinicalReport,
} from '../../../../infrastructure/cv/math/clinicalMetrics';
import {
  degreesToPixels,
  evaluateGazeSampleStability,
  computeRetinotopicSafeScaleFactor,
} from '../../../../infrastructure/therapy/retinotopicGeometry';
import {
  createStandardScanningTrial,
  stepStandardScanningTrial,
  interruptStandardScanningTrial,
  createSystematicExplorationTrial,
  stepSystematicExplorationTrial,
  interruptSystematicExplorationTrial,
  createCompensatorySaccadeTrial,
  stepCompensatorySaccadeTrial,
  interruptCompensatorySaccadeTrial,
  type ExplorationQuadrant,
  type ExplorationVisit,
  type StandardScanningTrialState,
  type SystematicExplorationTrialState,
  type CompensatorySaccadeTrialState,
} from '../../../../infrastructure/therapy/modules/visualScanningEngine';
import {
  createVisualSearchTrial,
  stepVisualSearchTrial,
  interruptVisualSearchTrial,
  createSustainedFixationTrial,
  stepSustainedFixationTrial,
  interruptSustainedFixationTrial,
  renderSearchEntity,
  renderFixationTarget,
  type VisualSearchTrialState,
  type FixationTrialState,
} from '../../../../infrastructure/therapy/modules/visualSearchAndFixationEngine';
import {
  ApiError,
  analyticsApi,
  clinicalApi,
  createUuid,
  extractApiErrorMessage,
  modeToAnalyticsSlug,
  parseJwtClaims,
  telemetryApi,
  type AnyTrialBody,
  type FixationParameters,
  type PatientActivityEventBody,
  type PatientSessionProgressResponse,
  type PatientTherapySessionResponse,
  type ReportMode,
  type AnalyticsDataOrigin,
  type TherapyCompletionTarget,
  type VisualScanningParameters,
  type VisualSearchParameters,
} from '../../../../infrastructure/api';
import {
  GazeFreshnessGuard,
  MAX_GAZE_STALENESS_MS,
  SUPPORTED_MIN_INFERENCE_FPS,
  type GazeFreshnessReason,
} from '../../../../infrastructure/therapy/gazeFreshnessGuard';
import {
  isMatchingSessionProgress,
  SessionDeliveryController,
  type ClinicalClosureStateDetail,
  type PendingCriticalWorkSnapshot,
  type SessionSyncSummary,
} from '../../../../infrastructure/telemetry/sessionDeliveryController';
import {
  Award,
  CheckCircle,
  Activity,
  Clock,
  RotateCcw,
  ArrowLeft,
  Pause,
  Play,
  MousePointer2,
  AlertTriangle,
  Loader2,
  Volume2,
  VolumeX,
  Flame,
  Trophy,
  Sparkles,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { therapyAudio } from '../../../../infrastructure/therapy/therapyAudioFeedback';
import { ClinicalTermTooltip } from '../../../shared/components/ClinicalTermTooltip';

export interface Point2D {
  x: number;
  y: number;
}

export interface EyeTrackingGameCanvasProps {
  gazeRef: React.MutableRefObject<Point2D>;
  prescription: MedicalPrescription;
  gamePhase: GamePhase;
  onPhaseChange: (newPhase: GamePhase) => void;
  width?: number;
  height?: number;
  exerciseMode?: ReportMode;
  activeSession?: PatientTherapySessionResponse | null;
  sessionProgress?: PatientSessionProgressResponse | null;
  accountKey?: string | null;
  gazeConfidenceRef?: React.MutableRefObject<number>;
  gazeSampleSeqRef?: React.MutableRefObject<number>;
  gazeLastValidPerfRef?: React.MutableRefObject<number>;
  gazeIsBlinkingRef?: React.MutableRefObject<boolean>;
  isWebcamStreaming?: boolean;
  mouseFallbackEnabled?: boolean;
  measuredInferenceFps?: number | null;
  onToggleMouseFallback?: () => void;
  onSessionProgressUpdate?: (progress: PatientSessionProgressResponse) => void;
  onSessionCompleted?: (
    progress: PatientSessionProgressResponse | null,
    action: 'FINISHED' | 'ABANDONED'
  ) => void;
  onRequestNewSession?: () => void;
  onPendingCriticalWorkChange?: (snapshot: PendingCriticalWorkSnapshot) => void;
}

type TrialSubPhase = 'INTER_STIMULUS_REST' | 'CENTRAL_ANCHOR' | 'ACTIVE_TRIAL';

interface CanvasEntity {
  id: string;
  x: number;
  y: number;
  radius: number;
  kind: 'TARGET' | 'DISTRACTOR' | 'ANCHOR' | 'WAYPOINT';
  quadrant?: ExplorationQuadrant;
  orderIndex?: number;
  found: boolean;
  dwellTimeMs: number;
}

interface ModuleSessionSummary {
  successfulTrials: number;
  timedOutTrials: number;
  medianDurationMs: number | null;
  falseFixations: number;
  quadrantCoveragePercent: number;
  maxContinuousFixationMs: number;
  gamifiedPoints: number;
  maxStreak: number;
  inputOrigin: 'WEBCAM_GAZE' | 'MOUSE_FALLBACK' | 'MIXED' | 'NONE';
  webcamSamplePercent: number;
  reportedDataOrigin: 'PRODUCER_REPORTED' | 'SYNTHETIC' | 'MIXED' | 'NONE';
}

function createEmptySyncSummary(sessionId: string | null = null): SessionSyncSummary {
  return {
    sessionId,
    confirmedTrials: 0,
    pendingTrials: 0,
    uncertainTrials: 0,
    failedPermanentTrials: 0,
    inFlightTrials: 0,
    pendingTelemetryBatches: 0,
    inFlightTelemetryBatches: 0,
    bufferedTelemetrySamples: 0,
    brokerAcceptedTelemetryBatches: 0,
    permanentRejectedTelemetryBatches: 0,
    droppedOverflowTelemetryBatches: 0,
    hasPendingOrUncertainDelivery: false,
    hasPermanentDataLoss: false,
    isSyncComplete: true,
    lastWarning: null,
  };
}

function createEmptyPendingWorkSnapshot(
  sessionId: string | null = null,
  accountKey: string | null = null
): PendingCriticalWorkSnapshot {
  return {
    sessionId,
    accountKey,
    pendingTelemetryBatches: 0,
    inFlightTelemetryBatches: 0,
    bufferedTelemetrySamples: 0,
    pendingTrials: 0,
    uncertainTrials: 0,
    inFlightTrials: 0,
    hasActiveClosure: false,
    hasUncertainClosure: false,
    hasPendingCriticalWork: false,
    isInMemoryOnly: true,
  };
}

function getGazeWarningText(reason: GazeFreshnessReason): string | null {
  switch (reason) {
    case 'BLINKING':
      return '👁️ Parpadeo detectado — fijación pausada';
    case 'STALE_SAMPLE':
      return `⚠️ Señal ocular detenida (>${MAX_GAZE_STALENESS_MS}ms) — reubíquese frente a la cámara`;
    case 'STREAM_STOPPED':
      return '⚠️ Cámara detenida — reactívela para continuar';
    case 'LOW_CONFIDENCE':
      return '⚠️ Baja confianza ocular — mejore iluminación o postura';
    case 'MOUSE_WAITING_INPUT':
      return '🖱️ Mueva el puntero sobre el lienzo para iniciar';
    default:
      return null;
  }
}

function clamp01(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.max(0, Math.min(1, val));
}

function clamp(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, val));
}

function resolveSessionParams(
  prescription: MedicalPrescription,
  mode: ReportMode,
  activeSession?: PatientTherapySessionResponse | null
): {
  frozen: FrozenClinicalExerciseParameters;
  completionTarget?: TherapyCompletionTarget;
} {
  if (activeSession) {
    if (activeSession.parameterSchemaVersion === 2) {
      return {
        frozen: activeSession.parameters.parameters,
        completionTarget: activeSession.parameters.completionTarget,
      };
    }
    return {
      frozen: activeSession.parameters,
      completionTarget: prescription.clinicalContext?.completionTarget,
    };
  }

  if (
    prescription.clinicalContext?.frozenParameters &&
    prescription.clinicalContext.frozenParameters.mode === mode
  ) {
    return {
      frozen: prescription.clinicalContext.frozenParameters,
      completionTarget: prescription.clinicalContext.completionTarget,
    };
  }

  const rawMinFix = prescription.parameters.min_fixation_time || 900;
  const minFixScanning = clamp(rawMinFix, 300, 2000);
  const minFixFixation = clamp(Math.max(1200, rawMinFix), 300, 3000);
  const amp = clamp(prescription.parameters.visual_field_amplitude || 0.85, 0.4, 1.0);
  const ecc = clamp(Math.round(amp * 30), 5, 30);

  switch (mode) {
    case 'STANDARD_SCANNING':
    case 'SYSTEMATIC_EXPLORATION':
    case 'COMPENSATORY_SACCADE':
      return {
        frozen: {
          mode,
          affectedHemifield: 'LEFT',
          minimumFixationMs: minFixScanning,
          maximumStimulusDurationMs: mode === 'SYSTEMATIC_EXPLORATION' ? 9000 : 6000,
          eccentricityDegrees: ecc,
          targetSizePx: 68,
          repetitions: 8,
          interStimulusIntervalMs: 750,
          difficultyLevel: 2,
        },
        completionTarget: prescription.clinicalContext?.completionTarget,
      };
    case 'TARGET_SEARCH_WITH_DISTRACTORS':
      return {
        frozen: {
          mode: 'TARGET_SEARCH_WITH_DISTRACTORS',
          affectedHemifield: 'LEFT',
          targetCount: 8,
          distractorCount: 6,
          minimumFixationMs: minFixScanning,
          maximumSearchTimeMs: 12000,
          affectedHemifieldBias: 0.75,
          targetSizePx: 64,
          difficultyLevel: 2,
        },
        completionTarget: prescription.clinicalContext?.completionTarget,
      };
    case 'SUSTAINED_TARGET_FIXATION':
      return {
        frozen: {
          mode: 'SUSTAINED_TARGET_FIXATION',
          targetPosition: 'LEFT',
          minimumFixationMs: minFixFixation,
          maximumFixationMs: clamp(Math.max(minFixFixation + 1000, minFixFixation * 2), 500, 5000),
          targetSizePx: 72,
          repetitions: 6,
          restBetweenRepetitionsMs: 1200,
          difficultyLevel: 2,
        },
        completionTarget: prescription.clinicalContext?.completionTarget,
      };
  }
}

const CALIBRATION_GRID = [
  { x: 0.1, y: 0.1 },
  { x: 0.5, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.1, y: 0.5 },
  { x: 0.5, y: 0.5 },
  { x: 0.9, y: 0.5 },
  { x: 0.1, y: 0.9 },
  { x: 0.5, y: 0.9 },
  { x: 0.9, y: 0.9 },
];

export const EyeTrackingGameCanvas: React.FC<EyeTrackingGameCanvasProps> = ({
  gazeRef,
  prescription,
  gamePhase,
  onPhaseChange,
  width = 800,
  height = 600,
  exerciseMode,
  activeSession,
  sessionProgress,
  accountKey,
  gazeConfidenceRef,
  gazeSampleSeqRef,
  gazeLastValidPerfRef,
  gazeIsBlinkingRef,
  isWebcamStreaming,
  mouseFallbackEnabled = false,
  measuredInferenceFps = null,
  onToggleMouseFallback,
  onSessionProgressUpdate,
  onSessionCompleted,
  onRequestNewSession,
  onPendingCriticalWorkChange,
}) => {
  const navigate = useNavigate();
  const authMode = useAppStore((state) => state.authMode);
  const accessToken = useAppStore((state) => state.accessToken);
  const userProfile = useAppStore((state) => state.userProfile);
  const measuredInferenceFpsRef = useRef<number | null>(measuredInferenceFps);
  measuredInferenceFpsRef.current = measuredInferenceFps;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hudPrimaryRef = useRef<HTMLSpanElement>(null);
  const hudSecondaryRef = useRef<HTMLSpanElement>(null);
  const hudWarningRef = useRef<HTMLSpanElement>(null);
  const lastHudPrimaryRef = useRef<string>('');
  const lastHudSecondaryRef = useRef<string>('');
  const lastHudWarningRef = useRef<string>('');
  const requestRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const trajectoryRef = useRef<TrajectoryPoint[]>([]);
  const isMountedRef = useRef<boolean>(true);

  const [report, setReport] = useState<ClinicalEvaluationReport | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  const [localMouseFallback, setLocalMouseFallback] = useState(mouseFallbackEnabled);
  const localMouseFallbackRef = useRef<boolean>(mouseFallbackEnabled);
  const mousePointRef = useRef<Point2D>({ x: 0.5, y: 0.5 });

  useEffect(() => {
    localMouseFallbackRef.current = mouseFallbackEnabled;
    setLocalMouseFallback(mouseFallbackEnabled);
  }, [mouseFallbackEnabled]);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      deliveryControllerRef.current?.dispose();
      deliveryControllerRef.current = null;
    };
  }, []);

  // Backend integration status (non-blocking UI feedback)
  const [backendWarning, setBackendWarning] = useState<string | null>(null);
  const [completionState, setCompletionState] = useState<
    'IDLE' | 'SAVING' | 'PENDING_SYNC' | 'FINISHED' | 'ABANDONED' | 'ERROR'
  >('IDLE');
  const completionStateRef = useRef(completionState);
  useEffect(() => {
    completionStateRef.current = completionState;
  }, [completionState]);
  const [syncSummary, setSyncSummary] = useState<SessionSyncSummary>(() =>
    createEmptySyncSummary(null)
  );
  const [closureDetail, setClosureDetail] = useState<ClinicalClosureStateDetail | null>(null);
  const [pendingExitIntent, setPendingExitIntent] = useState<'DASHBOARD' | 'NEW_SESSION' | null>(
    null
  );
  const [pendingWorkSnapshot, setPendingWorkSnapshot] = useState<PendingCriticalWorkSnapshot>(
    () => createEmptyPendingWorkSnapshot(null)
  );

  const resolvedMode: ReportMode =
    exerciseMode ||
    (activeSession
      ? activeSession.parameterSchemaVersion === 2
        ? activeSession.parameters.parameters.mode
        : activeSession.parameters.mode
      : undefined) ||
    prescription.clinicalContext?.mode ||
    'STANDARD_SCANNING';

  const activeSessionId =
    activeSession?.therapySessionId || prescription.clinicalContext?.therapySessionId || null;

  const isCognitoSession =
    authMode === 'COGNITO' && Boolean(accessToken) && Boolean(activeSessionId);

  const resolvedAccountKey = useMemo(() => {
    if (accountKey !== undefined) return accountKey;
    if (authMode !== 'COGNITO' || !accessToken) return null;
    return parseJwtClaims(accessToken).sub ?? userProfile?.id ?? null;
  }, [accountKey, authMode, accessToken, userProfile?.id]);

  const { frozen: frozenParams, completionTarget } = useMemo(
    () => resolveSessionParams(prescription, resolvedMode, activeSession),
    [prescription, resolvedMode, activeSession]
  );

  const requiredReps = useMemo(() => {
    if (completionTarget?.criterion === 'REPETITIONS') {
      return Math.max(1, completionTarget.target);
    }
    if (completionTarget?.criterion === 'ACTIVE_TIME') {
      return null;
    }
    if ('repetitions' in frozenParams) {
      return Math.max(1, frozenParams.repetitions);
    }
    return 6;
  }, [completionTarget, frozenParams]);

  const timeTargetSeconds =
    completionTarget?.criterion === 'ACTIVE_TIME'
      ? Math.max(1, completionTarget.target)
      : null;

  const initialMatchedProgress =
    sessionProgress &&
    activeSessionId &&
    sessionProgress.therapySessionId === activeSessionId
      ? sessionProgress
      : null;

  // Clinical lifecycle refs (strictly ordered & race-free)
  const nextSequenceRef = useRef<number>(initialMatchedProgress?.nextSequence ?? 0);
  const eventQueueRef = useRef<Promise<void>>(Promise.resolve());
  const deliveryControllerRef = useRef<SessionDeliveryController | null>(null);
  const gazeFreshnessGuardRef = useRef(new GazeFreshnessGuard());
  const hasMousePointerMovedRef = useRef<boolean>(false);
  const fallbackSampleSeqRef = useRef<number>(0);
  const trialUsedMouseFallbackRef = useRef<boolean>(mouseFallbackEnabled);
  const sessionTrialOriginsRef = useRef<{ producerReported: number; synthetic: number }>({
    producerReported: 0,
    synthetic: 0,
  });
  const isBootstrappedRef = useRef<boolean>(false);
  const isCompletingRef = useRef<boolean>(false);
  const latestProgressRef = useRef<PatientSessionProgressResponse | null>(
    initialMatchedProgress
  );

  const repetitionCounterRef = useRef<number>(
    initialMatchedProgress?.completedRepetitions ?? 0
  );
  const currentRepObjRef = useRef<{ id: string; index: number } | null>(null);
  const sessionHadCognitoRef = useRef<boolean>(false);

  const sessionStartPerfRef = useRef<number>(performance.now());
  const lastTelemetrySamplePerfRef = useRef<number>(0);
  const prevMouseFallbackRef = useRef<boolean>(mouseFallbackEnabled);
  const webcamGazeSamplesCountRef = useRef<number>(0);
  const mouseFallbackSamplesCountRef = useRef<number>(0);
  const lastCountedWebcamSampleSeqRef = useRef<number>(-1);

  // Publish pending critical work snapshot to parent and protect reload/tab-close while pending
  useEffect(() => {
    const snap =
      deliveryControllerRef.current?.getPendingCriticalWorkSnapshot() ??
      createEmptyPendingWorkSnapshot(activeSessionId, resolvedAccountKey);
    setPendingWorkSnapshot(snap);
    onPendingCriticalWorkChange?.(snap);
  }, [
    syncSummary,
    completionState,
    closureDetail,
    activeSessionId,
    resolvedAccountKey,
    onPendingCriticalWorkChange,
  ]);

  useEffect(() => {
    if (!pendingWorkSnapshot.hasPendingCriticalWork) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [pendingWorkSnapshot.hasPendingCriticalWork]);

  const sessionProgressPropRef = useRef<PatientSessionProgressResponse | null>(
    sessionProgress ?? null
  );
  sessionProgressPropRef.current = sessionProgress ?? null;

  // Sync incoming sessionProgress strictly only when its therapySessionId matches activeSessionId
  useEffect(() => {
    if (
      sessionProgress &&
      activeSessionId &&
      sessionProgress.therapySessionId === activeSessionId
    ) {
      latestProgressRef.current = sessionProgress;
      deliveryControllerRef.current?.setCachedProgress(sessionProgress);
    } else if (
      latestProgressRef.current &&
      latestProgressRef.current.therapySessionId !== activeSessionId
    ) {
      latestProgressRef.current = null;
      deliveryControllerRef.current?.clearCachedProgress();
    }
  }, [sessionProgress, activeSessionId]);

  // Reset lifecycle refs & initialize SessionDeliveryController when activeSessionId or account changes
  useEffect(() => {
    const targetSessionId = isCognitoSession && activeSessionId ? activeSessionId : null;

    if (deliveryControllerRef.current === null) {
      deliveryControllerRef.current = new SessionDeliveryController({
        sendTelemetryBatch: (body) => telemetryApi.sendTelemetryBatch(body),
        sendTrialResult: (sessionId, slug, body) =>
          analyticsApi.submitTrialResult(sessionId, slug, body),
        onSyncSummaryChange: (summary) => {
          if (!isMountedRef.current) return;
          setSyncSummary(summary);
          if (summary.lastWarning) {
            setBackendWarning(summary.lastWarning);
          } else {
            setBackendWarning((prev) =>
              prev &&
              (prev.startsWith('Telemetry') ||
                prev.startsWith('Telemetría') ||
                prev.startsWith('Duplicate trialId') ||
                prev.startsWith('Trial '))
                ? null
                : prev
            );
          }
        },
      });
    }

    const controller = deliveryControllerRef.current;
    const accountChanged = controller.getActiveAccountKey() !== resolvedAccountKey;

    if (!targetSessionId) {
      if (
        accountChanged ||
        (completionStateRef.current !== 'FINISHED' &&
          completionStateRef.current !== 'ABANDONED')
      ) {
        controller.syncSession(null, {
          initialMouseFallback: localMouseFallbackRef.current,
          accountKey: resolvedAccountKey,
        });
        latestProgressRef.current = null;
        if (accountChanged) {
          sessionHadCognitoRef.current = false;
          completionStateRef.current = 'IDLE';
          setCompletionState('IDLE');
          setClosureDetail(null);
          setPendingExitIntent(null);
          setBackendWarning(null);
        }
        setSyncSummary(controller.getSyncSummary());
      }
      return;
    }

    const sessionChanged = controller.syncSession(targetSessionId, {
      initialMouseFallback: localMouseFallbackRef.current,
      accountKey: resolvedAccountKey,
    });
    if (sessionChanged) {
      const currentPropProgress = sessionProgressPropRef.current;
      const matchingProgress =
        currentPropProgress && currentPropProgress.therapySessionId === targetSessionId
          ? currentPropProgress
          : null;
      latestProgressRef.current = matchingProgress;
      if (matchingProgress) {
        controller.setCachedProgress(matchingProgress);
      } else {
        controller.clearCachedProgress();
      }
      nextSequenceRef.current = matchingProgress?.nextSequence ?? 0;
      repetitionCounterRef.current = matchingProgress?.completedRepetitions ?? 0;
      currentRepObjRef.current = null;
      sessionHadCognitoRef.current = false;
      isBootstrappedRef.current = false;
      isCompletingRef.current = false;
      webcamGazeSamplesCountRef.current = 0;
      mouseFallbackSamplesCountRef.current = 0;
      gazeFreshnessGuardRef.current.reset();
      hasMousePointerMovedRef.current = false;
      fallbackSampleSeqRef.current = 0;
      trialUsedMouseFallbackRef.current = localMouseFallbackRef.current;
      sessionTrialOriginsRef.current = { producerReported: 0, synthetic: 0 };
      completionStateRef.current = 'IDLE';
      setCompletionState('IDLE');
      setClosureDetail(null);
      setPendingExitIntent(null);
      setBackendWarning(null);
      setSyncSummary(controller.getSyncSummary());
    }
  }, [activeSessionId, isCognitoSession, resolvedAccountKey]);

  const enqueueActivityEvent = useCallback(
    (
      buildEvent: (seq: number) => PatientActivityEventBody,
      options?: { allowDuringCompletion?: boolean }
    ): Promise<void> => {
      if (!isCognitoSession || !activeSessionId) {
        return Promise.resolve();
      }

      const capturedCtx = deliveryControllerRef.current?.getLifecycleContext() ?? null;
      if (!capturedCtx) {
        return Promise.resolve();
      }
      const isAdmitted = () =>
        Boolean(deliveryControllerRef.current?.isLifecycleAdmitted(capturedCtx));

      eventQueueRef.current = eventQueueRef.current.then(async () => {
        if (!isAdmitted()) return;
        if (
          isCompletingRef.current &&
          !options?.allowDuringCompletion &&
          completionStateRef.current !== 'PENDING_SYNC'
        ) {
          return;
        }
        const seq = nextSequenceRef.current;
        const payload = buildEvent(seq);
        try {
          let progress = await clinicalApi.sendActivityEvent(capturedCtx.sessionId, payload);
          if (!isAdmitted() || !isMatchingSessionProgress(progress, capturedCtx.sessionId)) return;
          nextSequenceRef.current = progress.nextSequence;
          latestProgressRef.current = progress;
          deliveryControllerRef.current?.setCachedProgress(progress, capturedCtx);
          repetitionCounterRef.current = progress.completedRepetitions;
          gameState.current.score = progress.completedRepetitions;
          gameState.current.activeElapsedMs = progress.activeMilliseconds;

          // CRITICAL per `clinical/integration.md` (lines 128, 140-142) & `SessionActivityProgress.java`:
          // A gap > 15s returns 200 OK with `activityState: 'RESUME_REQUIRED'` and discards any open repetition (`open = null`).
          // Immediately send RESUMED and open a replacement repetition with a new `repetitionId` at `completedRepetitions + 1`.
          if (
            progress.activityState === 'RESUME_REQUIRED' &&
            !isPausedRef.current &&
            !isCompletingRef.current
          ) {
            currentRepObjRef.current = null;
            progress = await clinicalApi.sendActivityEvent(capturedCtx.sessionId, {
              schemaVersion: 1,
              eventId: createUuid(),
              sequence: progress.nextSequence,
              type: 'RESUMED',
            });
            if (!isAdmitted() || !isMatchingSessionProgress(progress, capturedCtx.sessionId)) return;
            nextSequenceRef.current = progress.nextSequence;
            latestProgressRef.current = progress;
            deliveryControllerRef.current?.setCachedProgress(progress, capturedCtx);
            repetitionCounterRef.current = progress.completedRepetitions;
            gameState.current.score = progress.completedRepetitions;

            if (gameState.current.subPhase !== 'INTER_STIMULUS_REST') {
              const repObj = {
                id: createUuid(),
                index: progress.completedRepetitions + 1,
              };
              currentRepObjRef.current = repObj;
              repetitionCounterRef.current = repObj.index;
              progress = await clinicalApi.sendActivityEvent(capturedCtx.sessionId, {
                schemaVersion: 1,
                eventId: createUuid(),
                sequence: progress.nextSequence,
                type: 'REPETITION_STARTED',
                repetitionId: repObj.id,
                repetitionIndex: repObj.index,
              });
              if (!isAdmitted() || !isMatchingSessionProgress(progress, capturedCtx.sessionId)) return;
              nextSequenceRef.current = progress.nextSequence;
              latestProgressRef.current = progress;
              deliveryControllerRef.current?.setCachedProgress(progress, capturedCtx);
            }
          }

          if (isMountedRef.current && isAdmitted()) {
            setBackendWarning(null);
            onSessionProgressUpdate?.(progress);
          }
        } catch (err) {
          if (!isAdmitted()) return;
          if (err instanceof ApiError && err.status === 409) {
            try {
              let synced = await clinicalApi.getSessionProgress(capturedCtx.sessionId);
              if (!isAdmitted() || !isMatchingSessionProgress(synced, capturedCtx.sessionId)) return;
              nextSequenceRef.current = synced.nextSequence;
              latestProgressRef.current = synced;
              deliveryControllerRef.current?.setCachedProgress(synced, capturedCtx);
              repetitionCounterRef.current = synced.completedRepetitions;
              gameState.current.score = synced.completedRepetitions;
              gameState.current.activeElapsedMs = synced.activeMilliseconds;

              if (
                (synced.activityState === 'RESUME_REQUIRED' ||
                  synced.activityState === 'PAUSED') &&
                !isPausedRef.current &&
                !isCompletingRef.current
              ) {
                currentRepObjRef.current = null;
                synced = await clinicalApi.sendActivityEvent(capturedCtx.sessionId, {
                  schemaVersion: 1,
                  eventId: createUuid(),
                  sequence: synced.nextSequence,
                  type: 'RESUMED',
                });
                if (!isAdmitted() || !isMatchingSessionProgress(synced, capturedCtx.sessionId)) return;
                nextSequenceRef.current = synced.nextSequence;
                latestProgressRef.current = synced;
                deliveryControllerRef.current?.setCachedProgress(synced, capturedCtx);

                if (gameState.current.subPhase !== 'INTER_STIMULUS_REST') {
                  const repObj = {
                    id: createUuid(),
                    index: synced.completedRepetitions + 1,
                  };
                  currentRepObjRef.current = repObj;
                  repetitionCounterRef.current = repObj.index;
                  synced = await clinicalApi.sendActivityEvent(capturedCtx.sessionId, {
                    schemaVersion: 1,
                    eventId: createUuid(),
                    sequence: synced.nextSequence,
                    type: 'REPETITION_STARTED',
                    repetitionId: repObj.id,
                    repetitionIndex: repObj.index,
                  });
                  if (!isAdmitted() || !isMatchingSessionProgress(synced, capturedCtx.sessionId)) return;
                  nextSequenceRef.current = synced.nextSequence;
                  latestProgressRef.current = synced;
                  deliveryControllerRef.current?.setCachedProgress(synced, capturedCtx);
                }
              }

              if (isMountedRef.current && isAdmitted()) {
                setBackendWarning(null);
                onSessionProgressUpdate?.(synced);
              }
              return;
            } catch {
              if (!isAdmitted()) return;
              // Ignore secondary sync failure
            }
          }
          if (isMountedRef.current && isAdmitted()) {
            setBackendWarning(
              `Sincronización clínica pendiente: ${extractApiErrorMessage(err)}`
            );
          }
        }
      });

      return eventQueueRef.current;
    },
    [isCognitoSession, activeSessionId, onSessionProgressUpdate]
  );

  const flushTelemetryBuffer = useCallback((): Promise<void> => {
    if (!isCognitoSession || !activeSessionId || !deliveryControllerRef.current) {
      return Promise.resolve();
    }
    return deliveryControllerRef.current.flushTelemetry().then(() => undefined);
  }, [isCognitoSession, activeSessionId]);

  // Isolate telemetry streamId when switching input origin between Webcam Gaze and Mouse Fallback
  useEffect(() => {
    localMouseFallbackRef.current = localMouseFallback;
    if (prevMouseFallbackRef.current !== localMouseFallback) {
      prevMouseFallbackRef.current = localMouseFallback;
      gazeFreshnessGuardRef.current.reset();
      hasMousePointerMovedRef.current = false;
      void deliveryControllerRef.current?.handleInputOriginChange(localMouseFallback);
    }
    if (localMouseFallback && gamePhase === 'MAIN_GAME') {
      trialUsedMouseFallbackRef.current = true;
    }
  }, [localMouseFallback, gamePhase]);

  const [isMuted, setIsMuted] = useState<boolean>(() => therapyAudio.isMuted());
  const [moduleSummary, setModuleSummary] = useState<ModuleSessionSummary>({
    successfulTrials: 0,
    timedOutTrials: 0,
    medianDurationMs: null,
    falseFixations: 0,
    quadrantCoveragePercent: 0,
    maxContinuousFixationMs: 0,
    gamifiedPoints: 0,
    maxStreak: 0,
    inputOrigin: mouseFallbackEnabled ? 'MOUSE_FALLBACK' : 'NONE',
    webcamSamplePercent: 0,
    reportedDataOrigin: mouseFallbackEnabled ? 'SYNTHETIC' : 'NONE',
  });

  const handleToggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      therapyAudio.setMuted(next);
      return next;
    });
  }, []);

  const recordSubmittedTrialOrigin = useCallback((origin: AnalyticsDataOrigin) => {
    if (origin === 'SYNTHETIC') {
      sessionTrialOriginsRef.current.synthetic += 1;
    } else {
      sessionTrialOriginsRef.current.producerReported += 1;
    }
  }, []);

  const submitTrialAnalytics = useCallback(
    (body: AnyTrialBody): Promise<void> => {
      if (!isCognitoSession || !activeSessionId || !deliveryControllerRef.current) {
        return Promise.resolve();
      }
      const slug = modeToAnalyticsSlug(resolvedMode);
      return deliveryControllerRef.current.submitTrial(slug, body).then(() => undefined);
    },
    [isCognitoSession, activeSessionId, resolvedMode]
  );

  // Mutable Game Engine State (zero frame re-renders)
  const gameState = useRef({
    score: 0,
    completedTrials: 0,
    timedOutTrials: 0,
    trialDurationsMs: [] as number[],
    falseFixationsTotal: 0,
    quadrantCoverageSum: 0,
    quadrantTrialsCount: 0,
    maxSessionContinuousFixationMs: 0,
    activeElapsedMs: 0,
    calibrationIndex: 0,
    subPhase: 'ACTIVE_TRIAL' as TrialSubPhase,
    restRemainingMs: 0,
    trialId: createUuid(),
    trialElapsedMs: 0,
    entities: [] as CanvasEntity[],
    explorationStepIndex: 0,
    explorationVisits: [] as ExplorationVisit[],
    insideTargetMs: 0,
    currentContinuousInsideMs: 0,
    longestContinuousInsideMs: 0,
    lastConfirmedDwellMs: 0,
    anchorHoldMs: 0,
    prevCursorPx: { x: width / 2, y: height / 2 },
    cursorSpeedPxPerSec: 0,
    isGazeStable: true,
    standardState: null as StandardScanningTrialState | null,
    explorationState: null as SystematicExplorationTrialState | null,
    saccadeState: null as CompensatorySaccadeTrialState | null,
    searchState: null as VisualSearchTrialState | null,
    fixationState: null as FixationTrialState | null,
    streak: 0,
    maxStreak: 0,
    gamifiedPoints: 0,
    lastFalseFixationsCount: 0,
    lastFoundTargetsCount: 0,
    particles: [] as Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      color: string;
      alpha: number;
      radius: number;
    }>,
    floatingTexts: [] as Array<{
      x: number;
      y: number;
      text: string;
      color: string;
      alpha: number;
      vy: number;
    }>,
  });

  const spawnRewardBurst = useCallback(
    (x: number, y: number, label: string, color: string) => {
      const s = gameState.current;
      for (let i = 0; i < 14; i++) {
        const angle = (Math.PI * 2 * i) / 14 + (Math.random() - 0.5) * 0.25;
        const speed = 90 + Math.random() * 140;
        s.particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color,
          alpha: 1,
          radius: 3 + Math.random() * 3.5,
        });
      }
      s.floatingTexts.push({
        x,
        y: Math.max(40, y - 28),
        text: label,
        color,
        alpha: 1,
        vy: -52,
      });
    },
    []
  );

  const buildInterruptedTrialBody = useCallback((): AnyTrialBody | null => {
    const s = gameState.current;
    const trialOrigin: AnalyticsDataOrigin = trialUsedMouseFallbackRef.current
      ? 'SYNTHETIC'
      : 'PRODUCER_REPORTED';

    switch (resolvedMode) {
      case 'TARGET_SEARCH_WITH_DISTRACTORS': {
        if (s.searchState?.completed) return null;
        if (s.searchState) {
          return interruptVisualSearchTrial(
            s.searchState,
            frozenParams as VisualSearchParameters,
            trialOrigin
          );
        }
        const maxMs = Math.round((frozenParams as VisualSearchParameters).maximumSearchTimeMs);
        return {
          schemaVersion: 1,
          trialId: s.trialId,
          dataOrigin: trialOrigin,
          outcome: 'INTERRUPTED',
          confirmedDwellMs: null,
          searchDurationMs: Math.min(
            Math.max(0, maxMs - 1),
            Math.max(0, Math.round(s.trialElapsedMs))
          ),
        };
      }
      case 'STANDARD_SCANNING': {
        if (s.standardState?.completed) return null;
        if (s.standardState) {
          return interruptStandardScanningTrial(
            s.standardState,
            frozenParams as VisualScanningParameters,
            trialOrigin
          );
        }
        const maxMs = Math.round(
          (frozenParams as VisualScanningParameters).maximumStimulusDurationMs
        );
        return {
          schemaVersion: 1,
          trialId: s.trialId,
          dataOrigin: trialOrigin,
          outcome: 'INTERRUPTED',
          confirmedDwellMs: null,
          localizationDurationMs: Math.min(
            Math.max(0, maxMs - 1),
            Math.max(0, Math.round(s.trialElapsedMs))
          ),
        };
      }
      case 'COMPENSATORY_SACCADE': {
        if (s.saccadeState?.completed) return null;
        if (s.saccadeState) {
          return interruptCompensatorySaccadeTrial(
            s.saccadeState,
            frozenParams as VisualScanningParameters,
            trialOrigin
          );
        }
        const maxMs = Math.round(
          (frozenParams as VisualScanningParameters).maximumStimulusDurationMs
        );
        return {
          schemaVersion: 1,
          trialId: s.trialId,
          dataOrigin: trialOrigin,
          outcome: 'INTERRUPTED',
          confirmedDwellMs: null,
          elapsedMs: Math.min(
            Math.max(0, maxMs - 1),
            Math.max(0, Math.round(s.trialElapsedMs))
          ),
        };
      }
      case 'SUSTAINED_TARGET_FIXATION': {
        if (s.fixationState?.completed) return null;
        if (s.fixationState) {
          return interruptSustainedFixationTrial(
            s.fixationState,
            frozenParams as FixationParameters,
            trialOrigin
          );
        }
        const fixParams = frozenParams as FixationParameters;
        const maxMs = Math.round(fixParams.maximumFixationMs);
        const minFixMs = Math.round(fixParams.minimumFixationMs);
        const elapsedMs = Math.min(
          Math.max(1, maxMs - 1),
          Math.max(1, Math.round(s.trialElapsedMs))
        );
        const insideTargetMs = Math.min(elapsedMs, Math.max(0, Math.round(s.insideTargetMs)));
        const longestContinuousInsideMs = Math.min(
          insideTargetMs,
          Math.max(0, minFixMs - 1),
          Math.max(0, Math.round(s.longestContinuousInsideMs))
        );
        return {
          schemaVersion: 1,
          trialId: s.trialId,
          dataOrigin: trialOrigin,
          outcome: 'INTERRUPTED',
          elapsedMs,
          insideTargetMs,
          longestContinuousInsideMs,
        };
      }
      case 'SYSTEMATIC_EXPLORATION': {
        if (s.explorationState?.completed) return null;
        if (s.explorationState) {
          return interruptSystematicExplorationTrial(
            s.explorationState,
            frozenParams as VisualScanningParameters,
            trialOrigin
          );
        }
        const maxMs = Math.round(
          (frozenParams as VisualScanningParameters).maximumStimulusDurationMs
        );
        return {
          schemaVersion: 1,
          trialId: s.trialId,
          dataOrigin: trialOrigin,
          outcome: 'INTERRUPTED',
          elapsedMs: Math.min(
            Math.max(0, maxMs - 1),
            Math.max(0, Math.round(s.trialElapsedMs))
          ),
          visits: s.explorationVisits,
        };
      }
    }
  }, [resolvedMode, frozenParams]);

  const spawnModeTrial = useCallback(
    (emitRepetitionStart: boolean) => {
      const s = gameState.current;
      const trialIdx = s.completedTrials;
      trialUsedMouseFallbackRef.current = localMouseFallbackRef.current;

      s.trialElapsedMs = 0;
      s.explorationStepIndex = 0;
      s.explorationVisits = [];
      s.insideTargetMs = 0;
      s.currentContinuousInsideMs = 0;
      s.longestContinuousInsideMs = 0;
      s.lastConfirmedDwellMs = 0;
      s.anchorHoldMs = 0;
      s.lastFalseFixationsCount = 0;
      s.lastFoundTargetsCount = 0;
      s.entities = [];
      s.standardState = null;
      s.explorationState = null;
      s.saccadeState = null;
      s.searchState = null;
      s.fixationState = null;

      if (resolvedMode === 'STANDARD_SCANNING') {
        const p = frozenParams as VisualScanningParameters;
        const st = createStandardScanningTrial(p, width, height, trialIdx);
        s.standardState = st;
        s.trialId = st.trialId;
        s.subPhase = 'ACTIVE_TRIAL';
        s.entities = [st.target];
      } else if (resolvedMode === 'SYSTEMATIC_EXPLORATION') {
        const p = frozenParams as VisualScanningParameters;
        const st = createSystematicExplorationTrial(p, width, height, trialIdx);
        s.explorationState = st;
        s.trialId = st.trialId;
        s.subPhase = 'ACTIVE_TRIAL';
        s.entities = st.waypoints;
      } else if (resolvedMode === 'COMPENSATORY_SACCADE') {
        const p = frozenParams as VisualScanningParameters;
        const st = createCompensatorySaccadeTrial(p, width, height, trialIdx);
        s.saccadeState = st;
        s.trialId = st.trialId;
        s.subPhase = 'CENTRAL_ANCHOR';
        s.entities = [st.anchor];
      } else if (resolvedMode === 'TARGET_SEARCH_WITH_DISTRACTORS') {
        const p = frozenParams as VisualSearchParameters;
        const st = createVisualSearchTrial(p, width, height, trialIdx);
        s.searchState = st;
        s.trialId = st.trialId;
        s.subPhase = 'ACTIVE_TRIAL';
        s.entities = st.entities;
      } else {
        const p = frozenParams as FixationParameters;
        const st = createSustainedFixationTrial(p, width, height, trialIdx);
        s.fixationState = st;
        s.trialId = st.id;
        s.subPhase = 'ACTIVE_TRIAL';
        s.entities = [
          {
            id: st.id,
            x: st.x,
            y: st.y,
            radius: st.radius,
            kind: 'TARGET',
            found: false,
            dwellTimeMs: 0,
          },
        ];
      }

      if (emitRepetitionStart && isCognitoSession && activeSessionId) {
        const repObj = { id: createUuid(), index: 0 };
        currentRepObjRef.current = repObj;

        void enqueueActivityEvent((seq) => {
          const baseCompleted =
            latestProgressRef.current?.completedRepetitions ?? repetitionCounterRef.current;
          repObj.index = baseCompleted + 1;
          repetitionCounterRef.current = repObj.index;
          return {
            schemaVersion: 1,
            eventId: createUuid(),
            sequence: seq,
            type: 'REPETITION_STARTED',
            repetitionId: repObj.id,
            repetitionIndex: repObj.index,
          };
        });
      }
    },
    [
      frozenParams,
      resolvedMode,
      width,
      height,
      isCognitoSession,
      activeSessionId,
      enqueueActivityEvent,
    ]
  );

  const computeCurrentModuleSummary = useCallback((): ModuleSessionSummary => {
    const s = gameState.current;
    const sorted = [...s.trialDurationsMs].sort((a, b) => a - b);
    let median: number | null = null;
    if (sorted.length > 0) {
      const mid = Math.floor(sorted.length / 2);
      median =
        sorted.length % 2 === 1
          ? sorted[mid]
          : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
    }
    const avgCoverage =
      s.quadrantTrialsCount > 0
        ? Math.round(s.quadrantCoverageSum / s.quadrantTrialsCount)
        : s.score > 0
        ? 100
        : 0;

    const webcamSamples = webcamGazeSamplesCountRef.current;
    const mouseSamples = mouseFallbackSamplesCountRef.current;
    const totalOriginSamples = webcamSamples + mouseSamples;
    const inputOrigin: 'WEBCAM_GAZE' | 'MOUSE_FALLBACK' | 'MIXED' | 'NONE' =
      webcamSamples > 0 && mouseSamples > 0
        ? 'MIXED'
        : webcamSamples > 0
        ? 'WEBCAM_GAZE'
        : mouseSamples > 0
        ? 'MOUSE_FALLBACK'
        : 'NONE';
    const webcamSamplePercent =
      totalOriginSamples > 0
        ? Math.round((webcamSamples / totalOriginSamples) * 100)
        : 0;

    const { producerReported, synthetic } = sessionTrialOriginsRef.current;
    const reportedDataOrigin: 'PRODUCER_REPORTED' | 'SYNTHETIC' | 'MIXED' | 'NONE' =
      producerReported > 0 && synthetic > 0
        ? 'MIXED'
        : synthetic > 0
        ? 'SYNTHETIC'
        : producerReported > 0
        ? 'PRODUCER_REPORTED'
        : 'NONE';

    return {
      successfulTrials: s.score,
      timedOutTrials: s.timedOutTrials,
      medianDurationMs: median,
      falseFixations: s.falseFixationsTotal,
      quadrantCoveragePercent: avgCoverage,
      maxContinuousFixationMs: Math.round(s.maxSessionContinuousFixationMs),
      gamifiedPoints: s.gamifiedPoints,
      maxStreak: s.maxStreak,
      inputOrigin,
      webcamSamplePercent,
      reportedDataOrigin,
    };
  }, []);

  const buildClosureParams = useCallback(
    () => ({
      apis: {
        getSessionProgress: (therapySessionId: string, options?: { signal?: AbortSignal }) =>
          clinicalApi.getSessionProgress(therapySessionId, options),
        completeSession: (
          therapySessionId: string,
          body: { action: 'FINISHED' | 'ABANDONED' },
          idempotencyKey: string,
          options?: { signal?: AbortSignal }
        ) => clinicalApi.completeSession(therapySessionId, body, idempotencyKey, options),
      },
      adapter: {
        isMounted: () => isMountedRef.current,
        waitForActivityEvents: () => eventQueueRef.current,
        getCachedProgress: () => latestProgressRef.current,
        setCachedProgress: (progress: PatientSessionProgressResponse) => {
          latestProgressRef.current = progress;
        },
        clearCachedProgress: () => {
          latestProgressRef.current = null;
        },
        setSyncSummary: (summary: SessionSyncSummary) => {
          setSyncSummary(summary);
        },
        setCompletionState: (
          state: 'SAVING' | 'PENDING_SYNC' | 'FINISHED' | 'ABANDONED' | 'ERROR'
        ) => {
          completionStateRef.current = state;
          setCompletionState(state);
        },
        setBackendWarning: (message: string) => {
          setBackendWarning(message);
        },
        onClosureStateDetail: (detail: ClinicalClosureStateDetail) => {
          setClosureDetail(detail);
        },
        onSessionProgressUpdate,
        onSessionCompleted,
        formatError: extractApiErrorMessage,
      },
    }),
    [onSessionProgressUpdate, onSessionCompleted]
  );

  const runCloseSessionFlow = useCallback(
    async (forceCloseWithoutSync: boolean) => {
      if (!isCognitoSession || !activeSessionId || !deliveryControllerRef.current) return;

      await deliveryControllerRef.current.closeClinicalSession({
        forceCloseWithoutSync,
        ...buildClosureParams(),
      });
    },
    [isCognitoSession, activeSessionId, buildClosureParams]
  );

  const runRecoverSessionFlow = useCallback(
    async (mode: 'VERIFY_ONLY' | 'VERIFY_AND_RESEND') => {
      const controller = deliveryControllerRef.current;
      if (!controller || !controller.getActiveSessionId()) return;

      await controller.recoverClinicalClosure({
        mode,
        ...buildClosureParams(),
      });
    },
    [buildClosureParams]
  );

  const finishSession = useCallback(
    async (reason: 'TARGET_REACHED' | 'USER_EXIT') => {
      if (isCompletingRef.current) return;
      isCompletingRef.current = true;
      therapyAudio.playSessionCompleted();

      const finalReport = generateClinicalReport(
        trajectoryRef.current,
        width,
        height,
        40 / Math.hypot(width, height)
      );
      setReport(finalReport);
      setModuleSummary(computeCurrentModuleSummary());
      onPhaseChange('FINISHED');

      if (!isCognitoSession || !activeSessionId) {
        setCompletionState(reason === 'TARGET_REACHED' ? 'FINISHED' : 'ABANDONED');
        return;
      }

      // If exiting mid-trial, submit interrupted trial analytics without inflating REPETITION_FINISHED
      if (reason === 'USER_EXIT' && gameState.current.subPhase !== 'INTER_STIMULUS_REST') {
        if (gameState.current.trialElapsedMs > 150) {
          const interruptedBody = buildInterruptedTrialBody();
          if (interruptedBody) {
            recordSubmittedTrialOrigin(interruptedBody.dataOrigin);
            void submitTrialAnalytics(interruptedBody);
          }
        }
      }

      await runCloseSessionFlow(false);
    },
    [
      width,
      height,
      onPhaseChange,
      isCognitoSession,
      activeSessionId,
      submitTrialAnalytics,
      buildInterruptedTrialBody,
      recordSubmittedTrialOrigin,
      runCloseSessionFlow,
      computeCurrentModuleSummary,
    ]
  );

  const completeCurrentTrial = useCallback(
    (trialBody: AnyTrialBody, wasSuccessful: boolean) => {
      const s = gameState.current;
      s.completedTrials += 1;
      const primaryX = s.entities[0]?.x ?? width / 2;
      const primaryY = s.entities[0]?.y ?? height / 2;
      if (wasSuccessful) {
        s.score += 1;
        s.streak += 1;
        s.maxStreak = Math.max(s.maxStreak, s.streak);
        const speedBonus = Math.max(
          0,
          Math.round((1 - Math.min(1, s.trialElapsedMs / 6500)) * 75)
        );
        const earnedPts = (100 + speedBonus) * Math.min(4, s.streak);
        s.gamifiedPoints += earnedPts;
        therapyAudio.playTargetAcquired(s.streak, primaryX / width);
        spawnRewardBurst(
          primaryX,
          primaryY,
          s.streak > 1
            ? `+${earnedPts} pts · ¡Racha x${s.streak}!`
            : `+${earnedPts} pts`,
          '#FACC15'
        );
        if ('localizationDurationMs' in trialBody) {
          s.trialDurationsMs.push(trialBody.localizationDurationMs);
        } else if ('searchDurationMs' in trialBody) {
          s.trialDurationsMs.push(trialBody.searchDurationMs);
        } else if ('elapsedMs' in trialBody) {
          s.trialDurationsMs.push(trialBody.elapsedMs);
        }
      } else {
        s.timedOutTrials += 1;
        s.streak = 0;
        spawnRewardBurst(width / 2, height / 2, 'Tiempo agotado', '#F87171');
      }

      if ('visits' in trialBody) {
        s.quadrantTrialsCount += 1;
        s.quadrantCoverageSum += (trialBody.visits.length / 4) * 100;
      }
      if ('longestContinuousInsideMs' in trialBody) {
        s.maxSessionContinuousFixationMs = Math.max(
          s.maxSessionContinuousFixationMs,
          trialBody.longestContinuousInsideMs
        );
      }
      if (s.searchState) {
        s.falseFixationsTotal += s.searchState.falseFixations;
      }

      if (isCognitoSession && activeSessionId) {
        recordSubmittedTrialOrigin(trialBody.dataOrigin);
        void submitTrialAnalytics(trialBody);

        if (wasSuccessful) {
          if (currentRepObjRef.current) {
            const repObj = currentRepObjRef.current;
            currentRepObjRef.current = null;
            void enqueueActivityEvent(
              (seq) => {
                const baseCompleted =
                  latestProgressRef.current?.completedRepetitions ?? repetitionCounterRef.current;
                const idx = repObj.index > 0 ? repObj.index : baseCompleted + 1;
                return {
                  schemaVersion: 1,
                  eventId: createUuid(),
                  sequence: seq,
                  type: 'REPETITION_FINISHED',
                  repetitionId: repObj.id,
                  repetitionIndex: idx,
                };
              },
              { allowDuringCompletion: true }
            );
          } else {
            // If trial 1 completed before bootstrap finished opening the initial repetition,
            // open and immediately close the repetition sequentially on the eventQueue so it is never lost.
            const fallbackRepId = createUuid();
            void enqueueActivityEvent(
              (seq) => {
                const baseCompleted =
                  latestProgressRef.current?.completedRepetitions ?? repetitionCounterRef.current;
                const idx = baseCompleted + 1;
                repetitionCounterRef.current = idx;
                return {
                  schemaVersion: 1,
                  eventId: createUuid(),
                  sequence: seq,
                  type: 'REPETITION_STARTED',
                  repetitionId: fallbackRepId,
                  repetitionIndex: idx,
                };
              },
              { allowDuringCompletion: true }
            );
            void enqueueActivityEvent(
              (seq) => {
                const baseCompleted =
                  latestProgressRef.current?.completedRepetitions ?? repetitionCounterRef.current;
                const idx = baseCompleted + 1;
                return {
                  schemaVersion: 1,
                  eventId: createUuid(),
                  sequence: seq,
                  type: 'REPETITION_FINISHED',
                  repetitionId: fallbackRepId,
                  repetitionIndex: idx,
                };
              },
              { allowDuringCompletion: true }
            );
          }
        } else if (currentRepObjRef.current) {
          // A timed-out trial must NOT count as a completed repetition in Clinical.
          // Discard the open repetition via PAUSED -> RESUMED so the next trial re-opens at completedRepetitions + 1.
          currentRepObjRef.current = null;
          void enqueueActivityEvent((seq) => ({
            schemaVersion: 1,
            eventId: createUuid(),
            sequence: seq,
            type: 'PAUSED',
          }));
          void enqueueActivityEvent((seq) => ({
            schemaVersion: 1,
            eventId: createUuid(),
            sequence: seq,
            type: 'RESUMED',
          }));
        }
      }

      // Evaluate completion criteria
      if (isCognitoSession && activeSessionId) {
        const expectedServerReps =
          requiredReps !== null
            ? (latestProgressRef.current?.completedRepetitions ?? 0) + (wasSuccessful ? 1 : 0)
            : null;
        const serverReached = Boolean(
          latestProgressRef.current?.therapySessionId === activeSessionId &&
            (latestProgressRef.current?.targetReached ||
              (requiredReps !== null &&
                expectedServerReps !== null &&
                expectedServerReps >= requiredReps))
        );
        const localTimeGoalReached =
          timeTargetSeconds !== null && s.activeElapsedMs >= timeTargetSeconds * 1000;
        const maxSafetyTrialsReached =
          requiredReps !== null && s.completedTrials >= requiredReps * 3;

        if (serverReached || localTimeGoalReached || maxSafetyTrialsReached) {
          void finishSession('TARGET_REACHED');
          return;
        }
      } else {
        const localRepGoalReached =
          requiredReps !== null && s.score >= requiredReps;
        const localTimeGoalReached =
          timeTargetSeconds !== null && s.activeElapsedMs >= timeTargetSeconds * 1000;
        const maxSafetyTrialsReached =
          requiredReps !== null && s.completedTrials >= requiredReps * 3;

        if (
          localRepGoalReached ||
          localTimeGoalReached ||
          maxSafetyTrialsReached
        ) {
          void finishSession('TARGET_REACHED');
          return;
        }
      }

      // Inter-stimulus rest / rest between repetitions
      const restMs =
        resolvedMode === 'SUSTAINED_TARGET_FIXATION'
          ? (frozenParams as FixationParameters).restBetweenRepetitionsMs
          : 'interStimulusIntervalMs' in frozenParams
          ? frozenParams.interStimulusIntervalMs
          : 500;

      if (restMs > 150) {
        s.subPhase = 'INTER_STIMULUS_REST';
        s.restRemainingMs = Math.min(restMs, 5000);
        s.entities = [];
      } else {
        spawnModeTrial(true);
      }
    },
    [
      isCognitoSession,
      activeSessionId,
      submitTrialAnalytics,
      enqueueActivityEvent,
      requiredReps,
      timeTargetSeconds,
      finishSession,
      resolvedMode,
      frozenParams,
      spawnModeTrial,
      width,
      height,
      spawnRewardBurst,
      recordSubmittedTrialOrigin,
    ]
  );

  const spawnTutorialTarget = useCallback(() => {
    const idx = gameState.current.calibrationIndex;
    if (idx >= CALIBRATION_GRID.length) {
      onPhaseChange('MAIN_GAME');
      trajectoryRef.current = [];
      return;
    }

    const point = CALIBRATION_GRID[idx];
    gameState.current.entities = [
      {
        id: `tut-${idx}`,
        x: point.x * width,
        y: point.y * height,
        radius: 50,
        kind: 'TARGET',
        found: false,
        dwellTimeMs: 0,
      },
    ];
  }, [width, height, onPhaseChange]);

  // Initialize phase & Cognito session bootstrap
  useEffect(() => {
    if (gamePhase === 'TUTORIAL_CALIBRATION') {
      gameState.current.calibrationIndex = 0;
      gameState.current.score = 0;
      gameState.current.completedTrials = 0;
      gameState.current.timedOutTrials = 0;
      gameState.current.trialDurationsMs = [];
      gameState.current.falseFixationsTotal = 0;
      gameState.current.quadrantCoverageSum = 0;
      gameState.current.quadrantTrialsCount = 0;
      gameState.current.maxSessionContinuousFixationMs = 0;
      gameState.current.activeElapsedMs = 0;
      trajectoryRef.current = [];
      gazeFreshnessGuardRef.current.reset();
      hasMousePointerMovedRef.current = false;
      setReport(null);
      setIsPaused(false);
      spawnTutorialTarget();
      return;
    }

    if (gamePhase === 'MAIN_GAME') {
      gameState.current.timedOutTrials = 0;
      gameState.current.trialDurationsMs = [];
      gameState.current.falseFixationsTotal = 0;
      gameState.current.quadrantCoverageSum = 0;
      gameState.current.quadrantTrialsCount = 0;
      gameState.current.maxSessionContinuousFixationMs = 0;
      trajectoryRef.current = [];
      gazeFreshnessGuardRef.current.reset();
      webcamGazeSamplesCountRef.current = 0;
      mouseFallbackSamplesCountRef.current = 0;
      lastCountedWebcamSampleSeqRef.current = -1;
      sessionTrialOriginsRef.current = { producerReported: 0, synthetic: 0 };
      hasMousePointerMovedRef.current = false;
      trialUsedMouseFallbackRef.current = localMouseFallbackRef.current;
      setReport(null);
      setIsPaused(false);
      isCompletingRef.current = false;
      setCompletionState('IDLE');
      sessionStartPerfRef.current = performance.now();
      lastTimeRef.current = performance.now();

      if (isCognitoSession && activeSessionId && !isBootstrappedRef.current) {
        const capturedCtx = deliveryControllerRef.current?.getLifecycleContext() ?? null;
        const isAdmitted = () =>
          Boolean(capturedCtx && deliveryControllerRef.current?.isLifecycleAdmitted(capturedCtx));
        if (!capturedCtx) {
          return;
        }

        isBootstrappedRef.current = true;
        sessionHadCognitoRef.current = true;

        // Spawn initial visual target without emitting REPETITION_STARTED yet;
        // REPETITION_STARTED will be emitted with the authoritative server `completedRepetitions + 1`
        // right after bootstrap reconciles NEW / PAUSED / RESUME_REQUIRED / ACTIVE state.
        spawnModeTrial(false);

        eventQueueRef.current = eventQueueRef.current.then(async () => {
          if (!isAdmitted()) return;
          try {
            const [detail, progress] = await Promise.all([
              clinicalApi.getPatientSessionDetail(capturedCtx.sessionId),
              clinicalApi.getSessionProgress(capturedCtx.sessionId),
            ]);
            if (
              !isAdmitted() ||
              detail.therapySessionId !== capturedCtx.sessionId ||
              !isMatchingSessionProgress(progress, capturedCtx.sessionId)
            ) {
              return;
            }

            if (detail.technicalProgress) {
              gameState.current.activeElapsedMs = detail.technicalProgress.activeMilliseconds;
            } else {
              gameState.current.activeElapsedMs = progress.activeMilliseconds;
            }
            nextSequenceRef.current = progress.nextSequence;
            repetitionCounterRef.current = progress.completedRepetitions;
            gameState.current.score = progress.completedRepetitions;
            latestProgressRef.current = progress;
            deliveryControllerRef.current?.setCachedProgress(progress, capturedCtx);
            currentRepObjRef.current = null;

            if (isMountedRef.current && isAdmitted()) {
              onSessionProgressUpdate?.(progress);
            }

            // If recovering a session that already satisfied its completion target, finish immediately
            if (progress.targetReached) {
              if (isAdmitted()) {
                void finishSession('TARGET_REACHED');
              }
              return;
            }

            let activeProg = progress;

            if (progress.activityState === 'NEW') {
              activeProg = await clinicalApi.sendActivityEvent(capturedCtx.sessionId, {
                schemaVersion: 1,
                eventId: createUuid(),
                sequence: progress.nextSequence,
                type: 'ACTIVITY_STARTED',
              });
            } else if (
              progress.activityState === 'PAUSED' ||
              progress.activityState === 'RESUME_REQUIRED'
            ) {
              activeProg = await clinicalApi.sendActivityEvent(capturedCtx.sessionId, {
                schemaVersion: 1,
                eventId: createUuid(),
                sequence: progress.nextSequence,
                type: 'RESUMED',
              });
            } else if (progress.activityState === 'ACTIVE') {
              // Recovering an already-ACTIVE session (after refresh, navigation, or >15s calibration):
              // Per `clinical/integration.md` (lines 140-142) & `SessionActivityProgress.java`:
              // Sending PAUSED -> RESUMED safely discards any unfinished open repetition (`open = null`),
              // reconciles any >15s gap, re-anchors server time, and renews the 120s lease.
              const pausedProg = await clinicalApi.sendActivityEvent(capturedCtx.sessionId, {
                schemaVersion: 1,
                eventId: createUuid(),
                sequence: progress.nextSequence,
                type: 'PAUSED',
              });
              if (
                !isAdmitted() ||
                !isMatchingSessionProgress(pausedProg, capturedCtx.sessionId)
              ) {
                return;
              }
              activeProg = await clinicalApi.sendActivityEvent(capturedCtx.sessionId, {
                schemaVersion: 1,
                eventId: createUuid(),
                sequence: pausedProg.nextSequence,
                type: 'RESUMED',
              });
            }

            if (
              !isAdmitted() ||
              !isMatchingSessionProgress(activeProg, capturedCtx.sessionId)
            ) {
              return;
            }

            nextSequenceRef.current = activeProg.nextSequence;
            repetitionCounterRef.current = activeProg.completedRepetitions;
            gameState.current.score = activeProg.completedRepetitions;
            gameState.current.activeElapsedMs = activeProg.activeMilliseconds;
            latestProgressRef.current = activeProg;
            deliveryControllerRef.current?.setCachedProgress(activeProg, capturedCtx);

            if (isMountedRef.current && isAdmitted()) {
              onSessionProgressUpdate?.(activeProg);
            }

            // Now open the first/replacement repetition at `completedRepetitions + 1`
            // only if the canvas is currently in an active trial (and not in INTER_STIMULUS_REST)
            if (
              !isCompletingRef.current &&
              !isPausedRef.current &&
              gameState.current.subPhase !== 'INTER_STIMULUS_REST'
            ) {
              const repObj = {
                id: createUuid(),
                index: activeProg.completedRepetitions + 1,
              };
              currentRepObjRef.current = repObj;
              repetitionCounterRef.current = repObj.index;
              const repProg = await clinicalApi.sendActivityEvent(capturedCtx.sessionId, {
                schemaVersion: 1,
                eventId: createUuid(),
                sequence: activeProg.nextSequence,
                type: 'REPETITION_STARTED',
                repetitionId: repObj.id,
                repetitionIndex: repObj.index,
              });
              if (
                !isAdmitted() ||
                !isMatchingSessionProgress(repProg, capturedCtx.sessionId)
              ) {
                return;
              }
              nextSequenceRef.current = repProg.nextSequence;
              latestProgressRef.current = repProg;
              deliveryControllerRef.current?.setCachedProgress(repProg, capturedCtx);
              if (isMountedRef.current && isAdmitted()) {
                onSessionProgressUpdate?.(repProg);
              }
            }
          } catch (err) {
            if (isMountedRef.current && isAdmitted()) {
              setBackendWarning(
                `Inicio/recuperación de actividad: ${extractApiErrorMessage(err)}`
              );
            }
          }
        });
      } else {
        spawnModeTrial(true);
      }
    }
  }, [
    gamePhase,
    isCognitoSession,
    activeSessionId,
    spawnTutorialTarget,
    spawnModeTrial,
    finishSession,
    onSessionProgressUpdate,
  ]);

  // 5000ms HEARTBEAT & 2000ms Telemetry Batching Intervals
  // Keep HEARTBEAT active during PENDING_SYNC so the 120s Clinical lease does not expire while waiting for sync retry.
  useEffect(() => {
    const keepHeartbeatAlive =
      (gamePhase === 'MAIN_GAME' || completionState === 'PENDING_SYNC') &&
      isCognitoSession &&
      Boolean(activeSessionId);
    if (!keepHeartbeatAlive || !activeSessionId) {
      return;
    }

    const heartbeatTimer = window.setInterval(() => {
      if (
        isPausedRef.current ||
        (isCompletingRef.current && completionStateRef.current !== 'PENDING_SYNC')
      ) {
        return;
      }
      void enqueueActivityEvent((seq) => ({
        schemaVersion: 1,
        eventId: createUuid(),
        sequence: seq,
        type: 'HEARTBEAT',
      }));
    }, 5000);

    const telemetryTimer =
      gamePhase === 'MAIN_GAME'
        ? window.setInterval(() => {
            void flushTelemetryBuffer();
          }, 2000)
        : null;

    return () => {
      window.clearInterval(heartbeatTimer);
      if (telemetryTimer !== null) {
        window.clearInterval(telemetryTimer);
        void flushTelemetryBuffer();
      }
    };
  }, [
    gamePhase,
    completionState,
    isCognitoSession,
    activeSessionId,
    enqueueActivityEvent,
    flushTelemetryBuffer,
  ]);

  const handleTogglePause = () => {
    if (gamePhase !== 'MAIN_GAME' || isCompletingRef.current) return;
    const nextPaused = !isPaused;
    setIsPaused(nextPaused);

    if (isCognitoSession && activeSessionId) {
      if (nextPaused) {
        // Server discards open repetition on PAUSED (`clinical/integration.md` line 128-129)
        currentRepObjRef.current = null;
        void enqueueActivityEvent((seq) => ({
          schemaVersion: 1,
          eventId: createUuid(),
          sequence: seq,
          type: 'PAUSED',
        }));
        void flushTelemetryBuffer();
      } else {
        lastTimeRef.current = performance.now();
        void enqueueActivityEvent((seq) => ({
          schemaVersion: 1,
          eventId: createUuid(),
          sequence: seq,
          type: 'RESUMED',
        })).then(() => {
          if (gameState.current.subPhase !== 'INTER_STIMULUS_REST' && !isCompletingRef.current) {
            const repObj = { id: createUuid(), index: 0 };
            currentRepObjRef.current = repObj;
            void enqueueActivityEvent((seq) => {
              const baseCompleted =
                latestProgressRef.current?.completedRepetitions ?? repetitionCounterRef.current;
              repObj.index = baseCompleted + 1;
              repetitionCounterRef.current = repObj.index;
              return {
                schemaVersion: 1,
                eventId: createUuid(),
                sequence: seq,
                type: 'REPETITION_STARTED',
                repetitionId: repObj.id,
                repetitionIndex: repObj.index,
              };
            });
          }
        });
      }
    } else if (!nextPaused) {
      lastTimeRef.current = performance.now();
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!localMouseFallbackRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    hasMousePointerMovedRef.current = true;
    const nx = clamp01((e.clientX - rect.left) / rect.width);
    const ny = clamp01((e.clientY - rect.top) / rect.height);
    mousePointRef.current = { x: nx, y: ny };
    gazeRef.current = { x: nx, y: ny };
  };

  const renderLoop = useCallback(
    (time: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      if (lastTimeRef.current === 0) {
        lastTimeRef.current = time;
      }
      const rawDelta = time - lastTimeRef.current;
      lastTimeRef.current = time;
      const deltaTime = isPausedRef.current ? 0 : Math.min(120, Math.max(0, rawDelta));

      ctx.fillStyle = '#070B12';
      ctx.fillRect(0, 0, width, height);

      // Subtle hemifield center reference line & retinotopic eccentricity rings during active game
      if (gamePhase === 'MAIN_GAME') {
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(width / 2, 0);
        ctx.lineTo(width / 2, height);
        ctx.stroke();

        // Retinotopic angular reference rings (10°, 20°, 30°)
        const scaleFactor = computeRetinotopicSafeScaleFactor(width, height, 48);
        for (const deg of [10, 20, 30]) {
          const rPx = degreesToPixels(deg) * scaleFactor;
          ctx.beginPath();
          ctx.arc(width / 2, height / 2, rPx, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(138, 226, 214, 0.045)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        ctx.restore();
      }

      const isMouseFallback = localMouseFallbackRef.current;
      const activeGaze = isMouseFallback ? mousePointRef.current : gazeRef.current;
      const normGazeX = clamp01(activeGaze.x);
      const normGazeY = clamp01(activeGaze.y);
      const cursorX = normGazeX * width;
      const cursorY = normGazeY * height;

      const rawGazeConfidence = gazeConfidenceRef
        ? clamp01(gazeConfidenceRef.current)
        : 0.85;
      const nowPerfMs = performance.now();
      if (isMouseFallback && gamePhase === 'MAIN_GAME') {
        trialUsedMouseFallbackRef.current = true;
      }
      const trialOrigin: AnalyticsDataOrigin = trialUsedMouseFallbackRef.current
        ? 'SYNTHETIC'
        : 'PRODUCER_REPORTED';

      const currentSampleSeq = gazeSampleSeqRef
        ? gazeSampleSeqRef.current
        : rawGazeConfidence >= 0.35
        ? ++fallbackSampleSeqRef.current
        : 0;
      const currentLastValidPerfMs = gazeLastValidPerfRef
        ? gazeLastValidPerfRef.current
        : rawGazeConfidence >= 0.35
        ? nowPerfMs
        : 0;

      const guardEval = gazeFreshnessGuardRef.current.evaluateFrame({
        nowPerfMs,
        deltaTimeMs: deltaTime,
        isMouseFallback,
        hasMousePointerMoved: hasMousePointerMovedRef.current,
        isWebcamStreaming: isWebcamStreaming ?? true,
        confidence: rawGazeConfidence,
        lastValidSamplePerfMs: currentLastValidPerfMs,
        sampleSeq: currentSampleSeq,
        isBlinking: gazeIsBlinkingRef?.current ?? false,
      });
      const sampleContinuity = gazeFreshnessGuardRef.current.getLatestSampleContinuity();

      const isGazeSignalAvailable = guardEval.isSignalFresh;
      const currentConf = isMouseFallback ? 0.95 : rawGazeConfidence;

      const s = gameState.current;
      if (deltaTime > 0) {
        const stability = evaluateGazeSampleStability(
          { x: cursorX, y: cursorY },
          s.prevCursorPx,
          deltaTime,
          currentConf,
          { canvasWidth: width, canvasHeight: height }
        );
        s.cursorSpeedPxPerSec = stability.pixelVelocity;
        s.isGazeStable = isGazeSignalAvailable && stability.isValidFixation;
        s.prevCursorPx = { x: cursorX, y: cursorY };
      }

      // TUTORIAL CALIBRATION PHASE
      if (gamePhase === 'TUTORIAL_CALIBRATION') {
        const tutTarget = s.entities[0];
        if (tutTarget) {
          const dist = Math.hypot(tutTarget.x - cursorX, tutTarget.y - cursorY);
          const isHovering = isGazeSignalAvailable && dist < tutTarget.radius * 1.5;
          const minFix = Math.max(300, prescription.parameters.min_fixation_time || 800);

          if (isHovering && !isPausedRef.current) {
            tutTarget.dwellTimeMs += guardEval.effectiveDwellDeltaMs;
            if (tutTarget.dwellTimeMs >= minFix) {
              s.calibrationIndex += 1;
              spawnTutorialTarget();
            }
          } else if (!isHovering || guardEval.shouldDecayDwell) {
            tutTarget.dwellTimeMs = Math.max(0, tutTarget.dwellTimeMs - deltaTime * 2);
          }

          ctx.beginPath();
          ctx.arc(tutTarget.x, tutTarget.y, tutTarget.radius, 0, Math.PI * 2);
          ctx.fillStyle = isHovering ? '#FFFFFF' : '#00FFFF';
          ctx.fill();
          ctx.lineWidth = 4;
          ctx.strokeStyle = '#FFFFFF';
          ctx.stroke();

          if (tutTarget.dwellTimeMs > 0) {
            const ratio = clamp01(tutTarget.dwellTimeMs / minFix);
            ctx.beginPath();
            ctx.arc(
              tutTarget.x,
              tutTarget.y,
              tutTarget.radius + 14,
              -Math.PI / 2,
              -Math.PI / 2 + Math.PI * 2 * ratio
            );
            ctx.strokeStyle = '#00FFFF';
            ctx.lineWidth = 6;
            ctx.stroke();
          }

          const tutWarning = !isGazeSignalAvailable
            ? getGazeWarningText(guardEval.reason) ??
              '⚠️ Rostro o mirada no detectada — reubíquese frente a la cámara'
            : '';
          const tutPrimary = `Calentamiento: ¡Sigue la luz mágica! (${s.calibrationIndex}/9)`;
          const tutSecondary = isMouseFallback
            ? 'Origen: RATÓN FALLBACK · Fija cada círculo luminoso'
            : 'Origen: MIRADA WEBCAM · Fija cada círculo luminoso';

          if (hudPrimaryRef.current && lastHudPrimaryRef.current !== tutPrimary) {
            lastHudPrimaryRef.current = tutPrimary;
            hudPrimaryRef.current.textContent = tutPrimary;
          }
          if (hudSecondaryRef.current && lastHudSecondaryRef.current !== tutSecondary) {
            lastHudSecondaryRef.current = tutSecondary;
            hudSecondaryRef.current.textContent = tutSecondary;
          }
          if (hudWarningRef.current && lastHudWarningRef.current !== tutWarning) {
            lastHudWarningRef.current = tutWarning;
            hudWarningRef.current.textContent = tutWarning;
            hudWarningRef.current.style.display = tutWarning ? 'inline-flex' : 'none';
          }
        }
      }

      // MAIN GAME PHASE
      if (gamePhase === 'MAIN_GAME' && !isCompletingRef.current) {
        if (!isPausedRef.current) {
          s.activeElapsedMs += deltaTime;
        }

        // Primary target for trajectory & telemetry
        const primaryEntity =
          s.entities.find((e) => !e.found && e.kind !== 'DISTRACTOR') ||
          s.entities[0] || {
            x: width / 2,
            y: height / 2,
          };

        if (!isPausedRef.current) {
          const isActiveSampleWindow = s.subPhase !== 'INTER_STIMULUS_REST';
          const isFreshUniqueWebcamSample =
            !isMouseFallback &&
            isGazeSignalAvailable &&
            currentSampleSeq > 0 &&
            currentSampleSeq !== lastCountedWebcamSampleSeqRef.current;

          if (isGazeSignalAvailable && isActiveSampleWindow) {
            if (isMouseFallback) {
              mouseFallbackSamplesCountRef.current += 1;
              trajectoryRef.current.push({
                timestamp: time,
                gaze: { x: normGazeX, y: normGazeY },
                target: {
                  x: clamp01(primaryEntity.x / width),
                  y: clamp01(primaryEntity.y / height),
                },
              });
            } else if (isFreshUniqueWebcamSample) {
              lastCountedWebcamSampleSeqRef.current = currentSampleSeq;
              webcamGazeSamplesCountRef.current += 1;
              trajectoryRef.current.push({
                timestamp: time,
                gaze: { x: normGazeX, y: normGazeY },
                target: {
                  x: clamp01(primaryEntity.x / width),
                  y: clamp01(primaryEntity.y / height),
                },
              });
            }
          }

          // Sample telemetry (~30 Hz)
          const perfNow = performance.now();
          if (
            isCognitoSession &&
            activeSessionId &&
            deliveryControllerRef.current &&
            perfNow - lastTelemetrySamplePerfRef.current >= 32
          ) {
            lastTelemetrySamplePerfRef.current = perfNow;
            const progressNorm =
              requiredReps !== null
                ? clamp01(s.score / requiredReps)
                : timeTargetSeconds !== null
                ? clamp01(s.activeElapsedMs / (timeTargetSeconds * 1000))
                : 0;

            // Emit gazeSamples both when genuine webcam gaze tracking has a fresh sample AND when
            // mouse fallback is actively tracking on canvas so reports, heatmaps, and gaze plots are
            // populated during mouse fallback testing as well.
            const emitGaze =
              guardEval.isNewSampleForTelemetry ||
              (isMouseFallback && isGazeSignalAvailable);
            deliveryControllerRef.current.recordTelemetrySample({
              gaze: emitGaze
                ? {
                    x: normGazeX,
                    y: normGazeY,
                    confidence: isMouseFallback ? currentConf : rawGazeConfidence,
                  }
                : null,
              gameplay: {
                playerX: normGazeX,
                playerY: normGazeY,
                targetX: clamp01(primaryEntity.x / width),
                targetY: clamp01(primaryEntity.y / height),
                score: Math.max(0, s.score),
                speed: Math.max(0, Number(s.cursorSpeedPxPerSec.toFixed(2))),
                progress: progressNorm,
              },
            });
            if (guardEval.isNewSampleForTelemetry) {
              gazeFreshnessGuardRef.current.markTelemetrySampleEmitted(currentSampleSeq);
            }
          }
        }

        // Handle subPhases
        if (s.subPhase === 'INTER_STIMULUS_REST') {
          if (!isPausedRef.current) {
            s.restRemainingMs -= deltaTime;
            if (s.restRemainingMs <= 0) {
              spawnModeTrial(true);
            }
          }

          ctx.fillStyle = '#8AE2D6';
          ctx.font = 'bold 24px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(
            `Descanse la mirada... Siguiente estímulo en ${Math.max(
              0,
              s.restRemainingMs / 1000
            ).toFixed(1)}s`,
            width / 2,
            height / 2
          );
          ctx.textAlign = 'start';
        } else if (!isPausedRef.current) {
          s.trialElapsedMs += deltaTime;
          const cursorPt = { x: cursorX, y: cursorY };

          // Update game mechanics via modular algorithmic engines
          if (resolvedMode === 'STANDARD_SCANNING' && s.standardState) {
            const p = frozenParams as VisualScanningParameters;
            const res = stepStandardScanningTrial(
              s.standardState,
              cursorPt,
              deltaTime,
              p,
              isGazeSignalAvailable,
              guardEval.effectiveDwellDeltaMs,
              trialOrigin,
              sampleContinuity
            );
            s.entities = [s.standardState.target];
            if (s.standardState.target.dwellTimeMs > 60) {
              therapyAudio.playFixationTick(
                clamp01(s.standardState.target.dwellTimeMs / Math.max(200, p.minimumFixationMs)),
                s.standardState.target.x / width
              );
            }
            if (res) {
              completeCurrentTrial(res, res.outcome === 'SUCCESS');
            }
          } else if (resolvedMode === 'SYSTEMATIC_EXPLORATION' && s.explorationState) {
            const p = frozenParams as VisualScanningParameters;
            const prevStep = s.explorationState.currentStepIndex;
            const res = stepSystematicExplorationTrial(
              s.explorationState,
              cursorPt,
              deltaTime,
              p,
              isGazeSignalAvailable,
              guardEval.effectiveDwellDeltaMs,
              trialOrigin,
              sampleContinuity
            );
            if (s.explorationState.currentStepIndex > prevStep && !res) {
              const completedWp =
                s.explorationState.waypoints[prevStep] ?? s.explorationState.waypoints[0];
              if (completedWp) {
                therapyAudio.playTargetAcquired(s.streak + 1, completedWp.x / width);
                spawnRewardBurst(
                  completedWp.x,
                  completedWp.y,
                  `¡Cuadrante ${s.explorationState.currentStepIndex}/4!`,
                  '#8AE2D6'
                );
              }
            }
            const activeWp = s.explorationState.waypoints[s.explorationState.currentStepIndex];
            if (activeWp && activeWp.dwellTimeMs > 60) {
              therapyAudio.playFixationTick(
                clamp01(activeWp.dwellTimeMs / Math.max(200, p.minimumFixationMs)),
                activeWp.x / width
              );
            }
            s.explorationStepIndex = s.explorationState.currentStepIndex;
            s.explorationVisits = s.explorationState.visits;
            s.entities = s.explorationState.waypoints;
            if (res) {
              completeCurrentTrial(res, res.outcome === 'COMPLETED');
            }
          } else if (resolvedMode === 'COMPENSATORY_SACCADE' && s.saccadeState) {
            const p = frozenParams as VisualScanningParameters;
            const prevPhase = s.saccadeState.phase;
            const res = stepCompensatorySaccadeTrial(
              s.saccadeState,
              cursorPt,
              deltaTime,
              p,
              isGazeSignalAvailable,
              guardEval.effectiveDwellDeltaMs,
              trialOrigin,
              sampleContinuity
            );
            if (s.saccadeState.phase === 'CENTRAL_ANCHOR') {
              s.subPhase = 'CENTRAL_ANCHOR';
              s.entities = [s.saccadeState.anchor];
              if (s.saccadeState.anchor.dwellTimeMs > 60) {
                therapyAudio.playFixationTick(
                  clamp01(
                    s.saccadeState.anchor.dwellTimeMs /
                      Math.max(150, s.saccadeState.anchorHoldRequiredMs)
                  ),
                  0.5
                );
              }
            } else {
              if (prevPhase === 'CENTRAL_ANCHOR') {
                s.trialElapsedMs = 0;
                therapyAudio.playAnchorLocked(s.saccadeState.peripheralTarget.x / width);
                spawnRewardBurst(width / 2, height / 2, '¡Salto Sacádico!', '#38BDF8');
              }
              s.subPhase = 'ACTIVE_TRIAL';
              s.entities = [s.saccadeState.peripheralTarget];
              if (s.saccadeState.peripheralTarget.dwellTimeMs > 60) {
                therapyAudio.playFixationTick(
                  clamp01(
                    s.saccadeState.peripheralTarget.dwellTimeMs /
                      Math.max(200, p.minimumFixationMs)
                  ),
                  s.saccadeState.peripheralTarget.x / width
                );
              }
            }
            if (res) {
              completeCurrentTrial(res, res.outcome === 'SUCCESS');
            }
          } else if (resolvedMode === 'TARGET_SEARCH_WITH_DISTRACTORS' && s.searchState) {
            const p = frozenParams as VisualSearchParameters;
            const res = stepVisualSearchTrial(
              s.searchState,
              cursorPt,
              deltaTime,
              p,
              isGazeSignalAvailable,
              guardEval.effectiveDwellDeltaMs,
              trialOrigin,
              sampleContinuity
            );
            const foundTargetsNow = s.searchState.entities.filter(
              (e) => e.kind === 'TARGET' && e.found
            );
            if (foundTargetsNow.length > s.lastFoundTargetsCount && !res) {
              s.lastFoundTargetsCount = foundTargetsNow.length;
              const lastFound = foundTargetsNow[foundTargetsNow.length - 1];
              if (lastFound) {
                therapyAudio.playTargetAcquired(s.streak + 1, lastFound.x / width);
                spawnRewardBurst(lastFound.x, lastFound.y, '¡Objetivo Localizado!', '#10B981');
              }
            }
            if (s.searchState.falseFixations > s.lastFalseFixationsCount) {
              s.lastFalseFixationsCount = s.searchState.falseFixations;
              therapyAudio.playDistractorWarning(cursorX / width);
              spawnRewardBurst(cursorX, cursorY, 'Distractor', '#F59E0B');
            }
            const hoveringTarget = s.searchState.entities.find(
              (e) => e.kind === 'TARGET' && !e.found && e.dwellTimeMs > 60
            );
            if (hoveringTarget) {
              therapyAudio.playFixationTick(
                clamp01(hoveringTarget.dwellTimeMs / Math.max(200, p.minimumFixationMs)),
                hoveringTarget.x / width
              );
            }
            s.lastConfirmedDwellMs = s.searchState.lastConfirmedDwellMs;
            s.entities = s.searchState.entities;
            if (res) {
              completeCurrentTrial(res, res.outcome === 'SUCCESS');
            }
          } else if (resolvedMode === 'SUSTAINED_TARGET_FIXATION' && s.fixationState) {
            const p = frozenParams as FixationParameters;
            const res = stepSustainedFixationTrial(
              s.fixationState,
              cursorPt,
              deltaTime,
              p,
              isGazeSignalAvailable,
              guardEval.effectiveDwellDeltaMs,
              trialOrigin,
              sampleContinuity
            );
            s.insideTargetMs = s.fixationState.insideTargetMs;
            s.currentContinuousInsideMs = s.fixationState.currentContinuousInsideMs;
            s.longestContinuousInsideMs = s.fixationState.longestContinuousInsideMs;
            if (s.entities[0]) {
              s.entities[0].dwellTimeMs = s.fixationState.currentContinuousInsideMs;
            }
            if (s.fixationState.currentContinuousInsideMs > 60) {
              therapyAudio.playFixationTick(
                clamp01(
                  s.fixationState.currentContinuousInsideMs / Math.max(200, p.minimumFixationMs)
                ),
                s.fixationState.x / width
              );
            }
            if (res) {
              completeCurrentTrial(res, res.outcome === 'SUCCESS');
            }
          }
        }

        // Draw Systematic Exploration connecting route & quadrant labels
        if (resolvedMode === 'SYSTEMATIC_EXPLORATION' && s.entities.length > 1) {
          ctx.save();
          ctx.strokeStyle = 'rgba(138, 226, 214, 0.28)';
          ctx.lineWidth = 3;
          ctx.setLineDash([8, 8]);
          ctx.beginPath();
          s.entities.forEach((wp, idx) => {
            if (idx === 0) ctx.moveTo(wp.x, wp.y);
            else ctx.lineTo(wp.x, wp.y);
          });
          ctx.stroke();
          ctx.restore();
        }

        // Draw Compensatory Saccade directional vector during peripheral jump
        if (
          resolvedMode === 'COMPENSATORY_SACCADE' &&
          s.saccadeState &&
          s.saccadeState.phase === 'PERIPHERAL_TARGET'
        ) {
          ctx.save();
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
          ctx.lineWidth = 2.5;
          ctx.setLineDash([6, 6]);
          ctx.beginPath();
          ctx.moveTo(width / 2, height / 2);
          ctx.lineTo(s.saccadeState.peripheralTarget.x, s.saccadeState.peripheralTarget.y);
          ctx.stroke();
          ctx.restore();
        }

        // Draw all active entities by mode
        if (resolvedMode === 'TARGET_SEARCH_WITH_DISTRACTORS' && s.searchState) {
          for (const searchEnt of s.searchState.entities) {
            renderSearchEntity(ctx, searchEnt, { showAcceptanceRadius: true });
          }
        } else if (resolvedMode === 'SUSTAINED_TARGET_FIXATION' && s.fixationState) {
          renderFixationTarget(ctx, s.fixationState, frozenParams as FixationParameters);
        } else {
          for (const entity of s.entities) {
            if (entity.kind === 'ANCHOR') {
              ctx.save();
              ctx.beginPath();
              ctx.arc(entity.x, entity.y, entity.radius, 0, Math.PI * 2);
              ctx.fillStyle = '#1E293B';
              ctx.fill();
              ctx.lineWidth = 3;
              ctx.strokeStyle = '#38BDF8';
              ctx.stroke();

              // Crosshair
              ctx.strokeStyle = '#FFFFFF';
              ctx.lineWidth = 3;
              ctx.beginPath();
              ctx.moveTo(entity.x - 12, entity.y);
              ctx.lineTo(entity.x + 12, entity.y);
              ctx.moveTo(entity.x, entity.y - 12);
              ctx.lineTo(entity.x, entity.y + 12);
              ctx.stroke();

              const anchorMax =
                s.saccadeState?.anchorHoldRequiredMs ??
                Math.min(frozenParams.minimumFixationMs, 500);
              if (entity.dwellTimeMs > 0) {
                const ratio = clamp01(entity.dwellTimeMs / anchorMax);
                ctx.beginPath();
                ctx.arc(
                  entity.x,
                  entity.y,
                  entity.radius + 10,
                  -Math.PI / 2,
                  -Math.PI / 2 + Math.PI * 2 * ratio
                );
                ctx.strokeStyle = '#38BDF8';
                ctx.lineWidth = 5;
                ctx.stroke();
              }
              ctx.restore();
              continue;
            }

            // TARGET or WAYPOINT
            const isCurrentStep =
              entity.kind !== 'WAYPOINT' || entity.orderIndex === s.explorationStepIndex;
            const isHovering =
              Math.hypot(entity.x - cursorX, entity.y - cursorY) <=
              Math.max(entity.radius * 1.45, entity.radius + 16);

            ctx.save();
            ctx.beginPath();
            ctx.arc(entity.x, entity.y, entity.radius, 0, Math.PI * 2);

            if (entity.found) {
              ctx.fillStyle = '#0F6F62';
              ctx.strokeStyle = '#8AE2D6';
            } else if (!isCurrentStep) {
              ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
              ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
            } else if (isHovering) {
              ctx.fillStyle = '#FFFFFF';
              ctx.strokeStyle = '#26A69A';
            } else {
              ctx.fillStyle = '#FACC15';
              ctx.strokeStyle = '#FFFFFF';
            }

            ctx.fill();
            ctx.lineWidth = 4;
            ctx.stroke();

            // Inner bullseye / step number
            if (entity.kind === 'WAYPOINT' && entity.orderIndex !== undefined) {
              ctx.fillStyle = entity.found ? '#FFFFFF' : isCurrentStep ? '#0F172A' : '#CBD5E1';
              ctx.font = 'bold 20px Inter, sans-serif';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(entity.found ? '✓' : String(entity.orderIndex + 1), entity.x, entity.y);
              ctx.textAlign = 'start';
              ctx.textBaseline = 'alphabetic';
            } else {
              ctx.beginPath();
              ctx.arc(entity.x, entity.y, Math.max(6, entity.radius * 0.25), 0, Math.PI * 2);
              ctx.fillStyle = entity.found ? '#8AE2D6' : '#0F172A';
              ctx.fill();
            }

            // Dwell progress ring
            if (!entity.found && isCurrentStep && entity.dwellTimeMs > 0) {
              const denom = Math.max(200, frozenParams.minimumFixationMs);
              const ratio = clamp01(entity.dwellTimeMs / denom);
              ctx.beginPath();
              ctx.arc(
                entity.x,
                entity.y,
                entity.radius + 14,
                -Math.PI / 2,
                -Math.PI / 2 + Math.PI * 2 * ratio
              );
              ctx.strokeStyle = '#26A69A';
              ctx.lineWidth = 6;
              ctx.stroke();
            }
            ctx.restore();
          }
        }

        // Peripheral Rescue Beacon (visual + spatial audio cue when patient struggles to locate stimulus)
        const maxTrialDurationMs =
          'maximumStimulusDurationMs' in frozenParams
            ? frozenParams.maximumStimulusDurationMs
            : 'maximumSearchTimeMs' in frozenParams
            ? frozenParams.maximumSearchTimeMs
            : (frozenParams as FixationParameters).maximumFixationMs;

        const rescueTarget =
          resolvedMode === 'SYSTEMATIC_EXPLORATION'
            ? s.entities[s.explorationStepIndex] ?? primaryEntity
            : s.entities.find((e) => (e.kind === 'TARGET' || e.kind === 'WAYPOINT') && !e.found) ??
              primaryEntity;

        const effectiveRescueElapsedMs =
          resolvedMode === 'SYSTEMATIC_EXPLORATION'
            ? s.explorationState?.currentQuadrantElapsedMs ?? s.trialElapsedMs
            : s.trialElapsedMs;

        if (
          s.subPhase === 'ACTIVE_TRIAL' &&
          !rescueTarget.found &&
          rescueTarget.dwellTimeMs < 80 &&
          effectiveRescueElapsedMs >= maxTrialDurationMs * 0.65
        ) {
          if (!isPausedRef.current) {
            therapyAudio.playPeripheralRescueBeacon(rescueTarget.x / width);
          }

          const pulsePhase = (effectiveRescueElapsedMs % 900) / 900;
          const waveRadius = rescueTarget.radius + 14 + pulsePhase * 42;
          ctx.save();
          ctx.beginPath();
          ctx.arc(rescueTarget.x, rescueTarget.y, waveRadius, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(250, 204, 21, ${(1 - pulsePhase) * 0.85})`;
          ctx.lineWidth = 3.5;
          ctx.stroke();

          // Directional chevron arrow from center toward rescueTarget
          const dx = rescueTarget.x - width / 2;
          const dy = rescueTarget.y - height / 2;
          const distFromCenter = Math.hypot(dx, dy);
          if (distFromCenter > 95) {
            const angle = Math.atan2(dy, dx);
            const arrowDist = Math.min(130, distFromCenter * 0.45);
            const tipX = width / 2 + Math.cos(angle) * arrowDist;
            const tipY = height / 2 + Math.sin(angle) * arrowDist;
            ctx.translate(tipX, tipY);
            ctx.rotate(angle);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(-18, -10);
            ctx.lineTo(-13, 0);
            ctx.lineTo(-18, 10);
            ctx.closePath();
            ctx.fillStyle = '#FACC15';
            ctx.fill();
          }
          ctx.restore();
        }

        // Gamification Particles & Floating Popups
        if (s.particles.length > 0) {
          const dtSec = deltaTime / 1000;
          for (let i = s.particles.length - 1; i >= 0; i--) {
            const pt = s.particles[i];
            if (!isPausedRef.current) {
              pt.x += pt.vx * dtSec;
              pt.y += pt.vy * dtSec;
              pt.alpha -= dtSec * 1.45;
            }
            if (pt.alpha <= 0) {
              s.particles.splice(i, 1);
              continue;
            }
            ctx.save();
            ctx.globalAlpha = clamp01(pt.alpha);
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, pt.radius, 0, Math.PI * 2);
            ctx.fillStyle = pt.color;
            ctx.fill();
            ctx.restore();
          }
        }

        if (s.floatingTexts.length > 0) {
          const dtSec = deltaTime / 1000;
          for (let i = s.floatingTexts.length - 1; i >= 0; i--) {
            const ft = s.floatingTexts[i];
            if (!isPausedRef.current) {
              ft.y += ft.vy * dtSec;
              ft.alpha -= dtSec * 0.95;
            }
            if (ft.alpha <= 0) {
              s.floatingTexts.splice(i, 1);
              continue;
            }
            ctx.save();
            ctx.globalAlpha = clamp01(ft.alpha);
            ctx.font = 'bold 16px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = ft.color;
            ctx.fillText(ft.text, ft.x, ft.y);
            ctx.restore();
          }
        }

        // Sync HUD bar above Canvas (zero overlap with targets + zero React re-renders)
        const goalLabel =
          requiredReps !== null
            ? `Repeticiones: ${s.score} / ${requiredReps}`
            : `Tiempo Activo: ${Math.floor(s.activeElapsedMs / 1000)}s / ${timeTargetSeconds}s`;
        const distPrimary = Math.hypot(primaryEntity.x - cursorX, primaryEntity.y - cursorY);
        const anchorRemainingSec =
          s.subPhase === 'CENTRAL_ANCHOR' && s.saccadeState
            ? Math.max(
                0,
                (s.saccadeState.anchorTimeoutMs - s.saccadeState.anchorElapsedMs) / 1000
              )
            : null;
        const subHint =
          s.subPhase === 'CENTRAL_ANCHOR'
            ? anchorRemainingSec !== null
              ? `Fije la cruz central (${anchorRemainingSec.toFixed(1)}s)`
              : 'Fije la cruz central para disparar la sacada'
            : resolvedMode === 'TARGET_SEARCH_WITH_DISTRACTORS'
            ? `Objetivos pendientes: ${
                s.entities.filter((e) => e.kind === 'TARGET' && !e.found).length
              }`
            : `Error distancia: ${Math.round(distPrimary)} px`;
        const liveFps = measuredInferenceFpsRef.current;
        const inputOriginHint = isMouseFallback
          ? 'Origen: RATÓN FALLBACK (gazeSamples + gameplaySamples)'
          : `Origen: MIRADA WEBCAM (conf ${(rawGazeConfidence * 100).toFixed(0)}%${
              liveFps !== null && liveFps > 0 ? ` · ${liveFps.toFixed(1)} Hz` : ''
            })`;

        const mainPrimary = `${goalLabel}  ·  ${resolvedMode}`;
        const mainSecondary = `⭐ ${s.gamifiedPoints} pts  ·  🔥 Racha: x${s.streak} (Máx x${s.maxStreak})  ·  ${subHint}  ·  ${inputOriginHint}`;
        const lowFpsWarning =
          !isMouseFallback &&
          liveFps !== null &&
          liveFps > 0 &&
          liveFps < SUPPORTED_MIN_INFERENCE_FPS
            ? `⚠️ Inferencia real ${liveFps.toFixed(1)} Hz (< ${SUPPORTED_MIN_INFERENCE_FPS} Hz mínimos) — fijaciones continuas comprometidas`
            : '';
        const mainWarning = !isGazeSignalAvailable
          ? getGazeWarningText(guardEval.reason) ??
            '⚠️ Rostro/mirada no detectada — reubíquese frente a la cámara (acumulación en pausa)'
          : lowFpsWarning;

        if (hudPrimaryRef.current && lastHudPrimaryRef.current !== mainPrimary) {
          lastHudPrimaryRef.current = mainPrimary;
          hudPrimaryRef.current.textContent = mainPrimary;
        }
        if (hudSecondaryRef.current && lastHudSecondaryRef.current !== mainSecondary) {
          lastHudSecondaryRef.current = mainSecondary;
          hudSecondaryRef.current.textContent = mainSecondary;
        }
        if (hudWarningRef.current && lastHudWarningRef.current !== mainWarning) {
          lastHudWarningRef.current = mainWarning;
          hudWarningRef.current.textContent = mainWarning;
          hudWarningRef.current.style.display = mainWarning ? 'inline-flex' : 'none';
        }
      }

      // Gaze cursor indicator
      ctx.beginPath();
      ctx.arc(cursorX, cursorY, 10, 0, Math.PI * 2);
      ctx.fillStyle = isMouseFallback
        ? 'rgba(38, 166, 154, 0.75)'
        : 'rgba(255, 255, 255, 0.55)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#FFFFFF';
      ctx.stroke();

      if (gamePhase !== 'FINISHED' && !isCompletingRef.current) {
        requestRef.current = requestAnimationFrame(renderLoop);
      }
    },
    [
      width,
      height,
      gamePhase,
      gazeRef,
      gazeConfidenceRef,
      gazeSampleSeqRef,
      gazeLastValidPerfRef,
      gazeIsBlinkingRef,
      isWebcamStreaming,
      prescription.parameters.min_fixation_time,
      spawnTutorialTarget,
      isCognitoSession,
      activeSessionId,
      requiredReps,
      timeTargetSeconds,
      spawnModeTrial,
      resolvedMode,
      frozenParams,
      completeCurrentTrial,
      spawnRewardBurst,
    ]
  );

  useEffect(() => {
    if (gamePhase !== 'FINISHED') {
      requestRef.current = requestAnimationFrame(renderLoop);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [renderLoop, gamePhase]);

  const handleToggleMouse = () => {
    if (onToggleMouseFallback) {
      onToggleMouseFallback();
    } else {
      setLocalMouseFallback((prev) => {
        const next = !prev;
        localMouseFallbackRef.current = next;
        return next;
      });
    }
  };

  const renderCognitoSyncStatus = () => {
    if (completionState === 'SAVING') {
      return (
        <div className="flex items-center gap-2">
          <Loader2 size={14} className="animate-spin text-[#8AE2D6]" />
          <span>Sincronizando telemetría y cierre de sesión clínica...</span>
        </div>
      );
    }

    if (completionState === 'PENDING_SYNC') {
      const unresolvedTrials = syncSummary.pendingTrials + syncSummary.uncertainTrials;
      const rejectedOrDroppedTelemetry =
        syncSummary.permanentRejectedTelemetryBatches +
        syncSummary.droppedOverflowTelemetryBatches;

      return (
        <div className="w-full space-y-2.5 text-left">
          <div className="flex items-center gap-2 text-amber-300 font-bold">
            <AlertTriangle size={15} className="shrink-0" />
            <span>Sincronización pendiente antes de cerrar la sesión clínica</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-white/85">
            <span>
              Ensayos confirmados: <strong>{syncSummary.confirmedTrials}</strong>
            </span>
            <span>
              Pendientes / inciertos: <strong>{unresolvedTrials}</strong>
              {syncSummary.inFlightTrials > 0
                ? ` (${syncSummary.inFlightTrials} en vuelo)`
                : ''}
            </span>
            <span>
              Rechazados permanentes (Analytics):{' '}
              <strong>{syncSummary.failedPermanentTrials}</strong>
            </span>
            <span>
              Lotes telemetría pendientes:{' '}
              <strong>{syncSummary.pendingTelemetryBatches}</strong>
              {syncSummary.bufferedTelemetrySamples > 0
                ? ` (+${syncSummary.bufferedTelemetrySamples} muestras en búfer)`
                : ''}
            </span>
            <span>
              Aceptados por broker (202 Kafka):{' '}
              <strong>{syncSummary.brokerAcceptedTelemetryBatches}</strong>
            </span>
            <span>
              Telemetría rechazada permanente / desbordada:{' '}
              <strong>{rejectedOrDroppedTelemetry}</strong>
            </span>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => void runCloseSessionFlow(false)}
              className="px-3 py-1.5 rounded-lg bg-[#26A69A] hover:bg-[#1E8A80] text-[#0E1722] font-bold text-xs transition-colors"
            >
              Reintentar sincronización y cerrar sesión
            </button>
            <button
              type="button"
              onClick={() => void runCloseSessionFlow(true)}
              className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white border border-white/20 font-semibold text-xs transition-colors"
            >
              Cerrar sesión clínica de todas formas
            </button>
          </div>
          <p className="text-[10px] text-white/65 leading-relaxed">
            Nota: las colas son en memoria (mejor esfuerzo y no sobreviven recarga). HTTP 202
            (BROKER_ACCEPTED) confirma recepción en Kafka, no persistencia final en TimescaleDB ni
            cierre de Analytics.
          </p>
        </div>
      );
    }

    if (completionState === 'ERROR') {
      if (closureDetail?.kind === 'PROGRESS_UNAVAILABLE') {
        return (
          <div className="w-full space-y-2.5 text-left">
            <div className="flex items-start gap-2 text-amber-300 font-bold">
              <AlertTriangle size={15} className="shrink-0 mt-0.5 text-red-400" />
              <span>{closureDetail.message}</span>
            </div>
            <p className="text-[11px] text-white/75">
              No se usó progreso en caché de ninguna otra sesión ni se envió cierre al servidor.
            </p>
            <button
              type="button"
              onClick={() => void runCloseSessionFlow(false)}
              className="px-3 py-1.5 rounded-lg bg-[#26A69A] hover:bg-[#1E8A80] text-[#0E1722] font-bold text-xs transition-colors cursor-pointer"
            >
              Reintentar lectura de progreso y cerrar
            </button>
          </div>
        );
      }

      if (
        closureDetail?.kind === 'UNCERTAIN_COMPLETION' ||
        closureDetail?.kind === 'OBSERVED_SERVER_STATE'
      ) {
        return (
          <div className="w-full space-y-2.5 text-left">
            <div className="flex items-start gap-2 text-amber-300 font-bold">
              <AlertTriangle size={15} className="shrink-0 mt-0.5 text-amber-400" />
              <span>{closureDetail.message}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px] text-white/85">
              <span>
                Estado observado en servidor:{' '}
                <strong>{closureDetail.observedServerStatus ?? 'DESCONOCIDO'}</strong>
              </span>
              <span>
                Comprobante de esta operación:{' '}
                <strong>
                  {closureDetail.receiptAcknowledged ? 'CONFIRMADO' : 'NO CONFIRMADO'}
                </strong>
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void runRecoverSessionFlow('VERIFY_ONLY')}
                className="px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white font-semibold text-xs transition-colors cursor-pointer"
              >
                Verificar estado en servidor
              </button>
              {closureDetail.canRecoverWithSameKey && (
                <button
                  type="button"
                  onClick={() => void runRecoverSessionFlow('VERIFY_AND_RESEND')}
                  className="px-3 py-1.5 rounded-lg bg-[#26A69A] hover:bg-[#1E8A80] text-[#0E1722] font-bold text-xs transition-colors cursor-pointer"
                >
                  Verificar y reconfirmar cierre (misma clave)
                </button>
              )}
            </div>
            <p className="text-[10px] text-white/65 leading-relaxed">
              La solicitud anterior puede estar aún ejecutándose de forma remota. El reenvío conserva
              exactamente la misma sesión, clave idempotente y acción.
            </p>
          </div>
        );
      }

      if (closureDetail?.kind === 'CONFLICT') {
        return (
          <div className="w-full space-y-2 text-left">
            <div className="flex items-start gap-2 text-red-300 font-bold">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" />
              <span>{closureDetail.message}</span>
            </div>
            <p className="text-[11px] text-white/75">
              Estado observado en servidor:{' '}
              <strong>{closureDetail.observedServerStatus ?? 'DESCONOCIDO'}</strong>. No se
              generará una clave nueva ni se reintentará automáticamente.
            </p>
            <button
              type="button"
              onClick={() => void runRecoverSessionFlow('VERIFY_ONLY')}
              className="px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white font-semibold text-xs transition-colors cursor-pointer"
            >
              Actualizar estado observado
            </button>
          </div>
        );
      }

      if (closureDetail?.kind === 'AUTH_ERROR') {
        return (
          <div className="w-full space-y-2 text-left">
            <div className="flex items-start gap-2 text-red-300 font-bold">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" />
              <span>{closureDetail.message}</span>
            </div>
            <button
              type="button"
              onClick={() => void runRecoverSessionFlow('VERIFY_AND_RESEND')}
              className="px-3 py-1.5 rounded-lg bg-red-500/80 hover:bg-red-500 text-white font-bold text-xs transition-colors cursor-pointer"
            >
              Reintentar recuperación (misma clave)
            </button>
          </div>
        );
      }

      return (
        <div className="w-full space-y-2 text-left">
          <div className="flex items-center gap-2 text-red-300 font-bold">
            <AlertTriangle size={15} className="shrink-0" />
            <span>{backendWarning || 'Error al cerrar la sesión clínica.'}</span>
          </div>
          <button
            type="button"
            onClick={() => void runRecoverSessionFlow('VERIFY_AND_RESEND')}
            className="px-3 py-1.5 rounded-lg bg-red-500/80 hover:bg-red-500 text-white font-bold text-xs transition-colors cursor-pointer"
          >
            Reintentar cierre clínico
          </button>
        </div>
      );
    }

    if (completionState === 'FINISHED' || completionState === 'ABANDONED') {
      const closedStatusLabel =
        completionState === 'FINISHED' ? 'COMPLETED' : 'ABANDONED';
      const hasIncompleteOrLostData =
        syncSummary.hasPermanentDataLoss || syncSummary.hasPendingOrUncertainDelivery;

      if (hasIncompleteOrLostData) {
        return (
          <div
            className={`w-full space-y-2 text-left rounded-lg p-3 border ${
              syncSummary.hasPermanentDataLoss
                ? 'bg-red-950/45 border-red-400/50'
                : 'bg-amber-950/40 border-amber-400/40'
            }`}
          >
            <div className="flex items-start gap-2 text-amber-300 font-bold">
              <AlertTriangle size={15} className="shrink-0 mt-0.5 text-red-400" />
              <span>
                Sesión registrada como <strong>{closedStatusLabel}</strong> — Sincronización
                incompleta (datos no confirmados o perdidos)
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-white/85">
              <span>
                Ensayos confirmados: <strong>{syncSummary.confirmedTrials}</strong>
              </span>
              <span>
                Rechazados permanentes (Analytics):{' '}
                <strong>{syncSummary.failedPermanentTrials}</strong>
              </span>
              <span>
                Pendientes/inciertos:{' '}
                <strong>{syncSummary.pendingTrials + syncSummary.uncertainTrials}</strong>
              </span>
              <span>
                Lotes broker 202 (Kafka):{' '}
                <strong>{syncSummary.brokerAcceptedTelemetryBatches}</strong>
              </span>
              <span className="sm:col-span-2">
                Lotes telemetría rechazados (perm.) / desbordados:{' '}
                <strong>
                  {syncSummary.permanentRejectedTelemetryBatches} /{' '}
                  {syncSummary.droppedOverflowTelemetryBatches}
                </strong>
                {(syncSummary.pendingTelemetryBatches > 0 ||
                  syncSummary.bufferedTelemetrySamples > 0) &&
                  ` · Telemetría pendiente/búfer: ${syncSummary.pendingTelemetryBatches} lotes / ${syncSummary.bufferedTelemetrySamples} muestras`}
              </span>
            </div>
            {syncSummary.uncertainTrials > 0 && (
              <div className="pt-0.5">
                <button
                  type="button"
                  onClick={() => void deliveryControllerRef.current?.drainPendingTrials(1)}
                  className="px-2.5 py-1 rounded-md bg-amber-500/25 border border-amber-400/40 text-amber-200 font-semibold text-[11px] hover:bg-amber-500/35"
                >
                  Confirmar ensayos inciertos (ALREADY_STORED)
                </button>
              </div>
            )}
            <p className="text-[10px] text-amber-100/75 leading-relaxed">
              Los rechazos permanentes no se reintentan automáticamente y los lotes desbordados por
              capacidad no pueden recuperarse localmente. La entrega del cliente es en memoria (mejor
              esfuerzo): HTTP 202 (BROKER_ACCEPTED) confirma recepción en Kafka, no persistencia
              final en base de datos.
            </p>
          </div>
        );
      }

      if (syncSummary.isSyncComplete) {
        return (
          <div className="w-full space-y-1.5 text-center">
            <div className="flex flex-wrap items-center justify-center gap-2">
              {completionState === 'FINISHED' ? (
                <CheckCircle size={14} className="text-[#26A69A]" />
              ) : (
                <AlertTriangle size={14} className="text-amber-400" />
              )}
              <span>
                Sesión registrada como <strong>{closedStatusLabel}</strong> · Ensayos confirmados:{' '}
                <strong>{syncSummary.confirmedTrials}</strong> · Lotes aceptados en broker (202
                Kafka): <strong>{syncSummary.brokerAcceptedTelemetryBatches}</strong>
              </span>
            </div>
            <p className="text-[10px] text-white/65 leading-relaxed">
              Entrega del cliente en memoria (mejor esfuerzo); HTTP 202 (BROKER_ACCEPTED) confirma
              recepción en el broker Kafka, no persistencia final en base de datos.
            </p>
          </div>
        );
      }
    }

    return <span>Estado de envío: {completionState}</span>;
  };

  return (
    <div className="flex flex-col rounded-2xl overflow-hidden border-2 border-white/15 shadow-2xl transition-all bg-[#070B12] w-full">
      {/* Slim dedicated HUD bar above Canvas (prevents overlapping targets & action buttons) */}
      <div className="bg-[#0B131C] border-b border-white/10 px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 min-h-[48px]">
        <div className="min-w-0 flex-1 flex flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span
              ref={hudPrimaryRef}
              className="text-xs sm:text-sm font-bold text-white tracking-tight truncate"
            >
              {gamePhase === 'CALIBRATION'
                ? 'Calibración ocular de 9 puntos'
                : 'Preparando ejercicio...'}
            </span>
            <span
              ref={hudWarningRef}
              style={{ display: 'none' }}
              className="items-center px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-400/40 text-amber-300 text-[11px] font-bold"
            />
          </div>
          <span
            ref={hudSecondaryRef}
            className="text-[11px] font-mono text-[#8AE2D6] truncate"
          />
        </div>

        {/* Action Controls during MAIN_GAME */}
        {gamePhase === 'MAIN_GAME' && (
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              onClick={handleToggleMute}
              title={isMuted ? 'Activar retroalimentación sonora espacial' : 'Silenciar audio'}
              className={`px-2.5 py-1.5 text-xs font-bold rounded-lg flex items-center space-x-1.5 transition-colors cursor-pointer ${
                !isMuted
                  ? 'bg-[#26A69A]/25 border border-[#26A69A]/50 text-[#8AE2D6]'
                  : 'bg-white/15 hover:bg-white/25 text-white/70'
              }`}
            >
              {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
              <span className="hidden sm:inline">{isMuted ? 'Audio OFF' : 'Audio 3D'}</span>
            </button>

            {!onToggleMouseFallback && (
              <button
                onClick={handleToggleMouse}
                className={`px-2.5 py-1.5 text-xs font-bold rounded-lg flex items-center space-x-1.5 transition-colors cursor-pointer ${
                  localMouseFallback
                    ? 'bg-[#26A69A] text-[#0E1722]'
                    : 'bg-white/15 hover:bg-white/25 text-white'
                }`}
              >
                <MousePointer2 size={14} />
                <span>{localMouseFallback ? 'Ratón ON' : 'Ratón'}</span>
              </button>
            )}

            <button
              onClick={handleTogglePause}
              className="px-3 py-1.5 bg-white/15 hover:bg-white/25 text-white text-xs font-semibold rounded-lg flex items-center space-x-1.5 transition-colors cursor-pointer"
            >
              {isPaused ? <Play size={14} /> : <Pause size={14} />}
              <span>{isPaused ? 'Reanudar' : 'Pausar'}</span>
            </button>

            <button
              onClick={() => void finishSession('USER_EXIT')}
              className="px-3 py-1.5 bg-[#B85D19] hover:bg-[#974911] text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              Finalizar Ejercicio
            </button>
          </div>
        )}
      </div>

      {/* Unobstructed 16:9 Canvas Stage */}
      <div className="relative w-full aspect-video bg-hc-black">
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          onPointerMove={handlePointerMove}
          className="block w-full h-full bg-hc-black"
          style={{ touchAction: 'none', cursor: localMouseFallback ? 'crosshair' : 'default' }}
        />

        {/* Non-blocking backend warning badge */}
        {backendWarning && gamePhase === 'MAIN_GAME' && (
          <div className="absolute bottom-3 left-3 right-3 sm:right-auto max-w-md bg-amber-950/90 border border-amber-500/40 text-amber-200 px-3 py-1.5 rounded-lg text-[11px] flex items-center space-x-2 z-20">
            <AlertTriangle size={14} className="shrink-0 text-amber-400" />
            <span className="truncate">{backendWarning}</span>
          </div>
        )}

        {/* Pause Overlay */}
        {gamePhase === 'MAIN_GAME' && isPaused && (
          <div className="absolute inset-0 bg-black/75 backdrop-blur-xs flex flex-col items-center justify-center z-20 space-y-4">
            <h3 className="text-2xl font-bold text-white">Sesión en Pausa</h3>
            <p className="text-sm text-white/75">
              Descansa tus ojos un momento. Pulsa reanudar cuando estés listo.
            </p>
            <button
              onClick={handleTogglePause}
              className="px-6 py-3 bg-[#26A69A] hover:bg-[#1E8A80] text-[#0E1722] font-bold rounded-xl flex items-center space-x-2 cursor-pointer"
            >
              <Play size={18} className="fill-current" />
              <span>Reanudar Terapia</span>
            </button>
          </div>
        )}
      </div>

      {/* Finished / Clinical Report Overlay */}
      {gamePhase === 'FINISHED' && report && (
        <div className="fixed inset-0 bg-primary/95 text-white flex items-start justify-center p-4 sm:p-6 z-[80] overflow-y-auto">
          <div className="bg-bgSecondary/10 border border-white/20 rounded-2xl p-6 sm:p-8 max-w-2xl w-full my-auto text-center shadow-2xl backdrop-blur-sm space-y-5">
            <div className="flex justify-center">
              <Award className="text-secondary w-14 h-14" />
            </div>

            <div>
              <h2 className="text-2xl sm:text-3xl font-bold mb-1.5">
                {completionState === 'ABANDONED'
                  ? 'Sesión Finalizada Anticipadamente'
                  : '¡Sesión Terapéutica Completada!'}
              </h2>
              <p className="text-slate-300 text-xs sm:text-sm">
                Métricas computadas según modelos de evaluación oculomotora continua (
                <ClinicalTermTooltip
                  termId="MAD"
                  audience="patient"
                  theme="dark"
                  showIcon={false}
                  className="text-slate-200 hover:text-[#84F5E8] font-semibold"
                >
                  MAD
                </ClinicalTermTooltip>
                ,{' '}
                <ClinicalTermTooltip
                  termId="RMSE"
                  audience="patient"
                  theme="dark"
                  showIcon={false}
                  className="text-slate-200 hover:text-[#84F5E8] font-semibold"
                >
                  RMSE
                </ClinicalTermTooltip>
                ,{' '}
                <ClinicalTermTooltip
                  termId="DTW"
                  audience="patient"
                  theme="dark"
                  showIcon={false}
                  className="text-slate-200 hover:text-[#84F5E8] font-semibold"
                >
                  DTW
                </ClinicalTermTooltip>
                ).
              </p>
              <p className="text-[11px] text-[#8AE2D6]/90 mt-1">
                Pasa el cursor o toca cualquier métrica (?) para saber qué es y para qué sirve.
              </p>
            </div>

            {/* Cognito persistence badge */}
            {(isCognitoSession || sessionHadCognitoRef.current) && (
              <div className="bg-white/10 border border-white/15 rounded-xl px-4 py-3 text-xs flex flex-col items-center justify-center gap-2">
                {renderCognitoSyncStatus()}
              </div>
            )}

            {/* Gamification & Clinical Achievements Banner */}
            <div className="bg-gradient-to-r from-[#26A69A]/20 via-amber-500/15 to-[#38BDF8]/20 border border-amber-400/35 rounded-xl p-3.5 text-left space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center space-x-1.5 text-xs font-bold text-amber-300">
                  <Trophy size={15} className="text-amber-400" />
                  <span>Recompensas de Neuro-Rehabilitación</span>
                </div>
                <div className="flex items-center space-x-3 text-xs font-bold">
                  <span className="flex items-center space-x-1 bg-black/35 px-2.5 py-1 rounded-lg text-amber-300">
                    <Sparkles size={13} />
                    <span>{moduleSummary.gamifiedPoints} pts</span>
                  </span>
                  <span className="flex items-center space-x-1 bg-black/35 px-2.5 py-1 rounded-lg text-orange-300">
                    <Flame size={13} />
                    <span>Racha Máx x{moduleSummary.maxStreak}</span>
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {report.fixationStability >= 70 && (
                  <span className="text-[11px] font-semibold bg-[#26A69A]/30 border border-[#8AE2D6]/40 text-[#8AE2D6] px-2.5 py-0.5 rounded-full">
                    🏅 Estabilidad Foveal ({report.fixationStability}%)
                  </span>
                )}
                {moduleSummary.maxStreak >= 3 && (
                  <span className="text-[11px] font-semibold bg-amber-500/25 border border-amber-400/40 text-amber-200 px-2.5 py-0.5 rounded-full">
                    🔥 Racha Imparable (x{moduleSummary.maxStreak})
                  </span>
                )}
                {report.meanSaccadicLatencyMs > 0 && report.meanSaccadicLatencyMs <= 450 && (
                  <span className="text-[11px] font-semibold bg-sky-500/25 border border-sky-400/40 text-sky-200 px-2.5 py-0.5 rounded-full">
                    ⚡ Reflejo Sacádico ({report.meanSaccadicLatencyMs} ms)
                  </span>
                )}
                {resolvedMode === 'TARGET_SEARCH_WITH_DISTRACTORS' &&
                  moduleSummary.falseFixations === 0 &&
                  moduleSummary.successfulTrials > 0 && (
                    <span className="text-[11px] font-semibold bg-emerald-500/25 border border-emerald-400/40 text-emerald-200 px-2.5 py-0.5 rounded-full">
                      🎯 Discriminación Selectiva Perfecta
                    </span>
                  )}
                {resolvedMode === 'SYSTEMATIC_EXPLORATION' &&
                  moduleSummary.quadrantCoveragePercent >= 90 && (
                    <span className="text-[11px] font-semibold bg-purple-500/25 border border-purple-400/40 text-purple-200 px-2.5 py-0.5 rounded-full">
                      🧭 Explorador de 4 Cuadrantes ({moduleSummary.quadrantCoveragePercent}%)
                    </span>
                  )}
              </div>
            </div>

            {/* Module-Specific Clinical Trial Summary (PRODUCER_REPORTED) */}
            <div className="bg-white/10 border border-[#26A69A]/35 rounded-xl p-3.5 text-left space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-[#8AE2D6]">
                <span>Resultados del Módulo ({resolvedMode})</span>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`font-mono text-[10px] px-2 py-0.5 rounded ${
                      moduleSummary.inputOrigin === 'WEBCAM_GAZE'
                        ? 'bg-[#26A69A]/30 text-[#8AE2D6] border border-[#26A69A]/50'
                        : moduleSummary.inputOrigin === 'NONE'
                        ? 'bg-neutral-500/25 text-neutral-200 border border-neutral-400/40'
                        : 'bg-amber-500/25 text-amber-200 border border-amber-400/40'
                    }`}
                  >
                    {moduleSummary.inputOrigin === 'WEBCAM_GAZE'
                      ? 'ORIGEN: MIRADA WEBCAM (100%)'
                      : moduleSummary.inputOrigin === 'MIXED'
                      ? `ORIGEN: MIXTO (${moduleSummary.webcamSamplePercent}% WEBCAM)`
                      : moduleSummary.inputOrigin === 'NONE'
                      ? 'ORIGEN: SIN MUESTRAS OCULARES (0)'
                      : 'ORIGEN: CONTINGENCIA RATÓN'}
                  </span>
                  <span className="font-mono text-[10px] bg-black/30 px-2 py-0.5 rounded">
                    {moduleSummary.reportedDataOrigin}
                  </span>
                  <ClinicalTermTooltip
                    termId="INPUT_ORIGIN"
                    audience="patient"
                    theme="dark"
                    ariaLabel="Qué significa el origen de los datos de esta sesión"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="bg-black/25 rounded-lg p-2">
                  <div className="text-[10px] text-slate-200">
                    <ClinicalTermTooltip termId="TRIAL_SUCCESS_OMISSIONS" audience="patient" theme="dark" iconSize={11}>
                      Ensayos Exitosos
                    </ClinicalTermTooltip>
                  </div>
                  <div className="text-base font-bold text-[#8AE2D6]">
                    {moduleSummary.successfulTrials}
                  </div>
                </div>
                <div className="bg-black/25 rounded-lg p-2">
                  <div className="text-[10px] text-slate-200">
                    <ClinicalTermTooltip termId="TRIAL_SUCCESS_OMISSIONS" audience="patient" theme="dark" iconSize={11}>
                      Omisiones / Timeout
                    </ClinicalTermTooltip>
                  </div>
                  <div className="text-base font-bold text-amber-300">
                    {moduleSummary.timedOutTrials}
                  </div>
                </div>
                <div className="bg-black/25 rounded-lg p-2">
                  <div className="text-[10px] text-slate-200">
                    <ClinicalTermTooltip termId="MEDIAN_DURATION" audience="patient" theme="dark" iconSize={11}>
                      Mediana Localiz./Búsq.
                    </ClinicalTermTooltip>
                  </div>
                  <div className="text-base font-bold text-white">
                    {moduleSummary.medianDurationMs !== null
                      ? `${moduleSummary.medianDurationMs} ms`
                      : 'N/A'}
                  </div>
                </div>
                <div className="bg-black/25 rounded-lg p-2">
                  <div className="text-[10px] text-slate-200">
                    <ClinicalTermTooltip
                      termId={
                        resolvedMode === 'SYSTEMATIC_EXPLORATION'
                          ? 'QUADRANT_COVERAGE'
                          : resolvedMode === 'SUSTAINED_TARGET_FIXATION'
                          ? 'FOVEAL_FIXATION'
                          : 'FALSE_FIXATIONS'
                      }
                      audience="patient"
                      theme="dark"
                      iconSize={11}
                    >
                      {resolvedMode === 'SYSTEMATIC_EXPLORATION'
                        ? 'Cobertura Cuadrantes'
                        : resolvedMode === 'SUSTAINED_TARGET_FIXATION'
                        ? 'Fijación Continua Máx'
                        : 'Falsas Fijaciones'}
                    </ClinicalTermTooltip>
                  </div>
                  <div className="text-base font-bold text-white">
                    {resolvedMode === 'SYSTEMATIC_EXPLORATION'
                      ? `${moduleSummary.quadrantCoveragePercent}%`
                      : resolvedMode === 'SUSTAINED_TARGET_FIXATION'
                      ? `${moduleSummary.maxContinuousFixationMs} ms`
                      : moduleSummary.falseFixations}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-left">
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <div className="flex items-center text-secondary text-xs font-semibold mb-1">
                  <CheckCircle size={14} className="mr-1 shrink-0" />
                  <ClinicalTermTooltip termId="GLOBAL_ACCURACY" audience="patient" theme="dark">
                    Precisión Global
                  </ClinicalTermTooltip>
                </div>
                <div className="text-2xl font-bold text-white">{report.accuracyScore}%</div>
                <div className="text-[10px] text-slate-300 mt-0.5">
                  <ClinicalTermTooltip termId="BCEA" audience="patient" theme="dark" iconSize={11}>
                    BCEA 68% est. (webcam escritorio)
                  </ClinicalTermTooltip>
                  : {report.bceaDeg2} deg²
                </div>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <div className="flex items-center text-tertiary text-xs font-semibold mb-1">
                  <Activity size={14} className="mr-1 shrink-0" />
                  <ClinicalTermTooltip termId="MAD_RMSE" audience="patient" theme="dark">
                    Error MAD / RMSE
                  </ClinicalTermTooltip>
                </div>
                <div className="text-xl font-bold text-white">
                  {report.madPixels} / {report.rmsePixels} px
                </div>
                <div className="text-[10px] text-slate-300 mt-0.5">
                  {(report.madNormalized * 100).toFixed(1)}% desv. media
                </div>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <div className="flex items-center text-blue-400 text-xs font-semibold mb-1">
                  <Activity size={14} className="mr-1 shrink-0" />
                  <ClinicalTermTooltip termId="SACCADIC_GAIN" audience="patient" theme="dark">
                    Ganancia Sacádica
                  </ClinicalTermTooltip>
                </div>
                <div className="text-xl font-bold text-white">{report.saccadicGain}</div>
                <div className="text-[10px] text-slate-300 mt-0.5">
                  <ClinicalTermTooltip termId="SACCADIC_LATENCY" audience="patient" theme="dark" iconSize={11}>
                    Latencia
                  </ClinicalTermTooltip>
                  : {report.meanSaccadicLatencyMs} ms
                </div>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <div className="flex items-center text-purple-400 text-xs font-semibold mb-1">
                  <Activity size={14} className="mr-1 shrink-0" />
                  <ClinicalTermTooltip termId="DTW" audience="patient" theme="dark">
                    DTW Score
                  </ClinicalTermTooltip>
                </div>
                <div className="text-xl font-bold text-white">
                  {(report.dtwDistance * 100).toFixed(1)}
                </div>
                <div className="text-[10px] text-slate-300 mt-0.5">Fidelidad morfológica</div>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <div className="flex items-center text-green-400 text-xs font-semibold mb-1">
                  <CheckCircle size={14} className="mr-1 shrink-0" />
                  <ClinicalTermTooltip termId="FOVEAL_FIXATION" audience="patient" theme="dark">
                    Fijación Foveal
                  </ClinicalTermTooltip>
                </div>
                <div className="text-xl font-bold text-white">{report.fixationStability}%</div>
                <div className="text-[10px] text-slate-300 mt-0.5">
                  Izq {report.leftHemifieldRatio}% · Der {report.rightHemifieldRatio}%
                </div>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <div className="flex items-center text-yellow-400 text-xs font-semibold mb-1">
                  <Clock size={14} className="mr-1 shrink-0" />
                  <ClinicalTermTooltip termId="SESSION_DURATION_SAMPLES" audience="patient" theme="dark">
                    Duración
                  </ClinicalTermTooltip>
                </div>
                <div className="text-xl font-bold text-white">
                  {(report.durationMs / 1000).toFixed(1)} s
                </div>
                <div className="text-[10px] text-slate-300 mt-0.5">{report.totalSamples} muestras</div>
              </div>
            </div>

            {pendingExitIntent && pendingWorkSnapshot.hasPendingCriticalWork && (
              <div className="bg-amber-950/60 border border-amber-400/50 rounded-xl p-3 text-left text-xs space-y-2">
                <div className="font-bold text-amber-300">
                  Confirmar salida con datos pendientes o cierre incierto en memoria
                </div>
                <p className="text-[11px] text-amber-100/85 leading-relaxed">
                  Pendientes: lotes=
                  {pendingWorkSnapshot.pendingTelemetryBatches +
                    pendingWorkSnapshot.inFlightTelemetryBatches}
                  , búfer={pendingWorkSnapshot.bufferedTelemetrySamples}, ensayos=
                  {pendingWorkSnapshot.pendingTrials +
                    pendingWorkSnapshot.uncertainTrials +
                    pendingWorkSnapshot.inFlightTrials}
                  {pendingWorkSnapshot.hasUncertainClosure
                    ? ', cierre clínico pendiente de comprobante'
                    : ''}
                  . Los pendientes en memoria no sobreviven recargas ni se reasignan a otra sesión o paciente.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setPendingExitIntent(null)}
                    className="px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white font-semibold cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const intent = pendingExitIntent;
                      setPendingExitIntent(null);
                      if (intent === 'NEW_SESSION') {
                        if (onRequestNewSession) {
                          onRequestNewSession();
                        } else {
                          navigate('/patient/dashboard');
                        }
                      } else {
                        navigate('/patient/dashboard');
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-[#071524] font-bold cursor-pointer"
                  >
                    Descartar pendientes y continuar
                  </button>
                </div>
              </div>
            )}

            <div className="flex space-x-4">
              {isCognitoSession || sessionHadCognitoRef.current ? (
                <button
                  onClick={() => {
                    if (pendingWorkSnapshot.hasPendingCriticalWork) {
                      setPendingExitIntent('NEW_SESSION');
                    } else if (onRequestNewSession) {
                      onRequestNewSession();
                    } else {
                      navigate('/patient/dashboard');
                    }
                  }}
                  className="flex-1 py-3 bg-white/10 hover:bg-white/20 rounded-xl font-bold flex items-center justify-center space-x-2 transition-all border border-white/20 cursor-pointer"
                >
                  <RotateCcw size={18} />
                  <span>Nueva Sesión</span>
                </button>
              ) : (
                <button
                  onClick={() => onPhaseChange('TUTORIAL_CALIBRATION')}
                  className="flex-1 py-3 bg-white/10 hover:bg-white/20 rounded-xl font-bold flex items-center justify-center space-x-2 transition-all border border-white/20 cursor-pointer"
                >
                  <RotateCcw size={18} />
                  <span>Repetir</span>
                </button>
              )}

              <button
                onClick={() => {
                  if (pendingWorkSnapshot.hasPendingCriticalWork) {
                    setPendingExitIntent('DASHBOARD');
                  } else {
                    navigate('/patient/dashboard');
                  }
                }}
                className="flex-1 py-3 bg-secondary hover:bg-secondary/80 rounded-xl font-bold flex items-center justify-center space-x-2 transition-all shadow-lg cursor-pointer"
              >
                <ArrowLeft size={18} />
                <span>Ir al Dashboard</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
