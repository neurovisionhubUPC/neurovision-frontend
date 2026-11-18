import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  ShieldCheck,
  UserCheck,
  CheckCircle2,
  AlertTriangle,
  Info,
  Loader2,
  Stethoscope,
  RefreshCw,
  UserPlus,
  Mail,
  Calendar,
  KeyRound,
} from 'lucide-react';
import { useAppStore } from '../../../../core/store/useAppStore';
import { iamApi } from '../../../../infrastructure/api/iamApi';
import { profileApi } from '../../../../infrastructure/api/profileApi';
import { ApiError, extractApiErrorMessage } from '../../../../infrastructure/api/httpClient';
import type {
  DoctorInvitationResponse,
  InviteDoctorBody,
} from '../../../../infrastructure/api/contracts/iam.contracts';
import type {
  OnboardDoctorBody,
  ProfileResponse,
} from '../../../../infrastructure/api/contracts/profile.contracts';

export interface ProfileOnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (profile: ProfileResponse) => void;
  initialTab?: 'profile' | 'doctor-invite';
}

const CMP_REGEX = /^\d{6}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateMedicalLicense(rawValue: string): {
  isValid: boolean;
  trimmed: string;
  message: string;
} {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return {
      isValid: false,
      trimmed,
      message: 'Obligatorio: 6 dígitos ASCII (ej. 058492). Conserva ceros a la izquierda.',
    };
  }
  if (!CMP_REGEX.test(trimmed)) {
    return {
      isValid: false,
      trimmed,
      message: 'Debe contener exactamente 6 dígitos numéricos (0-9), sin espacios ni letras.',
    };
  }
  if (trimmed === '000000') {
    return {
      isValid: false,
      trimmed,
      message: 'El código CMP "000000" no está permitido por el backend.',
    };
  }
  return {
    isValid: true,
    trimmed,
    message: `CMP válido (${trimmed}).`,
  };
}

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleString('es-PE', {
      dateStyle: 'short',
      timeStyle: 'medium',
    });
  } catch {
    return dateStr;
  }
}

export const ProfileOnboardingModal: React.FC<ProfileOnboardingModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialTab = 'profile',
}) => {
  const { authMode, accessToken, userProfile, setUserProfile } = useAppStore();
  const isCognitoMode = authMode === 'COGNITO' && Boolean(accessToken);

  // Tab state
  const [activeTab, setActiveTab] = useState<'profile' | 'doctor-invite'>(initialTab);

  // Form fields aligned 1:1 with OnboardDoctorBody (profile.contracts.ts)
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [medicalLicense, setMedicalLicense] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [phone, setPhone] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [birthDate, setBirthDate] = useState('');

  // Async states for Profile
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [activatingIam, setActivatingIam] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  // Feedback states for Profile
  const [iamActivationInfo, setIamActivationInfo] = useState<{
    type: 'success' | 'info' | 'error';
    message: string;
    invitation?: DoctorInvitationResponse;
  } | null>(null);
  const [profileNotice, setProfileNotice] = useState<{
    type: 'success' | 'info' | 'warning' | 'error';
    message: string;
  } | null>(null);

  // Doctor Invitation (Admin IAM) states
  const [inviteEmail, setInviteEmail] = useState('');
  const [isInvitingDoctor, setIsInvitingDoctor] = useState(false);
  const [inviteNotice, setInviteNotice] = useState<{
    type: 'success' | 'info' | 'error';
    message: string;
    invitation?: DoctorInvitationResponse;
  } | null>(null);

  const populateFormFromProfile = useCallback((profile: ProfileResponse | null) => {
    if (!profile) return;
    setFirstName(profile.firstName ?? '');
    setLastName(profile.lastName ?? '');
    setMedicalLicense(profile.medicalLicense ?? '');
    setSpecialty(profile.specialty ?? '');
    setPhone(profile.phone ?? '');
    setDocumentNumber(profile.documentNumber ?? '');
    setBirthDate(profile.birthDate ?? '');
  }, []);

  const loadCurrentProfile = useCallback(async () => {
    if (!isCognitoMode) return;
    setLoadingProfile(true);
    setProfileNotice(null);

    try {
      const profile = await profileApi.getMyProfile();
      setUserProfile(profile);
      populateFormFromProfile(profile);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setProfileNotice({
          type: 'warning',
          message:
            'Profile (8082) devolvió 403: activa primero tu invitación médica en IAM (Paso 1) si aún no lo hiciste.',
        });
      } else if (err instanceof ApiError && err.status === 404) {
        setProfileNotice({
          type: 'info',
          message:
            'Tu perfil médico aún no existe en Profile (404). Completa el formulario del Paso 2 para registrarlo.',
        });
      } else {
        setProfileNotice({
          type: 'error',
          message: `No se pudo cargar tu perfil actual: ${extractApiErrorMessage(err)}`,
        });
      }
    } finally {
      setLoadingProfile(false);
    }
  }, [isCognitoMode, populateFormFromProfile, setUserProfile]);

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab(initialTab);
    setIamActivationInfo(null);
    setProfileNotice(null);
    setInviteNotice(null);

    const existingProfile = useAppStore.getState().userProfile;
    if (existingProfile) {
      populateFormFromProfile(existingProfile);
    }

    if (isCognitoMode) {
      void loadCurrentProfile();
    }
  }, [isOpen, initialTab, isCognitoMode, populateFormFromProfile, loadCurrentProfile]);

  if (!isOpen) return null;

  const cmpValidation = validateMedicalLicense(medicalLicense);

  const handleActivateDoctorIam = async () => {
    if (!isCognitoMode) return;
    setActivatingIam(true);
    setIamActivationInfo(null);

    try {
      const res = await iamApi.activateMyDoctorAccount();
      setIamActivationInfo({
        type: 'success',
        message: 'Cuenta médica activada en IAM correctamente. Ahora puedes completar tu perfil CMP.',
        invitation: res,
      });
      await loadCurrentProfile();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setIamActivationInfo({
          type: 'info',
          message:
            'No se encontró una invitación médica pendiente (404). Si tu cuenta Cognito ya cuenta con grupo DOCTOR o fue pre-aprobada, continúa directamente al Paso 2.',
        });
      } else if (err instanceof ApiError && err.status === 409) {
        setIamActivationInfo({
          type: 'info',
          message:
            'Tu cuenta médica ya estaba activada en IAM (409). Puedes proceder directamente con el Paso 2.',
        });
        await loadCurrentProfile();
      } else {
        setIamActivationInfo({
          type: 'error',
          message: extractApiErrorMessage(err),
        });
      }
    } finally {
      setActivatingIam(false);
    }
  };

  const handleSubmitProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isCognitoMode) return;

    const trimmedFirstName = firstName.trim();
    const trimmedLastName = lastName.trim();

    if (!trimmedFirstName || !trimmedLastName) {
      setProfileNotice({
        type: 'error',
        message: 'Los campos Nombres y Apellidos son obligatorios.',
      });
      return;
    }

    if (!cmpValidation.isValid) {
      setProfileNotice({
        type: 'error',
        message: cmpValidation.message,
      });
      return;
    }

    const body: OnboardDoctorBody = {
      firstName: trimmedFirstName,
      lastName: trimmedLastName,
      medicalLicense: cmpValidation.trimmed,
      specialty: specialty.trim() || null,
      phone: phone.trim() || null,
      documentNumber: documentNumber.trim() || null,
      birthDate: birthDate.trim() || null,
    };

    setSavingProfile(true);
    setProfileNotice(null);

    try {
      const updated = await profileApi.onboardDoctorProfile(body);
      setUserProfile(updated);
      populateFormFromProfile(updated);
      setProfileNotice({
        type: 'success',
        message: `Perfil profesional actualizado (${updated.status}). CMP ${updated.medicalLicense ?? cmpValidation.trimmed} registrado.`,
      });
      onSuccess?.(updated);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setProfileNotice({
          type: 'error',
          message:
            'Acceso denegado (403): verifica haber ejecutado el Paso 1 (Activación IAM) y que tu token tenga rol DOCTOR.',
        });
      } else if (err instanceof ApiError && err.status === 409) {
        setProfileNotice({
          type: 'error',
          message: `Conflicto al guardar perfil (409): ${extractApiErrorMessage(err)}`,
        });
      } else {
        setProfileNotice({
          type: 'error',
          message: extractApiErrorMessage(err),
        });
      }
    } finally {
      setSavingProfile(false);
    }
  };

  // Handle Admin IAM Doctor Invitation
  const handleInviteDoctor = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailClean = inviteEmail.trim().toLowerCase();

    if (!emailClean) {
      setInviteNotice({
        type: 'error',
        message: 'Por favor ingresa el correo electrónico del médico a invitar.',
      });
      return;
    }

    if (!EMAIL_REGEX.test(emailClean)) {
      setInviteNotice({
        type: 'error',
        message: 'El formato de correo electrónico ingresado no es válido.',
      });
      return;
    }

    setIsInvitingDoctor(true);
    setInviteNotice(null);

    try {
      const body: InviteDoctorBody = { doctorEmail: emailClean };
      const response = await iamApi.inviteDoctor(body);

      setInviteNotice({
        type: 'success',
        message: `Invitación emitida exitosamente. Se ha creado el usuario facultativo en AWS Cognito y enviado una contraseña temporal a ${emailClean}.`,
        invitation: response,
      });
      setInviteEmail('');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setInviteNotice({
            type: 'error',
            message: 'No autorizado (401): Tu sesión o token ha expirado. Inicia sesión nuevamente.',
          });
        } else if (err.status === 403) {
          setInviteNotice({
            type: 'error',
            message:
              'Acceso denegado (403): Solo usuarios con rol de administrador (ADMIN) en AWS Cognito tienen autorización para invitar médicos.',
          });
        } else if (err.status === 409) {
          setInviteNotice({
            type: 'error',
            message: `Conflicto (409): El correo ${emailClean} ya tiene una invitación registrada o usuario activo en Cognito.`,
          });
        } else {
          setInviteNotice({
            type: 'error',
            message: extractApiErrorMessage(err),
          });
        }
      } else {
        setInviteNotice({
          type: 'error',
          message: extractApiErrorMessage(err),
        });
      }
    } finally {
      setIsInvitingDoctor(false);
    }
  };

  const currentStatus = userProfile?.status ?? 'PENDING_COMPLETION';

  return (
    <div className="fixed inset-0 z-50 bg-[#071524]/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-[#071524]/10 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="bg-[#1C2A39] text-white p-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#26A69A]/20 text-[#84F5E8] flex items-center justify-center border border-[#84F5E8]/30 shrink-0">
              {activeTab === 'profile' ? (
                <Stethoscope className="w-5 h-5" />
              ) : (
                <UserPlus className="w-5 h-5" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-base sm:text-lg text-white">
                  {activeTab === 'profile'
                    ? 'Onboarding Facultativo (IAM + Profile)'
                    : 'Administración IAM · Invitar Médico'}
                </h3>
                {isCognitoMode && activeTab === 'profile' && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${
                      currentStatus === 'ACTIVE'
                        ? 'bg-[#26A69A]/25 text-[#84F5E8] border border-[#84F5E8]/30'
                        : 'bg-amber-400/20 text-amber-200 border border-amber-300/30'
                    }`}
                  >
                    {currentStatus}
                  </span>
                )}
              </div>
              <p className="text-xs text-[#84F5E8]/80 font-medium truncate">
                {activeTab === 'profile'
                  ? 'Activación de cuenta facultativa (8081) y registro de colegiatura CMP (8082)'
                  : 'Gestión de accesos clínicos y aprovisionamiento Cognito (POST /api/v1/doctor-invitations)'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar modal"
            className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Navigation Tabs */}
        <div className="flex border-b border-[#071524]/10 bg-[#F3FAFF] px-5 pt-2 text-xs font-semibold gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('profile')}
            className={`py-2 px-3 border-b-2 font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'profile'
                ? 'border-[#006A62] text-[#006A62]'
                : 'border-transparent text-[#44474C] hover:text-[#071524]'
            }`}
          >
            <Stethoscope className="w-3.5 h-3.5" />
            <span>Mi Perfil Facultativo (CMP)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('doctor-invite')}
            className={`py-2 px-3 border-b-2 font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'doctor-invite'
                ? 'border-[#006A62] text-[#006A62]'
                : 'border-transparent text-[#44474C] hover:text-[#071524]'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Admin IAM · Invitar Médico</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5 text-xs">
          {/* TAB 1: MI PERFIL FACULTATIVO */}
          {activeTab === 'profile' && (
            <>
              {!isCognitoMode ? (
                <div className="p-4 rounded-xl bg-[#DBF1FE] border border-[#006A62]/20 text-[#071E27] flex items-start gap-3">
                  <Info className="w-5 h-5 text-[#006A62] shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-bold text-sm text-[#071524]">Modo Demo Local Activo</p>
                    <p className="text-xs text-[#44474C] leading-relaxed">
                      Las mutaciones hacia los microservicios IAM (8081) y Profile (8082) requieren iniciar sesión con Cognito OAuth2 PKCE o un Access Token JWT válido. En modo demo se utiliza el perfil clínico simulado de la Dra. Elena Ramos.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Step 1: IAM Doctor Activation */}
                  <section className="rounded-xl border border-[#071524]/15 bg-[#F3FAFF] p-4 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#1C2A39] text-[#84F5E8] text-[11px] font-bold">
                            1
                          </span>
                          <h4 className="font-bold text-sm text-[#071524]">
                            Activación de Cuenta Médica en IAM
                          </h4>
                        </div>
                        <p className="text-[11px] text-[#44474C] pl-7">
                          Ejecuta <code className="text-[10px] bg-white px-1.5 py-0.5 rounded border border-[#C4C6CC]/50">PUT /api/v1/doctor-invitations/me/activation</code> para vincular tu identidad Cognito como facultativo.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={handleActivateDoctorIam}
                        disabled={activatingIam}
                        className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg bg-[#006A62] hover:bg-[#005049] disabled:opacity-60 text-white font-bold text-xs transition-colors shrink-0 cursor-pointer"
                      >
                        {activatingIam ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <UserCheck className="w-3.5 h-3.5" />
                        )}
                        <span>{activatingIam ? 'Activando...' : 'Activar Invitación IAM'}</span>
                      </button>
                    </div>

                    {iamActivationInfo && (
                      <div
                        className={`p-3 rounded-lg border text-[11px] flex items-start gap-2 ${
                          iamActivationInfo.type === 'success'
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                            : iamActivationInfo.type === 'info'
                            ? 'bg-[#DBF1FE] border-[#006A62]/25 text-[#071E27]'
                            : 'bg-red-50 border-red-200 text-red-900'
                        }`}
                      >
                        {iamActivationInfo.type === 'success' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                        ) : iamActivationInfo.type === 'info' ? (
                          <Info className="w-4 h-4 text-[#006A62] shrink-0 mt-0.5" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                        )}
                        <div className="space-y-1 min-w-0">
                          <p className="font-semibold">{iamActivationInfo.message}</p>
                          {iamActivationInfo.invitation && (
                            <div className="text-[10px] opacity-85 flex flex-wrap gap-x-3 gap-y-0.5">
                              <span>ID: {iamActivationInfo.invitation.invitationId}</span>
                              <span>Email: {iamActivationInfo.invitation.doctorEmail}</span>
                              <span>Estado: {iamActivationInfo.invitation.status}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </section>

                  {/* Step 2: Doctor Profile Completion */}
                  <section className="rounded-xl border border-[#071524]/15 bg-white p-4 space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#1C2A39] text-[#84F5E8] text-[11px] font-bold">
                          2
                        </span>
                        <h4 className="font-bold text-sm text-[#071524]">
                          Perfil Profesional y Colegiatura CMP
                        </h4>
                      </div>

                      <button
                        type="button"
                        onClick={() => void loadCurrentProfile()}
                        disabled={loadingProfile}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#C4C6CC] text-[#071524] hover:bg-[#F3FAFF] font-semibold text-[11px] transition-colors cursor-pointer disabled:opacity-60"
                      >
                        <RefreshCw className={`w-3 h-3 ${loadingProfile ? 'animate-spin' : ''}`} />
                        <span>Recargar Perfil</span>
                      </button>
                    </div>

                    {profileNotice && (
                      <div
                        className={`p-3 rounded-lg border text-[11px] flex items-start gap-2 ${
                          profileNotice.type === 'success'
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                            : profileNotice.type === 'warning'
                            ? 'bg-amber-50 border-amber-200 text-amber-900'
                            : profileNotice.type === 'info'
                            ? 'bg-[#DBF1FE] border-[#006A62]/25 text-[#071E27]'
                            : 'bg-red-50 border-red-200 text-red-900'
                        }`}
                      >
                        {profileNotice.type === 'success' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                        ) : profileNotice.type === 'warning' || profileNotice.type === 'error' ? (
                          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        ) : (
                          <Info className="w-4 h-4 text-[#006A62] shrink-0 mt-0.5" />
                        )}
                        <span className="font-medium leading-relaxed">{profileNotice.message}</span>
                      </div>
                    )}

                    <form onSubmit={handleSubmitProfile} className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block font-bold text-[#071524] mb-1">
                            Nombres *
                          </label>
                          <input
                            type="text"
                            required
                            value={firstName}
                            onChange={(e) => setFirstName(e.target.value)}
                            placeholder="Ej. Elena"
                            className="w-full px-3 py-2 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/70 text-sm text-[#071524] focus:ring-2 focus:ring-[#006A62] outline-none"
                          />
                        </div>

                        <div>
                          <label className="block font-bold text-[#071524] mb-1">
                            Apellidos *
                          </label>
                          <input
                            type="text"
                            required
                            value={lastName}
                            onChange={(e) => setLastName(e.target.value)}
                            placeholder="Ej. Ramos Morales"
                            className="w-full px-3 py-2 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/70 text-sm text-[#071524] focus:ring-2 focus:ring-[#006A62] outline-none"
                          />
                        </div>

                        <div>
                          <label className="block font-bold text-[#071524] mb-1">
                            Colegiatura CMP (6 dígitos) *
                          </label>
                          <input
                            type="text"
                            required
                            inputMode="numeric"
                            maxLength={6}
                            value={medicalLicense}
                            onChange={(e) => setMedicalLicense(e.target.value)}
                            placeholder="Ej. 058492"
                            className={`w-full px-3 py-2 rounded-lg bg-[#F3FAFF] border text-sm font-mono text-[#071524] focus:ring-2 outline-none ${
                              !medicalLicense.trim()
                                ? 'border-[#C4C6CC]/70 focus:ring-[#006A62]'
                                : cmpValidation.isValid
                                ? 'border-emerald-500 focus:ring-emerald-500'
                                : 'border-[#BA1A1A] focus:ring-[#BA1A1A]'
                            }`}
                          />
                          <p
                            className={`mt-1 text-[11px] font-medium ${
                              !medicalLicense.trim()
                                ? 'text-[#44474C]'
                                : cmpValidation.isValid
                                ? 'text-emerald-700'
                                : 'text-[#BA1A1A]'
                            }`}
                          >
                            {cmpValidation.message}
                          </p>
                        </div>

                        <div>
                          <label className="block font-bold text-[#071524] mb-1">
                            Especialidad (opcional)
                          </label>
                          <input
                            type="text"
                            value={specialty}
                            onChange={(e) => setSpecialty(e.target.value)}
                            placeholder="Ej. Neuroftalmología"
                            className="w-full px-3 py-2 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/70 text-sm text-[#071524] focus:ring-2 focus:ring-[#006A62] outline-none"
                          />
                        </div>

                        <div>
                          <label className="block font-bold text-[#071524] mb-1">
                            Teléfono (opcional)
                          </label>
                          <input
                            type="tel"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder="+51 987 654 321"
                            className="w-full px-3 py-2 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/70 text-sm text-[#071524] focus:ring-2 focus:ring-[#006A62] outline-none"
                          />
                        </div>

                        <div>
                          <label className="block font-bold text-[#071524] mb-1">
                            Documento / DNI (opcional)
                          </label>
                          <input
                            type="text"
                            value={documentNumber}
                            onChange={(e) => setDocumentNumber(e.target.value)}
                            placeholder="Ej. 42891024"
                            className="w-full px-3 py-2 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/70 text-sm text-[#071524] focus:ring-2 focus:ring-[#006A62] outline-none"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block font-bold text-[#071524] mb-1">
                            Fecha de nacimiento (opcional)
                          </label>
                          <input
                            type="date"
                            value={birthDate}
                            onChange={(e) => setBirthDate(e.target.value)}
                            className="w-full sm:w-1/2 px-3 py-2 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/70 text-sm text-[#071524] focus:ring-2 focus:ring-[#006A62] outline-none"
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-3 pt-3 border-t border-[#071524]/10">
                        <div className="flex items-center gap-1.5 text-[11px] text-[#006A62] font-semibold">
                          <ShieldCheck className="w-4 h-4 shrink-0" />
                          <span>PUT /api/v1/profile/professional</span>
                        </div>

                        <div className="flex items-center gap-2.5">
                          <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 rounded-lg border border-[#C4C6CC] text-[#44474C] font-semibold hover:bg-[#F3FAFF] transition-colors cursor-pointer"
                          >
                            Cerrar
                          </button>
                          <button
                            type="submit"
                            disabled={savingProfile || !cmpValidation.isValid}
                            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-[#1C2A39] hover:bg-[#071524] disabled:opacity-50 text-white font-bold transition-colors shadow-xs cursor-pointer"
                          >
                            {savingProfile && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            <span>
                              {savingProfile ? 'Guardando...' : 'Guardar Perfil Médico'}
                            </span>
                          </button>
                        </div>
                      </div>
                    </form>
                  </section>
                </>
              )}
            </>
          )}

          {/* TAB 2: ADMIN IAM - INVITAR MÉDICO */}
          {activeTab === 'doctor-invite' && (
            <div className="space-y-4">
              <section className="rounded-xl border border-[#071524]/15 bg-[#F3FAFF] p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-[#1C2A39] text-[#84F5E8] flex items-center justify-center shrink-0">
                    <UserPlus className="w-4 h-4" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="font-bold text-sm text-[#071524]">
                      Aprovisionamiento de Facultativos (IAM Service)
                    </h4>
                    <p className="text-xs text-[#44474C] leading-relaxed">
                      Emite una invitación a través de <code className="text-[10px] bg-white px-1.5 py-0.5 rounded border border-[#C4C6CC]/50">POST /api/v1/doctor-invitations</code>. Esto creará el usuario en AWS Cognito asignado al grupo <strong>DOCTOR</strong> y despachará una contraseña temporal para su primer acceso clínico.
                    </p>
                  </div>
                </div>

                {!isCognitoMode && (
                  <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <span>
                      Modo Demo: Para registrar invitaciones en IAM es necesario contar con un Access Token Cognito con privilegios de Administrador (grupo ADMIN).
                    </span>
                  </div>
                )}

                <form onSubmit={handleInviteDoctor} className="space-y-3 pt-2">
                  <div>
                    <label className="block font-bold text-[#071524] mb-1">
                      Correo Electrónico Institucional del Médico *
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-[#44474C] absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="email"
                        required
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="medico.especialista@hospital.pe"
                        className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-white border border-[#C4C6CC] text-xs text-[#071524] focus:ring-2 focus:ring-[#006A62] outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-1">
                    <div className="flex items-center gap-1.5 text-[11px] text-[#006A62] font-semibold">
                      <ShieldCheck className="w-4 h-4 shrink-0" />
                      <span>Requiere grupo Cognito ADMIN</span>
                    </div>

                    <button
                      type="submit"
                      disabled={isInvitingDoctor || !inviteEmail.trim()}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#006A62] hover:bg-[#005049] disabled:opacity-50 text-white font-bold text-xs transition-colors shadow-xs cursor-pointer"
                    >
                      {isInvitingDoctor ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <UserPlus className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {isInvitingDoctor
                          ? 'Enviando invitación...'
                          : 'Enviar Invitación a Médico (POST /api/v1/doctor-invitations)'}
                      </span>
                    </button>
                  </div>
                </form>
              </section>

              {/* Invitation Feedback / Error */}
              {inviteNotice && (
                <div
                  className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
                    inviteNotice.type === 'success'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                      : inviteNotice.type === 'info'
                      ? 'bg-[#DBF1FE] border-[#006A62]/25 text-[#071E27]'
                      : 'bg-red-50 border-red-200 text-red-950'
                  }`}
                >
                  {inviteNotice.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  ) : inviteNotice.type === 'info' ? (
                    <Info className="w-4 h-4 text-[#006A62] shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-[#BA1A1A] shrink-0 mt-0.5" />
                  )}
                  <div className="space-y-1 flex-1">
                    <p className="font-semibold">{inviteNotice.message}</p>

                    {/* Detailed DoctorInvitationResponse Card */}
                    {inviteNotice.invitation && (
                      <div className="mt-3 p-3 rounded-lg bg-white border border-emerald-200 shadow-2xs space-y-2 text-[11px] text-[#071524]">
                        <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                          <span className="font-bold text-[#006A62]">
                            Detalle de Respuesta: DoctorInvitationResponse
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              inviteNotice.invitation.status === 'ACTIVATED'
                                ? 'bg-emerald-100 text-emerald-800'
                                : inviteNotice.invitation.status === 'INVITED'
                                ? 'bg-[#D5ECF8] text-[#006A62]'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            Estado: {inviteNotice.invitation.status}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div>
                            <span className="text-[#44474C] block">ID de Invitación (id):</span>
                            <span className="font-mono text-[10px] font-bold text-[#071524] break-all">
                              {inviteNotice.invitation.invitationId}
                            </span>
                          </div>

                          <div>
                            <span className="text-[#44474C] block">Email del Médico (email):</span>
                            <span className="font-semibold text-[#071524] break-all">
                              {inviteNotice.invitation.doctorEmail}
                            </span>
                          </div>

                          <div>
                            <span className="text-[#44474C] block">Cognito Username / Sub:</span>
                            <span className="font-mono text-[10px] text-[#071524] flex items-center gap-1">
                              <KeyRound className="w-3 h-3 text-[#006A62]" />
                              {inviteNotice.invitation.doctorSubject || '(Asignado en Cognito al activar)'}
                            </span>
                          </div>

                          <div>
                            <span className="text-[#44474C] block">Fecha de Creación:</span>
                            <span className="text-[#071524] flex items-center gap-1">
                              <Calendar className="w-3 h-3 text-[#44474C]" />
                              {formatDate(inviteNotice.invitation.createdAt)}
                            </span>
                          </div>

                          <div className="sm:col-span-2">
                            <span className="text-[#44474C] block">Última Actualización:</span>
                            <span className="text-[#071524]">
                              {formatDate(inviteNotice.invitation.updatedAt)}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 bg-[#F3FAFF] border-t border-[#071524]/10 flex justify-between items-center text-xs">
          <span className="text-[#44474C] text-[11px]">
            NeuroVisión IAM & Profile Service v4.8
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#1C2A39] text-white text-xs font-bold hover:bg-[#071524] transition-colors cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
