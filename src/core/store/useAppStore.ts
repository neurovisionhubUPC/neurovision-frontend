import { create } from 'zustand';

interface AppState {
  hasCompletedOnboarding: boolean;
  setHasCompletedOnboarding: (status: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  hasCompletedOnboarding: false,
  setHasCompletedOnboarding: (status) => set({ hasCompletedOnboarding: status }),
}));
