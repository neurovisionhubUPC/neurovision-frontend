import { create } from 'zustand';
import type { MedicalPrescription } from '../domain/Prescription';

export type GamePhase = 'IDLE' | 'TUTORIAL_CALIBRATION' | 'CALIBRATION' | 'MAIN_GAME' | 'FINISHED';

interface AppState {
  hasCompletedOnboarding: boolean;
  setHasCompletedOnboarding: (status: boolean) => void;

  // Estado Clínico y Máquina de Estados del Juego
  currentPrescription: MedicalPrescription | null;
  setPrescription: (prescription: MedicalPrescription) => void;
  
  gamePhase: GamePhase;
  setGamePhase: (phase: GamePhase) => void;
}

export const useAppStore = create<AppState>((set) => ({
  hasCompletedOnboarding: false,
  setHasCompletedOnboarding: (status) => set({ hasCompletedOnboarding: status }),

  currentPrescription: null,
  setPrescription: (prescription) => set({ currentPrescription: prescription }),
  
  gamePhase: 'IDLE',
  setGamePhase: (phase) => set({ gamePhase: phase }),
}));
