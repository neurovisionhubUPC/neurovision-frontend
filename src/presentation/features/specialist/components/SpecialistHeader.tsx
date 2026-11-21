import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Eye,
  Bell,
  HelpCircle,
  Settings,
  LogOut,
  Menu,
  X,
  CheckCircle2,
  BookOpen,
  ShieldCheck,
  Activity,
  ChevronDown,
  ExternalLink,
  RefreshCw,
  AlertCircle,
  UserCog,
  UserPlus,
  AlertTriangle,
} from 'lucide-react';
import { useAppStore } from '../../../../core/store/useAppStore';
import { profileApi } from '../../../../infrastructure/api/profileApi';
import { parseJwtClaims } from '../../../../infrastructure/api/cognitoAuth';
import {
  BACKEND_SERVICES_META,
  checkAllServicesHealth,
  type ServiceHealthInfo,
} from '../../../../infrastructure/api/healthApi';
import { ProfileOnboardingModal } from './ProfileOnboardingModal';

export interface SpecialistHeaderProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onOpenNotifications?: () => void;
  onLogout?: () => void;
  onOpenDoctorInvite?: () => void;
}

function buildInitials(firstName?: string | null, lastName?: string | null): string {
  const first = firstName?.trim()?.[0] ?? '';
  const last = lastName?.trim()?.[0] ?? '';
  const combined = `${first}${last}`.toUpperCase();
  return combined || 'MD';
}

interface ClinicalAlertItem {
  id: string;
  patientName: string;
  type: 'critical' | 'warning' | 'info';
  message: string;
  timestamp: string;
  read: boolean;
}

const INITIAL_CLINICAL_ALERTS: ClinicalAlertItem[] = [
  {
    id: 'alt-1',
    patientName: 'Carlos Alberto Mendoza',
    type: 'critical',
    message: 'Baja estabilidad foveal BCEA (2.1°²) detectada en protocolo antisacádico.',
    timestamp: 'Hace 12 min',
    read: false,
  },
  {
    id: 'alt-2',
    patientName: 'Ana Sofía Torres',
    type: 'warning',
    message: '2 sesiones consecutivas no completadas. Adherencia al 55%.',
    timestamp: 'Hace 45 min',
    read: false,
  },
  {
    id: 'alt-3',
    patientName: 'Jorge Ramírez Díaz',
    type: 'info',
    message: 'Calibración OLS completada con 94% de muestras válidas.',
    timestamp: 'Hace 2 horas',
    read: true,
  },
];

export const SpecialistHeader: React.FC<SpecialistHeaderProps> = ({
  activeTab,
  onTabChange,
  onOpenNotifications,
  onLogout,
  onOpenDoctorInvite,
}) => {
  const {
    authMode,
    accessToken,
    userProfile,
    setUserProfile,
    backendHealth,
    setBackendHealth,
    logout,
  } = useAppStore();

  const isCognitoMode = authMode === 'COGNITO' && Boolean(accessToken);

  // Parse claims to check for ADMIN group
  const decodedClaims = useMemo(
    () => (accessToken ? parseJwtClaims(accessToken) : null),
    [accessToken]
  );
  const isAdmin = Boolean(decodedClaims?.groups.includes('ADMIN'));

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeModal, setActiveModal] = useState<'help' | 'settings' | null>(null);

  // Profile / Onboarding / Admin IAM Modal
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [onboardingInitialTab, setOnboardingInitialTab] = useState<'profile' | 'doctor-invite'>('profile');

  // Health Popover state
  const [healthPopoverOpen, setHealthPopoverOpen] = useState(false);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [servicesInfo, setServicesInfo] = useState<ServiceHealthInfo[]>(() =>
    BACKEND_SERVICES_META.map((meta) => ({
      service: meta.service,
      label: meta.label,
      port: meta.port,
      swaggerUrl: meta.swaggerUrl,
      ready: backendHealth[meta.service],
      statusText: backendHealth[meta.service] ? 'UP' : 'Sin verificar',
      latencyMs: null,
    }))
  );

  // Notifications Popover state
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [alerts, setAlerts] = useState<ClinicalAlertItem[]>(INITIAL_CLINICAL_ALERTS);

  // Settings State
  const [samplingRateHz, setSamplingRateHz] = useState('120');
  const [autoSyncFhir, setAutoSyncFhir] = useState(true);
  const [settingsSavedNotice, setSettingsSavedNotice] = useState(false);

  const healthContainerRef = useRef<HTMLDivElement | null>(null);
  const notificationsContainerRef = useRef<HTMLDivElement | null>(null);
  const hasProbedProfileRef = useRef(false);

  const refreshHealth = useCallback(async () => {
    setCheckingHealth(true);
    try {
      const { services, statusMap } = await checkAllServicesHealth();
      setServicesInfo(services);
      setBackendHealth(statusMap);
    } finally {
      setCheckingHealth(false);
    }
  }, [setBackendHealth]);

  // Check backend health once on mount when in Cognito mode
  useEffect(() => {
    if (!isCognitoMode) return;
    void refreshHealth();
  }, [isCognitoMode, refreshHealth]);

  // Hydrate doctor profile gently on mount if missing in Cognito mode
  useEffect(() => {
    if (!isCognitoMode || userProfile || hasProbedProfileRef.current) return;
    hasProbedProfileRef.current = true;

    let cancelled = false;
    profileApi
      .getMyProfile()
      .then((profile) => {
        if (!cancelled) setUserProfile(profile);
      })
      .catch(() => {
        // 403/404 expected when doctor onboarding is pending; handled via onboarding banner
      });
    return () => {
      cancelled = true;
    };
  }, [isCognitoMode, userProfile, setUserProfile]);

  // Keep servicesInfo aligned when backendHealth changes externally
  useEffect(() => {
    setServicesInfo((prev) =>
      prev.map((item) => ({
        ...item,
        ready: backendHealth[item.service],
        statusText:
          item.statusText === 'Sin verificar'
            ? backendHealth[item.service]
              ? 'UP'
              : 'Sin verificar'
            : item.statusText,
      }))
    );
  }, [backendHealth]);

  // Close health popover on outside click
  useEffect(() => {
    if (!healthPopoverOpen) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (
        healthContainerRef.current &&
        !healthContainerRef.current.contains(event.target as Node)
      ) {
        setHealthPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [healthPopoverOpen]);

  // Close notifications popover on outside click
  useEffect(() => {
    if (!notificationsOpen) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (
        notificationsContainerRef.current &&
        !notificationsContainerRef.current.contains(event.target as Node)
      ) {
        setNotificationsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [notificationsOpen]);

  const onlineServicesCount = Object.values(backendHealth).filter(Boolean).length;
  const totalServicesCount = BACKEND_SERVICES_META.length;

  const needsOnboarding =
    isCognitoMode && (!userProfile || userProfile.status === 'PENDING_COMPLETION');

  const doctorFullName = isCognitoMode
    ? [userProfile?.firstName, userProfile?.lastName].filter(Boolean).join(' ').trim() ||
      'Especialista Cognito'
    : 'Dra. Elena Ramos Morales, M.D.';

  const doctorShortName = isCognitoMode
    ? doctorFullName
    : 'Dra. Elena Ramos M.';

  const doctorInitials = isCognitoMode
    ? buildInitials(userProfile?.firstName, userProfile?.lastName)
    : 'ER';

  const doctorSpecialty = isCognitoMode
    ? userProfile?.specialty || 'Especialista'
    : 'Neuroftalmología';

  const handleLogout = () => {
    logout();
    onLogout?.();
  };

  const handleNotificationsToggle = () => {
    setNotificationsOpen((prev) => !prev);
    onOpenNotifications?.();
  };

  const handleMarkAllAlertsRead = () => {
    setAlerts((prev) => prev.map((a) => ({ ...a, read: true })));
  };

  const unreadAlertsCount = alerts.filter((a) => !a.read).length;

  const handleOpenDoctorInviteModal = () => {
    if (onOpenDoctorInvite) {
      onOpenDoctorInvite();
    } else {
      setOnboardingInitialTab('doctor-invite');
      setIsOnboardingOpen(true);
    }
  };

  const handleSaveSettings = () => {
    setSettingsSavedNotice(true);
    setTimeout(() => {
      setSettingsSavedNotice(false);
      setActiveModal(null);
    }, 800);
  };

  const navTabs = [
    { id: 'pacientes', label: 'Pacientes y Casos' },
    { id: 'protocolos', label: 'Protocolos Sacádicos' },
    { id: 'telemetria', label: 'Telemetría Ocular' },
    { id: 'interconsultas', label: 'Interconsultas FHIR' },
  ];

  return (
    <header className="bg-white border-b border-[#071524]/10 sticky top-0 z-40 shadow-xs">
      <div className="max-w-[1536px] mx-auto flex justify-between items-center w-full px-4 lg:px-6 xl:px-8 h-16 gap-3">
        {/* Brand & Hospital Unit Context */}
        <div
          onClick={() => onTabChange('pacientes')}
          className="flex items-center gap-2.5 sm:gap-3 shrink-0 cursor-pointer"
        >
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[#1C2A39] flex items-center justify-center text-[#26A69A] shadow-xs shrink-0">
            <Eye className="w-5 h-5 stroke-[2.5]" />
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="text-sm sm:text-base font-bold text-[#071524] tracking-tight whitespace-nowrap">
                NeuroVisión Rehab
              </span>
              <span className="hidden 2xl:inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold bg-[#D5ECF8] text-[#006A62] border border-[#006A62]/20 whitespace-nowrap">
                PRO v4.8-FHIR
              </span>
            </div>
            <p
              title="Portal Facultativo · Unidad de Rehabilitación Visual y Campimetría"
              className="hidden 2xl:block text-[11px] text-[#44474C] font-medium leading-tight truncate max-w-[235px]"
            >
              Portal Facultativo · Unidad de Rehabilitación Visual y Campimetría
            </p>
          </div>
        </div>

        {/* Center Clinical Navigation Tabs (Desktop xl+) */}
        <nav className="hidden xl:flex items-center gap-1 2xl:gap-2 h-full text-xs 2xl:text-[13px] font-semibold min-w-0 overflow-x-auto scrollbar-none">
          {navTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onTabChange(tab.id)}
                className={`h-full flex items-center px-2 2xl:px-2.5 pt-1 whitespace-nowrap shrink-0 transition-all relative cursor-pointer ${
                  isActive
                    ? 'text-[#071524] font-bold border-b-4 border-[#006A62]'
                    : 'text-[#44474C] hover:text-[#071524]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Trailing Action Icons & Doctor Pill Profile */}
        <div className="flex items-center gap-1.5 xl:gap-2 shrink-0">
          {/* Admin IAM Quick Action Button (Visible if user has ADMIN group or always readily available) */}
          {isAdmin && (
            <button
              type="button"
              onClick={handleOpenDoctorInviteModal}
              className="inline-flex items-center gap-1.5 px-2.5 2xl:px-3 py-1.5 rounded-full bg-[#1C2A39] text-[#84F5E8] hover:bg-[#071524] text-[11px] 2xl:text-xs font-bold transition-colors cursor-pointer border border-[#84F5E8]/30 shadow-2xs whitespace-nowrap"
              title="Panel de Administración IAM: Invitar nuevo médico facultativo"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span className="hidden 2xl:inline">Invitar</span>
              <span className="2xl:hidden">IAM</span>
            </button>
          )}

          {/* Microservice Health Popover Trigger */}
          <div ref={healthContainerRef} className="relative">
            <button
              type="button"
              onClick={() => {
                const next = !healthPopoverOpen;
                setHealthPopoverOpen(next);
                if (next && isCognitoMode) {
                  void refreshHealth();
                }
              }}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-[11px] 2xl:text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                !isCognitoMode
                  ? 'bg-[#DBF1FE] border-[#C4C6CC]/40 text-[#071E27] hover:bg-[#cde8f8]'
                  : onlineServicesCount === totalServicesCount
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900 hover:bg-emerald-100'
                  : onlineServicesCount > 0
                  ? 'bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100'
                  : 'bg-red-50 border-red-200 text-red-900 hover:bg-red-100'
              }`}
              title={`Estado de microservicios backend (8081-8085): ${onlineServicesCount}/${totalServicesCount} servicios`}
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  !isCognitoMode
                    ? 'bg-[#006A62]'
                    : onlineServicesCount === totalServicesCount
                    ? 'bg-emerald-500 animate-pulse'
                    : onlineServicesCount > 0
                    ? 'bg-amber-500'
                    : 'bg-[#BA1A1A]'
                }`}
              />
              <span>
                {!isCognitoMode
                  ? 'Modo Demo'
                  : `${onlineServicesCount}/${totalServicesCount}`}
              </span>
              <ChevronDown className="w-3.5 h-3.5 opacity-70 hidden sm:block" />
            </button>

            {healthPopoverOpen && (
              <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-xl shadow-2xl border border-[#071524]/15 z-50 overflow-hidden">
                <div className="bg-[#1C2A39] text-white px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-[#84F5E8]" />
                    <span className="font-bold text-xs">
                      Salud de Microservicios ({onlineServicesCount}/{totalServicesCount})
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void refreshHealth()}
                      disabled={checkingHealth}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-60"
                    >
                      <RefreshCw
                        className={`w-3 h-3 ${checkingHealth ? 'animate-spin' : ''}`}
                      />
                      <span>Actualizar</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setHealthPopoverOpen(false)}
                      className="p-1 rounded hover:bg-white/10 text-white/70 hover:text-white cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="p-3 space-y-2 max-h-80 overflow-y-auto">
                  {servicesInfo.map((svc) => (
                    <div
                      key={svc.service}
                      className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-[#F3FAFF] border border-[#071524]/10 text-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                            svc.ready ? 'bg-emerald-500' : 'bg-[#BA1A1A]'
                          }`}
                        />
                        <div className="min-w-0">
                          <div className="font-bold text-[#071524] truncate">
                            {svc.label}
                          </div>
                          <div className="text-[11px] text-[#44474C] flex items-center gap-2">
                            <span className="font-mono">:{svc.port}</span>
                            <span>·</span>
                            <span>
                              {svc.statusText}
                              {svc.latencyMs !== null ? ` (${svc.latencyMs} ms)` : ''}
                            </span>
                          </div>
                        </div>
                      </div>

                      <a
                        href={svc.swaggerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white border border-[#C4C6CC]/70 text-[#006A62] hover:bg-[#DBF1FE] text-[11px] font-bold shrink-0 transition-colors"
                      >
                        <span>Swagger</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Clinical Alert Bell with Interactive Notification Flyout */}
          <div ref={notificationsContainerRef} className="relative">
            <button
              type="button"
              onClick={handleNotificationsToggle}
              className="relative p-2 rounded-lg hover:bg-[#F3FAFF] text-[#071524] transition-colors focus:outline-none cursor-pointer"
              title="Alertas de pacientes y telemetría"
            >
              <Bell className="w-4 h-4 sm:w-5 sm:h-5 text-[#44474C]" />
              {unreadAlertsCount > 0 && (
                <span className="absolute top-1 right-1 w-3.5 h-3.5 bg-[#BA1A1A] text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                  {unreadAlertsCount}
                </span>
              )}
            </button>

            {notificationsOpen && (
              <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-xl shadow-2xl border border-[#071524]/15 z-50 overflow-hidden">
                <div className="bg-[#1C2A39] text-white px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bell className="w-4 h-4 text-[#84F5E8]" />
                    <span className="font-bold text-xs">
                      Alertas Clínicas ({unreadAlertsCount} pendientes)
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {unreadAlertsCount > 0 && (
                      <button
                        type="button"
                        onClick={handleMarkAllAlertsRead}
                        className="text-[10px] text-[#84F5E8] hover:underline font-semibold cursor-pointer"
                      >
                        Marcar leídas
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setNotificationsOpen(false)}
                      className="p-1 rounded hover:bg-white/10 text-white/70 hover:text-white cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="p-3 space-y-2 max-h-80 overflow-y-auto">
                  {alerts.map((alt) => (
                    <div
                      key={alt.id}
                      className={`p-2.5 rounded-lg border text-xs space-y-1 transition-colors ${
                        alt.read
                          ? 'bg-[#F8FAFC] border-gray-200 opacity-75'
                          : alt.type === 'critical'
                          ? 'bg-red-50 border-red-200 text-red-950'
                          : alt.type === 'warning'
                          ? 'bg-amber-50 border-amber-200 text-amber-950'
                          : 'bg-[#DBF1FE] border-[#006A62]/20 text-[#071E27]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-[#071524] flex items-center gap-1.5">
                          {alt.type === 'critical' && (
                            <AlertTriangle className="w-3.5 h-3.5 text-[#BA1A1A] shrink-0" />
                          )}
                          {alt.patientName}
                        </span>
                        <span className="text-[10px] text-[#44474C]">{alt.timestamp}</span>
                      </div>
                      <p className="text-[11px] text-[#44474C] leading-snug">{alt.message}</p>
                    </div>
                  ))}
                </div>

                <div className="p-2.5 bg-[#F3FAFF] border-t border-[#071524]/10 text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setNotificationsOpen(false);
                      onTabChange('pacientes');
                    }}
                    className="text-xs font-bold text-[#006A62] hover:underline cursor-pointer"
                  >
                    Ver todos los pacientes en monitorización →
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Help Action */}
          <button
            type="button"
            onClick={() => setActiveModal('help')}
            className="p-1.5 2xl:p-2 rounded-lg hover:bg-[#F3FAFF] text-[#44474C] hover:text-[#071524] transition-colors cursor-pointer hidden sm:flex"
            title="Soporte y Guías Clínicas"
          >
            <HelpCircle className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>

          {/* Settings Action */}
          <button
            type="button"
            onClick={() => setActiveModal('settings')}
            className="p-1.5 2xl:p-2 rounded-lg hover:bg-[#F3FAFF] text-[#44474C] hover:text-[#071524] transition-colors cursor-pointer hidden sm:flex"
            title="Configuración de guardia"
          >
            <Settings className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>

          {/* Doctor Profile Pill */}
          <div className="flex items-center gap-1.5 sm:gap-2 pl-1.5 sm:pl-2 border-l border-[#C4C6CC]/40 shrink-0">
            <button
              type="button"
              onClick={() => {
                setOnboardingInitialTab('profile');
                setIsOnboardingOpen(true);
              }}
              title={
                isCognitoMode
                  ? 'Gestionar activación IAM y perfil médico CMP'
                  : 'Ver estado de perfil facultativo'
              }
              className="flex items-center gap-2 text-left rounded-lg px-1.5 py-1 hover:bg-[#F3FAFF] transition-colors cursor-pointer"
            >
              <div className="relative w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-[#1C2A39] text-[#84F5E8] flex items-center justify-center font-bold text-xs border border-[#006A62]/30 shrink-0">
                {doctorInitials}
                {needsOnboarding && (
                  <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-amber-500 border-2 border-white" />
                )}
              </div>
              <div className="hidden xl:block text-left text-xs leading-tight whitespace-nowrap">
                <div className="font-bold text-[#071E27] flex items-center gap-1.5">
                  <span className="hidden 2xl:inline max-w-[145px] truncate">
                    {doctorFullName}
                  </span>
                  <span className="2xl:hidden max-w-[120px] truncate">
                    {doctorShortName}
                  </span>
                  {isCognitoMode && (
                    <span
                      className={`hidden 2xl:inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                        userProfile?.status === 'ACTIVE'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {userProfile?.status ?? 'PENDING_COMPLETION'}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-[#44474C]">
                  <span className="max-w-[90px] 2xl:max-w-[115px] truncate">{doctorSpecialty}</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-[#006A62]" />
                  {isCognitoMode ? (
                    <span className="text-[#006A62] font-semibold font-mono">
                      {userProfile?.medicalLicense
                        ? `CMP ${userProfile.medicalLicense}`
                        : 'Sin CMP'}
                    </span>
                  ) : (
                    <span className="text-[#006A62] font-semibold">En Turno</span>
                  )}
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={handleLogout}
              title="Cerrar sesión"
              className="p-1.5 sm:p-2 rounded-lg text-[#BA1A1A] hover:bg-[#FFDAD6]/50 transition-colors ml-0.5 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>

          {/* Mobile Menu Toggle Button */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 rounded-lg xl:hidden text-[#071524] hover:bg-[#F3FAFF] transition-colors cursor-pointer"
            aria-label="Abrir menú"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Auto-Onboarding Alert Strip when Cognito doctor account needs IAM activation or CMP */}
      {needsOnboarding && (
        <div className="bg-amber-50 border-t border-amber-200 px-4 lg:px-6 xl:px-8 py-2">
          <div className="max-w-[1536px] mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 text-amber-900">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <span className="font-medium">
                <strong>Onboarding médico pendiente:</strong>{' '}
                {!userProfile
                  ? 'Activa tu cuenta médica en IAM (8081) y registra tu colegiatura CMP de 6 dígitos en Profile (8082).'
                  : 'Tu perfil profesional está en estado PENDING_COMPLETION. Registra tu colegiatura CMP de 6 dígitos para activarlo.'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setOnboardingInitialTab('profile');
                setIsOnboardingOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1C2A39] hover:bg-[#071524] text-white font-bold text-[11px] transition-colors shrink-0 cursor-pointer self-start sm:self-auto"
            >
              <UserCog className="w-3.5 h-3.5 text-[#84F5E8]" />
              <span>Completar Onboarding CMP</span>
            </button>
          </div>
        </div>
      )}

      {/* Mobile Drawer Navigation (Visible on screen < xl) */}
      {mobileMenuOpen && (
        <div className="xl:hidden bg-white border-t border-[#071524]/10 px-4 py-3 flex flex-col gap-2 shadow-md">
          {navTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  onTabChange(tab.id);
                  setMobileMenuOpen(false);
                }}
                className={`py-2 px-3 text-left rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-[#DBF1FE] text-[#006A62] font-bold'
                    : 'text-[#44474C] hover:bg-[#F3FAFF] text-[#071524]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => {
              setMobileMenuOpen(false);
              setOnboardingInitialTab('profile');
              setIsOnboardingOpen(true);
            }}
            className="py-2 px-3 text-left rounded-lg text-xs font-bold bg-[#F3FAFF] text-[#1C2A39] border border-[#071524]/15 flex items-center gap-2 cursor-pointer"
          >
            <UserCog className="w-4 h-4 text-[#006A62]" />
            <span>Mi Perfil & Onboarding CMP</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setMobileMenuOpen(false);
              handleOpenDoctorInviteModal();
            }}
            className="py-2 px-3 text-left rounded-lg text-xs font-bold bg-[#1C2A39] text-[#84F5E8] flex items-center gap-2 cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            <span>Admin IAM · Invitar Médico</span>
          </button>
        </div>
      )}

      {/* Help / Clinical Guide Modal */}
      {activeModal === 'help' && (
        <div className="fixed inset-0 z-50 bg-[#071524]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-[#071524]/10 overflow-hidden">
            <div className="bg-[#1C2A39] text-white p-4 px-6 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <BookOpen className="w-5 h-5 text-[#84F5E8]" />
                <h3 className="font-bold text-sm">Guía Clínica de Rehabilitación Oculomotora</h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="p-1 rounded-lg text-white/70 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4 text-xs text-[#071E27]">
              <div className="p-3.5 rounded-xl bg-[#E6F6FF] border border-[#071524]/10">
                <strong className="text-[#071524] block mb-1">
                  1. Calibración de 9 Puntos y Validación Ambiental
                </strong>
                Asegure que el paciente se ubique entre 40 y 60 cm de la cámara con iluminación &gt;
                60 lux sin contraluz antes de iniciar la regresión OLS.
              </div>
              <div className="p-3.5 rounded-xl bg-[#E6F6FF] border border-[#071524]/10">
                <strong className="text-[#071524] block mb-1">
                  2. Criterio de Ganancia Sacádica y BCEA
                </strong>
                Una estabilidad foveal BCEA &lt; 1.5°² y un índice de muestras válidas &gt; 80%
                certifican la validez clínica de la sesión domiciliaria.
              </div>
              <div className="p-3.5 rounded-xl bg-[#E6F6FF] border border-[#071524]/10">
                <strong className="text-[#071524] block mb-1">
                  3. Versionado Inmutable de Prescripciones
                </strong>
                Todo cambio en la velocidad sacádica o Dwell Time genera una nueva versión sellada
                bajo estándar HL7 FHIR v4.0.1.
              </div>
            </div>
            <div className="px-6 py-3 bg-[#F3FAFF] border-t border-[#071524]/10 flex justify-end">
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="px-4 py-2 rounded-lg bg-[#071524] text-white text-xs font-bold cursor-pointer"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clinical Station Settings Modal */}
      {activeModal === 'settings' && (
        <div className="fixed inset-0 z-50 bg-[#071524]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-[#071524]/10 overflow-hidden">
            <div className="bg-[#1C2A39] text-white p-4 px-6 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Settings className="w-5 h-5 text-[#84F5E8]" />
                <h3 className="font-bold text-sm">Configuración de Estación Facultativa</h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="p-1 rounded-lg text-white/70 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4 text-xs text-[#071E27]">
              <div>
                <label className="font-bold text-[#071524] block mb-1">
                  Frecuencia de Auditoría de Telemetría
                </label>
                <select
                  value={samplingRateHz}
                  onChange={(e) => setSamplingRateHz(e.target.value)}
                  className="w-full p-2.5 rounded-lg bg-[#E6F6FF] border border-[#071524]/15 font-semibold text-[#071524]"
                >
                  <option value="120">120 Hz (Alta Precisión Clínica)</option>
                  <option value="60">60 Hz (Estándar WebRTC)</option>
                </select>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-[#E6F6FF] border border-[#071524]/10">
                <div>
                  <strong className="text-[#071524] block">
                    Sincronización Automática HIS / FHIR
                  </strong>
                  <span className="text-[11px] text-[#44474C]">
                    Nodo Hospital Rebagliati (TLS 1.3)
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={autoSyncFhir}
                  onChange={(e) => setAutoSyncFhir(e.target.checked)}
                  className="w-4 h-4 accent-[#006A62]"
                />
              </div>
              <div className="flex items-center gap-2 text-[11px] text-[#006A62] font-semibold">
                <ShieldCheck className="w-4 h-4" />
                <span>
                  {isCognitoMode
                    ? `Sesión Cognito activa · ${doctorFullName}${
                        userProfile?.medicalLicense ? ` (CMP ${userProfile.medicalLicense})` : ''
                      }`
                    : 'Certificado Digital PKI Dra. Elena Ramos activo'}
                </span>
              </div>

              {settingsSavedNotice && (
                <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Preferencias clínicas guardadas correctamente.</span>
                </div>
              )}
            </div>
            <div className="px-6 py-3 bg-[#F3FAFF] border-t border-[#071524]/10 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="px-4 py-2 rounded-lg border border-[#C4C6CC] text-[#44474C] text-xs font-semibold hover:bg-gray-100 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveSettings}
                className="px-4 py-2 rounded-lg bg-[#006A62] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer hover:bg-[#005049] transition-colors"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Guardar Preferencias
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Doctor IAM Activation & Profile Onboarding Modal */}
      <ProfileOnboardingModal
        isOpen={isOnboardingOpen}
        onClose={() => setIsOnboardingOpen(false)}
        initialTab={onboardingInitialTab}
      />
    </header>
  );
};
