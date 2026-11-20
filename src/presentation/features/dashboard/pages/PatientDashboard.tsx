import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  CheckCircle2,
  Clock,
  Flame,
  Calendar as CalendarIcon,
  Compass,
  Search,
  Volume2,
  Target,
  Play,
  Check,
  Pause,
  PhoneCall,
  MessageSquare,
  LogOut,
  Eye,
  AlertTriangle,
  Type,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  Activity,
  XCircle,
  Loader2,
  Copy,
  AlertOctagon,
  X,
  TrendingUp,
  BarChart3,
  ArrowLeft,
  Award,
  Phone,
  Layers,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../../../core/store/useAppStore';
import {
  computeCognitoProgressView,
  type CognitoProgressItem,
} from '../utils/patientProgressMetrics';
import type {
  FrozenClinicalExerciseParameters,
  MedicalPrescription,
} from '../../../../core/domain/Prescription';
import {
  ApiError,
  clinicalApi,
  createUuid,
  extractApiErrorMessage,
  iamApi,
  profileApi,
  type PatientCurrentSessionResponse,
  type PatientEffectiveConfiguration,
  type PatientExerciseAvailabilityReason,
  type PatientInvitationResponse,
  type PatientSessionProgressResponse,
  type PatientTherapyPlanResponse,
  type PatientTherapySessionResponse,
  type ReportMode,
  type TherapyCompletionTarget,
  type TherapyExerciseCode,
  type VersionedConfiguration,
} from '../../../../infrastructure/api';

const EXERCISE_LABELS: Record<TherapyExerciseCode, { title: string; subtitle: string; goal: string }> = {
  'visual-scanning': {
    title: 'Exploración Visual',
    subtitle: 'Visual Scanning',
    goal: 'Ampliar campo visual periférico y seguimiento sacádico.',
  },
  'visual-search': {
    title: 'Búsqueda Visual',
    subtitle: 'Visual Search',
    goal: 'Identificar estímulos clave discriminando distractores.',
  },
  fixation: {
    title: 'Fijación Ocular Sostenida',
    subtitle: 'Sustained Fixation',
    goal: 'Estabilizar la mirada foveal sobre un punto objetivo.',
  },
};

const MODE_LABELS: Record<ReportMode, string> = {
  STANDARD_SCANNING: 'Escaneo Visual Estándar',
  SYSTEMATIC_EXPLORATION: 'Exploración Sistemática',
  COMPENSATORY_SACCADE: 'Sacadas Compensatorias',
  TARGET_SEARCH_WITH_DISTRACTORS: 'Búsqueda con Distractores',
  SUSTAINED_TARGET_FIXATION: 'Fijación Sostenida',
};

const AVAILABILITY_REASON_LABELS: Record<PatientExerciseAvailabilityReason, string> = {
  ACTIVE_SESSION: 'Ya existe una sesión activa en curso.',
  CONFIGURATION_UNAVAILABLE: 'Configuración clínica aún no efectiva.',
  PLAN_QUOTA_EXHAUSTED: 'Límite diario de sesiones del plan alcanzado.',
  EXERCISE_QUOTA_EXHAUSTED: 'Límite diario de este ejercicio completado.',
  DAILY_TARGET_TIME_INSUFFICIENT: 'Tiempo objetivo diario insuficiente para iniciar.',
  DAILY_SAFETY_TIME_INSUFFICIENT: 'Límite de seguridad diario de exposición alcanzado.',
};

interface ProgressItem {
  exerciseCode: TherapyExerciseCode;
  exerciseTitle: string;
  modeLabel: string;
  completedRunsToday: number;
  dailyTargetRuns: number;
  completedRunsInPlan: number;
  totalPlannedRuns: number;
  remainingRunsToday: number;
  availabilityStatus: string;
  reason: string | null;
}

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

function formatCompletionTargetText(
  params: FrozenClinicalExerciseParameters,
  completionTarget?: TherapyCompletionTarget
): string {
  if (completionTarget) {
    if (completionTarget.criterion === 'ACTIVE_TIME') {
      const mins = Math.max(1, Math.round(completionTarget.target / 60));
      return `${completionTarget.target} s activos (~${mins} min)`;
    }
    return `${completionTarget.target} repeticiones válidas`;
  }
  if ('repetitions' in params) {
    return `${params.repetitions} repeticiones pautadas`;
  }
  return `${params.targetCount} objetivos por ronda`;
}

export const PatientDashboard: React.FC = () => {
  const navigate = useNavigate();
  const {
    authMode,
    accessToken,
    userProfile,
    setUserProfile,
    setActiveClinicalSession,
    setPrescription,
    setGamePhase,
    setHasCompletedOnboarding,
    logout,
  } = useAppStore();

  const isCognitoMode = authMode === 'COGNITO' && Boolean(accessToken);

  const [highContrast, setHighContrast] = useState(false);
  const [activeTab, setActiveTab] = useState<'inicio' | 'ejercicios' | 'progreso'>('inicio');
  const [isResting, setIsResting] = useState(false);
  const [restSeconds, setRestSeconds] = useState(120);
  const restTimerRef = useRef<number | null>(null);

  // Cognito backend state
  const [loadingBackend, setLoadingBackend] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [plans, setPlans] = useState<PatientTherapyPlanResponse[]>([]);
  const [currentSessionRes, setCurrentSessionRes] = useState<PatientCurrentSessionResponse | null>(
    null
  );
  const [currentProgress, setCurrentProgress] = useState<PatientSessionProgressResponse | null>(
    null
  );

  // Onboarding: IAM patient activation + Profile completion
  const [needsActivation, setNeedsActivation] = useState(false);
  const [activatingAccount, setActivatingAccount] = useState(false);
  const [activationResult, setActivationResult] = useState<PatientInvitationResponse | null>(null);
  const [activationMessage, setActivationMessage] = useState<string | null>(null);
  const [showOnboardingOverride, setShowOnboardingOverride] = useState(false);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [phone, setPhone] = useState('');
  const [completingProfile, setCompletingProfile] = useState(false);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);

  // Action states
  const [startingKey, setStartingKey] = useState<string | null>(null);
  const [closingExpired, setClosingExpired] = useState(false);
  const [mockSummaryVisible, setMockSummaryVisible] = useState(false);

  // Emergency Modal states
  const [isEmergencyModalOpen, setIsEmergencyModalOpen] = useState(false);
  const [copiedClinicalData, setCopiedClinicalData] = useState(false);
  const [isPausingEmergencySession, setIsPausingEmergencySession] = useState(false);
  const [emergencySessionNotice, setEmergencySessionNotice] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (restTimerRef.current !== null) {
        window.clearInterval(restTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (userProfile) {
      setFirstName((prev) => prev || userProfile.firstName || '');
      setLastName((prev) => prev || userProfile.lastName || '');
      setDocumentNumber((prev) => prev || userProfile.documentNumber || '');
      setBirthDate((prev) => prev || userProfile.birthDate || '');
      setPhone((prev) => prev || userProfile.phone || '');
    }
  }, [userProfile]);

  // Modal Escape key listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isEmergencyModalOpen) {
        setIsEmergencyModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isEmergencyModalOpen]);

  const loadPatientBackendData = useCallback(async () => {
    if (!isCognitoMode) return;

    setLoadingBackend(true);
    setBackendError(null);

    try {
      const [profileRes, plansRes, currentRes] = await Promise.allSettled([
        profileApi.getMyProfile(),
        clinicalApi.listMyTherapyPlans(),
        clinicalApi.getCurrentSession(),
      ]);

      let activationRequired = false;
      const errors: string[] = [];

      if (profileRes.status === 'fulfilled') {
        const prof = profileRes.value;
        setUserProfile(prof);
        setFirstName(prof.firstName || '');
        setLastName(prof.lastName || '');
        setDocumentNumber(prof.documentNumber || '');
        setBirthDate(prof.birthDate || '');
        setPhone(prof.phone || '');
        if (prof.status === 'ACTIVE') {
          setHasCompletedOnboarding(true);
        }
      } else {
        const err = profileRes.reason;
        if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
          activationRequired = true;
        } else {
          errors.push(`Perfil: ${extractApiErrorMessage(err)}`);
        }
      }

      if (plansRes.status === 'fulfilled') {
        setPlans(Array.isArray(plansRes.value) ? plansRes.value : []);
      } else {
        const err = plansRes.reason;
        if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
          activationRequired = true;
          setPlans([]);
        } else {
          errors.push(`Planes: ${extractApiErrorMessage(err)}`);
        }
      }

      if (currentRes.status === 'fulfilled') {
        const cur = currentRes.value;
        setCurrentSessionRes(cur);
        if (cur.state === 'ACTIVE' && cur.session) {
          setActiveClinicalSession(cur.session);
          try {
            const prog = await clinicalApi.getSessionProgress(cur.session.therapySessionId);
            setCurrentProgress(prog);
          } catch {
            setCurrentProgress(null);
          }
        } else if (cur.state === 'EXPIRED' && cur.session) {
          // Per `clinical/integration.md` (lines 120, 140): an EXPIRED observation is not resumable;
          // do not treat it as an active session.
          setActiveClinicalSession(null);
          try {
            const prog = await clinicalApi.getSessionProgress(cur.session.therapySessionId);
            setCurrentProgress(prog);
          } catch {
            setCurrentProgress(null);
          }
        } else {
          setActiveClinicalSession(null);
          setCurrentProgress(null);
        }
      } else {
        const err = currentRes.reason;
        if (!(err instanceof ApiError && (err.status === 403 || err.status === 404))) {
          errors.push(`Sesión actual: ${extractApiErrorMessage(err)}`);
        }
      }

      setNeedsActivation(activationRequired);
      if (errors.length > 0) {
        setBackendError(errors.join(' · '));
      }
    } finally {
      setLoadingBackend(false);
    }
  }, [isCognitoMode, setUserProfile, setHasCompletedOnboarding, setActiveClinicalSession]);

  useEffect(() => {
    if (isCognitoMode) {
      void loadPatientBackendData();
    }
  }, [isCognitoMode, loadPatientBackendData]);

  const startRest = () => {
    if (restTimerRef.current !== null) {
      window.clearInterval(restTimerRef.current);
    }
    setIsResting(true);
    setRestSeconds(120);
    restTimerRef.current = window.setInterval(() => {
      setRestSeconds((prev) => {
        if (prev <= 1) {
          if (restTimerRef.current !== null) {
            window.clearInterval(restTimerRef.current);
            restTimerRef.current = null;
          }
          setIsResting(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleActivatePatientAccount = async () => {
    setActivatingAccount(true);
    setBackendError(null);
    setActivationMessage(null);
    try {
      const res = await iamApi.activateMyPatientAccount();
      setActivationResult(res);
      setNeedsActivation(false);
      setActivationMessage(
        `Invitación activada (${res.status}). Ahora verifica o completa tu perfil clínico.`
      );
      await loadPatientBackendData();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setNeedsActivation(false);
        setActivationMessage('Tu invitación de paciente ya estaba activada. Actualizando datos...');
        await loadPatientBackendData();
      } else {
        setBackendError(`No se pudo activar la invitación: ${extractApiErrorMessage(err)}`);
      }
    } finally {
      setActivatingAccount(false);
    }
  };

  const handleCompleteProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) {
      setBackendError('Por favor ingresa tus nombres y apellidos para completar tu perfil.');
      return;
    }

    setCompletingProfile(true);
    setBackendError(null);
    setProfileNotice(null);
    try {
      const updated = await profileApi.completePatientProfile({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        documentNumber: documentNumber.trim() ? documentNumber.trim() : null,
        birthDate: birthDate.trim() ? birthDate.trim() : null,
        phone: phone.trim() ? phone.trim() : null,
      });
      setUserProfile(updated);
      setHasCompletedOnboarding(updated.status === 'ACTIVE');
      setNeedsActivation(false);
      setShowOnboardingOverride(false);
      setProfileNotice('Perfil de paciente guardado y verificado correctamente.');
      await loadPatientBackendData();
    } catch (err) {
      setBackendError(`No se pudo guardar el perfil: ${extractApiErrorMessage(err)}`);
    } finally {
      setCompletingProfile(false);
    }
  };

  const handleResumeSession = (session: PatientTherapySessionResponse) => {
    setActiveClinicalSession(session);
    const patientId = userProfile?.id || 'patient';
    setPrescription(buildPrescriptionFromSession(session, patientId));
    setGamePhase('CALIBRATION');
    navigate('/serious-games');
  };

  const handleAbandonExpiredSession = async (session: PatientTherapySessionResponse) => {
    setClosingExpired(true);
    setBackendError(null);
    try {
      // Per `clinical/integration.md` (lines 120, 140) & `StartTherapySessionCommandService.java`:
      // An EXPIRED session lease cannot be closed via PUT /completion (requires live lease).
      // The normal POST /sessions start flow automatically reconciles & expires the old session.
      const newSession = await clinicalApi.startTherapySession(
        session.therapyPlanId,
        { exerciseCode: session.exerciseCode },
        createUuid()
      );
      setActiveClinicalSession(newSession);
      const patientId = userProfile?.id || 'patient';
      setPrescription(buildPrescriptionFromSession(newSession, patientId));
      setGamePhase('CALIBRATION');
      navigate('/serious-games');
    } catch (err) {
      setBackendError(
        `No se pudo iniciar una nueva sesión tras expirar la anterior: ${extractApiErrorMessage(err)}`
      );
      await loadPatientBackendData();
    } finally {
      setClosingExpired(false);
    }
  };

  const handleStartClinicalSession = async (
    plan: PatientTherapyPlanResponse,
    cfg: PatientEffectiveConfiguration
  ) => {
    const key = `${plan.therapyPlanId}:${cfg.exerciseCode}`;
    setStartingKey(key);
    setBackendError(null);
    try {
      const session = await clinicalApi.startTherapySession(
        plan.therapyPlanId,
        { exerciseCode: cfg.exerciseCode },
        createUuid()
      );
      setActiveClinicalSession(session);
      const patientId = userProfile?.id || 'patient';
      setPrescription(buildPrescriptionFromSession(session, patientId));
      setGamePhase('CALIBRATION');
      navigate('/serious-games');
    } catch (err) {
      setBackendError(`No se pudo iniciar la sesión terapéutica: ${extractApiErrorMessage(err)}`);
      if (err instanceof ApiError && err.status === 409) {
        await loadPatientBackendData();
      }
    } finally {
      setStartingKey(null);
    }
  };

  const handleStartMockSession = () => {
    setPrescription({
      prescriptionId: 'demo-plan',
      patientId: 'demo-patient',
      gameId: 'visual-scanning',
      parameters: {
        target_speed: 1.0,
        visual_field_amplitude: 0.9,
        min_fixation_time: 1000,
      },
    });
    setGamePhase('CALIBRATION');
    navigate('/serious-games');
  };

  const handleSelectTab = (tab: 'inicio' | 'ejercicios' | 'progreso') => {
    setActiveTab(tab);
    if (tab === 'ejercicios') {
      setTimeout(() => {
        const el = document.getElementById('ejercicios-catalog');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          el.focus();
        }
      }, 50);
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleEmergencyAbandonActiveSession = async () => {
    if (!currentSessionRes || currentSessionRes.state === 'NONE' || !currentSessionRes.session) return;
    setIsPausingEmergencySession(true);
    setEmergencySessionNotice(null);
    try {
      await clinicalApi.completeSession(
        currentSessionRes.session.therapySessionId,
        { action: 'ABANDONED' },
        createUuid()
      );
      setActiveClinicalSession(null);
      setEmergencySessionNotice('Sesión activa finalizada y guardada de forma segura por protocolo clínico.');
      await loadPatientBackendData();
    } catch (err) {
      setEmergencySessionNotice(`No se pudo cerrar la sesión: ${extractApiErrorMessage(err)}`);
    } finally {
      setIsPausingEmergencySession(false);
    }
  };

  const handleCopyClinicalData = () => {
    const patientName = userProfile
      ? `${userProfile.firstName || ''} ${userProfile.lastName || ''}`.trim() || 'Paciente Registrado'
      : 'Roberto Mendoza';
    const patientDoc = userProfile?.documentNumber || '45891234';
    const patientPhone = userProfile?.phone || '+51 987 654 321';
    const sessionId =
      currentSessionRes?.state === 'ACTIVE' && currentSessionRes.session
        ? currentSessionRes.session.therapySessionId
        : 'Sin sesión activa';

    const textToCopy = `=== NEUROVISION REHAB - FICHA DE ASISTENCIA CLÍNICA ===
Paciente: ${patientName}
Documento: ${patientDoc}
Teléfono registrado: ${patientPhone}
Sesión activa: ${sessionId}
Fecha/Hora del reporte: ${new Date().toLocaleString('es-ES')}
Protocolo: Telerehabilitación Neuro-Oftalmológica
Motivo de Alerta: Síntomas de fatiga visual / mareo / cefalea en curso.`;

    if (navigator.clipboard) {
      void navigator.clipboard.writeText(textToCopy).then(() => {
        setCopiedClinicalData(true);
        setTimeout(() => setCopiedClinicalData(false), 3000);
      });
    }
  };

  // Progress View derived data for Cognito mode (100% real from activePlan.dailyAvailability, no synthetic +2 or 7-day history)
  const cognitoProgressView = useMemo(
    () =>
      computeCognitoProgressView(
        plans,
        EXERCISE_LABELS,
        MODE_LABELS,
        AVAILABILITY_REASON_LABELS
      ),
    [plans]
  );

  // Progress View simulated data for Mock mode
  const mockProgressView = useMemo(() => {
    const items: ProgressItem[] = [
      {
        exerciseCode: 'visual-scanning',
        exerciseTitle: 'Exploración Visual',
        modeLabel: 'Escaneo Visual Estándar',
        completedRunsToday: 1,
        dailyTargetRuns: 2,
        completedRunsInPlan: 8,
        totalPlannedRuns: 14,
        remainingRunsToday: 1,
        availabilityStatus: 'AVAILABLE',
        reason: null,
      },
      {
        exerciseCode: 'visual-search',
        exerciseTitle: 'Búsqueda Visual',
        modeLabel: 'Búsqueda con Distractores',
        completedRunsToday: 1,
        dailyTargetRuns: 1,
        completedRunsInPlan: 7,
        totalPlannedRuns: 7,
        remainingRunsToday: 0,
        availabilityStatus: 'AVAILABLE',
        reason: 'Límite diario completado con 92% de precisión.',
      },
      {
        exerciseCode: 'fixation',
        exerciseTitle: 'Fijación Ocular Sostenida',
        modeLabel: 'Fijación Sostenida',
        completedRunsToday: 1,
        dailyTargetRuns: 1,
        completedRunsInPlan: 6,
        totalPlannedRuns: 7,
        remainingRunsToday: 0,
        availabilityStatus: 'AVAILABLE',
        reason: null,
      },
    ];

    return {
      dailyCompletionPercentage: 75,
      planCompletionPercentage: 82,
      completedTodaySessions: 3,
      dailyLimit: 4,
      items,
    };
  }, []);

  const needsProfileCompletion =
    isCognitoMode && (!userProfile || userProfile.status === 'PENDING_COMPLETION');
  const showOnboardingCard =
    isCognitoMode && (needsActivation || needsProfileCompletion || showOnboardingOverride);

  const formattedToday = useMemo(() => {
    if (!isCognitoMode) return 'Miércoles, 28 de Octubre';
    const raw = new Date().toLocaleDateString('es-ES', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }, [isCognitoMode]);

  const greetingName = isCognitoMode
    ? userProfile?.firstName?.trim() || 'Paciente'
    : 'Roberto';

  const activeBannerSession =
    isCognitoMode && currentSessionRes && currentSessionRes.state !== 'NONE'
      ? currentSessionRes.session
      : null;

  const hasActiveBlockingSession = Boolean(
    currentSessionRes && currentSessionRes.state === 'ACTIVE' && currentSessionRes.session
  );

  return (
    <div
      className={`min-h-screen bg-[#F3FAFF] font-sans text-[#1C2A39] flex flex-col justify-between ${
        highContrast ? 'text-lg' : ''
      }`}
    >
      {/* Top Navbar */}
      <header className="bg-white border-b border-[#E2EEF5] px-4 sm:px-6 lg:px-12 py-3.5 flex items-center justify-between sticky top-0 z-30 shadow-xs">
        {/* Brand / Logo */}
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-full bg-[#E6F6FF] flex items-center justify-center text-[#26A69A]">
            <Eye size={24} className="stroke-[2.5]" />
          </div>
          <span className="text-xl font-bold tracking-tight text-[#1C2A39]">
            NeuroVisión
            <span className="block text-xs font-semibold text-[#455A64] -mt-1 tracking-normal">
              Rehab
            </span>
          </span>
        </div>

        {/* Center Navigation Links (Both COGNITO and MOCK) */}
        <nav className="flex items-center space-x-3 sm:space-x-8" aria-label="Navegación principal">
          <button
            type="button"
            onClick={() => handleSelectTab('inicio')}
            className={`font-bold text-xs sm:text-sm transition-all pb-1.5 border-b-2 ${
              activeTab === 'inicio'
                ? 'text-[#1C2A39] border-[#1C2A39]'
                : 'text-[#455A64] border-transparent hover:text-[#1C2A39]'
            }`}
          >
            Inicio
          </button>
          <button
            type="button"
            onClick={() => handleSelectTab('ejercicios')}
            className={`font-bold text-xs sm:text-sm transition-all pb-1.5 border-b-2 ${
              activeTab === 'ejercicios'
                ? 'text-[#1C2A39] border-[#1C2A39]'
                : 'text-[#455A64] border-transparent hover:text-[#1C2A39]'
            }`}
          >
            Ejercicios
          </button>
          <button
            type="button"
            onClick={() => handleSelectTab('progreso')}
            className={`font-bold text-xs sm:text-sm transition-all pb-1.5 border-b-2 ${
              activeTab === 'progreso'
                ? 'text-[#1C2A39] border-[#1C2A39]'
                : 'text-[#455A64] border-transparent hover:text-[#1C2A39]'
            }`}
          >
            Progreso
          </button>
        </nav>

        {/* Actions (Sync/Profile in Cognito + Emergency + Logout) */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          {isCognitoMode && (
            <>
              <button
                type="button"
                onClick={() => setShowOnboardingOverride((prev) => !prev)}
                title="Activación y Perfil de Paciente"
                className="hidden sm:inline-flex items-center space-x-1.5 px-3 py-2 rounded-xl border border-[#D5E5EF] text-xs font-bold text-[#1C2A39] hover:bg-[#F3FAFF] transition-all"
              >
                <UserCheck size={15} className="text-[#0F6F62]" />
                <span>Mi Perfil</span>
              </button>
              <button
                type="button"
                onClick={() => void loadPatientBackendData()}
                disabled={loadingBackend}
                title="Actualizar planes y sesiones"
                className="w-10 h-10 rounded-xl border border-[#D5E5EF] flex items-center justify-center text-[#455A64] hover:bg-[#F3FAFF] hover:text-[#1C2A39] transition-all disabled:opacity-50"
              >
                <RefreshCw size={17} className={loadingBackend ? 'animate-spin' : ''} />
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setIsEmergencyModalOpen(true)}
            aria-label="Abrir soporte de emergencia y asistencia clínica"
            className="flex items-center space-x-2 bg-[#B71C1C] hover:bg-[#9B1717] text-white px-3.5 sm:px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm shadow-sm transition-all active:scale-95"
          >
            <PhoneCall size={18} className="fill-white" />
            <span className="hidden xs:inline">Emergencia</span>
          </button>

          <button
            type="button"
            onClick={() => logout()}
            title="Cerrar sesión"
            className="w-10 h-10 rounded-xl border border-[#D5E5EF] flex items-center justify-center text-[#455A64] hover:bg-[#F3FAFF] hover:text-[#1C2A39] transition-all"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-7">
        {/* Patient Greeting & Status Header Card */}
        <div className="bg-white border border-[#DCEBF4] rounded-2xl p-6 sm:p-7 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-3">
            {/* Badges row */}
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex items-center space-x-1.5 bg-[#E6F6FF] text-[#1C2A39] font-medium text-xs px-3 py-1 rounded-md border border-[#CDE9FA]">
                <CalendarIcon size={14} className="text-[#26A69A]" />
                <span>Hoy: {formattedToday}</span>
              </span>
              {isCognitoMode ? (
                <span className="inline-flex items-center space-x-1.5 bg-[#DCF8F2] text-[#0F6F62] font-bold text-xs px-3 py-1 rounded-md border border-[#B5EAE0]">
                  <ShieldCheck size={14} />
                  <span>
                    Modo Clínico Conectado ·{' '}
                    {userProfile?.status === 'ACTIVE'
                      ? 'Perfil Activo'
                      : needsActivation
                      ? 'Activación Pendiente'
                      : 'Completar Perfil'}
                  </span>
                </span>
              ) : (
                <span className="inline-flex items-center space-x-1.5 bg-[#FFF2E2] text-[#B85D19] font-bold text-xs px-3 py-1 rounded-md border border-[#FFE2C2]">
                  <Flame size={14} className="fill-[#F4A261] text-[#F4A261]" />
                  <span>Días seguidos: 5 (Demo)</span>
                </span>
              )}
            </div>

            {/* Title */}
            <div>
              <h1 className="text-3xl sm:text-4xl font-extrabold text-[#1C2A39] tracking-tight">
                ¡Hola, {greetingName}!
              </h1>
              <div className="flex items-center space-x-1.5 text-xs sm:text-sm text-[#455A64] font-medium mt-1.5">
                <CheckCircle2 size={16} className="text-[#26A69A] shrink-0 fill-[#E6F6FF]" />
                <span>
                  {isCognitoMode
                    ? 'Protocolo de Telerehabilitación Neuro-Oftalmológica · Sincronizado'
                    : 'Supervisado por Dr. Chen - Protocolo de Telerehabilitación Neuro-Oftalmológica'}
                </span>
              </div>
            </div>
          </div>

          {/* Accessibility pill */}
          <div className="bg-[#EBF7FD] border border-[#CDE9FA] rounded-xl p-3 flex items-center space-x-4 shrink-0">
            <div className="flex items-start space-x-2.5">
              <div className="p-1.5 rounded-md bg-white text-[#1C2A39] shadow-2xs">
                <Type size={18} />
              </div>
              <div className="leading-tight">
                <p className="text-xs font-bold text-[#1C2A39]">Texto de Alta Visibilidad</p>
                <p className="text-[10px] text-[#455A64]">WCAG 2.2 AAA Activo</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setHighContrast(!highContrast)}
              className="bg-white hover:bg-neutral-50 text-[#1C2A39] border border-[#BDE0F3] px-3 py-1.5 rounded-lg text-xs font-bold shadow-2xs transition-all active:scale-95"
            >
              {highContrast ? 'Normal -' : 'Aumentar +'}
            </button>
          </div>
        </div>

        {/* Feedback alerts (Cognito mode) */}
        {isCognitoMode && backendError && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-2xl p-4 flex items-start justify-between gap-4">
            <div className="flex items-start space-x-3 text-xs sm:text-sm">
              <AlertTriangle size={18} className="shrink-0 mt-0.5 text-red-600" />
              <span>{backendError}</span>
            </div>
            <button
              type="button"
              onClick={() => setBackendError(null)}
              className="text-red-500 hover:text-red-700 shrink-0"
            >
              <XCircle size={18} />
            </button>
          </div>
        )}

        {isCognitoMode && (activationMessage || profileNotice) && (
          <div className="bg-[#DCF8F2] border border-[#A7E7DC] text-[#0F6F62] rounded-2xl p-4 flex items-start justify-between gap-4 text-xs sm:text-sm font-semibold">
            <div className="flex items-center space-x-2.5">
              <CheckCircle2 size={18} className="shrink-0" />
              <span>{activationMessage || profileNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setActivationMessage(null);
                setProfileNotice(null);
              }}
              className="text-[#0F6F62] hover:opacity-75"
            >
              <XCircle size={17} />
            </button>
          </div>
        )}

        {/* Patient IAM Activation & Profile Completion Panel */}
        {showOnboardingCard && (
          <section className="bg-white border-2 border-[#26A69A]/40 rounded-2xl p-6 sm:p-7 shadow-sm space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E2EEF5] pb-4">
              <div>
                <span className="inline-flex items-center space-x-1.5 bg-[#FFF2E2] text-[#B85D19] px-3 py-1 rounded-md text-xs font-bold mb-2">
                  <ShieldCheck size={14} />
                  <span>ACTIVACIÓN Y REGISTRO DE PACIENTE</span>
                </span>
                <h2 className="text-xl font-bold text-[#1C2A39]">
                  Configuración Inicial de tu Cuenta Clínica
                </h2>
                <p className="text-xs sm:text-sm text-[#455A64] mt-0.5">
                  Activa tu invitación clínica y completa tus datos personales para acceder a tus planes terapéuticos.
                </p>
              </div>
              {userProfile?.status === 'ACTIVE' && !needsActivation && (
                <button
                  type="button"
                  onClick={() => setShowOnboardingOverride(false)}
                  className="text-xs font-bold text-[#455A64] hover:text-[#1C2A39] px-3 py-1.5 rounded-lg border border-[#DCEBF4]"
                >
                  Cerrar Panel
                </button>
              )}
            </div>

            {/* Step 1: IAM Patient Activation */}
            <div className="bg-[#F0F8FD] border border-[#CDE9FA] rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-[#1C2A39] flex items-center space-x-2">
                  <span>1. Activación de Invitación (IAM)</span>
                  {activationResult?.status === 'ACTIVATED' && (
                    <span className="bg-[#DCF8F2] text-[#0F6F62] text-[10px] px-2 py-0.5 rounded font-bold">
                      ACTIVADA
                    </span>
                  )}
                </h3>
                <p className="text-xs text-[#455A64]">
                  {needsActivation
                    ? 'Tu cuenta aún requiere activar la invitación enviada por tu especialista.'
                    : 'Si es tu primer ingreso y recibes error 403, ejecuta la activación con un clic.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleActivatePatientAccount()}
                disabled={activatingAccount}
                className="bg-[#1C2A39] hover:bg-[#131F2B] text-white px-5 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center space-x-2 shrink-0 transition-all disabled:opacity-60"
              >
                {activatingAccount ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <ShieldCheck size={15} className="text-[#26A69A]" />
                )}
                <span>{activatingAccount ? 'Activando...' : 'Activar Invitación'}</span>
              </button>
            </div>

            {/* Step 2: Complete Patient Profile */}
            <form onSubmit={(e) => void handleCompleteProfile(e)} className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-[#1C2A39]">
                  2. Datos del Perfil Clínico del Paciente
                </h3>
                {userProfile && (
                  <span
                    className={`text-[11px] font-bold px-2.5 py-0.5 rounded ${
                      userProfile.status === 'ACTIVE'
                        ? 'bg-[#DCF8F2] text-[#0F6F62]'
                        : 'bg-[#FFF2E2] text-[#B85D19]'
                    }`}
                  >
                    Estado: {userProfile.status}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold text-[#1C2A39] mb-1">
                    Nombres *
                  </label>
                  <input
                    type="text"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Ej. Roberto"
                    className="w-full bg-[#F8FBFE] border border-[#CDE9FA] rounded-xl px-3.5 py-2.5 text-sm text-[#1C2A39] focus:outline-none focus:border-[#0F6F62]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#1C2A39] mb-1">
                    Apellidos *
                  </label>
                  <input
                    type="text"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Ej. Mendoza Ríos"
                    className="w-full bg-[#F8FBFE] border border-[#CDE9FA] rounded-xl px-3.5 py-2.5 text-sm text-[#1C2A39] focus:outline-none focus:border-[#0F6F62]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#1C2A39] mb-1">
                    Documento de Identidad
                  </label>
                  <input
                    type="text"
                    value={documentNumber}
                    onChange={(e) => setDocumentNumber(e.target.value)}
                    placeholder="Ej. 45891234"
                    className="w-full bg-[#F8FBFE] border border-[#CDE9FA] rounded-xl px-3.5 py-2.5 text-sm text-[#1C2A39] focus:outline-none focus:border-[#0F6F62]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#1C2A39] mb-1">
                    Fecha de Nacimiento
                  </label>
                  <input
                    type="date"
                    value={birthDate}
                    onChange={(e) => setBirthDate(e.target.value)}
                    className="w-full bg-[#F8FBFE] border border-[#CDE9FA] rounded-xl px-3.5 py-2.5 text-sm text-[#1C2A39] focus:outline-none focus:border-[#0F6F62]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#1C2A39] mb-1">
                    Teléfono de Contacto
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Ej. +51 999 888 777"
                    className="w-full bg-[#F8FBFE] border border-[#CDE9FA] rounded-xl px-3.5 py-2.5 text-sm text-[#1C2A39] focus:outline-none focus:border-[#0F6F62]"
                  />
                </div>

                <div className="flex items-end">
                  <button
                    type="submit"
                    disabled={completingProfile}
                    className="w-full py-2.5 px-5 bg-[#0F6F62] hover:bg-[#0C584E] text-white font-bold text-sm rounded-xl shadow-xs flex items-center justify-center space-x-2 transition-all disabled:opacity-60"
                  >
                    {completingProfile ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <UserCheck size={16} />
                    )}
                    <span>{completingProfile ? 'Guardando...' : 'Guardar y Completar Perfil'}</span>
                  </button>
                </div>
              </div>
            </form>
          </section>
        )}

        {/* Active / Resumable / Expired Session Banner (Cognito Mode) */}
        {activeBannerSession && currentSessionRes && (
          <section
            className={`rounded-2xl p-5 sm:p-6 border-2 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 ${
              currentSessionRes.state === 'ACTIVE'
                ? 'bg-[#E6F6FF] border-[#26A69A]'
                : 'bg-[#FFF4E5] border-[#F4A261]'
            }`}
          >
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-md text-xs font-bold ${
                    currentSessionRes.state === 'ACTIVE'
                      ? 'bg-[#0F6F62] text-white'
                      : 'bg-[#B85D19] text-white'
                  }`}
                >
                  <Activity size={13} />
                  <span>
                    {currentSessionRes.state === 'ACTIVE'
                      ? `SESIÓN EN CURSO (${currentProgress?.activityState || activeBannerSession.status})`
                      : 'SESIÓN EXPIRADA PENDIENTE DE CIERRE'}
                  </span>
                </span>
                <span className="text-xs font-mono text-[#455A64]">
                  ID: {activeBannerSession.therapySessionId.slice(0, 8)}...
                </span>
              </div>

              <h3 className="text-lg sm:text-xl font-bold text-[#1C2A39]">
                {EXERCISE_LABELS[activeBannerSession.exerciseCode]?.title ||
                  activeBannerSession.exerciseCode}{' '}
                ·{' '}
                {
                  MODE_LABELS[
                    extractVersionedParameters(activeBannerSession).parameters.mode
                  ]
                }
              </h3>

              <p className="text-xs sm:text-sm text-[#455A64]">
                Iniciada:{' '}
                {new Date(activeBannerSession.startedAt).toLocaleString('es-ES', {
                  hour: '2-digit',
                  minute: '2-digit',
                  day: '2-digit',
                  month: 'short',
                })}
                {currentProgress && (
                  <>
                    {' · '}Progreso:{' '}
                    <strong className="text-[#1C2A39]">
                      {currentProgress.criterion === 'REPETITIONS'
                        ? `${currentProgress.completedRepetitions} / ${currentProgress.target} reps`
                        : `${Math.round(currentProgress.activeMilliseconds / 1000)} / ${
                            currentProgress.target
                          } s`}
                    </strong>
                  </>
                )}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 shrink-0">
              {currentSessionRes.state === 'ACTIVE' ? (
                <button
                  type="button"
                  onClick={() => handleResumeSession(activeBannerSession)}
                  className="px-6 py-3.5 bg-[#0F6F62] hover:bg-[#0C584E] text-white font-bold rounded-xl shadow-sm flex items-center space-x-2 text-sm transition-all active:scale-95"
                >
                  <Play size={17} className="fill-white" />
                  <span>Reanudar Sesión</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleAbandonExpiredSession(activeBannerSession)}
                  disabled={closingExpired}
                  className="px-5 py-3 bg-[#B85D19] hover:bg-[#974911] text-white font-bold rounded-xl shadow-sm flex items-center space-x-2 text-sm transition-all disabled:opacity-60"
                >
                  {closingExpired && <Loader2 size={16} className="animate-spin" />}
                  <span>Iniciar Nueva Sesión ({activeBannerSession.exerciseCode})</span>
                </button>
              )}
            </div>
          </section>
        )}

        {/* ======================================================== */}
        {/* VISTA 1: TAB DE PROGRESO (AMBOS MODOS COGNITO Y MOCK)     */}
        {/* ======================================================== */}
        {activeTab === 'progreso' ? (
          <section className="space-y-7 animate-in fade-in duration-300">
            {/* Header de Progreso con botón de regreso y refresco */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-l-4 border-[#0F6F62] pl-3.5">
              <div>
                <h2 className="text-2xl sm:text-3xl font-extrabold text-[#1C2A39] tracking-tight">
                  Progreso y Métricas de Rehabilitación
                </h2>
                <p className="text-sm text-[#455A64] mt-0.5">
                  Cumplimiento de metas diarias, cuotas pautadas y registro de eventos neurosensoriales.
                </p>
              </div>

              <div className="flex items-center space-x-2.5 shrink-0">
                {isCognitoMode && (
                  <button
                    type="button"
                    onClick={() => void loadPatientBackendData()}
                    disabled={loadingBackend}
                    className="inline-flex items-center space-x-1.5 px-4 py-2.5 rounded-xl border border-[#CDE9FA] bg-white text-xs font-bold text-[#1C2A39] hover:bg-[#F3FAFF] transition-all disabled:opacity-50"
                  >
                    <RefreshCw size={14} className={loadingBackend ? 'animate-spin' : ''} />
                    <span>Refrescar Progreso</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleSelectTab('ejercicios')}
                  className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-[#0F6F62] hover:bg-[#0C584E] text-white text-xs font-bold shadow-xs transition-all active:scale-95"
                >
                  <ArrowLeft size={15} />
                  <span>Volver a Ejercicios</span>
                </button>
              </div>
            </div>

            {/* Metas Diarias y Cumplimiento de Cuota Diaria */}
            {(() => {
              const view = isCognitoMode ? cognitoProgressView : mockProgressView;
              const dailyPct = view ? view.dailyCompletionPercentage : 0;
              const planPct = view ? view.planCompletionPercentage : 0;
              const hasIncomplete = isCognitoMode && Boolean(cognitoProgressView?.hasIncompleteAvailability);

              return (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  {/* Card 1: Meta Diaria */}
                  <div className="bg-white border border-[#DCEBF4] rounded-2xl p-6 shadow-xs space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-[#455A64]">
                        {isCognitoMode
                          ? 'Sesiones Diarias (Clinical API 8083)'
                          : 'Meta Diaria Cumplida'}
                      </span>
                      <Target size={18} className="text-[#0F6F62]" />
                    </div>
                    <div className="flex items-baseline space-x-2">
                      <span className="text-4xl font-extrabold text-[#1C2A39]">
                        {dailyPct !== null ? `${dailyPct}%` : 'N/D'}
                      </span>
                      <span className="text-xs font-semibold text-[#455A64]">
                        {view?.completedTodaySessions !== null && view?.completedTodaySessions !== undefined
                          ? `(${view.completedTodaySessions} de ${view.dailyLimit ?? 1} sesiones hoy)`
                          : 'Disponibilidad pendiente de verificación (CHECK_AT_START / cupos null)'}
                      </span>
                    </div>
                    {/* Accessible Progress Bar */}
                    <div
                      role="progressbar"
                      aria-valuenow={dailyPct ?? 0}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label="Porcentaje de meta diaria"
                      className="w-full bg-[#E2EEF5] rounded-full h-3.5 overflow-hidden"
                    >
                      <div
                        className="bg-[#0F6F62] h-full rounded-full transition-all duration-500"
                        style={{ width: `${dailyPct ?? 0}%` }}
                      />
                    </div>
                  </div>

                  {/* Card 2: Cumplimiento de Cuota Diaria (Clinical API 8083) */}
                  <div className="bg-white border border-[#DCEBF4] rounded-2xl p-6 shadow-xs space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-[#455A64]">
                        {isCognitoMode
                          ? 'Cumplimiento de Cuota Diaria (Clinical API 8083)'
                          : 'Adherencia al Plan Activo (Demo)'}
                      </span>
                      <TrendingUp size={18} className="text-[#26A69A]" />
                    </div>
                    <div className="flex items-baseline space-x-2">
                      <span className="text-4xl font-extrabold text-[#1C2A39]">
                        {planPct !== null ? `${planPct}%` : 'N/D'}
                      </span>
                      <span className="text-xs font-semibold text-[#455A64]">
                        {isCognitoMode
                          ? planPct === null || hasIncomplete
                            ? 'Disponibilidad pendiente de verificación (CHECK_AT_START / cupos null)'
                            : `${cognitoProgressView?.totalCompletedRunsToday ?? 'N/D'} / ${
                                cognitoProgressView?.totalPrescribedRunsToday ?? 0
                              } prescripciones hoy · ${
                                cognitoProgressView?.remainingSlots ?? 'Por verificar'
                              } cupo(s) libre(s)`
                          : 'Rendimiento semanal demo'}
                      </span>
                    </div>
                    {/* Accessible Progress Bar */}
                    <div
                      role="progressbar"
                      aria-valuenow={planPct ?? 0}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label="Porcentaje de cumplimiento de cuota diaria"
                      className="w-full bg-[#E2EEF5] rounded-full h-3.5 overflow-hidden"
                    >
                      <div
                        className="bg-[#26A69A] h-full rounded-full transition-all duration-500"
                        style={{ width: `${planPct ?? 0}%` }}
                      />
                    </div>
                  </div>

                  {/* Card 3: Vigencia de Cuota Diaria (Cognito) vs Racha Demo (Mock) */}
                  <div className="bg-white border border-[#DCEBF4] rounded-2xl p-6 shadow-xs space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-[#455A64]">
                        {isCognitoMode
                          ? 'Fecha de Cuota & Estado (8083)'
                          : 'Constancia Terapéutica (Demo)'}
                      </span>
                      <Award size={18} className="text-[#F4A261]" />
                    </div>
                    <div className="flex items-baseline space-x-2">
                      <span className="text-2xl sm:text-3xl font-extrabold text-[#B85D19]">
                        {isCognitoMode
                          ? cognitoProgressView?.plan.dailyAvailability.quotaDate || 'Sin plan activo'
                          : '5 Días'}
                      </span>
                      <span className="text-xs font-semibold text-[#455A64]">
                        {isCognitoMode
                          ? `Plan ${cognitoProgressView?.plan.status || 'N/D'}`
                          : 'Seguidos sin interrupción'}
                      </span>
                    </div>
                    <p className="text-xs text-[#0F6F62] font-semibold flex items-center gap-1.5 pt-1">
                      <CheckCircle2 size={15} />{' '}
                      {isCognitoMode
                        ? `${cognitoProgressView?.items.length ?? 0} módulo(s) configurado(s) en Clinical API`
                        : 'Estimulación visual continua óptima [Datos Demo]'}
                    </p>
                  </div>
                </div>
              );
            })()}

            {/* Lista detallada de Ejercicios en el Plan */}
            <div className="bg-white border border-[#DCEBF4] rounded-2xl p-6 sm:p-7 shadow-xs space-y-6">
              <div className="flex items-center justify-between border-b border-[#E2EEF5] pb-4">
                <div className="space-y-0.5">
                  <h3 className="text-xl font-bold text-[#1C2A39] flex items-center gap-2">
                    <BarChart3 size={20} className="text-[#0F6F62]" />
                    <span>Desglose por Módulo de Terapia</span>
                  </h3>
                  <p className="text-xs text-[#455A64]">
                    Seguimiento individual de repeticiones y cuotas autorizadas para cada ejercicio.
                  </p>
                </div>
                <span className="text-xs font-bold text-[#0F6F62] bg-[#DCF8F2] px-3 py-1 rounded-md">
                  {isCognitoMode ? 'Modo Clínico Verificado' : 'Modo Demostración / Práctica'}
                </span>
              </div>

              {/* Notice banner when availability is incomplete (CHECK_AT_START / null slots) */}
              {isCognitoMode && cognitoProgressView?.hasIncompleteAvailability && (
                <div className="bg-[#FFF8F0] border border-[#FFE2C2] text-[#B85D19] rounded-xl p-3.5 flex items-center gap-2.5 text-xs font-semibold">
                  <AlertTriangle size={16} className="shrink-0 text-[#B85D19]" />
                  <span>
                    Disponibilidad pendiente de verificación (CHECK_AT_START / cupos null). Algunos
                    cupos diarios se evaluarán al iniciar la sesión.
                  </span>
                </div>
              )}

              {/* Items Grid / List */}
              <div className="space-y-4">
                {(() => {
                  const items = isCognitoMode
                    ? cognitoProgressView?.items || []
                    : mockProgressView.items;

                  if (items.length === 0) {
                    return (
                      <div className="text-center py-8 text-[#455A64] text-sm">
                        No hay ejercicios activos configurados en este momento.
                      </div>
                    );
                  }

                  return items.map((item) => {
                    const cognitoItem = isCognitoMode ? (item as CognitoProgressItem) : null;
                    const mockItem = !isCognitoMode ? (item as ProgressItem) : null;

                    const runPct: number | null = cognitoItem
                      ? cognitoItem.runCompletionPercentage
                      : Math.min(
                          100,
                          Math.round(
                            ((mockItem?.completedRunsToday ?? 0) /
                              (mockItem?.dailyTargetRuns || 1)) *
                              100
                          )
                        );
                    const planPct: number | null = cognitoItem
                      ? runPct
                      : Math.min(
                          100,
                          Math.round(
                            ((mockItem?.completedRunsInPlan ?? 0) /
                              (mockItem?.totalPlannedRuns || 1)) *
                              100
                          )
                        );

                    return (
                      <div
                        key={item.exerciseCode}
                        className="p-5 rounded-xl border border-[#DCEBF4] bg-[#F8FBFE] hover:bg-white transition-colors space-y-4"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="text-lg font-bold text-[#1C2A39]">
                                {item.exerciseTitle}
                              </h4>
                              <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                                  item.availabilityStatus === 'AVAILABLE'
                                    ? 'bg-[#DCF8F2] text-[#0F6F62]'
                                    : 'bg-[#FFF2E2] text-[#B85D19]'
                                }`}
                              >
                                {item.availabilityStatus === 'AVAILABLE'
                                  ? 'DISPONIBLE'
                                  : item.availabilityStatus}
                              </span>
                            </div>
                            <p className="text-xs font-semibold text-[#0F6F62]">
                              {item.modeLabel}
                            </p>
                          </div>

                          <div className="text-xs font-semibold text-[#455A64] sm:text-right">
                            <span>Cupos restantes hoy: </span>
                            <strong className="text-[#1C2A39] font-bold text-sm">
                              {item.remainingRunsToday === null
                                ? 'Por verificar'
                                : item.remainingRunsToday}
                            </strong>
                          </div>
                        </div>

                        {/* Progress bars row */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                          {/* Hoy */}
                          <div className="space-y-1.5">
                            <div className="flex justify-between text-xs font-semibold">
                              <span className="text-[#455A64]">Rondas completadas hoy:</span>
                              <span className="text-[#1C2A39] font-bold">
                                {item.completedRunsToday === null ? 'N/D' : item.completedRunsToday} /{' '}
                                {item.dailyTargetRuns ?? 'N/D'} (
                                {runPct !== null ? `${runPct}%` : 'N/D'})
                              </span>
                            </div>
                            <div
                              role="progressbar"
                              aria-valuenow={runPct ?? 0}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-label={`Rondas de hoy para ${item.exerciseTitle}`}
                              className="w-full bg-[#E2EEF5] rounded-full h-2.5 overflow-hidden"
                            >
                              <div
                                className="bg-[#0F6F62] h-full rounded-full transition-all duration-300"
                                style={{ width: `${runPct ?? 0}%` }}
                              />
                            </div>
                          </div>

                          {/* Cuota Diaria Prescrita (Cognito) vs Plan Total (Demo) */}
                          <div className="space-y-1.5">
                            <div className="flex justify-between text-xs font-semibold">
                              <span className="text-[#455A64]">
                                {isCognitoMode
                                  ? 'Cuota diaria prescrita (8083):'
                                  : 'Cumplimiento en el plan (Demo):'}
                              </span>
                              <span className="text-[#1C2A39] font-bold">
                                {isCognitoMode
                                  ? `${
                                      item.remainingRunsToday === null
                                        ? 'Por verificar'
                                        : `${item.remainingRunsToday} libre(s)`
                                    } / ${item.dailyTargetRuns ?? 'N/D'} pautado(s)`
                                  : `${mockItem?.completedRunsInPlan ?? 0} / ${
                                      mockItem?.totalPlannedRuns ?? 0
                                    } (${planPct ?? 0}%)`}
                              </span>
                            </div>
                            <div
                              role="progressbar"
                              aria-valuenow={planPct ?? 0}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-label={`Avance de cuota para ${item.exerciseTitle}`}
                              className="w-full bg-[#E2EEF5] rounded-full h-2.5 overflow-hidden"
                            >
                              <div
                                className="bg-[#26A69A] h-full rounded-full transition-all duration-300"
                                style={{ width: `${planPct ?? 0}%` }}
                              />
                            </div>
                          </div>
                        </div>

                        {item.reason && (
                          <div className="bg-[#FFF8F0] border border-[#FFE2C2] text-[#B85D19] rounded-lg p-2.5 text-xs font-medium">
                            {item.reason}
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            </div>

            {/* Historial de Eventos Técnicos y Clínicos */}
            <div className="bg-white border border-[#DCEBF4] rounded-2xl p-6 sm:p-7 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-[#E2EEF5] pb-3">
                <h3 className="text-lg font-bold text-[#1C2A39] flex items-center gap-2">
                  <Activity size={18} className="text-[#0F6F62]" />
                  <span>Estado de Sesión Actual (Clinical API 8083)</span>
                </h3>
                <span className="text-xs font-mono text-[#455A64]">
                  {isCognitoMode
                    ? currentSessionRes?.session
                      ? `Sesión ID: ${currentSessionRes.session.therapySessionId.slice(0, 10)}...`
                      : `Estado: ${currentSessionRes?.state || 'NONE'} [Clinical 8083]`
                    : 'Modo Local [Demo]'}
                </span>
              </div>

              {isCognitoMode ? (
                currentSessionRes?.session ? (
                  <div className="space-y-3">
                    <div className="bg-[#E6F6FF] border border-[#BDE0F3] rounded-xl p-4 text-xs space-y-2">
                      <p className="font-bold text-[#1C2A39]">
                        Sesión ({currentSessionRes.state}):{' '}
                        {EXERCISE_LABELS[currentSessionRes.session.exerciseCode]?.title}
                      </p>
                      <p className="text-[#455A64]">
                        Iniciada a las{' '}
                        {new Date(currentSessionRes.session.startedAt).toLocaleTimeString('es-ES')} ·
                        Estado: <strong>{currentProgress?.activityState || currentSessionRes.session.status}</strong>
                      </p>
                      {currentProgress && (
                        <p className="text-[#0F6F62] font-semibold">
                          Progreso técnico real (8083): {currentProgress.completedRepetitions} /{' '}
                          {currentProgress.target} repeticiones (
                          {Math.round(currentProgress.activeMilliseconds / 1000)}s activos)
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="bg-[#F8FBFE] border border-[#E2EEF5] rounded-xl p-4 text-xs text-[#455A64]">
                    No hay ninguna sesión terapéutica activa en este momento (
                    <code className="font-mono text-[#1C2A39]">
                      state: {currentSessionRes?.state || 'NONE'}
                    </code>
                    ). Seleccione un módulo disponible en la pestaña de Ejercicios para iniciar una nueva sesión supervisada.
                  </div>
                )
              ) : (
                <div className="space-y-2.5">
                  <div className="flex items-start gap-3 p-3 rounded-xl bg-[#F8FBFE] border border-[#E2EEF5] text-xs">
                    <span className="w-2 h-2 rounded-full bg-[#0F6F62] mt-1.5 shrink-0" />
                    <div>
                      <p className="font-bold text-[#1C2A39]">
                        10:15 - Módulo Búsqueda Visual completado [Demo]
                      </p>
                      <p className="text-[#455A64]">
                        Sesión supervisada de 12 minutos con precisión del 92% y latencia media sacádica de 312 ms.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-3 rounded-xl bg-[#F8FBFE] border border-[#E2EEF5] text-xs">
                    <span className="w-2 h-2 rounded-full bg-[#26A69A] mt-1.5 shrink-0" />
                    <div>
                      <p className="font-bold text-[#1C2A39]">
                        09:58 - Pre-calibración ocular y ambiental validada [Demo]
                      </p>
                      <p className="text-[#455A64]">
                        Alineación cefálica óptima a 50 cm con 420 Lux en habitación. Calibración R² = 96%.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Plan Clínico Activo Specs */}
            {isCognitoMode && cognitoProgressView?.plan && (
              <div className="bg-[#F0F8FD] border border-[#CDE9FA] rounded-2xl p-6 shadow-xs space-y-3 text-xs">
                <h4 className="font-bold text-sm text-[#1C2A39] flex items-center gap-2">
                  <Layers size={16} className="text-[#0F6F62]" />
                  <span>Parámetros del Plan Clínico Asignado</span>
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <span className="text-[#455A64]">Límite diario:</span>
                    <p className="font-bold text-[#1C2A39]">
                      {cognitoProgressView.plan.dailySessionLimit} sesiones
                    </p>
                  </div>
                  <div>
                    <span className="text-[#455A64]">Tiempo diario meta:</span>
                    <p className="font-bold text-[#1C2A39]">
                      {cognitoProgressView.plan.dailyTargetDurationMinutes} minutos
                    </p>
                  </div>
                  <div>
                    <span className="text-[#455A64]">Duración válida:</span>
                    <p className="font-bold text-[#1C2A39]">
                      {cognitoProgressView.plan.minimumValidDurationMinutes} a{' '}
                      {cognitoProgressView.plan.maximumSessionDurationMinutes} min
                    </p>
                  </div>
                  <div>
                    <span className="text-[#455A64]">Límite seguridad:</span>
                    <p className="font-bold text-[#1C2A39]">
                      {cognitoProgressView.plan.dailyHardSafetyLimitMinutes ?? 'Estándar'} min
                    </p>
                  </div>
                </div>
              </div>
            )}
          </section>
        ) : (
          /* ======================================================== */
          /* VISTA 2: TAB DE INICIO / EJERCICIOS (CATÁLOGO COMPLETO)   */
          /* ======================================================== */
          <div id="ejercicios-catalog" tabIndex={-1} className="space-y-7 focus:outline-none">
            {/* Section Heading */}
            <div className="border-l-4 border-[#0F6F62] pl-3.5 space-y-0.5">
              <h2 className="text-2xl font-bold text-[#1C2A39] tracking-tight">
                {isCognitoMode
                  ? 'Tus Planes y Ejercicios Terapéuticos'
                  : 'Tus Ejercicios para Hoy'}
              </h2>
              <p className="text-sm text-[#455A64]">
                {isCognitoMode
                  ? 'Seleccione un ejercicio disponible de su plan prescrito para iniciar la sesión supervisada.'
                  : 'Complete sus sesiones pautadas para estimular la recuperación visual y reconexión neuronal.'}
              </p>
            </div>

            {/* COGNITO MODE: Real Clinical Plans & Configurations */}
            {isCognitoMode ? (
              loadingBackend && plans.length === 0 ? (
                <div className="bg-white border border-[#DCEBF4] rounded-2xl p-10 flex flex-col items-center justify-center text-center space-y-3">
                  <Loader2 size={32} className="animate-spin text-[#0F6F62]" />
                  <p className="text-sm font-semibold text-[#455A64]">
                    Cargando planes terapéuticos asignados...
                  </p>
                </div>
              ) : plans.length === 0 ? (
                <div className="bg-white border border-[#DCEBF4] rounded-2xl p-8 text-center space-y-3">
                  <Target size={36} className="mx-auto text-[#26A69A]" />
                  <h3 className="text-lg font-bold text-[#1C2A39]">
                    No hay planes terapéuticos asignados todavía
                  </h3>
                  <p className="text-sm text-[#455A64] max-w-lg mx-auto">
                    {needsActivation || needsProfileCompletion
                      ? 'Completa primero la activación de tu invitación y tu perfil de paciente arriba.'
                      : 'Tu especialista aún no ha publicado un plan activo o puedes recargar para comprobar nuevamente.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => navigate('/serious-games')}
                    className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl border border-[#1C2A39] text-xs font-bold text-[#1C2A39] hover:bg-[#F3FAFF]"
                  >
                    <Compass size={15} />
                    <span>Ir a Verificación de Cámara y Calibración</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-8">
                  {plans.map((plan) => (
                    <div key={plan.therapyPlanId} className="space-y-5">
                      {/* Plan Summary & Quotas Header */}
                      <div className="bg-white border border-[#DCEBF4] rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2.5">
                            <span
                              className={`px-3 py-1 rounded-md text-xs font-bold tracking-wider ${
                                plan.status === 'ACTIVE'
                                  ? 'bg-[#DCF8F2] text-[#0F6F62]'
                                  : 'bg-neutral-100 text-neutral-600'
                              }`}
                            >
                              PLAN {plan.status}
                            </span>
                            <span className="text-xs font-mono text-[#455A64] bg-[#F3FAFF] px-2.5 py-1 rounded border border-[#E2EEF5]">
                              ID: {plan.therapyPlanId.slice(0, 12)}...
                            </span>
                          </div>

                          <div className="text-xs text-[#455A64] font-semibold">
                            Fecha de cuota: {plan.dailyAvailability.quotaDate} · Cupos restantes hoy:{' '}
                            <span className="text-[#0F6F62] font-bold">
                              {plan.dailyAvailability.remainingPlanSessionSlots === null
                                ? `Por verificar (límite ${plan.dailySessionLimit})`
                                : `${plan.dailyAvailability.remainingPlanSessionSlots} / ${plan.dailySessionLimit}`}
                            </span>
                          </div>
                        </div>

                        {/* Plan session limits */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                          <div className="bg-[#F0F8FD] border border-[#E1F0FA] rounded-xl p-3">
                            <p className="text-[#455A64]">Meta Diaria</p>
                            <p className="font-bold text-[#1C2A39] text-sm mt-0.5">
                              {plan.dailyTargetDurationMinutes} min
                            </p>
                          </div>
                          <div className="bg-[#F0F8FD] border border-[#E1F0FA] rounded-xl p-3">
                            <p className="text-[#455A64]">Duración Válida</p>
                            <p className="font-bold text-[#1C2A39] text-sm mt-0.5">
                              {plan.minimumValidDurationMinutes} - {plan.maximumSessionDurationMinutes} min
                            </p>
                          </div>
                          <div className="bg-[#F0F8FD] border border-[#E1F0FA] rounded-xl p-3">
                            <p className="text-[#455A64]">Muestras Mínimas</p>
                            <p className="font-bold text-[#1C2A39] text-sm mt-0.5">
                              {plan.minimumValidSampleCount} muestras
                            </p>
                          </div>
                          <div className="bg-[#F0F8FD] border border-[#E1F0FA] rounded-xl p-3">
                            <p className="text-[#455A64]">Límite Seguridad</p>
                            <p className="font-bold text-[#1C2A39] text-sm mt-0.5">
                              {plan.dailyHardSafetyLimitMinutes !== null
                                ? `${plan.dailyHardSafetyLimitMinutes} min`
                                : 'Estándar'}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Configurations / Exercises Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
                        {plan.effectiveConfigurations.map((cfg, idx) => {
                          const { parameters: params, completionTarget } =
                            extractVersionedParameters(cfg);
                          const availability = plan.dailyAvailability.exercises.find(
                            (e) => e.exerciseCode === cfg.exerciseCode
                          );
                          const meta = EXERCISE_LABELS[cfg.exerciseCode];
                          const isBlocked =
                            plan.status !== 'ACTIVE' || availability?.status === 'BLOCKED';
                          const actionKey = `${plan.therapyPlanId}:${cfg.exerciseCode}`;
                          const isStarting = startingKey === actionKey;

                          return (
                            <div
                              key={cfg.configurationId}
                              className={`bg-white border border-[#DCEBF4] rounded-2xl overflow-hidden shadow-xs flex flex-col justify-between border-t-4 ${
                                isBlocked ? 'border-t-[#B85D19]' : 'border-t-[#26A69A]'
                              }`}
                            >
                              <div className="p-6 sm:p-7 space-y-5">
                                {/* Badge & Module */}
                                <div className="flex items-center justify-between gap-2">
                                  <span
                                    className={`inline-flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-bold tracking-wider ${
                                      isBlocked
                                        ? 'bg-[#FFF2E2] text-[#B85D19]'
                                        : 'bg-[#DCF8F2] text-[#0F6F62]'
                                    }`}
                                  >
                                    <Clock size={14} />
                                    <span>{availability?.status || 'DISPONIBLE'}</span>
                                  </span>
                                  <span className="text-xs font-semibold text-[#455A64] bg-[#F3FAFF] px-2.5 py-1 rounded border border-[#E2EEF5]">
                                    Módulo {idx + 1} de {plan.effectiveConfigurations.length} · v
                                    {cfg.version}
                                  </span>
                                </div>

                                {/* Title */}
                                <div>
                                  <h3 className="text-2xl font-bold text-[#1C2A39]">{meta.title}</h3>
                                  <p className="text-sm text-[#0F6F62] font-semibold">
                                    {MODE_LABELS[params.mode]} ({params.mode})
                                  </p>
                                </div>

                                {/* Specs Box */}
                                <div className="bg-[#F0F8FD] rounded-xl p-4 space-y-2.5 text-xs text-[#1C2A39] border border-[#E1F0FA]">
                                  <div className="flex items-center space-x-2.5">
                                    <Target size={16} className="text-[#0F6F62] shrink-0" />
                                    <span>
                                      <strong>Meta:</strong>{' '}
                                      {formatCompletionTargetText(params, completionTarget)}
                                    </span>
                                  </div>
                                  <div className="flex items-center space-x-2.5">
                                    <Clock size={16} className="text-[#0F6F62] shrink-0" />
                                    <span>
                                      <strong>Fijación mínima:</strong> {params.minimumFixationMs} ms ·{' '}
                                      <strong>Nivel:</strong> {params.difficultyLevel}
                                    </span>
                                  </div>
                                  <div className="flex items-start space-x-2.5">
                                    <Compass size={16} className="text-[#0F6F62] shrink-0 mt-0.5" />
                                    <span>
                                      <strong>Campo / Posición:</strong>{' '}
                                      {'affectedHemifield' in params
                                        ? `Hemicampo ${
                                            params.affectedHemifield === 'LEFT'
                                              ? 'Izquierdo'
                                              : 'Derecho'
                                          }`
                                        : `Posición ${params.targetPosition}`}
                                      {availability?.remainingPrescribedSlots !== null &&
                                      availability?.remainingPrescribedSlots !== undefined
                                        ? ` · Cupos hoy: ${availability.remainingPrescribedSlots}`
                                        : ''}
                                    </span>
                                  </div>
                                </div>

                                {/* Availability reason / Clinical Strip */}
                                {isBlocked && availability?.reason ? (
                                  <div className="bg-[#FFF4E5] border border-[#FFE2C2] text-[#B85D19] rounded-xl p-3 text-xs font-medium">
                                    {AVAILABILITY_REASON_LABELS[availability.reason] ||
                                      availability.reason}
                                  </div>
                                ) : (
                                  <div className="bg-[#1C2A39] text-white rounded-xl p-3 flex items-center justify-between px-4">
                                    <div className="flex items-center space-x-2 text-xs">
                                      <Compass size={16} className="text-[#26A69A]" />
                                      <span>{meta.goal}</span>
                                    </div>
                                    <span className="bg-[#2B3E52] text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded text-[#8AE2D6] shrink-0">
                                      ESQUEMA V{cfg.parameterSchemaVersion}
                                    </span>
                                  </div>
                                )}
                              </div>

                              {/* Action Button */}
                              <div className="p-6 sm:p-7 pt-0">
                                <button
                                  type="button"
                                  onClick={() => void handleStartClinicalSession(plan, cfg)}
                                  disabled={isBlocked || isStarting || hasActiveBlockingSession}
                                  className="w-full py-4 bg-[#0F6F62] hover:bg-[#0C584E] disabled:bg-neutral-300 disabled:text-neutral-500 text-white font-bold rounded-xl shadow-sm flex items-center justify-center space-x-2 text-base tracking-wide transition-all active:scale-[0.99] disabled:cursor-not-allowed"
                                >
                                  {isStarting ? (
                                    <Loader2 size={18} className="animate-spin" />
                                  ) : (
                                    <Play size={18} className="fill-current" />
                                  )}
                                  <span>
                                    {hasActiveBlockingSession
                                      ? 'Reanuda tu sesión activa arriba'
                                      : isStarting
                                      ? 'Iniciando Sesión...'
                                      : 'Iniciar Sesión Terapéutica'}
                                  </span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : (
              /* MOCK MODE: Original Stitch Demo Experience preserved */
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
                {/* Card 1: PENDIENTE (Exploración Visual) */}
                <div className="bg-white border border-[#DCEBF4] rounded-2xl overflow-hidden shadow-xs flex flex-col justify-between border-t-4 border-t-[#F4A261]">
                  <div className="p-6 sm:p-7 space-y-5">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center space-x-1.5 bg-[#FFF2E2] text-[#B85D19] px-3 py-1 rounded-md text-xs font-bold tracking-wider">
                        <Clock size={14} />
                        <span>PENDIENTE</span>
                      </span>
                      <span className="text-xs font-semibold text-[#455A64] bg-[#F3FAFF] px-2.5 py-1 rounded border border-[#E2EEF5]">
                        Módulo 1 de 2
                      </span>
                    </div>

                    <div>
                      <h3 className="text-2xl font-bold text-[#1C2A39]">Exploración Visual</h3>
                      <p className="text-sm text-[#455A64] font-medium">(Visual Scanning)</p>
                    </div>

                    <div className="bg-[#F0F8FD] rounded-xl p-4 space-y-2.5 text-xs text-[#1C2A39] border border-[#E1F0FA]">
                      <div className="flex items-center space-x-2.5">
                        <Clock size={16} className="text-[#0F6F62] shrink-0" />
                        <span>
                          <strong>Tiempo estimado:</strong> 10 mins
                        </span>
                      </div>
                      <div className="flex items-center space-x-2.5">
                        <Volume2 size={16} className="text-[#0F6F62] shrink-0" />
                        <span>
                          <strong>Dificultad:</strong> Guiada con estímulo sonoro
                        </span>
                      </div>
                      <div className="flex items-start space-x-2.5">
                        <Target size={16} className="text-[#0F6F62] shrink-0 mt-0.5" />
                        <span>
                          <strong>Objetivo:</strong> Ampliar campo visual periférico y seguimiento
                          sacádico.
                        </span>
                      </div>
                    </div>

                    <div className="bg-[#1C2A39] text-white rounded-xl p-3 flex items-center justify-between px-4">
                      <div className="flex items-center space-x-2 text-xs">
                        <Compass size={16} className="text-[#26A69A]" />
                        <span>Trayectoria guiada: Ondas concéntricas suaves</span>
                      </div>
                      <span className="bg-[#2B3E52] text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded text-[#8AE2D6]">
                        CALIBRADO
                      </span>
                    </div>
                  </div>

                  <div className="p-6 sm:p-7 pt-0">
                    <button
                      type="button"
                      onClick={handleStartMockSession}
                      className="w-full py-4 bg-[#0F6F62] hover:bg-[#0C584E] text-white font-bold rounded-xl shadow-sm flex items-center justify-center space-x-2 text-base tracking-wide transition-all active:scale-[0.99]"
                    >
                      <span>INICIAR AHORA</span>
                      <Play size={18} className="fill-white" />
                    </button>
                  </div>
                </div>

                {/* Card 2: COMPLETADO (Búsqueda Visual) */}
                <div className="bg-white border border-[#DCEBF4] rounded-2xl overflow-hidden shadow-xs flex flex-col justify-between border-t-4 border-t-[#26A69A]">
                  <div className="p-6 sm:p-7 space-y-5">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center space-x-1.5 bg-[#DCF8F2] text-[#0F6F62] px-3 py-1 rounded-md text-xs font-bold tracking-wider">
                        <Check size={14} className="stroke-[3]" />
                        <span>COMPLETADO</span>
                      </span>
                      <span className="text-xs font-semibold text-[#455A64] bg-[#F3FAFF] px-2.5 py-1 rounded border border-[#E2EEF5]">
                        Módulo 2 de 2
                      </span>
                    </div>

                    <div>
                      <h3 className="text-2xl font-bold text-[#1C2A39]">Búsqueda Visual</h3>
                      <p className="text-sm text-[#455A64] font-medium">(Visual Search)</p>
                    </div>

                    <div className="bg-[#F0F8FD] rounded-xl p-4 space-y-2.5 text-xs text-[#1C2A39] border border-[#E1F0FA]">
                      <div className="flex items-center space-x-2.5">
                        <Clock size={16} className="text-[#0F6F62] shrink-0" />
                        <span>
                          <strong>Sesión:</strong> Completado a las 10:15 AM (12 mins)
                        </span>
                      </div>
                      <div className="flex items-center space-x-2.5">
                        <Target size={16} className="text-[#0F6F62] shrink-0" />
                        <span>
                          <strong>Puntuación de Acierto:</strong>{' '}
                          <span className="text-[#0F6F62] font-bold text-sm">92%</span>
                        </span>
                      </div>
                      <div className="flex items-start space-x-2.5">
                        <CheckCircle2 size={16} className="text-[#0F6F62] shrink-0 mt-0.5" />
                        <span>
                          <strong>Respuesta clínica:</strong> Precisión dentro del rango óptimo
                          pautado.
                        </span>
                      </div>
                    </div>

                    <div className="bg-[#EBF7FD] rounded-xl p-3.5 flex items-start space-x-3 border border-[#CDE9FA]">
                      <div className="w-7 h-7 rounded-lg bg-[#26A69A] text-white flex items-center justify-center shrink-0 mt-0.5">
                        <Search size={14} />
                      </div>
                      <div className="text-xs">
                        <p className="font-bold text-[#1C2A39]">Respuesta Neurosensorial</p>
                        <p className="text-[#455A64] mt-0.5">
                          Tiempos de fijación ocular sincronizados con éxito.
                        </p>
                      </div>
                    </div>

                    {mockSummaryVisible && (
                      <div className="bg-[#DCF8F2] border border-[#A7E7DC] text-[#0F6F62] rounded-xl p-3 text-xs font-medium">
                        Resumen Demo: Latencia media sacádica 312 ms · Estabilidad foveal 94% · 0
                        omisiones periféricas.
                      </div>
                    )}
                  </div>

                  <div className="p-6 sm:p-7 pt-0">
                    <button
                      type="button"
                      onClick={() => setMockSummaryVisible((prev) => !prev)}
                      className="w-full py-3.5 bg-white hover:bg-[#F3FAFF] text-[#1C2A39] border-2 border-[#1C2A39] font-bold rounded-xl shadow-2xs flex items-center justify-center space-x-2 text-sm tracking-wide transition-all active:scale-[0.99]"
                    >
                      <span>
                        {mockSummaryVisible ? 'Ocultar Resumen' : 'Ver Resumen del Ejercicio'}
                      </span>
                      <CheckCircle2 size={17} className="text-[#26A69A]" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Health / Fatigue Alert Banner */}
        <div className="bg-[#FFE5D2] border border-[#FCD2B3] rounded-2xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start space-x-3.5">
            <div className="w-8 h-8 rounded-full bg-[#B85D19] text-white flex items-center justify-center shrink-0 mt-0.5">
              <AlertTriangle size={18} />
            </div>
            <div>
              <h4 className="font-bold text-sm sm:text-base text-[#1C2A39]">
                Recordatorio de Salud Ocular
              </h4>
              <p className="text-xs sm:text-sm text-[#455A64] mt-0.5 max-w-2xl leading-relaxed">
                Si sientes fatiga visual o mareo, recuerda descansar la vista cerrando los ojos
                durante 2 minutos o contacta a tu especialista de inmediato.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={startRest}
            disabled={isResting}
            className="bg-[#3D1E0C] hover:bg-[#2B1406] text-white px-5 py-3 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center space-x-2 shrink-0 transition-all shadow-xs active:scale-95 disabled:opacity-75"
          >
            <Pause size={16} className="fill-white" />
            <span>{isResting ? `Descansando (${restSeconds}s)` : 'Pausar 2 min'}</span>
          </button>
        </div>

        {/* Technical Support Banner */}
        <div className="bg-[#E4F4FF] border border-[#CDE9FA] rounded-2xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-3.5">
            <div className="w-10 h-10 rounded-full bg-white text-[#26A69A] border border-[#CDE9FA] flex items-center justify-center shrink-0">
              <PhoneCall size={20} />
            </div>
            <div>
              <h4 className="font-bold text-sm sm:text-base text-[#1C2A39]">
                ¿Tienes dudas o necesitas ayuda técnica?
              </h4>
              <p className="text-xs text-[#455A64] mt-0.5">
                Nuestro equipo clínico y soporte telefónico está disponible.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsEmergencyModalOpen(true)}
            className="bg-white hover:bg-neutral-50 text-[#1C2A39] border border-[#1C2A39] px-5 py-3 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center space-x-2.5 shrink-0 transition-all shadow-2xs active:scale-95"
          >
            <MessageSquare size={16} className="text-[#0F6F62]" />
            <span>Asistencia Inmediata por Teléfono / WhatsApp</span>
          </button>
        </div>
      </main>

      {/* Modal de Emergencia y Soporte Clínico */}
      {isEmergencyModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="emergency-modal-title"
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto animate-in fade-in duration-200"
        >
          <div className="bg-white border-2 border-[#B71C1C] text-[#1C2A39] max-w-2xl w-full rounded-2xl p-6 sm:p-8 space-y-6 shadow-2xl relative my-auto max-h-[92vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-start justify-between gap-4 border-b border-red-100 pb-4">
              <div className="space-y-1">
                <span className="inline-flex items-center gap-1.5 bg-red-100 text-red-800 px-3 py-0.5 rounded text-xs font-bold uppercase tracking-wider">
                  <AlertOctagon size={14} className="text-red-700" /> Protocolo de Seguridad Clínica
                </span>
                <h2 id="emergency-modal-title" className="text-2xl font-extrabold text-[#B71C1C]">
                  Soporte de Emergencia y Asistencia Inmediata
                </h2>
                <p className="text-xs sm:text-sm text-[#455A64]">
                  Si presentas malestar durante los ejercicios o requieres apoyo médico urgente, utiliza los canales directos.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsEmergencyModalOpen(false)}
                aria-label="Cerrar ventana de emergencia"
                className="text-[#455A64] hover:text-[#1C2A39] p-2 rounded-xl hover:bg-neutral-100 transition-all"
              >
                <X size={22} />
              </button>
            </div>

            {/* Señales de alarma */}
            <div className="bg-[#FFF5F5] border border-red-200 rounded-xl p-4 sm:p-5 space-y-2">
              <h3 className="font-bold text-sm text-red-900 flex items-center gap-2">
                <AlertTriangle size={17} className="text-red-700 shrink-0" />
                <span>Señales de Alarma para Detener el Ejercicio de Inmediato:</span>
              </h3>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-red-800 pt-1">
                <li className="flex items-start gap-1.5">
                  <span className="font-bold">•</span>
                  <span>Mareo agudo o sensación de giro / vértigo</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="font-bold">•</span>
                  <span>Cefalea punzante o dolor ocular intenso</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="font-bold">•</span>
                  <span>Visión doble (diplopía) persistente</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="font-bold">•</span>
                  <span>Náuseas, lagrimeo excesivo o desorientación</span>
                </li>
              </ul>
            </div>

            {/* Ficha Clínica y Contacto Registrado */}
            <div className="bg-[#F8FBFE] border border-[#CDE9FA] rounded-xl p-4 sm:p-5 space-y-3">
              <h4 className="font-bold text-sm text-[#1C2A39] flex items-center justify-between">
                <span>Ficha del Paciente y Contacto de Referencia</span>
                <button
                  type="button"
                  onClick={handleCopyClinicalData}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0F6F62] hover:underline"
                >
                  <Copy size={13} />
                  <span>{copiedClinicalData ? '¡Copiado!' : 'Copiar Ficha'}</span>
                </button>
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-[#455A64]">Nombre del Paciente:</span>
                  <p className="font-bold text-[#1C2A39]">
                    {userProfile
                      ? `${userProfile.firstName || ''} ${userProfile.lastName || ''}`.trim() || 'Registrado'
                      : 'Roberto Mendoza'}
                  </p>
                </div>
                <div>
                  <span className="text-[#455A64]">Documento de Identidad:</span>
                  <p className="font-bold text-[#1C2A39]">
                    {userProfile?.documentNumber || '45891234'}
                  </p>
                </div>
                <div>
                  <span className="text-[#455A64]">Teléfono Registrado:</span>
                  <p className="font-bold text-[#1C2A39]">
                    {userProfile?.phone || '+51 987 654 321'}
                  </p>
                </div>
                <div>
                  <span className="text-[#455A64]">Sesión Activa:</span>
                  <p className="font-mono font-bold text-[#0F6F62]">
                    {currentSessionRes?.state === 'ACTIVE' && currentSessionRes.session
                      ? currentSessionRes.session.therapySessionId.slice(0, 14) + '...'
                      : 'Ninguna sesión activa'}
                  </p>
                </div>
              </div>
            </div>

            {/* Pausar / Cancelar sesión activa si existe */}
            {currentSessionRes?.state === 'ACTIVE' && currentSessionRes.session && (
              <div className="bg-[#FFF4E5] border border-[#FFE2C2] rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-xs text-[#B85D19]">
                    Sesión Terapéutica en Curso Detectada
                  </h4>
                  {emergencySessionNotice && (
                    <span className="text-[11px] font-bold text-[#0F6F62]">
                      {emergencySessionNotice}
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#455A64]">
                  Si te sientes mal, pulsa este botón para guardar el avance técnico y cerrar la sesión sin penalización clínica.
                </p>
                <button
                  type="button"
                  onClick={() => void handleEmergencyAbandonActiveSession()}
                  disabled={isPausingEmergencySession}
                  className="px-4 py-2 bg-[#B85D19] hover:bg-[#974911] text-white font-bold rounded-lg text-xs flex items-center gap-2 transition-all disabled:opacity-50"
                >
                  {isPausingEmergencySession ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Pause size={14} />
                  )}
                  <span>Pausar y Finalizar Sesión Activa por Seguridad</span>
                </button>
              </div>
            )}

            {/* Canales de Contacto Directo */}
            <div className="space-y-3 pt-1">
              <a
                href="tel:+51999888777"
                className="w-full py-3.5 px-6 rounded-xl bg-[#B71C1C] hover:bg-[#9B1717] text-white font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-95 shadow-md"
              >
                <Phone size={18} />
                <span>Llamar a Emergencias Médicas (+51 999 888 777)</span>
              </a>

              <a
                href="https://wa.me/51999888777?text=Hola,%20soy%20paciente%20de%20NeuroVision%20Rehab%20y%20necesito%20asistencia%20clinica"
                target="_blank"
                rel="noreferrer"
                className="w-full py-3 px-6 rounded-xl border-2 border-[#0F6F62] text-[#0F6F62] hover:bg-[#F0FDF9] font-bold text-sm flex items-center justify-center gap-2 transition-all"
              >
                <MessageSquare size={17} />
                <span>Contactar por WhatsApp con Unidad de Telerehabilitación</span>
              </a>
            </div>

            {/* Footer */}
            <div className="pt-2 flex justify-end border-t border-[#E2EEF5]">
              <button
                type="button"
                onClick={() => setIsEmergencyModalOpen(false)}
                className="px-6 py-2.5 rounded-xl border border-[#D5E5EF] text-xs font-bold text-[#1C2A39] hover:bg-[#F3FAFF] transition-all"
              >
                Cerrar Ventana
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-[#E2EEF5] bg-white py-4 px-6 lg:px-12 mt-12 text-xs text-[#455A64] flex flex-col sm:flex-row items-center justify-between gap-2">
        <div className="flex items-center space-x-2">
          <span className="text-[#26A69A] font-bold">♿</span>
          <span>Interfaz adaptada</span>
        </div>
        <div>Plataforma Médica Homologada © 2024 NeuroVisión Rehab</div>
      </footer>
    </div>
  );
};
