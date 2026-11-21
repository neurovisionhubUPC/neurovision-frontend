import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MedicalPrescription } from '../domain/Prescription';
import type { Patient } from '../domain/Patient';
import { INITIAL_MOCK_PATIENTS } from '../domain/mockPatients';
import type { ProfileResponse } from '../../infrastructure/api/contracts/profile.contracts';
import type { PatientTherapySessionResponse } from '../../infrastructure/api/contracts/clinical.contracts';
import {
  registerAccessTokenGetter,
  registerAccessTokenRefresher,
  type BackendServiceName,
} from '../../infrastructure/api/httpClient';
import {
  isTokenExpiringSoon,
  refreshCognitoAccessToken,
} from '../../infrastructure/api/cognitoAuth';

export type GamePhase = 'IDLE' | 'TUTORIAL_CALIBRATION' | 'CALIBRATION' | 'MAIN_GAME' | 'FINISHED';
export type UserRole = 'PATIENT' | 'SPECIALIST' | null;
export type AuthMode = 'COGNITO' | 'MOCK';

export type BackendHealthMap = Record<BackendServiceName, boolean>;

const DEFAULT_HEALTH_MAP: BackendHealthMap = {
  iam: false,
  profile: false,
  clinical: false,
  telemetry: false,
  analytics: false,
};

interface LoginOptions {
  accessToken?: string | null;
  refreshToken?: string | null;
  authMode?: AuthMode;
  profile?: ProfileResponse | null;
}

interface AppState {
  isAuthenticated: boolean;
  userRole: UserRole;
  accessToken: string | null;
  refreshToken: string | null;
  authMode: AuthMode;
  userProfile: ProfileResponse | null;
  backendHealth: BackendHealthMap;
  activeClinicalSession: PatientTherapySessionResponse | null;
  hasCompletedOnboarding: boolean;
  currentPrescription: MedicalPrescription | null;
  gamePhase: GamePhase;
  patients: Patient[];

  login: (role: UserRole, options?: LoginOptions) => void;
  logout: () => void;
  setAccessToken: (token: string | null) => void;
  setRefreshToken: (token: string | null) => void;
  setAuthMode: (mode: AuthMode) => void;
  setUserProfile: (profile: ProfileResponse | null) => void;
  setBackendHealth: (health: BackendHealthMap) => void;
  setActiveClinicalSession: (session: PatientTherapySessionResponse | null) => void;
  completeOnboarding: () => void;
  setHasCompletedOnboarding: (status: boolean) => void;
  setPrescription: (prescription: MedicalPrescription) => void;
  setGamePhase: (phase: GamePhase) => void;
  setPatients: (patients: Patient[]) => void;
  addPatient: (patient: Patient) => void;
  updatePatient: (patient: Patient) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      isAuthenticated: false,
      userRole: null,
      accessToken: null,
      refreshToken: null,
      authMode: 'MOCK',
      userProfile: null,
      backendHealth: DEFAULT_HEALTH_MAP,
      activeClinicalSession: null,
      hasCompletedOnboarding: false,
      currentPrescription: null,
      gamePhase: 'IDLE',
      patients: INITIAL_MOCK_PATIENTS,

      login: (role, options) =>
        set((state) => ({
          isAuthenticated: Boolean(role),
          userRole: role,
          accessToken: options?.accessToken ?? null,
          refreshToken:
            options?.refreshToken !== undefined ? options.refreshToken : state.refreshToken,
          authMode: options?.authMode ?? (options?.accessToken ? 'COGNITO' : 'MOCK'),
          userProfile: options?.profile ?? null,
          activeClinicalSession: null,
        })),
      logout: () =>
        set({
          isAuthenticated: false,
          userRole: null,
          accessToken: null,
          refreshToken: null,
          authMode: 'MOCK',
          userProfile: null,
          activeClinicalSession: null,
          gamePhase: 'IDLE',
        }),
      setAccessToken: (token) => set({ accessToken: token }),
      setRefreshToken: (token) => set({ refreshToken: token }),
      setAuthMode: (mode) => set({ authMode: mode }),
      setUserProfile: (profile) => set({ userProfile: profile }),
      setBackendHealth: (health) => set({ backendHealth: health }),
      setActiveClinicalSession: (session) => set({ activeClinicalSession: session }),
      completeOnboarding: () => set({ hasCompletedOnboarding: true }),
      setHasCompletedOnboarding: (status) => set({ hasCompletedOnboarding: status }),
      setPrescription: (prescription) => set({ currentPrescription: prescription }),
      setGamePhase: (phase) => set({ gamePhase: phase }),
      setPatients: (patients) => set({ patients }),
      addPatient: (patient) => set((state) => ({ patients: [patient, ...state.patients] })),
      updatePatient: (updated) =>
        set((state) => ({
          patients: state.patients.map((p) => (p.id === updated.id ? updated : p)),
        })),
    }),
    {
      name: 'app-storage',
    }
  )
);

// Wire global HTTP client token getter so all API services send the Cognito access token automatically
registerAccessTokenGetter(() => useAppStore.getState().accessToken);

// Single-flight token refresh so concurrent requests share one REFRESH_TOKEN_AUTH call
let activeRefreshPromise: Promise<string | null> | null = null;

registerAccessTokenRefresher(
  async () => {
    if (activeRefreshPromise) {
      return activeRefreshPromise;
    }

    const { authMode, refreshToken } = useAppStore.getState();
    if (authMode !== 'COGNITO' || !refreshToken) {
      return null;
    }

    activeRefreshPromise = (async () => {
      try {
        const refreshed = await refreshCognitoAccessToken(refreshToken);
        useAppStore.getState().setAccessToken(refreshed.accessToken);
        if (refreshed.refreshToken) {
          useAppStore.getState().setRefreshToken(refreshed.refreshToken);
        }
        return refreshed.accessToken;
      } catch {
        return null;
      } finally {
        activeRefreshPromise = null;
      }
    })();

    return activeRefreshPromise;
  },
  (token) => {
    const { authMode, refreshToken } = useAppStore.getState();
    if (authMode !== 'COGNITO' || !refreshToken) return false;
    return isTokenExpiringSoon(token, 60);
  }
);
