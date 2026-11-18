import type {
  FixationParameters,
  PatientSessionLimits,
  ReportMode,
  TherapyCompletionTarget,
  TherapyExerciseCode,
  VisualScanningParameters,
  VisualSearchParameters,
} from '../../infrastructure/api/contracts/clinical.contracts';

export type FrozenClinicalExerciseParameters =
  | VisualScanningParameters
  | VisualSearchParameters
  | FixationParameters;

export interface MedicalPrescription {
  prescriptionId: string;
  patientId: string;
  gameId: string;

  /**
   * Configuraciones terapéuticas dinámicas dictadas por el especialista.
   * Estos parámetros alteran directamente la dificultad y la mecánica del Canvas.
   */
  parameters: {
    /**
     * Velocidad o dinámica del estímulo.
     * Para este minijuego, puede dictar qué tan rápido decrece la puntuación
     * o si el objetivo se mueve por la pantalla.
     */
    target_speed: number;

    /**
     * Amplitud del campo visual (0.0 a 1.0).
     * Ej: 0.5 restringirá el juego al 50% central de la pantalla.
     * Espectacularmente útil para pacientes con restricciones periféricas (ej. hemianopsia).
     */
    visual_field_amplitude: number;

    /**
     * Tiempo mínimo de fijación en milisegundos.
     * Sustituye al REQUIRED_DWELL_TIME rígido. A menor tiempo, menor exigencia oculomotora.
     */
    min_fixation_time: number;
  };

  /** Metadatos y configuración congelada del microservicio Clinical (cuando hay sesión backend real) */
  clinicalContext?: {
    therapyPlanId: string;
    therapySessionId?: string;
    exerciseCode: TherapyExerciseCode;
    mode: ReportMode;
    configurationId?: string;
    configurationVersion?: number;
    parameterSchemaVersion?: 1 | 2;
    frozenParameters?: FrozenClinicalExerciseParameters;
    completionTarget?: TherapyCompletionTarget;
    sessionLimits?: PatientSessionLimits;
  };
}
