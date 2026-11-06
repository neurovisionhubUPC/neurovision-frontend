export type AffectedHemifield = 'LEFT' | 'RIGHT' | 'BILATERAL';

export type AccountStatus = 'ACTIVE' | 'PENDING' | 'SUSPENDED';

export type RiskSeverity = 'OPTIMAL' | 'NORMAL' | 'PENDING' | 'WARNING' | 'CRITICAL';

export interface PatientSessionInfo {
  timestampText: string;
  durationMinutes: number;
  moduleName: string;
  interrupted?: boolean;
}

export interface TherapeuticAdherence {
  rate: number; // 0 - 100
  category: 'Excelente' | 'Regular' | 'Moderada' | 'Deficiente';
}

export interface RiskAlert {
  severity: RiskSeverity;
  label: string;
}

export interface DoctorInfo {
  name: string;
  specialty: string;
  idNumber: string;
  hospital: string;
}

export interface PatientStats {
  globalAdherence: number;
  completedSessions: number;
  scheduledSessions: number;
  meanFatigue: number;
  totalTherapyHours: number;
  validatedSessions: number;
  totalRecordedSessions: number;
  complianceAverage?: number;
}

export interface SessionRecord {
  id: string;
  dateText: string;
  timeText: string;
  period: 'Mañana' | 'Tarde' | 'Noche';
  moduleName: string;
  moduleDetail: string;
  durationMinutes: number;
  targetDurationMinutes?: number;
  complianceRate: number; // 0 - 100
  fovealPrecision: number; // 0 - 100
  microsaccadesPerSec?: number;
  latencyMs?: number;
  isValid: boolean;
  validationStatus: 'VALID_OPTIMAL' | 'INTERRUPTED_FATIGUE' | 'CALIBRATION_ISSUE';
  validationLabel: string;
  interrupted?: boolean;
  notes?: string;
}

export interface PatientAntecedents {
  strokeDate: string;
  strokeType: string;
  affectedArtery: string;
  motorDeficit: string;
  cognitiveDeficit: string;
  hypertension: boolean;
  diabetes: boolean;
  currentMedications: string[];
}

export interface PrescribedExercise {
  id: string;
  name: string;
  category: string;
  level: number;
  targetSpeed: number;
  visualFieldAmplitude: number;
  minFixationTimeMs: number;
  dailyTargetMinutes: number;
}

export interface ActiveTherapeuticPlan {
  prescribedDate: string;
  exercises: PrescribedExercise[];
}

export interface CampimetryProfile {
  leftEyeDefect: 'HOMONYMOUS_LEFT' | 'HOMONYMOUS_RIGHT' | 'SUPERIOR_QUADRANT' | 'INFERIOR_QUADRANT';
  rightEyeDefect: 'HOMONYMOUS_LEFT' | 'HOMONYMOUS_RIGHT' | 'SUPERIOR_QUADRANT' | 'INFERIOR_QUADRANT';
  fixationStabilityBCEA: number;
  saccadicGain: number;
  fovealSearchLatencyMs: number;
}

export interface Patient {
  id: string;
  initials: string;
  name: string;
  medicalRecordNumber: string; // HC
  nationalId: string; // DNI
  age: number;
  gender: 'Masculino' | 'Femenino' | 'Otro';
  affectedHemifield: AffectedHemifield;
  hemifieldDetail: string; // ej: "Homónima Completa", "Cuadrantanopsia Sup"
  accountStatus: AccountStatus;
  statusDetail?: string; // ej: "Código SMS Enviado", "Verificación biométrica"
  lastSession: PatientSessionInfo;
  adherence: TherapeuticAdherence;
  riskAlert: RiskAlert;
  facility: string; // Sede
  shift: string; // Turno
  phone?: string;
  email?: string;
  clinicalNotes?: string;

  // Campos extendidos para el Expediente Clínico e Historial
  enrollmentDate?: string;
  treatingDoctor?: DoctorInfo;
  primaryDiagnosisTitle?: string;
  primaryDiagnosisDetail?: string;
  stats?: PatientStats;
  antecedents?: PatientAntecedents;
  activePlan?: ActiveTherapeuticPlan;
  campimetryData?: CampimetryProfile;
  sessionHistory?: SessionRecord[];
}
