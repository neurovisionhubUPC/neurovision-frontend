import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MedicalPrescription } from '../domain/Prescription';

export type GamePhase = 'IDLE' | 'TUTORIAL_CALIBRATION' | 'CALIBRATION' | 'MAIN_GAME' | 'FINISHED';
export type UserRole = 'PATIENT' | 'SPECIALIST' | null;

interface AppState {
  isAuthenticated: boolean;
  userRole: UserRole;
  hasCompletedOnboarding: boolean;
  currentPrescription: MedicalPrescription | null;
  gamePhase: GamePhase;
  
  login: (role: UserRole) => void;
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
      userRole: null,
      hasCompletedOnboarding: false,
      currentPrescription: null,
      gamePhase: 'IDLE',
      
      login: (role) => set({ isAuthenticated: true, userRole: role }),
      logout: () => set({ isAuthenticated: false, userRole: null, gamePhase: 'IDLE' }),
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
