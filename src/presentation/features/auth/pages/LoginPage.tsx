import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShieldCheck,
  KeyRound,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  UserCheck,
  Stethoscope,
  LogIn,
  Server,
  Info,
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowLeft,
  Key,
  Type,
} from 'lucide-react';
import loginImage from '../../../../assets/login-image.png';
import { useAppStore, type UserRole, type AuthMode } from '../../../../core/store/useAppStore';
import type { ProfileResponse } from '../../../../infrastructure/api/contracts/profile.contracts';
import { ApiError, extractApiErrorMessage } from '../../../../infrastructure/api/httpClient';
import { profileApi } from '../../../../infrastructure/api/profileApi';
import {
  BACKEND_SERVICES_META,
  checkAllServicesHealth,
  getServiceEndpointDisplay,
  type ServiceHealthInfo,
} from '../../../../infrastructure/api/healthApi';
import {
  getCognitoConfig,
  startCognitoLogin,
  exchangeCognitoCodeForTokens,
  parseJwtClaims,
  signInWithCognitoPassword,
  completeCognitoNewPasswordChallenge,
  requestCognitoPasswordReset,
  confirmCognitoPasswordReset,
  type AppRole,
} from '../../../../infrastructure/api/cognitoAuth';

interface LoginPageProps {
  onLoginSuccess: (
    role: UserRole,
    options?: {
      accessToken?: string | null;
      refreshToken?: string | null;
      authMode?: AuthMode;
      profile?: ProfileResponse | null;
    }
  ) => void;
}

function stripBearerPrefix(raw: string): string {
  return raw.replace(/^Bearer\s+/i, '').trim();
}

function formatExpiration(exp: number | null): string {
  if (!exp) return 'Sin expiración';
  return new Date(exp * 1000).toLocaleString('es-PE', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const navigate = useNavigate();
  const {
    setAccessToken,
    setAuthMode,
    setBackendHealth,
    highVisibilityMode,
    toggleHighVisibilityMode,
  } = useAppStore();

  const cognitoConfig = useMemo(() => getCognitoConfig(), []);

  // Backend health state
  const [servicesHealth, setServicesHealth] = useState<ServiceHealthInfo[]>(() =>
    BACKEND_SERVICES_META.map((meta) => {
      const { endpointDisplay, swaggerUrl } = getServiceEndpointDisplay(meta);
      return {
        service: meta.service,
        label: meta.label,
        port: meta.port,
        endpointDisplay,
        swaggerUrl,
        ready: false,
        statusText: 'Verificando...',
        latencyMs: null,
      };
    })
  );
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [healthExpanded, setHealthExpanded] = useState(false);

  // Global Auth alerts
  const [authError, setAuthError] = useState<string | null>(null);
  const [authInfo, setAuthInfo] = useState<string | null>(null);

  // Direct AWS Cognito Login State (Email + Password)
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Cognito NEW_PASSWORD_REQUIRED Challenge State
  const [newPasswordChallenge, setNewPasswordChallenge] = useState<{
    session: string;
    username: string;
  } | null>(null);
  const [challengeNewPassword, setChallengeNewPassword] = useState('');
  const [challengeConfirmPassword, setChallengeConfirmPassword] = useState('');
  const [challengeGivenName, setChallengeGivenName] = useState('');
  const [challengeFamilyName, setChallengeFamilyName] = useState('');
  const [showChallengePassword, setShowChallengePassword] = useState(false);
  const [isCompletingChallenge, setIsCompletingChallenge] = useState(false);

  // Forgot Password Flow State
  const [forgotPasswordStep, setForgotPasswordStep] = useState<'IDLE' | 'REQUEST' | 'CONFIRM'>('IDLE');
  const [forgotUsername, setForgotUsername] = useState('');
  const [forgotCode, setForgotCode] = useState('');
  const [forgotNewPassword, setForgotNewPassword] = useState('');
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState('');
  const [showForgotNewPassword, setShowForgotNewPassword] = useState(false);
  const [isForgotSubmitting, setIsForgotSubmitting] = useState(false);
  const [forgotDestination, setForgotDestination] = useState<string | null>(null);

  // Secondary Panels / Tabs
  const [activeSecondaryTab, setActiveSecondaryTab] = useState<'hosted-ui' | 'jwt' | 'demo'>('hosted-ui');
  const [secondaryAccordionOpen, setSecondaryAccordionOpen] = useState(false);

  // Auth / PKCE / JWT state
  const [pkceLoading, setPkceLoading] = useState(false);
  const [rawJwt, setRawJwt] = useState('');
  const [manualRoleOverride, setManualRoleOverride] = useState<AppRole>('SPECIALIST');
  const [jwtSubmitting, setJwtSubmitting] = useState(false);

  const isMountedRef = useRef(false);
  const handledPkceCodeRef = useRef<string | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const refreshHealth = useCallback(async () => {
    setCheckingHealth(true);
    try {
      const { services, statusMap } = await checkAllServicesHealth();
      if (!isMountedRef.current) return;
      setServicesHealth(services);
      setBackendHealth(statusMap);
    } finally {
      if (isMountedRef.current) {
        setCheckingHealth(false);
      }
    }
  }, [setBackendHealth]);

  // Helper to probe profile safely after setting token in store
  const probeProfileAndProceed = useCallback(
    async (token: string, role: AppRole, refreshToken?: string | null) => {
      setAccessToken(token);
      if (refreshToken !== undefined) {
        useAppStore.getState().setRefreshToken(refreshToken);
      }
      setAuthMode('COGNITO');

      let profile: ProfileResponse | null = null;
      try {
        profile = await profileApi.getMyProfile();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setAccessToken(null);
          useAppStore.getState().setRefreshToken(null);
          setAuthMode('MOCK');
          throw new Error(
            'El backend rechazó el Access Token (401 Unauthorized). Verifica firma o vigencia.'
          );
        }
        // 403 (pendiente activación IAM) o 404 (perfil aún no completado) se ignoran limpiamente
        profile = null;
      }

      if (!isMountedRef.current) return;
      onLoginSuccess(role, {
        accessToken: token,
        refreshToken: refreshToken ?? null,
        authMode: 'COGNITO',
        profile,
      });
    },
    [onLoginSuccess, setAccessToken, setAuthMode]
  );

  // On mount: check backend services health
  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth]);

  // On mount: check Cognito OAuth2 PKCE callback (?code=...&state=...)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get('error');
    const oauthErrorDesc = params.get('error_description');
    const code = params.get('code');
    const state = params.get('state');

    if (oauthError) {
      window.history.replaceState({}, document.title, window.location.pathname);
      setAuthError(
        `Error de autenticación Cognito (${oauthError}): ${oauthErrorDesc || 'Acceso cancelado o denegado.'}`
      );
      return;
    }

    if (!code) return;
    if (handledPkceCodeRef.current === code) return;
    handledPkceCodeRef.current = code;

    // Clean URL immediately while preserving extracted code & state
    window.history.replaceState({}, document.title, window.location.pathname);

    const completePkceCallback = async () => {
      setPkceLoading(true);
      setAuthError(null);
      setAuthInfo('Intercambiando código OAuth2 PKCE con Cognito...');

      try {
        const tokens = await exchangeCognitoCodeForTokens(code, state);
        const claims = parseJwtClaims(tokens.accessToken);

        if (claims.isExpired) {
          throw new Error('El Access Token recibido de Cognito ya se encuentra expirado.');
        }

        if (!claims.appRole) {
          if (!isMountedRef.current) return;
          setRawJwt(tokens.accessToken);
          setActiveSecondaryTab('jwt');
          setSecondaryAccordionOpen(true);
          setAuthInfo(
            'Sesión Cognito verificada, pero el token no declara cognito:groups (DOCTOR / PATIENT). Selecciona manualmente el rol en el panel JWT.'
          );
          return;
        }

        if (isMountedRef.current) {
          setAuthInfo('Verificando perfil clínico...');
        }
        await probeProfileAndProceed(tokens.accessToken, claims.appRole, tokens.refreshToken);
        navigate(claims.appRole === 'SPECIALIST' ? '/specialist/dashboard' : '/patient/dashboard');
      } catch (err) {
        if (!isMountedRef.current) return;
        setAuthInfo(null);
        setAuthError(extractApiErrorMessage(err));
      } finally {
        if (isMountedRef.current) {
          setPkceLoading(false);
        }
      }
    };

    void completePkceCallback();
  }, [probeProfileAndProceed, navigate]);

  // Direct AWS Cognito Password Login Handler
  const handleDirectPasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthInfo(null);

    const userClean = loginUsername.trim();
    if (!userClean || !loginPassword) {
      setAuthError('Por favor ingresa tu correo electrónico / usuario y contraseña.');
      return;
    }

    setIsLoggingIn(true);
    try {
      const result = await signInWithCognitoPassword(userClean, loginPassword);

      if (result.status === 'NEW_PASSWORD_REQUIRED') {
        setNewPasswordChallenge({
          session: result.session,
          username: result.username,
        });
        setChallengeNewPassword('');
        setChallengeConfirmPassword('');
        setAuthInfo(
          'Primer inicio de sesión detectado. AWS Cognito requiere que definas una nueva contraseña definitiva.'
        );
        return;
      }

      // SUCCESS: tokens returned
      const claims = parseJwtClaims(result.accessToken);
      if (claims.isExpired) {
        throw new Error('El Access Token retornado por AWS Cognito ya se encuentra expirado.');
      }

      const targetRole: AppRole = claims.appRole ?? 'SPECIALIST';
      setAuthInfo('Autenticación confirmada. Accediendo a la estación clínica...');
      await probeProfileAndProceed(result.accessToken, targetRole, result.refreshToken);
      navigate(targetRole === 'SPECIALIST' ? '/specialist/dashboard' : '/patient/dashboard');
    } catch (err) {
      setAuthError(extractApiErrorMessage(err));
    } finally {
      if (isMountedRef.current) {
        setIsLoggingIn(false);
      }
    }
  };

  // Cognito NEW_PASSWORD_REQUIRED Challenge Handler
  const handleCompleteNewPasswordChallenge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPasswordChallenge) return;
    setAuthError(null);
    setAuthInfo(null);

    if (challengeNewPassword.length < 8) {
      setAuthError('La nueva contraseña debe tener al menos 8 caracteres, números y mayúsculas.');
      return;
    }
    if (challengeNewPassword !== challengeConfirmPassword) {
      setAuthError('Las contraseñas ingresadas no coinciden.');
      return;
    }

    setIsCompletingChallenge(true);
    try {
      const tokens = await completeCognitoNewPasswordChallenge({
        username: newPasswordChallenge.username,
        newPassword: challengeNewPassword,
        session: newPasswordChallenge.session,
        givenName: challengeGivenName.trim() || undefined,
        familyName: challengeFamilyName.trim() || undefined,
      });

      setNewPasswordChallenge(null);
      setChallengeNewPassword('');
      setChallengeConfirmPassword('');
      setChallengeGivenName('');
      setChallengeFamilyName('');

      const claims = parseJwtClaims(tokens.accessToken);
      const targetRole: AppRole = claims.appRole ?? 'SPECIALIST';
      setAuthInfo('Nueva contraseña configurada exitosamente. Accediendo al portal...');
      await probeProfileAndProceed(tokens.accessToken, targetRole, tokens.refreshToken);
      navigate(targetRole === 'SPECIALIST' ? '/specialist/dashboard' : '/patient/dashboard');
    } catch (err) {
      setAuthError(extractApiErrorMessage(err));
    } finally {
      if (isMountedRef.current) {
        setIsCompletingChallenge(false);
      }
    }
  };

  // Request Password Reset Code
  const handleRequestPasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthInfo(null);

    const userClean = forgotUsername.trim();
    if (!userClean) {
      setAuthError('Por favor ingresa tu correo electrónico o identificador de usuario.');
      return;
    }

    setIsForgotSubmitting(true);
    try {
      const res = await requestCognitoPasswordReset(userClean);
      setForgotDestination(res.destination || null);
      setForgotPasswordStep('CONFIRM');
      setAuthInfo(
        res.destination
          ? `Código de verificación enviado a ${res.destination}. Revisa tu bandeja de entrada o spam.`
          : 'Código de verificación enviado a tu correo registrado en Cognito.'
      );
    } catch (err) {
      setAuthError(extractApiErrorMessage(err));
    } finally {
      if (isMountedRef.current) {
        setIsForgotSubmitting(false);
      }
    }
  };

  // Confirm Password Reset with Code + New Password
  const handleConfirmPasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthInfo(null);

    if (!forgotCode.trim()) {
      setAuthError('Por favor ingresa el código de verificación recibido por correo.');
      return;
    }
    if (forgotNewPassword.length < 8) {
      setAuthError('La nueva contraseña debe tener como mínimo 8 caracteres.');
      return;
    }
    if (forgotNewPassword !== forgotConfirmPassword) {
      setAuthError('Las contraseñas no coinciden.');
      return;
    }

    setIsForgotSubmitting(true);
    try {
      await confirmCognitoPasswordReset({
        username: forgotUsername.trim(),
        confirmationCode: forgotCode.trim(),
        newPassword: forgotNewPassword,
      });

      setForgotPasswordStep('IDLE');
      setLoginUsername(forgotUsername.trim());
      setLoginPassword('');
      setForgotCode('');
      setForgotNewPassword('');
      setForgotConfirmPassword('');
      setAuthInfo('Contraseña actualizada correctamente. Ya puedes iniciar sesión con tu nueva contraseña.');
    } catch (err) {
      setAuthError(extractApiErrorMessage(err));
    } finally {
      if (isMountedRef.current) {
        setIsForgotSubmitting(false);
      }
    }
  };

  // JWT parsing & validation logic
  const cleanToken = useMemo(() => stripBearerPrefix(rawJwt), [rawJwt]);
  const hasJwtSegments = cleanToken.split('.').length === 3;
  const decodedClaims = useMemo(
    () => (cleanToken ? parseJwtClaims(cleanToken) : null),
    [cleanToken]
  );

  const isNonAccessToken = Boolean(
    decodedClaims?.tokenUse && decodedClaims.tokenUse !== 'access'
  );
  const isTokenStructurallyValid = Boolean(
    cleanToken && hasJwtSegments && decodedClaims && (decodedClaims.sub || decodedClaims.exp)
  );
  const needsManualRole = Boolean(
    isTokenStructurallyValid && decodedClaims && decodedClaims.groups.length === 0
  );
  const canSubmitJwt = Boolean(
    isTokenStructurallyValid &&
      !isNonAccessToken &&
      !decodedClaims?.isExpired &&
      !jwtSubmitting
  );

  const handleStartCognitoHostedUi = async () => {
    setAuthError(null);
    setAuthInfo(null);
    try {
      setPkceLoading(true);
      await startCognitoLogin();
    } catch (err) {
      setPkceLoading(false);
      setAuthError(extractApiErrorMessage(err));
    }
  };

  const handleJwtLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthInfo(null);

    if (!cleanToken || !isTokenStructurallyValid || !decodedClaims) {
      setAuthError('El texto ingresado no corresponde a un JWT válido de 3 segmentos.');
      return;
    }

    if (isNonAccessToken) {
      setAuthError(
        `Token rechazado: el token tiene token_use='${decodedClaims.tokenUse}'. Los microservicios requieren un Access Token de Cognito (token_use: 'access').`
      );
      return;
    }

    if (decodedClaims.isExpired) {
      setAuthError('El Access Token JWT ha expirado. Genera un token vigente.');
      return;
    }

    const resolvedRole: AppRole = decodedClaims.appRole ?? manualRoleOverride;

    setJwtSubmitting(true);
    try {
      await probeProfileAndProceed(cleanToken, resolvedRole);
      navigate(resolvedRole === 'SPECIALIST' ? '/specialist/dashboard' : '/patient/dashboard');
    } catch (err) {
      setAuthError(extractApiErrorMessage(err));
    } finally {
      if (isMountedRef.current) {
        setJwtSubmitting(false);
      }
    }
  };

  const handleDemoLogin = (role: 'SPECIALIST' | 'PATIENT') => {
    setAuthError(null);
    setAuthInfo(null);
    onLoginSuccess(role, {
      authMode: 'MOCK',
      accessToken: null,
      profile: null,
    });
    navigate(role === 'SPECIALIST' ? '/specialist/dashboard' : '/patient/dashboard');
  };

  const onlineCount = servicesHealth.filter((s) => s.ready).length;
  const totalCount = servicesHealth.length;

  return (
    <div className="wcag-patient-surface min-h-screen lg:h-screen bg-bgMain font-sans">
      <div className="min-h-screen lg:h-full max-w-[1920px] mx-auto w-full flex">
        {/* Columna Izquierda - Imagen */}
        <div className="hidden lg:flex lg:w-[44%] 2xl:max-w-[880px] p-4 pl-4 pr-0 h-full shrink-0">
        <div className="w-full h-full relative rounded-xl overflow-hidden border-2 border-white/20">
          <img
            src={loginImage}
            alt="NeuroVision abstract"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-x-0 bottom-0 p-6 bg-gradient-to-t from-[#071524]/85 via-[#071524]/40 to-transparent text-white">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#26A69A]/25 border border-[#84F5E8]/35 text-[#84F5E8] text-xs font-bold mb-2">
              <ShieldCheck className="w-3.5 h-3.5" />
              Plataforma Clínica v4.8-FHIR
            </span>
            <p className="text-xs text-white/85 leading-relaxed max-w-md">
              Rehabilitación oculomotora de precisión con telemetría WebRTC/MediaPipe y arquitectura de microservicios Quarkus + Cognito.
            </p>
          </div>
        </div>
      </div>

      {/* Columna Derecha - Formularios y Paneles */}
      <div className="wcag-patient-surface w-full lg:w-[56%] flex flex-col justify-between p-6 sm:p-10 lg:px-14 lg:py-8 bg-bgMain lg:overflow-y-auto">
        <div className="w-full max-w-lg mx-auto my-auto py-4 space-y-6">
          {/* Header Principal + Botón WCAG 2.2 AAA */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div>
              <h1 className="text-3xl sm:text-[2.35rem] font-bold text-primary mb-2 leading-tight tracking-tight">
                Bienvenido a<br />NeuroVisión Rehab
              </h1>
              <p className="text-neutral text-sm">
                Inicia sesión con tu cuenta corporativa AWS Cognito, Bearer JWT de desarrollo o Modo Demo local.
              </p>
            </div>
            <button
              type="button"
              aria-pressed={highVisibilityMode}
              onClick={toggleHighVisibilityMode}
              title="Alternar modo de alta visibilidad WCAG 2.2 AAA (contraste >= 7:1, escala +19% y áreas >= 44px)"
              className={`inline-flex items-center space-x-1.5 px-3 py-2 rounded-xl border text-xs font-extrabold shrink-0 transition-all cursor-pointer ${
                highVisibilityMode
                  ? 'bg-[#FFFF00] text-[#071524] border-2 border-[#071524] shadow-xs'
                  : 'bg-[#EBF7FD] text-[#1C2A39] border-[#CDE9FA] hover:bg-[#DCEFF9]'
              }`}
            >
              <Type size={15} />
              <span>{highVisibilityMode ? 'WCAG AAA: Activo' : 'Alta Visibilidad +'}</span>
            </button>
          </div>

          {/* Global Auth Alerts */}
          {authError && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-900 flex items-start gap-2.5 text-xs">
              <AlertTriangle className="w-4 h-4 text-[#BA1A1A] shrink-0 mt-0.5" />
              <span className="font-medium leading-relaxed">{authError}</span>
            </div>
          )}

          {authInfo && (
            <div className="p-3.5 rounded-xl bg-[#DBF1FE] border border-[#006A62]/25 text-[#071E27] flex items-start gap-2.5 text-xs">
              {pkceLoading || isLoggingIn || isCompletingChallenge || isForgotSubmitting ? (
                <Loader2 className="w-4 h-4 text-[#006A62] shrink-0 mt-0.5 animate-spin" />
              ) : (
                <Info className="w-4 h-4 text-[#006A62] shrink-0 mt-0.5" />
              )}
              <span className="font-medium leading-relaxed">{authInfo}</span>
            </div>
          )}

          {/* ============================================================== */}
          {/* VISTA 1: RETO NEW_PASSWORD_REQUIRED (Contraseña Temporal Invitación) */}
          {/* ============================================================== */}
          {newPasswordChallenge ? (
            <div className="bg-white rounded-2xl border-2 border-[#006A62] p-5 sm:p-6 shadow-md space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#E6F6FF] text-[#006A62] flex items-center justify-center shrink-0">
                  <Key className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-[#071524]">
                    Establecer Nueva Contraseña Definitiva
                  </h2>
                  <p className="text-xs text-[#44474C]">
                    Usuario: <strong className="text-[#071524]">{newPasswordChallenge.username}</strong>
                  </p>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  Has iniciado sesión con una contraseña temporal de invitación. Establece tu nueva contraseña clínica para activar tu acceso.
                </span>
              </div>

              <form onSubmit={handleCompleteNewPasswordChallenge} className="space-y-3.5 text-xs">
                <div>
                  <label className="block font-bold text-[#071524] mb-1">
                    Nueva Contraseña * (Mín. 8 carácteres, mayúsculas y números)
                  </label>
                  <div className="relative">
                    <input
                      type={showChallengePassword ? 'text' : 'password'}
                      required
                      value={challengeNewPassword}
                      onChange={(e) => setChallengeNewPassword(e.target.value)}
                      placeholder="••••••••••••"
                      className="w-full pl-3 pr-10 py-2.5 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/70 text-[#071524] text-xs focus:ring-2 focus:ring-[#006A62] outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowChallengePassword(!showChallengePassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#44474C] hover:text-[#071524] cursor-pointer"
                    >
                      {showChallengePassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-[#071524] mb-1">
                    Confirmar Nueva Contraseña *
                  </label>
                  <input
                    type={showChallengePassword ? 'text' : 'password'}
                    required
                    value={challengeConfirmPassword}
                    onChange={(e) => setChallengeConfirmPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full px-3 py-2.5 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/70 text-[#071524] text-xs focus:ring-2 focus:ring-[#006A62] outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block font-bold text-[#071524] mb-1">
                      Nombre (opcional)
                    </label>
                    <input
                      type="text"
                      value={challengeGivenName}
                      onChange={(e) => setChallengeGivenName(e.target.value)}
                      placeholder="Ej. Roberto"
                      className="w-full px-3 py-2 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/70 text-[#071524] text-xs focus:ring-2 focus:ring-[#006A62] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-[#071524] mb-1">
                      Apellidos (opcional)
                    </label>
                    <input
                      type="text"
                      value={challengeFamilyName}
                      onChange={(e) => setChallengeFamilyName(e.target.value)}
                      placeholder="Ej. Salazar"
                      className="w-full px-3 py-2 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/70 text-[#071524] text-xs focus:ring-2 focus:ring-[#006A62] outline-none"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setNewPasswordChallenge(null);
                      setAuthError(null);
                      setAuthInfo(null);
                    }}
                    className="px-3.5 py-2.5 rounded-lg border border-[#C4C6CC] text-[#44474C] font-semibold hover:bg-[#F3FAFF] transition-colors cursor-pointer"
                  >
                    Volver al login
                  </button>

                  <button
                    type="submit"
                    disabled={isCompletingChallenge}
                    className="flex-1 py-2.5 px-4 rounded-xl bg-[#006A62] hover:bg-[#005049] disabled:opacity-60 text-white font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    {isCompletingChallenge ? (
                      <Loader2 className="w-4 h-4 animate-spin text-[#84F5E8]" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-[#84F5E8]" />
                    )}
                    <span>
                      {isCompletingChallenge
                        ? 'Actualizando contraseña...'
                        : 'Establecer Contraseña y Entrar'}
                    </span>
                  </button>
                </div>
              </form>
            </div>
          ) : forgotPasswordStep !== 'IDLE' ? (
            /* ============================================================== */
            /* VISTA 2: ¿OLVIDASTE TU CONTRASEÑA? (Request / Confirm Reset) */
            /* ============================================================== */
            <div className="bg-white rounded-2xl border border-[#071524]/10 p-5 sm:p-6 shadow-xs space-y-4">
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setForgotPasswordStep('IDLE');
                    setAuthError(null);
                    setAuthInfo(null);
                  }}
                  className="p-1.5 rounded-lg text-[#44474C] hover:bg-[#F3FAFF] hover:text-[#071524] transition-colors cursor-pointer"
                  title="Volver"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div>
                  <h2 className="text-base font-bold text-[#071524]">
                    Recuperación de Contraseña AWS Cognito
                  </h2>
                  <p className="text-xs text-[#44474C]">
                    {forgotPasswordStep === 'REQUEST'
                      ? 'Paso 1 de 2: Solicita un código de verificación a tu correo registrado'
                      : 'Paso 2 de 2: Ingresa el código y define tu nueva contraseña'}
                  </p>
                </div>
              </div>

              {forgotPasswordStep === 'REQUEST' ? (
                <form onSubmit={handleRequestPasswordReset} className="space-y-3.5 text-xs">
                  <div>
                    <label className="block font-bold text-[#071524] mb-1">
                      Correo Electrónico o Usuario Registrado *
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-[#44474C] absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        required
                        value={forgotUsername}
                        onChange={(e) => setForgotUsername(e.target.value)}
                        placeholder="doctor@hospital.pe o usuario"
                        className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/70 text-[#071524] text-xs focus:ring-2 focus:ring-[#006A62] outline-none"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isForgotSubmitting}
                    className="w-full py-3 px-4 rounded-xl bg-[#1C2A39] hover:bg-[#071524] disabled:opacity-60 text-white font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    {isForgotSubmitting ? (
                      <Loader2 className="w-4 h-4 animate-spin text-[#84F5E8]" />
                    ) : (
                      <Mail className="w-4 h-4 text-[#84F5E8]" />
                    )}
                    <span>
                      {isForgotSubmitting ? 'Enviando código...' : 'Enviar Código de Verificación'}
                    </span>
                  </button>
                </form>
              ) : (
                <form onSubmit={handleConfirmPasswordReset} className="space-y-3.5 text-xs">
                  {forgotDestination && (
                    <div className="p-2.5 rounded-lg bg-[#DBF1FE] border border-[#006A62]/20 text-[#071E27] text-xs">
                      Código enviado al destino:{' '}
                      <strong className="text-[#006A62]">{forgotDestination}</strong>
                    </div>
                  )}

                  <div>
                    <label className="block font-bold text-[#071524] mb-1">
                      Código de Verificación (6 dígitos) *
                    </label>
                    <input
                      type="text"
                      required
                      value={forgotCode}
                      onChange={(e) => setForgotCode(e.target.value)}
                      placeholder="Ej. 481923"
                      className="w-full px-3 py-2.5 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/70 font-mono text-sm tracking-wider text-[#071524] focus:ring-2 focus:ring-[#006A62] outline-none"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-[#071524] mb-1">
                      Nueva Contraseña * (Mín. 8 caracteres)
                    </label>
                    <div className="relative">
                      <input
                        type={showForgotNewPassword ? 'text' : 'password'}
                        required
                        value={forgotNewPassword}
                        onChange={(e) => setForgotNewPassword(e.target.value)}
                        placeholder="••••••••••••"
                        className="w-full pl-3 pr-10 py-2.5 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/70 text-[#071524] text-xs focus:ring-2 focus:ring-[#006A62] outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowForgotNewPassword(!showForgotNewPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#44474C] hover:text-[#071524] cursor-pointer"
                      >
                        {showForgotNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block font-bold text-[#071524] mb-1">
                      Confirmar Nueva Contraseña *
                    </label>
                    <input
                      type={showForgotNewPassword ? 'text' : 'password'}
                      required
                      value={forgotConfirmPassword}
                      onChange={(e) => setForgotConfirmPassword(e.target.value)}
                      placeholder="••••••••••••"
                      className="w-full px-3 py-2.5 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/70 text-[#071524] text-xs focus:ring-2 focus:ring-[#006A62] outline-none"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setForgotPasswordStep('REQUEST')}
                      className="text-xs text-[#006A62] hover:underline font-semibold cursor-pointer"
                    >
                      Reenviar código
                    </button>

                    <button
                      type="submit"
                      disabled={isForgotSubmitting}
                      className="py-2.5 px-5 rounded-xl bg-[#006A62] hover:bg-[#005049] disabled:opacity-60 text-white font-bold flex items-center gap-2 transition-colors cursor-pointer"
                    >
                      {isForgotSubmitting ? (
                        <Loader2 className="w-4 h-4 animate-spin text-[#84F5E8]" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4 text-[#84F5E8]" />
                      )}
                      <span>
                        {isForgotSubmitting ? 'Confirmando...' : 'Restablecer Contraseña'}
                      </span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          ) : (
            /* ============================================================== */
            /* VISTA PRINCIPAL: FORMULARIO DIRECTO AWS COGNITO (EMAIL + CLAVE) */
            /* ============================================================== */
            <div className="bg-white rounded-2xl border border-[#071524]/10 p-5 sm:p-6 shadow-xs space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-[#006A62] flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 shrink-0" />
                  Acceso Directo AWS Cognito
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap shrink-0 ${
                    cognitoConfig.isPasswordAuthConfigured
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {cognitoConfig.isPasswordAuthConfigured ? 'Cognito IdP Listo' : '.env pendiente'}
                </span>
              </div>

              <form onSubmit={handleDirectPasswordLogin} className="space-y-3.5 text-xs">
                <div>
                  <label className="block font-bold text-[#071524] mb-1">
                    Correo Electrónico o Usuario *
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-[#44474C] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      autoComplete="username"
                      value={loginUsername}
                      onChange={(e) => setLoginUsername(e.target.value)}
                      placeholder="doctor@hospital.pe o usuario"
                      className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/70 text-[#071524] text-xs focus:ring-2 focus:ring-[#006A62] outline-none"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-bold text-[#071524]">
                      Contraseña *
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setForgotUsername(loginUsername);
                        setForgotPasswordStep('REQUEST');
                        setAuthError(null);
                        setAuthInfo(null);
                      }}
                      className="text-[11px] font-semibold text-[#006A62] hover:underline cursor-pointer"
                    >
                      ¿Olvidaste tu contraseña?
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-[#44474C] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="••••••••••••"
                      className="w-full pl-9 pr-10 py-2.5 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/70 text-[#071524] text-xs focus:ring-2 focus:ring-[#006A62] outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#44474C] hover:text-[#071524] cursor-pointer"
                      title={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoggingIn}
                  className="w-full py-3.5 px-4 bg-[#1C2A39] hover:bg-[#071524] disabled:opacity-60 text-white font-bold rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2.5 text-sm cursor-pointer mt-2"
                >
                  {isLoggingIn ? (
                    <Loader2 className="w-4 h-4 animate-spin text-[#84F5E8]" />
                  ) : (
                    <LogIn className="w-4 h-4 text-[#84F5E8]" />
                  )}
                  <span>
                    {isLoggingIn
                      ? 'Autenticando contra AWS Cognito...'
                      : 'Iniciar Sesión en NeuroVisión'}
                  </span>
                </button>
              </form>

              {!cognitoConfig.isPasswordAuthConfigured && (
                <p className="text-[11px] text-[#44474C] bg-[#F3FAFF] border border-[#C4C6CC]/50 rounded-lg p-2.5 leading-relaxed">
                  Para autenticación directa, configura{' '}
                  <code className="text-[10px] bg-white px-1 py-0.5 rounded border border-[#C4C6CC]/50">
                    VITE_AWS_REGION
                  </code>{' '}
                  y{' '}
                  <code className="text-[10px] bg-white px-1 py-0.5 rounded border border-[#C4C6CC]/50">
                    VITE_COGNITO_CLIENT_ID
                  </code>{' '}
                  en tu archivo <code className="text-[10px]">.env</code>.
                </p>
              )}
            </div>
          )}

          {/* ============================================================== */}
          {/* MÉTODOS ALTERNATIVOS (Acordeón: Hosted UI, Token JWT, Modo Demo) */}
          {/* ============================================================== */}
          <div className="bg-white rounded-2xl border border-[#071524]/10 shadow-xs overflow-hidden">
            <button
              type="button"
              onClick={() => setSecondaryAccordionOpen((prev) => !prev)}
              className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-[#F3FAFF]/70 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#E6F6FF] text-[#006A62] flex items-center justify-center">
                  <KeyRound className="w-4 h-4" />
                </div>
                <div>
                  <span className="font-bold text-xs sm:text-sm text-[#071524] block">
                    Otros Métodos de Acceso y Desarrollo
                  </span>
                  <span className="text-[11px] text-[#44474C]">
                    Cognito Hosted UI (PKCE), Bearer JWT manual o Modo Demo sin backend
                  </span>
                </div>
              </div>
              {secondaryAccordionOpen ? (
                <ChevronUp className="w-4 h-4 text-[#44474C] shrink-0" />
              ) : (
                <ChevronDown className="w-4 h-4 text-[#44474C] shrink-0" />
              )}
            </button>

            {secondaryAccordionOpen && (
              <div className="px-5 pb-5 pt-2 border-t border-[#071524]/10 space-y-4">
                {/* Secondary Navigation Tabs */}
                <div className="flex rounded-lg bg-[#F3FAFF] p-1 border border-[#071524]/10 gap-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setActiveSecondaryTab('hosted-ui')}
                    className={`flex-1 py-1.5 px-2 rounded-md font-bold transition-colors cursor-pointer text-center ${
                      activeSecondaryTab === 'hosted-ui'
                        ? 'bg-white text-[#006A62] shadow-xs'
                        : 'text-[#44474C] hover:text-[#071524]'
                    }`}
                  >
                    Hosted UI (PKCE)
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveSecondaryTab('jwt')}
                    className={`flex-1 py-1.5 px-2 rounded-md font-bold transition-colors cursor-pointer text-center ${
                      activeSecondaryTab === 'jwt'
                        ? 'bg-white text-[#006A62] shadow-xs'
                        : 'text-[#44474C] hover:text-[#071524]'
                    }`}
                  >
                    Token JWT
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveSecondaryTab('demo')}
                    className={`flex-1 py-1.5 px-2 rounded-md font-bold transition-colors cursor-pointer text-center ${
                      activeSecondaryTab === 'demo'
                        ? 'bg-white text-[#006A62] shadow-xs'
                        : 'text-[#44474C] hover:text-[#071524]'
                    }`}
                  >
                    Modo Demo
                  </button>
                </div>

                {/* Tab Content: Hosted UI PKCE */}
                {activeSecondaryTab === 'hosted-ui' && (
                  <div className="space-y-3 pt-1 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] font-bold text-[#44474C]">
                        Redirección OAuth2 Hosted UI con Code Challenge PKCE
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap shrink-0 ${
                          cognitoConfig.isHostedUiConfigured
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {cognitoConfig.isHostedUiConfigured ? 'Hosted UI Configurado' : 'Faltan variables .env'}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleStartCognitoHostedUi()}
                      disabled={pkceLoading || !cognitoConfig.isHostedUiConfigured}
                      className="w-full py-3 px-4 bg-[#006A62] hover:bg-[#005049] disabled:opacity-50 text-white font-bold rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2 text-xs cursor-pointer"
                    >
                      {pkceLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin text-[#84F5E8]" />
                      ) : (
                        <LogIn className="w-4 h-4 text-[#84F5E8]" />
                      )}
                      <span>
                        {pkceLoading
                          ? 'Iniciando redirección a Cognito...'
                          : 'Iniciar con Cognito Hosted UI (OAuth2 PKCE)'}
                      </span>
                    </button>

                    {!cognitoConfig.isHostedUiConfigured && (
                      <p className="text-[11px] text-[#44474C] bg-[#F3FAFF] border border-[#C4C6CC]/50 rounded-lg p-2.5 leading-relaxed">
                        Para habilitar la Hosted UI de Cognito, define{' '}
                        <code className="text-[10px] bg-white px-1 py-0.5 rounded border border-[#C4C6CC]/50">
                          VITE_COGNITO_DOMAIN
                        </code>{' '}
                        y{' '}
                        <code className="text-[10px] bg-white px-1 py-0.5 rounded border border-[#C4C6CC]/50">
                          VITE_COGNITO_CLIENT_ID
                        </code>{' '}
                        en el archivo <code className="text-[10px]">.env</code>.
                      </p>
                    )}
                  </div>
                )}

                {/* Tab Content: Token JWT Bearer */}
                {activeSecondaryTab === 'jwt' && (
                  <form onSubmit={handleJwtLogin} className="space-y-3 pt-1 text-xs">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="font-bold text-[#071524]">
                          Access Token JWT (con o sin prefijo Bearer)
                        </label>
                        {rawJwt && (
                          <button
                            type="button"
                            onClick={() => setRawJwt('')}
                            className="text-[11px] font-semibold text-[#44474C] hover:text-[#BA1A1A] cursor-pointer"
                          >
                            Limpiar
                          </button>
                        )}
                      </div>
                      <textarea
                        rows={3}
                        value={rawJwt}
                        onChange={(e) => setRawJwt(e.target.value)}
                        placeholder="eyJraWQiOi... (pega aquí tu Cognito access_token)"
                        className="w-full px-3 py-2 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/70 font-mono text-[11px] text-[#071524] focus:ring-2 focus:ring-[#006A62] outline-none"
                      />
                    </div>

                    {/* Claims Preview */}
                    {cleanToken && !isTokenStructurallyValid && (
                      <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-900 flex items-center gap-2 text-[11px]">
                        <AlertTriangle className="w-4 h-4 text-[#BA1A1A] shrink-0" />
                        <span>Formato inválido: un JWT debe tener 3 segmentos separados por punto.</span>
                      </div>
                    )}

                    {isTokenStructurallyValid && decodedClaims && (
                      <div className="rounded-xl bg-[#F3FAFF] border border-[#071524]/10 p-3 space-y-2.5">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="font-bold text-[#071524] text-[11px]">
                            Claims Decodificados
                          </span>
                          <div className="flex items-center gap-1.5">
                            {isNonAccessToken ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-900 border border-red-200">
                                Rechazado: token_use=&quot;{decodedClaims.tokenUse}&quot;
                              </span>
                            ) : decodedClaims.tokenUse === 'access' ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                Access Token válido
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                token_use ausente
                              </span>
                            )}

                            {decodedClaims.isExpired && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-900 border border-red-200">
                                Expirado
                              </span>
                            )}
                          </div>
                        </div>

                        {isNonAccessToken && (
                          <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-900 text-[11px] flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 text-[#BA1A1A] shrink-0 mt-0.5" />
                            <span>
                              Este JWT es de tipo <strong>{decodedClaims.tokenUse}</strong>. Los microservicios requieren exclusivamente un{' '}
                              <strong>Access Token</strong> (<code>token_use: &quot;access&quot;</code>).
                            </span>
                          </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                          <div>
                            <span className="text-[#44474C] block">Email / Usuario</span>
                            <span className="font-semibold text-[#071524] break-all">
                              {decodedClaims.email || decodedClaims.username || 'No especificado'}
                            </span>
                          </div>
                          <div>
                            <span className="text-[#44474C] block">Expiración</span>
                            <span className="font-semibold text-[#071524]">
                              {formatExpiration(decodedClaims.exp)}
                            </span>
                          </div>
                          <div className="sm:col-span-2">
                            <span className="text-[#44474C] block">cognito:groups</span>
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {decodedClaims.groups.length > 0 ? (
                                decodedClaims.groups.map((grp) => (
                                  <span
                                    key={grp}
                                    className="px-1.5 py-0.5 rounded bg-[#DBF1FE] text-[#006A62] font-bold text-[10px]"
                                  >
                                    {grp}
                                  </span>
                                ))
                              ) : (
                                <span className="text-amber-800 font-semibold">Sin grupos</span>
                              )}
                            </div>
                          </div>
                          <div className="sm:col-span-2">
                            <span className="text-[#44474C] block">Rol resuelto</span>
                            <span className="font-bold text-[#006A62]">
                              {decodedClaims.appRole ?? `${manualRoleOverride} (Manual)`}
                            </span>
                          </div>
                        </div>

                        {needsManualRole && (
                          <div className="pt-2 border-t border-[#071524]/10">
                            <label className="block font-bold text-[#071524] mb-1">
                              Selector manual de rol (token sin cognito:groups)
                            </label>
                            <select
                              value={manualRoleOverride}
                              onChange={(e) => setManualRoleOverride(e.target.value as AppRole)}
                              className="w-full px-3 py-2 rounded-lg bg-white border border-[#C4C6CC] text-xs font-semibold text-[#071524] focus:ring-2 focus:ring-[#006A62] outline-none"
                            >
                              <option value="SPECIALIST">Especialista (SPECIALIST)</option>
                              <option value="PATIENT">Paciente (PATIENT)</option>
                            </select>
                          </div>
                        )}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={!canSubmitJwt}
                      className="w-full py-2.5 px-4 rounded-xl bg-[#006A62] hover:bg-[#005049] disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      {jwtSubmitting ? (
                        <Loader2 className="w-4 h-4 animate-spin text-[#84F5E8]" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4 text-[#84F5E8]" />
                      )}
                      <span>
                        {jwtSubmitting
                          ? 'Validando perfil y accediendo...'
                          : 'Ingresar con Token JWT Bearer'}
                      </span>
                    </button>
                  </form>
                )}

                {/* Tab Content: Modo Demo */}
                {activeSecondaryTab === 'demo' && (
                  <div className="space-y-3 pt-1 text-xs">
                    <p className="text-[11px] text-[#44474C] leading-relaxed">
                      Accede inmediatamente con perfiles simulados locales de prueba clínica, sin conectividad requerida hacia AWS Cognito o microservicios Quarkus.
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => handleDemoLogin('SPECIALIST')}
                        className="py-3 px-4 bg-primary text-white font-bold rounded-xl shadow-xs hover:bg-[#131f2b] transition-colors flex items-center justify-center gap-2 text-xs cursor-pointer"
                      >
                        <Stethoscope className="w-4 h-4 text-[#84F5E8]" />
                        <span>Especialista (Demo)</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDemoLogin('PATIENT')}
                        className="py-3 px-4 bg-secondary text-white font-bold rounded-xl shadow-xs hover:bg-[#1E8A80] transition-colors flex items-center justify-center gap-2 text-xs cursor-pointer"
                      >
                        <UserCheck className="w-4 h-4" />
                        <span>Paciente (Demo)</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Backend Microservices Health Footer Drawer */}
          <div className="bg-white rounded-2xl border border-[#071524]/10 shadow-xs overflow-hidden">
            <div className="px-4 py-2.5 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setHealthExpanded((prev) => !prev)}
                className="flex items-center gap-2 text-xs font-bold text-[#071524] hover:text-[#006A62] transition-colors cursor-pointer"
              >
                <Server className="w-3.5 h-3.5 text-[#006A62]" />
                <span
                  className={`w-2 h-2 rounded-full ${
                    onlineCount === totalCount
                      ? 'bg-emerald-500 animate-pulse'
                      : onlineCount > 0
                      ? 'bg-amber-500'
                      : 'bg-[#BA1A1A]'
                  }`}
                />
                <span>
                  Backend: {onlineCount}/{totalCount} servicios online
                </span>
                {healthExpanded ? (
                  <ChevronUp className="w-3.5 h-3.5 text-[#44474C]" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-[#44474C]" />
                )}
              </button>

              <button
                type="button"
                onClick={() => void refreshHealth()}
                disabled={checkingHealth}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#C4C6CC]/70 hover:bg-[#F3FAFF] text-[11px] font-semibold text-[#071524] cursor-pointer disabled:opacity-60"
              >
                <RefreshCw
                  className={`w-3 h-3 text-[#006A62] ${checkingHealth ? 'animate-spin' : ''}`}
                />
                <span>Actualizar</span>
              </button>
            </div>

            {healthExpanded && (
              <div className="px-4 pb-3 pt-1 border-t border-[#071524]/10 space-y-1.5">
                {servicesHealth.map((svc) => (
                  <div
                    key={svc.service}
                    className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[#F3FAFF] border border-[#071524]/10 text-[11px]"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          svc.ready ? 'bg-emerald-500' : 'bg-[#BA1A1A]'
                        }`}
                      />
                      <div className="min-w-0">
                        <span className="font-bold text-[#071524] block truncate">
                          {svc.label}
                        </span>
                        <span className="text-[10px] text-[#44474C]">
                          <span className="font-mono">{svc.endpointDisplay}</span> · {svc.statusText}
                          {svc.latencyMs !== null ? ` (${svc.latencyMs} ms)` : ''}
                        </span>
                      </div>
                    </div>

                    {svc.swaggerUrl ? (
                      <a
                        href={svc.swaggerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white border border-[#C4C6CC]/70 text-[#006A62] hover:bg-[#DBF1FE] font-bold text-[10px] shrink-0 transition-colors"
                      >
                        <span>Swagger</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#E6F6FF] border border-[#CDE9FA] text-[#006A62] font-bold text-[10px] shrink-0">
                        Gateway TLS
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
};
