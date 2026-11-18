import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  MousePointer2,
  Play,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { useWebcam } from '../../../../infrastructure/cv/hooks/useWebcam';
import { useMediaPipeWorker } from '../../../../infrastructure/cv/hooks/useMediaPipeWorker';
import { useGazeSmoother } from '../../../../infrastructure/cv/hooks/useGazeSmoother';
import { useAppStore } from '../../../../core/store/useAppStore';
import { useCalibrationStore } from '../../../../core/store/useCalibrationStore';
import {
  computeFusedEyeSignals,
  initializeTrackingState,
  predictGazePoint,
} from '../../../../infrastructure/cv/math/zhangYinModel';
import { EyeTrackingGameCanvas } from '../components/EyeTrackingGameCanvas';
import { CalibrationOverlay } from '../components/CalibrationOverlay';
import { PreCalibrationView } from '../components/PreCalibrationView';
import type {
  FrozenClinicalExerciseParameters,
  MedicalPrescription,
} from '../../../../core/domain/Prescription';
import {
  ApiError,
  clinicalApi,
  createUuid,
  extractApiErrorMessage,
  type PatientEffectiveConfiguration,
  type PatientSessionProgressResponse,
  type PatientTherapyPlanResponse,
  type PatientTherapySessionResponse,
  type ReportMode,
  type TherapyCompletionTarget,
  type TherapyExerciseCode,
  type VersionedConfiguration,
} from '../../../../infrastructure/api';

interface ModeOptionMeta {
  mode: ReportMode;
  exerciseCode: TherapyExerciseCode;
  label: string;
  shortDesc: string;
}

const ALL_GAME_MODES: ModeOptionMeta[] = [
  {
    mode: 'STANDARD_SCANNING',
    exerciseCode: 'visual-scanning',
    label: 'Escaneo Estándar',
    shortDesc: 'Estímulos periféricos en hemicampo afectado.',
  },
  {
    mode: 'SYSTEMATIC_EXPLORATION',
    exerciseCode: 'visual-scanning',
    label: 'Exploración Sistemática',
    shortDesc: 'Recorrido ordenado por filas y cuadrantes.',
  },
  {
    mode: 'COMPENSATORY_SACCADE',
    exerciseCode: 'visual-scanning',
    label: 'Sacadas Compensatorias',
    shortDesc: 'Ancla central con salto sacádico periférico.',
  },
  {
    mode: 'TARGET_SEARCH_WITH_DISTRACTORS',
    exerciseCode: 'visual-search',
    label: 'Búsqueda con Distractores',
    shortDesc: 'Objetivos entre distractores con sesgo de hemicampo.',
  },
  {
    mode: 'SUSTAINED_TARGET_FIXATION',
    exerciseCode: 'fixation',
    label: 'Fijación Sostenida',
    shortDesc: 'Fijación foveal continua con pausas de descanso.',
  },
];

function extractVersionedParameters(config: VersionedConfiguration): {
  parameters: FrozenClinicalExerciseParameters;
  completionTarget?: TherapyCompletionTarget;
} {
  if (config.parameterSchemaVersion === 2) {
    return {
      parameters: config.parameters.parameters,
      completionTarget: config.parameters.completionTarget,
    };
  }
  return {
    parameters: config.parameters,
    completionTarget: undefined,
  };
}

function buildPrescriptionFromSession(
  session: PatientTherapySessionResponse,
  patientId: string
): MedicalPrescription {
  const { parameters: frozenParams, completionTarget } = extractVersionedParameters(session);
  const eccentricity =
    'eccentricityDegrees' in frozenParams ? frozenParams.eccentricityDegrees : 35;
  const visualFieldAmplitude = Math.max(0.45, Math.min(1.0, eccentricity / 45));
  const difficulty = frozenParams.difficultyLevel ?? 1;

  return {
    prescriptionId: session.therapyPlanId,
    patientId,
    gameId: session.exerciseCode,
    parameters: {
      target_speed: Math.max(0.6, Math.min(2.2, 0.7 + difficulty * 0.25)),
      visual_field_amplitude: visualFieldAmplitude,
      min_fixation_time: frozenParams.minimumFixationMs,
    },
    clinicalContext: {
      therapyPlanId: session.therapyPlanId,
      therapySessionId: session.therapySessionId,
      exerciseCode: session.exerciseCode,
      mode: frozenParams.mode,
      configurationId: session.configurationId,
      configurationVersion: session.configurationVersion,
      parameterSchemaVersion: session.parameterSchemaVersion,
      frozenParameters: frozenParams,
      completionTarget,
      sessionLimits: {
        minimumValidDurationMinutes: session.minimumValidDurationMinutes,
        maximumSessionDurationMinutes: session.maximumSessionDurationMinutes,
        minimumValidSampleCount: session.minimumValidSampleCount,
      },
    },
  };
}

function buildDemoParametersForMode(
  mode: ReportMode,
  baseFixationMs: number
): FrozenClinicalExerciseParameters {
  const safeScanningFixation = Math.max(300, Math.min(2000, baseFixationMs));
  const safeFixationHold = Math.max(300, Math.min(3000, Math.max(1200, baseFixationMs)));
  switch (mode) {
    case 'STANDARD_SCANNING':
    case 'SYSTEMATIC_EXPLORATION':
    case 'COMPENSATORY_SACCADE':
      return {
        mode,
        affectedHemifield: 'LEFT',
        minimumFixationMs: safeScanningFixation,
        maximumStimulusDurationMs: mode === 'SYSTEMATIC_EXPLORATION' ? 9000 : 6000,
        eccentricityDegrees: 20,
        targetSizePx: 68,
        repetitions: 8,
        interStimulusIntervalMs: 750,
        difficultyLevel: 2,
      };
    case 'TARGET_SEARCH_WITH_DISTRACTORS':
      return {
        mode: 'TARGET_SEARCH_WITH_DISTRACTORS',
        affectedHemifield: 'LEFT',
        targetCount: 8,
        distractorCount: 6,
        minimumFixationMs: safeScanningFixation,
        maximumSearchTimeMs: 12000,
        affectedHemifieldBias: 0.75,
        targetSizePx: 64,
        difficultyLevel: 2,
      };
    case 'SUSTAINED_TARGET_FIXATION':
      return {
        mode: 'SUSTAINED_TARGET_FIXATION',
        targetPosition: 'LEFT',
        minimumFixationMs: safeFixationHold,
        maximumFixationMs: Math.min(5000, Math.max(safeFixationHold + 1000, safeFixationHold * 2)),
        targetSizePx: 72,
        repetitions: 6,
        restBetweenRepetitionsMs: 1200,
        difficultyLevel: 2,
      };
  }
}

export const SeriousGamesPage: React.FC = () => {
  const navigate = useNavigate();
  const { videoRef, attachVideoElement, startWebcam, stopWebcam, isStreaming, error } = useWebcam();
  const { smooth } = useGazeSmoother(0.05, 0.9, 0.08);
  const gazeRef = useRef({ x: 0.5, y: 0.5 });
  const gazeConfidenceRef = useRef<number>(0.85);
  const frameRequestRef = useRef<number>(0);
  const debugRef = useRef<HTMLPreElement>(null);

  const authMode = useAppStore((state) => state.authMode);
  const accessToken = useAppStore((state) => state.accessToken);
  const userProfile = useAppStore((state) => state.userProfile);
  const activeClinicalSession = useAppStore((state) => state.activeClinicalSession);
  const setActiveClinicalSession = useAppStore((state) => state.setActiveClinicalSession);
  const currentPrescription = useAppStore((state) => state.currentPrescription);
  const setPrescription = useAppStore((state) => state.setPrescription);
  const gamePhase = useAppStore((state) => state.gamePhase);
  const setGamePhase = useAppStore((state) => state.setGamePhase);

  const isCognitoMode = authMode === 'COGNITO' && Boolean(accessToken);

  const { calibrationData, addSample, isPreCalibrating, startCalibration } = useCalibrationStore();
  const [heatmapPos, setHeatmapPos] = useState({ x: 0.5, y: 0.5 });
  const rawMetricsRef = useRef<any>(null);
  const pipCanvasRef = useRef<HTMLCanvasElement>(null);

  // Clinical session & mode controls
  const [plans, setPlans] = useState<PatientTherapyPlanResponse[]>([]);
  const [loadingClinical, setLoadingClinical] = useState(false);
  const [clinicalError, setClinicalError] = useState<string | null>(null);
  const [startingSessionKey, setStartingSessionKey] = useState<string | null>(null);
  const [sessionProgress, setSessionProgress] = useState<PatientSessionProgressResponse | null>(null);
  const [mouseFallbackEnabled, setMouseFallbackEnabled] = useState(false);
  const [expiredSession, setExpiredSession] = useState<PatientTherapySessionResponse | null>(null);

  const prescribedMode: ReportMode | null = useMemo(() => {
    if (activeClinicalSession) {
      return extractVersionedParameters(activeClinicalSession).parameters.mode;
    }
    return currentPrescription?.clinicalContext?.mode ?? null;
  }, [activeClinicalSession, currentPrescription]);

  const [selectedMode, setSelectedMode] = useState<ReportMode>(
    prescribedMode ?? 'STANDARD_SCANNING'
  );

  useEffect(() => {
    if (prescribedMode) {
      setSelectedMode(prescribedMode);
    }
  }, [prescribedMode]);

  const loadClinicalSessionAndPlans = useCallback(async () => {
    if (!isCognitoMode) return;
    setLoadingClinical(true);
    setClinicalError(null);
    try {
      const [currentRes, plansRes] = await Promise.allSettled([
        clinicalApi.getCurrentSession(),
        clinicalApi.listMyTherapyPlans(),
      ]);

      if (plansRes.status === 'fulfilled') {
        setPlans(plansRes.value);
      } else if (!(plansRes.reason instanceof ApiError && plansRes.reason.status === 403)) {
        setClinicalError(extractApiErrorMessage(plansRes.reason));
      }

      if (currentRes.status === 'fulfilled') {
        const cur = currentRes.value;
        if (cur.state === 'ACTIVE' && cur.session) {
          setExpiredSession(null);
          setActiveClinicalSession(cur.session);
          setPrescription(
            buildPrescriptionFromSession(cur.session, userProfile?.id || 'patient')
          );
          try {
            const prog = await clinicalApi.getSessionProgress(cur.session.therapySessionId);
            setSessionProgress(prog);
          } catch {
            setSessionProgress(null);
          }
        } else if (cur.state === 'EXPIRED' && cur.session) {
          setExpiredSession(cur.session);
          setActiveClinicalSession(null);
          setSessionProgress(null);
        } else {
          setExpiredSession(null);
          setActiveClinicalSession(null);
          setSessionProgress(null);
        }
      } else if (!(currentRes.reason instanceof ApiError && currentRes.reason.status === 403)) {
        setClinicalError(extractApiErrorMessage(currentRes.reason));
      }
    } finally {
      setLoadingClinical(false);
    }
  }, [isCognitoMode, setActiveClinicalSession, setPrescription, userProfile?.id]);

  useEffect(() => {
    if (isCognitoMode) {
      void loadClinicalSessionAndPlans();
    }
  }, [isCognitoMode, loadClinicalSessionAndPlans]);

  // Keep sessionProgress fresh while active session exists
  useEffect(() => {
    if (!isCognitoMode || !activeClinicalSession) return;
    let cancelled = false;
    const fetchProgress = async () => {
      try {
        const prog = await clinicalApi.getSessionProgress(
          activeClinicalSession.therapySessionId
        );
        if (!cancelled) {
          setSessionProgress(prog);
        }
      } catch {
        // Ignore transient poll errors; EyeTrackingGameCanvas handles event retries
      }
    };
    void fetchProgress();
    return () => {
      cancelled = true;
    };
  }, [isCognitoMode, activeClinicalSession]);

  const handleStartSessionFromPlan = async (
    plan: PatientTherapyPlanResponse,
    cfg: PatientEffectiveConfiguration
  ) => {
    const key = `${plan.therapyPlanId}:${cfg.exerciseCode}`;
    setStartingSessionKey(key);
    setClinicalError(null);
    try {
      const session = await clinicalApi.startTherapySession(
        plan.therapyPlanId,
        { exerciseCode: cfg.exerciseCode },
        createUuid()
      );
      setExpiredSession(null);
      setActiveClinicalSession(session);
      setPrescription(buildPrescriptionFromSession(session, userProfile?.id || 'patient'));
      const prog = await clinicalApi.getSessionProgress(session.therapySessionId);
      setSessionProgress(prog);
    } catch (err) {
      setClinicalError(`No se pudo iniciar la sesión: ${extractApiErrorMessage(err)}`);
    } finally {
      setStartingSessionKey(null);
    }
  };

  const handleCloseExpiredSession = async () => {
    if (!expiredSession) return;
    setLoadingClinical(true);
    setClinicalError(null);
    try {
      // Per `clinical/integration.md` (lines 120, 140) & `StartTherapySessionCommandService.java`:
      // An EXPIRED session cannot be closed via PUT /completion (which requires a live lease).
      // Instead, starting a new session via POST /sessions automatically reconciles and expires the old lease.
      const freshSession = await clinicalApi.startTherapySession(
        expiredSession.therapyPlanId,
        { exerciseCode: expiredSession.exerciseCode },
        createUuid()
      );
      setExpiredSession(null);
      setActiveClinicalSession(freshSession);
      setPrescription(buildPrescriptionFromSession(freshSession, userProfile?.id || 'patient'));
      const prog = await clinicalApi.getSessionProgress(freshSession.therapySessionId);
      setSessionProgress(prog);
      await loadClinicalSessionAndPlans();
    } catch (err) {
      setClinicalError(`No se pudo reemplazar la sesión expirada: ${extractApiErrorMessage(err)}`);
    } finally {
      setLoadingClinical(false);
    }
  };

  const handleResumeDirectlyToMainGame = () => {
    if (!calibrationData && !mouseFallbackEnabled) {
      setMouseFallbackEnabled(true);
    }
    useCalibrationStore.setState({
      isPreCalibrating: false,
      isCalibrating: false,
    });
    setGamePhase('MAIN_GAME');
  };

  const handleStartMouseFallbackDirect = () => {
    setMouseFallbackEnabled(true);
    useCalibrationStore.setState({
      isPreCalibrating: false,
      isCalibrating: false,
    });
    // If resuming an already-started clinical session, jump straight to MAIN_GAME
    if (isCognitoMode && activeClinicalSession && sessionProgress && sessionProgress.activityState !== 'NEW') {
      setGamePhase('MAIN_GAME');
    } else {
      setGamePhase('TUTORIAL_CALIBRATION');
    }
  };

  // Effective prescription passed to EyeTrackingGameCanvas (always preserves clinicalContext when in Cognito mode)
  const effectivePrescription: MedicalPrescription = useMemo(() => {
    if (activeClinicalSession) {
      return buildPrescriptionFromSession(activeClinicalSession, userProfile?.id || 'patient');
    }

    const base: MedicalPrescription = currentPrescription || {
      prescriptionId: 'demo',
      patientId: 'demo',
      gameId: 'demo',
      parameters: {
        target_speed: 1.0,
        visual_field_amplitude: 0.9,
        min_fixation_time: 1000,
      },
    };

    const modeMeta = ALL_GAME_MODES.find((m) => m.mode === selectedMode) ?? ALL_GAME_MODES[0];
    const hasSameModeFrozen =
      base.clinicalContext?.mode === selectedMode && base.clinicalContext?.frozenParameters;

    return {
      ...base,
      gameId: modeMeta.exerciseCode,
      clinicalContext: {
        therapyPlanId: base.clinicalContext?.therapyPlanId || 'demo-plan',
        therapySessionId: base.clinicalContext?.therapySessionId,
        exerciseCode: modeMeta.exerciseCode,
        mode: selectedMode,
        configurationId: base.clinicalContext?.configurationId,
        configurationVersion: base.clinicalContext?.configurationVersion,
        parameterSchemaVersion: base.clinicalContext?.parameterSchemaVersion,
        frozenParameters: hasSameModeFrozen
          ? base.clinicalContext!.frozenParameters
          : buildDemoParametersForMode(selectedMode, base.parameters.min_fixation_time),
        completionTarget: base.clinicalContext?.completionTarget,
        sessionLimits: base.clinicalContext?.sessionLimits,
      },
    };
  }, [activeClinicalSession, currentPrescription, selectedMode, userProfile?.id]);

  // 1. Recepción de Coordenadas desde el Worker Cefálico
  const handleWorkerResults = useCallback(
    (results: any) => {
      if (results && results.rawMetrics) {
        rawMetricsRef.current = results.rawMetrics;
      }

      if (pipCanvasRef.current && results && results.rawMetrics) {
        const ctx = pipCanvasRef.current.getContext('2d');
        if (ctx) {
          const { width, height } = pipCanvasRef.current;
          ctx.clearRect(0, 0, width, height);

          const drawPoint = (p: { x: number; y: number }, color: string, radius = 2) => {
            ctx.beginPath();
            ctx.arc(p.x * width, p.y * height, radius, 0, 2 * Math.PI);
            ctx.fillStyle = color;
            ctx.fill();
          };

          const metrics = results.rawMetrics;
          drawPoint(metrics.pupilL, '#26A69A', 3.5);
          drawPoint(metrics.pupilR, '#26A69A', 3.5);
          drawPoint(metrics.corners.LI, '#8AE2D6', 2);
          drawPoint(metrics.corners.LO, '#8AE2D6', 2);
          drawPoint(metrics.corners.RI, '#8AE2D6', 2);
          drawPoint(metrics.corners.RO, '#8AE2D6', 2);
        }
      } else if (pipCanvasRef.current) {
        const ctx = pipCanvasRef.current.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, pipCanvasRef.current.width, pipCanvasRef.current.height);
      }

      if (useAppStore.getState().gamePhase === 'CALIBRATION') {
        if (results && results.rawMetrics) {
          const isBlinking = results.rawMetrics.ear?.isBlinking;

          if (!isBlinking) {
            addSample(results.rawMetrics);
          }

          const fused = computeFusedEyeSignals(results.rawMetrics);
          const rawX = 0.5 - fused.uFused * 4.2;
          const rawY = 0.5 + fused.vFused * 5.2;

          if (!isBlinking) {
            const smoothedPreview = smooth({
              x: Math.max(0, Math.min(1, rawX)),
              y: Math.max(0, Math.min(1, rawY)),
            });
            setHeatmapPos(smoothedPreview);
          }

          if (debugRef.current) {
            debugRef.current.innerText = `STATUS: CALIBRANDO... ${
              isBlinking ? '👁️ [PARPADEO DETECTADO - Muestra omitida]' : ''
            }
Rostro: Detectado (Landmarks: ${results.landmarkCount || 0})
EAR: ${results.rawMetrics.ear ? results.rawMetrics.ear.avg.toFixed(3) : 'N/A'}
Yaw: ${(results.rawMetrics.headPose.yaw * (180 / Math.PI)).toFixed(1)}° | Pitch: ${(
              results.rawMetrics.headPose.pitch *
              (180 / Math.PI)
            ).toFixed(1)}°`;
          }
        } else if (results && results.rawResultsAvailable) {
          if (debugRef.current) {
            debugRef.current.innerText = `STATUS: ROSTRO DETECTADO (Esperando pupilas)...`;
          }
        }
        return;
      }

      if (calibrationData && results && results.rawMetrics) {
        if (results.rawMetrics.ear?.isBlinking) {
          gazeConfidenceRef.current = 0.25;
          return;
        }

        const predictedGaze = predictGazePoint(results.rawMetrics, calibrationData);
        const smoothed = smooth(predictedGaze);
        gazeRef.current = smoothed;

        const r2xRaw = calibrationData.leftModel?.r2X ?? 0.9;
        const r2yRaw = calibrationData.leftModel?.r2Y ?? 0.9;
        const avgR2 = Math.max(0.35, Math.min(1, (r2xRaw + r2yRaw) / 2));
        gazeConfidenceRef.current = Number(avgR2.toFixed(3));

        if (debugRef.current) {
          const r2X = calibrationData.leftModel?.r2X
            ? (calibrationData.leftModel.r2X * 100).toFixed(0)
            : 'N/A';
          const r2Y = calibrationData.leftModel?.r2Y
            ? (calibrationData.leftModel.r2Y * 100).toFixed(0)
            : 'N/A';

          debugRef.current.innerText = `STATUS: TRACKING ACTIVO (9 Pts OLS + Z-Recalib)
Fidelidad Calibración: R² X: ${r2X}% | R² Y: ${r2Y}%
EAR: ${results.rawMetrics.ear ? results.rawMetrics.ear.avg.toFixed(3) : 'N/A'}
Yaw: ${(results.rawMetrics.headPose.yaw * (180 / Math.PI)).toFixed(1)}° | Pitch: ${(
            results.rawMetrics.headPose.pitch *
            (180 / Math.PI)
          ).toFixed(1)}°
Gaze X: ${predictedGaze.x.toFixed(3)} | Y: ${predictedGaze.y.toFixed(3)}`;
        }
      } else if (!results?.rawMetrics) {
        gazeConfidenceRef.current = 0.0;
      }
    },
    [smooth, calibrationData, addSample]
  );

  const { processVideoFrame, isReady, isLoaded } = useMediaPipeWorker(handleWorkerResults);

  // 2. Bucle de Captura del Video
  const captureLoop = useCallback(() => {
    if (videoRef.current && isStreaming && isReady()) {
      processVideoFrame(videoRef.current, performance.now());
    }
    frameRequestRef.current = requestAnimationFrame(captureLoop);
  }, [isStreaming, isReady, processVideoFrame, videoRef]);

  useEffect(() => {
    if (calibrationData) {
      initializeTrackingState(calibrationData);
    }
  }, [calibrationData]);

  useEffect(() => {
    useCalibrationStore.getState().startPreCalibration();
    startWebcam();
    setGamePhase('CALIBRATION');
  }, [startWebcam, setGamePhase]);

  useEffect(() => {
    if (isStreaming) {
      frameRequestRef.current = requestAnimationFrame(captureLoop);
    }
    return () => {
      if (frameRequestRef.current) cancelAnimationFrame(frameRequestRef.current);
    };
  }, [isStreaming, captureLoop]);

  const activeModeMeta =
    ALL_GAME_MODES.find((m) => m.mode === selectedMode) ?? ALL_GAME_MODES[0];

  const handleSessionCompleted = useCallback(
    (finalProgress: PatientSessionProgressResponse | null) => {
      if (finalProgress) {
        setSessionProgress(finalProgress);
      }
      setActiveClinicalSession(null);
      if (isCognitoMode) {
        void clinicalApi
          .listMyTherapyPlans()
          .then(setPlans)
          .catch(() => undefined);
      }
    },
    [isCognitoMode, setActiveClinicalSession]
  );

  const handleRequestNewSession = useCallback(() => {
    setActiveClinicalSession(null);
    setSessionProgress(null);
    useCalibrationStore.getState().startPreCalibration();
    setGamePhase('CALIBRATION');
    if (isCognitoMode) {
      void loadClinicalSessionAndPlans();
    }
  }, [isCognitoMode, loadClinicalSessionAndPlans, setActiveClinicalSession, setGamePhase]);

  const renderProgressPill = () => {
    if (!isCognitoMode || !activeClinicalSession) return null;
    const progressText = sessionProgress
      ? sessionProgress.criterion === 'REPETITIONS'
        ? `${sessionProgress.completedRepetitions}/${sessionProgress.target} reps`
        : `${Math.round(sessionProgress.activeMilliseconds / 1000)}/${sessionProgress.target}s`
      : 'Sincronizando...';

    return (
      <div className="flex flex-wrap items-center gap-2 bg-[#132230]/90 border border-[#26A69A]/40 px-3 py-1.5 rounded-xl text-xs">
        <Activity size={14} className="text-[#26A69A]" />
        <span className="font-bold text-white">{activeClinicalSession.exerciseCode}</span>
        <span className="text-white/50">|</span>
        <span className="font-mono text-[#8AE2D6]">
          {activeClinicalSession.therapySessionId.slice(0, 8)}
        </span>
        <span className="text-white/50">|</span>
        <span className="font-semibold text-white">{progressText}</span>
        {sessionProgress && (
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
              sessionProgress.targetReached
                ? 'bg-[#26A69A] text-[#0E1722]'
                : 'bg-white/10 text-[#8AE2D6]'
            }`}
          >
            {sessionProgress.activityState}
          </span>
        )}
      </div>
    );
  };

  return (
    <div
      className={`min-h-screen ${
        isPreCalibrating ? 'bg-[#F3FAFF] text-[#1C2A39] p-6 lg:p-10' : 'bg-[#000000] text-white p-6 lg:p-8'
      } flex flex-col items-center justify-center relative transition-colors duration-300 font-sans`}
    >
      {/* VISTA 1: PRE-CALIBRACIÓN + PANEL DE SESIÓN CLÍNICA Y MODOS */}
      {isPreCalibrating ? (
        <div className="w-full max-w-6xl mx-auto space-y-6">
          {/* Top bar: Back + Clinical Session HUD / Mode Selector */}
          <div className="bg-white border border-[#DCEBF4] rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => navigate('/patient/dashboard')}
                  className="inline-flex items-center space-x-1.5 px-3 py-2 rounded-xl border border-[#DCEBF4] text-xs font-bold text-[#1C2A39] hover:bg-[#F3FAFF] transition-all"
                >
                  <ArrowLeft size={15} />
                  <span>Panel del Paciente</span>
                </button>
                <div>
                  <p className="text-xs font-bold text-[#0F6F62] uppercase tracking-wider">
                    {isCognitoMode ? 'Sesión Terapéutica Clínica' : 'Modo Práctica / Demo'}
                  </p>
                  <h2 className="text-base sm:text-lg font-bold text-[#1C2A39]">
                    {activeModeMeta.label} ({activeModeMeta.mode})
                  </h2>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                {isCognitoMode && (
                  <button
                    onClick={() => void loadClinicalSessionAndPlans()}
                    disabled={loadingClinical}
                    className="inline-flex items-center space-x-1.5 px-3 py-2 rounded-xl border border-[#CDE9FA] bg-[#F3FAFF] text-xs font-bold text-[#1C2A39] hover:bg-[#E6F6FF] disabled:opacity-50"
                  >
                    <RefreshCw size={14} className={loadingClinical ? 'animate-spin' : ''} />
                    <span>Sincronizar</span>
                  </button>
                )}
                <button
                  onClick={() => setMouseFallbackEnabled((prev) => !prev)}
                  className={`inline-flex items-center space-x-1.5 px-3 py-2 rounded-xl border text-xs font-bold transition-all ${
                    mouseFallbackEnabled
                      ? 'bg-[#1C2A39] text-white border-[#1C2A39]'
                      : 'bg-white text-[#455A64] border-[#DCEBF4] hover:bg-[#F3FAFF]'
                  }`}
                >
                  <MousePointer2 size={14} />
                  <span>{mouseFallbackEnabled ? 'Ratón Fallback: ON' : 'Ratón Fallback: OFF'}</span>
                </button>
              </div>
            </div>

            {clinicalError && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-xs flex items-center space-x-2">
                <ShieldAlert size={16} className="shrink-0" />
                <span>{clinicalError}</span>
              </div>
            )}

            {/* Cognito Active Session Status OR Start Session right from SeriousGamesPage */}
            {isCognitoMode ? (
              activeClinicalSession ? (
                <div className="bg-[#DCF8F2]/60 border border-[#26A69A]/40 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <div className="flex flex-wrap items-center gap-2 text-[#1C2A39]">
                    <CheckCircle2 size={16} className="text-[#0F6F62]" />
                    <span>
                      Sesión activa: <strong>{activeClinicalSession.exerciseCode}</strong> ·{' '}
                      <code className="font-mono bg-white px-1.5 py-0.5 rounded border border-[#CDE9FA]">
                        {activeClinicalSession.therapySessionId.slice(0, 12)}...
                      </code>
                    </span>
                    {sessionProgress && (
                      <span className="bg-white border border-[#B5EAE0] px-2.5 py-0.5 rounded-md font-bold text-[#0F6F62]">
                        {sessionProgress.criterion === 'REPETITIONS'
                          ? `${sessionProgress.completedRepetitions} / ${sessionProgress.target} repeticiones`
                          : `${Math.round(sessionProgress.activeMilliseconds / 1000)} / ${
                              sessionProgress.target
                            } s`}{' '}
                        · {sessionProgress.activityState}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleResumeDirectlyToMainGame}
                      className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-[#0F6F62] hover:bg-[#0C584E] text-white font-bold text-xs shadow-xs transition-all"
                    >
                      <Play size={13} className="fill-current" />
                      <span>
                        {sessionProgress && sessionProgress.activityState !== 'NEW'
                          ? 'Continuar Terapia Ahora'
                          : 'Ir Directo al Ejercicio'}
                      </span>
                    </button>
                  </div>
                </div>
              ) : expiredSession ? (
                <div className="bg-[#FFF4E5] border border-[#F4A261] rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <span className="text-[#B85D19] font-semibold">
                    El lease de 120s de la sesión anterior ({expiredSession.exerciseCode}) expiró. Inicia una nueva sesión para continuar:
                  </span>
                  <button
                    onClick={() => void handleCloseExpiredSession()}
                    disabled={loadingClinical}
                    className="px-4 py-2 rounded-lg bg-[#B85D19] text-white font-bold hover:bg-[#974911] disabled:opacity-60"
                  >
                    {loadingClinical ? 'Iniciando...' : 'Iniciar Nueva Sesión'}
                  </button>
                </div>
              ) : (
                <div className="bg-[#F0F8FD] border border-[#CDE9FA] rounded-xl p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#1C2A39]">
                      No hay una sesión clínica activa. Inicia una desde tu plan asignado:
                    </span>
                    {loadingClinical && <Loader2 size={14} className="animate-spin text-[#0F6F62]" />}
                  </div>
                  {plans.length === 0 ? (
                    <p className="text-xs text-[#455A64]">
                      No se encontraron planes activos disponibles. Puedes probar en modo local o volver al panel para verificar tu perfil.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {plans.flatMap((plan) =>
                        plan.effectiveConfigurations.map((cfg) => {
                          const { parameters: p } = extractVersionedParameters(cfg);
                          const avail = plan.dailyAvailability.exercises.find(
                            (e) => e.exerciseCode === cfg.exerciseCode
                          );
                          const disabled =
                            plan.status !== 'ACTIVE' ||
                            avail?.status === 'BLOCKED' ||
                            startingSessionKey !== null;
                          const isBusy =
                            startingSessionKey === `${plan.therapyPlanId}:${cfg.exerciseCode}`;
                          return (
                            <button
                              key={cfg.configurationId}
                              disabled={disabled}
                              onClick={() => void handleStartSessionFromPlan(plan, cfg)}
                              className="inline-flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-[#0F6F62] hover:bg-[#0C584E] disabled:bg-neutral-300 disabled:text-neutral-600 text-white text-xs font-bold transition-all"
                            >
                              {isBusy ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <Play size={14} className="fill-current" />
                              )}
                              <span>
                                Iniciar {cfg.exerciseCode} ({p.mode})
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              )
            ) : null}

            {/* All 5 Modes Selector / Viewer */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
              {ALL_GAME_MODES.map((m) => {
                const isSelected = selectedMode === m.mode;
                const lockedByClinical = Boolean(isCognitoMode && activeClinicalSession);
                return (
                  <button
                    key={m.mode}
                    type="button"
                    disabled={lockedByClinical && !isSelected}
                    onClick={() => setSelectedMode(m.mode)}
                    className={`text-left p-3 rounded-xl border transition-all ${
                      isSelected
                        ? 'bg-[#0F6F62] text-white border-[#0F6F62] shadow-xs'
                        : lockedByClinical
                        ? 'bg-neutral-50 text-neutral-400 border-[#E2EEF5] opacity-60 cursor-not-allowed'
                        : 'bg-[#F8FBFE] hover:bg-[#EBF7FD] text-[#1C2A39] border-[#DCEBF4]'
                    }`}
                  >
                    <p className="text-xs font-bold leading-tight">{m.label}</p>
                    <p
                      className={`text-[10px] font-mono mt-0.5 truncate ${
                        isSelected ? 'text-[#8AE2D6]' : 'text-[#455A64]'
                      }`}
                    >
                      {m.mode}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <PreCalibrationView
            videoRef={videoRef}
            attachVideoElement={attachVideoElement}
            pipCanvasRef={pipCanvasRef}
            isStreaming={isStreaming}
            onStartCalibration={startCalibration}
            onRetryCamera={(deviceId?: string) => {
              stopWebcam();
              startWebcam(deviceId);
            }}
            rawMetricsRef={rawMetricsRef}
            fps={60}
            onEnableMouseFallback={handleStartMouseFallbackDirect}
          />

          {/* Fallback when webcam is unavailable or user wants to run with mouse cursor */}
          {(error || mouseFallbackEnabled) && (
            <div className="bg-white border border-[#DCEBF4] rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs text-[#455A64]">
                <strong className="text-[#1C2A39]">Alternativa sin cámara / Modo Ratón:</strong>{' '}
                {error
                  ? `Cámara no disponible (${error}). Puedes ejecutar la terapia con seguimiento por puntero.`
                  : 'Seguimiento por ratón habilitado para pruebas o accesibilidad.'}
              </div>
              <button
                type="button"
                onClick={handleStartMouseFallbackDirect}
                className="px-5 py-2.5 rounded-xl bg-[#1C2A39] hover:bg-[#131F2B] text-white text-xs font-bold shrink-0 transition-all"
              >
                Iniciar Terapia con Ratón
              </button>
            </div>
          )}
        </div>
      ) : (
        /* VISTA 2: CALIBRACIÓN DE 9 PUNTOS / JUEGO ACTIVO */
        <>
          {/* HUD Superior */}
          <div className="w-full max-w-6xl mb-4 flex flex-wrap justify-between items-center gap-3 text-white/90 z-40">
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => navigate('/patient/dashboard')}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-bold text-white border border-white/15 transition-all"
              >
                <ArrowLeft size={14} />
                <span>Panel</span>
              </button>
              <h2 className="text-lg sm:text-xl font-bold tracking-tight text-[#26A69A]">
                NeuroVisión Terapia
              </h2>
              <span className="text-xs bg-white/10 border border-white/15 px-3 py-1 rounded-full font-semibold text-[#8AE2D6]">
                {activeModeMeta.label}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {renderProgressPill()}

              {!isCognitoMode && gamePhase !== 'CALIBRATION' && (
                <select
                  value={selectedMode}
                  onChange={(e) => setSelectedMode(e.target.value as ReportMode)}
                  className="bg-[#132230] border border-white/20 text-white text-xs font-semibold rounded-xl px-3 py-1.5 focus:outline-none focus:border-[#26A69A]"
                >
                  {ALL_GAME_MODES.map((m) => (
                    <option key={m.mode} value={m.mode}>
                      {m.label}
                    </option>
                  ))}
                </select>
              )}

              <button
                type="button"
                onClick={() => setMouseFallbackEnabled((prev) => !prev)}
                className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                  mouseFallbackEnabled
                    ? 'bg-[#26A69A] text-[#0E1722] border-[#26A69A]'
                    : 'bg-white/10 text-white/80 border-white/15 hover:bg-white/20'
                }`}
              >
                <MousePointer2 size={13} />
                <span>{mouseFallbackEnabled ? 'Ratón ON' : 'Ratón OFF'}</span>
              </button>

              {!isLoaded && (
                <span className="text-xs bg-white/10 px-3 py-1 rounded-full animate-pulse">
                  Cargando Motores de IA...
                </span>
              )}
              {error && (
                <span className="text-xs bg-red-900/60 text-red-200 px-3 py-1 rounded-full">
                  {error}
                </span>
              )}
            </div>
          </div>

          {/* PIP Video flotante abajo a la derecha */}
          <div className="fixed bottom-4 right-4 z-50 w-48 h-36 rounded-xl overflow-hidden shadow-2xl border-2 border-white/20 bg-black">
            <video
              ref={attachVideoElement}
              className="w-full h-full object-cover -scale-x-100 opacity-90"
              playsInline
              muted
              autoPlay
            />
            <canvas
              ref={pipCanvasRef}
              width={192}
              height={144}
              className="absolute inset-0 w-full h-full -scale-x-100 pointer-events-none"
            />
          </div>

          {/* HUD Telemetría flotante abajo a la izquierda */}
          <div className="fixed bottom-4 left-4 bg-black/80 backdrop-blur-xs border border-white/10 text-[#8AE2D6] p-3.5 rounded-xl font-mono text-xs shadow-xl z-50 pointer-events-none max-w-sm">
            <pre ref={debugRef} className="m-0 leading-tight whitespace-pre-wrap">
              {mouseFallbackEnabled
                ? 'Modo cursor ratón activo para seguimiento de prueba.'
                : 'Iniciando telemetría...'}
            </pre>
          </div>

          {/* Overlay de los 9 Puntos de Calibración */}
          {gamePhase === 'CALIBRATION' && (
            <>
              <CalibrationOverlay />
              <div
                className="absolute w-28 h-28 rounded-full pointer-events-none z-100 transition-transform duration-75"
                style={{
                  left: `${heatmapPos.x * 100}%`,
                  top: `${heatmapPos.y * 100}%`,
                  transform: 'translate(-50%, -50%)',
                  background:
                    'radial-gradient(circle, rgba(38, 166, 154, 0.6) 0%, rgba(38, 166, 154, 0) 70%)',
                  filter: 'blur(6px)',
                }}
              />
            </>
          )}

          {/* Motor Gráfico del Juego (Serious Games) */}
          <div className="w-full max-w-5xl aspect-video relative z-20">
            <EyeTrackingGameCanvas
              gazeRef={gazeRef}
              prescription={effectivePrescription}
              gamePhase={gamePhase}
              onPhaseChange={setGamePhase}
              exerciseMode={selectedMode}
              activeSession={activeClinicalSession}
              sessionProgress={sessionProgress}
              gazeConfidenceRef={gazeConfidenceRef}
              mouseFallbackEnabled={mouseFallbackEnabled}
              onToggleMouseFallback={() => setMouseFallbackEnabled((prev) => !prev)}
              onSessionProgressUpdate={setSessionProgress}
              onSessionCompleted={handleSessionCompleted}
              onRequestNewSession={handleRequestNewSession}
              width={1024}
              height={576}
            />
          </div>
        </>
      )}
    </div>
  );
};
