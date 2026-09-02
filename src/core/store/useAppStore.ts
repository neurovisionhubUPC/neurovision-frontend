import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MedicalPrescription } from '../domain/Prescription';

export type GamePhase = 'IDLE' | 'TUTORIAL_CALIBRATION' | 'CALIBRATION' | 'MAIN_GAME' | 'FINISHED';

interface AppState {
  isAuthenticated: boolean;
  hasCompletedOnboarding: boolean;
  currentPrescription: MedicalPrescription | null;
  gamePhase: GamePhase;
  
  login: () => void;
  logout: () => void;
  completeOnboarding: () => void;
  setHasCompletedOnboarding: (status: boolean) => void;
  setPrescription: (prescription: MedicalPrescription) => void;
  setGamePhase: (phase: GamePhase) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      isAuthenticated: false,
      hasCompletedOnboarding: false,
      currentPrescription: null,
      gamePhase: 'IDLE',
      
      login: () => set({ isAuthenticated: true }),
      logout: () => set({ isAuthenticated: false, gamePhase: 'IDLE' }),
      completeOnboarding: () => set({ hasCompletedOnboarding: true }),
      setHasCompletedOnboarding: (status) => set({ hasCompletedOnboarding: status }),
      setPrescription: (prescription) => set({ currentPrescription: prescription }),
      setGamePhase: (phase) => set({ gamePhase: phase })
    }),
    {
      name: 'app-storage',
    }
  )
);
