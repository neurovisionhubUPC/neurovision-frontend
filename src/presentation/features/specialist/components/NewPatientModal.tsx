import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  UserPlus,
  Shield,
  Mail,
  Send,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Info,
  Clock,
  Loader2,
  ListChecks,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type { Patient, AffectedHemifield } from '../../../../core/domain/Patient';
import { useAppStore } from '../../../../core/store/useAppStore';
import { iamApi } from '../../../../infrastructure/api/iamApi';
import { ApiError, extractApiErrorMessage } from '../../../../infrastructure/api/httpClient';
import type {
  InvitationStatus,
  PatientInvitationPageResponse,
  PatientInvitationResponse,
} from '../../../../infrastructure/api/contracts/iam.contracts';

interface NewPatientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSavePatient?: (patient: Patient) => void;
  onSuccess?: () => void;
}

type StatusFilter = 'ALL' | InvitationStatus;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STATUS_BADGE_MAP: Record<
  InvitationStatus,
  { label: string; badgeClass: string }
> = {
  PENDING: {
    label: 'PENDING',
    badgeClass: 'bg-amber-100 text-amber-900 border-amber-200',
  },
  INVITED: {
    label: 'INVITED',
    badgeClass: 'bg-sky-100 text-sky-900 border-sky-200',
  },
  ACTIVATED: {
    label: 'ACTIVATED',
    badgeClass: 'bg-emerald-100 text-emerald-900 border-emerald-200',
  },
  FAILED: {
    label: 'FAILED',
    badgeClass: 'bg-red-100 text-red-900 border-red-200',
  },
};

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString('es-PE', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

export const NewPatientModal: React.FC<NewPatientModalProps> = ({
  isOpen,
  onClose,
  onSavePatient,
  onSuccess,
}) => {
  const { authMode, accessToken, addPatient } = useAppStore();
  const isCognitoMode = authMode === 'COGNITO' && Boolean(accessToken);

  // Mock form state
  const [name, setName] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [medicalRecordNumber, setMedicalRecordNumber] = useState('');
  const [age, setAge] = useState<number>(60);
  const [gender, setGender] = useState<'Masculino' | 'Femenino' | 'Otro'>('Masculino');
  const [affectedHemifield, setAffectedHemifield] = useState<AffectedHemifield>('LEFT');
  const [hemifieldDetail, setHemifieldDetail] = useState('Hemianopsia Homónima Completa');
  const [facility, setFacility] = useState('Sede Rebagliati');
  const [phone, setPhone] = useState('+51 ');
  const [notes, setNotes] = useState('');
  const [mockError, setMockError] = useState<string | null>(null);

  // Cognito IAM Invitation state
  const [cognitoTab, setCognitoTab] = useState<'invite' | 'list'>('invite');
  const [patientEmail, setPatientEmail] = useState('');
  const [sendingInvite, setSendingInvite] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [createdInvitation, setCreatedInvitation] =
    useState<PatientInvitationResponse | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [page, setPage] = useState(0);
  const [invitationsPage, setInvitationsPage] =
    useState<PatientInvitationPageResponse | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const fetchInvitations = useCallback(
    async (targetPage: number, targetFilter: StatusFilter) => {
      if (!isCognitoMode) return;
      setLoadingList(true);
      setListError(null);
      try {
        const res = await iamApi.listPatientInvitations({
          page: targetPage,
          size: 8,
          status: targetFilter === 'ALL' ? undefined : targetFilter,
        });
        setInvitationsPage(res);
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) {
          setListError(
            'Acceso denegado (403): verifica que tu cuenta médica esté activada en IAM (Onboarding Médico).'
          );
        } else {
          setListError(extractApiErrorMessage(err));
        }
      } finally {
        setLoadingList(false);
      }
    },
    [isCognitoMode]
  );

  useEffect(() => {
    if (!isOpen) return;
    setMockError(null);
    setInviteError(null);
    setCreatedInvitation(null);

    if (isCognitoMode) {
      void fetchInvitations(page, statusFilter);
    }
  }, [isOpen, isCognitoMode, page, statusFilter, fetchInvitations]);

  if (!isOpen) return null;

  const handleMockSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !nationalId.trim()) {
      setMockError('Por favor ingrese el nombre completo y DNI del paciente.');
      return;
    }

    const initials = name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase();

    const newPatient: Patient = {
      id: `pat-${Date.now()}`,
      initials: initials || 'PX',
      name: name.trim(),
      medicalRecordNumber: medicalRecordNumber.trim()
        ? `#${medicalRecordNumber.trim().replace('#', '')}`
        : `#${Math.floor(100000 + Math.random() * 900000)}`,
      nationalId: nationalId.trim(),
      age: Number(age),
      gender,
      affectedHemifield,
      hemifieldDetail,
      accountStatus: 'PENDING',
      statusDetail: 'Código SMS Enviado',
      lastSession: {
        timestampText: 'Sin registro inicial',
        durationMinutes: 0,
        moduleName: 'Pendiente de inicio',
      },
      adherence: {
        rate: 0,
        category: 'Deficiente',
      },
      riskAlert: {
        severity: 'PENDING',
        label: 'Calibración pendiente',
      },
      facility,
      shift: 'Turno Mañana',
      phone,
      clinicalNotes: notes,
    };

    if (onSavePatient) {
      onSavePatient(newPatient);
    } else {
      addPatient(newPatient);
    }
    onSuccess?.();

    setName('');
    setNationalId('');
    setMedicalRecordNumber('');
    setNotes('');
    onClose();
  };

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = patientEmail.trim().toLowerCase();

    if (!EMAIL_REGEX.test(trimmedEmail)) {
      setInviteError('Ingresa un correo electrónico válido para el paciente.');
      return;
    }

    setSendingInvite(true);
    setInviteError(null);
    setCreatedInvitation(null);

    try {
      const response = await iamApi.invitePatient({ patientEmail: trimmedEmail });
      setCreatedInvitation(response);
      setPatientEmail('');
      onSuccess?.();
      setPage(0);
      await fetchInvitations(0, statusFilter);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setInviteError(
          `Conflicto (409): el correo "${trimmedEmail}" ya tiene una invitación pendiente/activa o el paciente ya se encuentra vinculado. Revisa el historial en "Invitaciones Enviadas".`
        );
      } else if (err instanceof ApiError && err.status === 403) {
        setInviteError(
          'Permisos insuficientes (403): asegúrate de haber activado tu cuenta médica en IAM desde el Onboarding Médico en la barra superior.'
        );
      } else {
        setInviteError(extractApiErrorMessage(err));
      }
    } finally {
      setSendingInvite(false);
    }
  };

  const filterOptions: Array<{ value: StatusFilter; label: string }> = [
    { value: 'ALL', label: 'Todas' },
    { value: 'PENDING', label: 'PENDING' },
    { value: 'INVITED', label: 'INVITED' },
    { value: 'ACTIVATED', label: 'ACTIVATED' },
    { value: 'FAILED', label: 'FAILED' },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-[#071524]/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-[#071524]/10 overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="bg-[#1C2A39] text-white p-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#26A69A]/20 text-[#84F5E8] flex items-center justify-center border border-[#84F5E8]/30 shrink-0">
              {isCognitoMode ? (
                <Mail className="w-5 h-5" />
              ) : (
                <UserPlus className="w-5 h-5" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-lg text-white">
                  {isCognitoMode
                    ? 'Invitar Paciente vía IAM'
                    : 'Registrar Nuevo Paciente'}
                </h3>
                {isCognitoMode && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#26A69A]/25 text-[#84F5E8] border border-[#84F5E8]/30">
                    IAM · 8081
                  </span>
                )}
              </div>
              <p className="text-xs text-[#84F5E8]/80 font-medium truncate">
                {isCognitoMode
                  ? 'Emisión de invitaciones clínicas Cognito y seguimiento de activación'
                  : 'Alta clínica y asignación de protocolo de rehabilitación visual'}
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

        {/* COGNITO MODE: Real IAM Invitation Flow */}
        {isCognitoMode ? (
          <div className="flex flex-col flex-1 overflow-hidden text-xs">
            {/* Sub-navigation Tabs */}
            <div className="px-6 pt-3 bg-[#F3FAFF] border-b border-[#071524]/10 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCognitoTab('invite')}
                className={`px-3.5 py-2 rounded-t-lg font-bold text-xs flex items-center gap-1.5 border-b-2 transition-colors cursor-pointer ${
                  cognitoTab === 'invite'
                    ? 'bg-white text-[#071524] border-[#006A62]'
                    : 'text-[#44474C] border-transparent hover:text-[#071524]'
                }`}
              >
                <Send className="w-3.5 h-3.5 text-[#006A62]" />
                <span>Nueva Invitación</span>
              </button>

              <button
                type="button"
                onClick={() => setCognitoTab('list')}
                className={`px-3.5 py-2 rounded-t-lg font-bold text-xs flex items-center gap-1.5 border-b-2 transition-colors cursor-pointer ${
                  cognitoTab === 'list'
                    ? 'bg-white text-[#071524] border-[#006A62]'
                    : 'text-[#44474C] border-transparent hover:text-[#071524]'
                }`}
              >
                <ListChecks className="w-3.5 h-3.5 text-[#006A62]" />
                <span>Invitaciones Enviadas</span>
                {invitationsPage && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-[#DBF1FE] text-[#006A62] font-bold">
                    {invitationsPage.totalElements}
                  </span>
                )}
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              {cognitoTab === 'invite' ? (
                <>
                  {/* Architectural Flow Info */}
                  <div className="p-3.5 rounded-xl bg-[#DBF1FE] border border-[#006A62]/20 text-[#071E27] flex items-start gap-2.5">
                    <Info className="w-4 h-4 text-[#006A62] shrink-0 mt-0.5" />
                    <div className="text-[11px] leading-relaxed space-y-1">
                      <p className="font-bold text-[#071524]">
                        Flujo de incorporación de paciente en microservicios:
                      </p>
                      <p>
                        1. Envías la invitación por correo mediante{' '}
                        <code className="bg-white/80 px-1 rounded">
                          POST /api/v1/patient-invitations
                        </code>
                        .
                      </p>
                      <p>
                        2. El paciente inicia sesión con Cognito, activa su invitación (
                        <code className="bg-white/80 px-1 rounded">
                          PUT /api/v1/patient-invitations/me/activation
                        </code>
                        ) y completa su perfil clínico; tras ello aparecerá en tu lista de
                        pacientes asignados.
                      </p>
                    </div>
                  </div>

                  <form onSubmit={handleInviteSubmit} className="space-y-4">
                    <div>
                      <label className="block font-bold text-[#071524] mb-1.5">
                        Correo Electrónico del Paciente *
                      </label>
                      <input
                        type="email"
                        required
                        value={patientEmail}
                        onChange={(e) => setPatientEmail(e.target.value)}
                        placeholder="paciente@dominio.com"
                        className="w-full px-3.5 py-2.5 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/70 text-sm text-[#071524] focus:ring-2 focus:ring-[#006A62] outline-none"
                      />
                    </div>

                    {inviteError && (
                      <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-900 flex items-start gap-2 text-[11px]">
                        <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                        <span className="font-medium leading-relaxed">{inviteError}</span>
                      </div>
                    )}

                    {createdInvitation && (
                      <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 font-bold text-xs text-emerald-800">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                            <span>Invitación creada y registrada en IAM</span>
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                              STATUS_BADGE_MAP[createdInvitation.status].badgeClass
                            }`}
                          >
                            {createdInvitation.status}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] bg-white/75 rounded-lg p-3 border border-emerald-200/70">
                          <div>
                            <span className="text-[#44474C] block">Invitation ID</span>
                            <span className="font-mono font-semibold text-[#071524] break-all">
                              {createdInvitation.invitationId}
                            </span>
                          </div>
                          <div>
                            <span className="text-[#44474C] block">Correo del Paciente</span>
                            <span className="font-semibold text-[#071524] break-all">
                              {createdInvitation.patientEmail}
                            </span>
                          </div>
                          <div>
                            <span className="text-[#44474C] block">Creada</span>
                            <span className="font-semibold text-[#071524]">
                              {formatDateTime(createdInvitation.createdAt)}
                            </span>
                          </div>
                          <div>
                            <span className="text-[#44474C] block">Activada</span>
                            <span className="font-semibold text-[#071524]">
                              {createdInvitation.activatedAt
                                ? formatDateTime(createdInvitation.activatedAt)
                                : 'Pendiente de activación'}
                            </span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => setCognitoTab('list')}
                          className="text-[11px] font-bold text-[#006A62] hover:underline cursor-pointer"
                        >
                          Ver todas las invitaciones enviadas &rarr;
                        </button>
                      </div>
                    )}

                    <div className="pt-3 border-t border-[#071524]/10 flex items-center justify-end gap-3">
                      <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg border border-[#C4C6CC] text-[#44474C] font-semibold hover:bg-[#F3FAFF] transition-colors cursor-pointer"
                      >
                        Cerrar
                      </button>
                      <button
                        type="submit"
                        disabled={sendingInvite}
                        className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-[#1C2A39] hover:bg-[#071524] disabled:opacity-60 text-white font-bold transition-colors shadow-xs cursor-pointer"
                      >
                        {sendingInvite ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Send className="w-3.5 h-3.5 text-[#84F5E8]" />
                        )}
                        <span>
                          {sendingInvite ? 'Enviando invitación...' : 'Enviar Invitación IAM'}
                        </span>
                      </button>
                    </div>
                  </form>
                </>
              ) : (
                <div className="space-y-3">
                  {/* Status Filter + Refresh Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {filterOptions.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => {
                            setStatusFilter(opt.value);
                            setPage(0);
                          }}
                          className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors cursor-pointer ${
                            statusFilter === opt.value
                              ? 'bg-[#1C2A39] text-white border-[#1C2A39]'
                              : 'bg-[#F3FAFF] text-[#44474C] border-[#C4C6CC]/70 hover:bg-[#DBF1FE]'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => void fetchInvitations(page, statusFilter)}
                      disabled={loadingList}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#C4C6CC] text-[#071524] hover:bg-[#F3FAFF] font-semibold text-[11px] cursor-pointer disabled:opacity-60"
                    >
                      <RefreshCw
                        className={`w-3 h-3 ${loadingList ? 'animate-spin' : ''}`}
                      />
                      <span>Actualizar</span>
                    </button>
                  </div>

                  {listError && (
                    <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-900 flex items-start gap-2 text-[11px]">
                      <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                      <span className="font-medium">{listError}</span>
                    </div>
                  )}

                  {loadingList && !invitationsPage ? (
                    <div className="py-10 flex flex-col items-center justify-center text-[#44474C] gap-2">
                      <Loader2 className="w-5 h-5 animate-spin text-[#006A62]" />
                      <span>Cargando invitaciones desde IAM...</span>
                    </div>
                  ) : invitationsPage && invitationsPage.items.length > 0 ? (
                    <div className="space-y-2">
                      {invitationsPage.items.map((inv) => {
                        const badge = STATUS_BADGE_MAP[inv.status];
                        return (
                          <div
                            key={inv.invitationId}
                            className="p-3 rounded-xl bg-[#F3FAFF] border border-[#071524]/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                          >
                            <div className="min-w-0 space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-xs text-[#071524] break-all">
                                  {inv.patientEmail}
                                </span>
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${badge.badgeClass}`}
                                >
                                  {badge.label}
                                </span>
                              </div>
                              <div className="text-[10px] text-[#44474C] flex flex-wrap items-center gap-x-3 gap-y-0.5">
                                <span className="font-mono" title={inv.invitationId}>
                                  ID: {inv.invitationId.slice(0, 12)}...
                                </span>
                                <span className="inline-flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  Creada: {formatDateTime(inv.createdAt)}
                                </span>
                                {inv.activatedAt && (
                                  <span className="text-emerald-700 font-semibold">
                                    Activada: {formatDateTime(inv.activatedAt)}
                                  </span>
                                )}
                              </div>
                            </div>

                            {inv.patientSubject && (
                              <div className="text-[10px] font-mono bg-white px-2 py-1 rounded border border-[#C4C6CC]/60 text-[#071E27] shrink-0">
                                sub: {inv.patientSubject.slice(0, 10)}...
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="py-8 text-center rounded-xl bg-[#F3FAFF] border border-dashed border-[#C4C6CC] text-[#44474C] space-y-1">
                      <p className="font-bold text-[#071524]">
                        No hay invitaciones registradas
                      </p>
                      <p className="text-[11px]">
                        Envía una nueva invitación desde la pestaña anterior o ajusta el filtro.
                      </p>
                    </div>
                  )}

                  {/* Pagination */}
                  {invitationsPage && invitationsPage.totalPages > 1 && (
                    <div className="flex items-center justify-between pt-2 text-[11px] text-[#44474C]">
                      <span>
                        Página {invitationsPage.page + 1} de {invitationsPage.totalPages} (
                        {invitationsPage.totalElements} registros)
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={page <= 0 || loadingList}
                          onClick={() => setPage((p) => Math.max(0, p - 1))}
                          className="p-1.5 rounded-lg border border-[#C4C6CC] hover:bg-[#F3FAFF] disabled:opacity-40 cursor-pointer"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={page + 1 >= invitationsPage.totalPages || loadingList}
                          onClick={() => setPage((p) => p + 1)}
                          className="p-1.5 rounded-lg border border-[#C4C6CC] hover:bg-[#F3FAFF] disabled:opacity-40 cursor-pointer"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* MOCK MODE: Preserved Original Patient Registration Form */
          <form onSubmit={handleMockSubmit} className="p-6 overflow-y-auto space-y-4 text-xs">
            {mockError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-900 flex items-center gap-2 text-[11px] font-medium">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{mockError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-bold text-[#071524] mb-1">
                  Nombre Completo del Paciente *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej. Jorge Ramírez Castillo"
                  className="w-full px-3 py-2 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/60 text-sm text-[#071524] focus:ring-2 focus:ring-[#006A62] outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-[#071524] mb-1">
                  Documento Nacional de Identidad (DNI) *
                </label>
                <input
                  type="text"
                  required
                  value={nationalId}
                  onChange={(e) => setNationalId(e.target.value)}
                  placeholder="Ej. 42891024"
                  className="w-full px-3 py-2 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/60 text-sm text-[#071524] focus:ring-2 focus:ring-[#006A62] outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-[#071524] mb-1">
                  N° Historia Clínica (HC)
                </label>
                <input
                  type="text"
                  value={medicalRecordNumber}
                  onChange={(e) => setMedicalRecordNumber(e.target.value)}
                  placeholder="Ej. 850124 (opcional)"
                  className="w-full px-3 py-2 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/60 text-sm text-[#071524] focus:ring-2 focus:ring-[#006A62] outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-[#071524] mb-1">
                  Teléfono de Contacto (SMS Activación)
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+51 987 654 321"
                  className="w-full px-3 py-2 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/60 text-sm text-[#071524] focus:ring-2 focus:ring-[#006A62] outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-[#071524] mb-1">Edad</label>
                <input
                  type="number"
                  min={18}
                  max={100}
                  value={age}
                  onChange={(e) => setAge(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/60 text-sm text-[#071524] focus:ring-2 focus:ring-[#006A62] outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-[#071524] mb-1">Sexo</label>
                <select
                  value={gender}
                  onChange={(e) =>
                    setGender(e.target.value as 'Masculino' | 'Femenino' | 'Otro')
                  }
                  className="w-full px-3 py-2 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/60 text-sm text-[#071524] focus:ring-2 focus:ring-[#006A62] outline-none"
                >
                  <option value="Masculino">Masculino</option>
                  <option value="Femenino">Femenino</option>
                  <option value="Otro">Otro</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-[#071524] mb-1">
                  Hemicampo Visual Afectado *
                </label>
                <select
                  value={affectedHemifield}
                  onChange={(e) => setAffectedHemifield(e.target.value as AffectedHemifield)}
                  className="w-full px-3 py-2 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/60 text-sm text-[#071524] focus:ring-2 focus:ring-[#006A62] outline-none"
                >
                  <option value="LEFT">Izquierdo [Izq]</option>
                  <option value="RIGHT">Derecho [Der]</option>
                  <option value="BILATERAL">Bilateral</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-[#071524] mb-1">
                  Detalle Diagnóstico / Campimetría
                </label>
                <input
                  type="text"
                  value={hemifieldDetail}
                  onChange={(e) => setHemifieldDetail(e.target.value)}
                  placeholder="Ej. Hemianopsia Homónima Completa"
                  className="w-full px-3 py-2 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/60 text-sm text-[#071524] focus:ring-2 focus:ring-[#006A62] outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block font-bold text-[#071524] mb-1">Sede Asistencial</label>
              <select
                value={facility}
                onChange={(e) => setFacility(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/60 text-sm text-[#071524] focus:ring-2 focus:ring-[#006A62] outline-none"
              >
                <option value="Sede Rebagliati">Hospital Edgardo Rebagliati Martins</option>
                <option value="Sede Almenara">Hospital Guillermo Almenara Irigoyen</option>
                <option value="Telemedicina Domiciliaria">Telemedicina Domiciliaria</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-[#071524] mb-1">
                Notas Clínicas Iniciales / Antecedentes
              </label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Detalles sobre ACV, tiempo de evolución, déficit motor o cognitivo concomitante..."
                className="w-full px-3 py-2 rounded-lg bg-[#F3FAFF] border border-[#C4C6CC]/60 text-sm text-[#071524] focus:ring-2 focus:ring-[#006A62] outline-none"
              />
            </div>

            {/* Compliance notice */}
            <div className="flex items-center gap-2 p-3 rounded-lg bg-[#DBF1FE] text-[#006A62] text-[11px] font-medium">
              <Shield className="w-4 h-4 shrink-0" />
              <span>
                El paciente recibirá un SMS seguro con su enlace de activación conforme a la ley de
                protección de datos médicos.
              </span>
            </div>

            {/* Modal Footer */}
            <div className="pt-4 border-t border-[#071524]/10 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg border border-[#C4C6CC] text-[#44474C] font-semibold hover:bg-[#F3FAFF] transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-lg bg-[#1C2A39] hover:bg-[#071524] text-white font-bold transition-colors shadow-xs cursor-pointer"
              >
                Guardar y Activar Paciente
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
