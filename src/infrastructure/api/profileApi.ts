import { apiRequest } from './httpClient';
import type {
  CompleteProfileBody,
  OnboardDoctorBody,
  ProfileResponse,
} from './contracts';

export const profileApi = {
  getMyProfile(): Promise<ProfileResponse> {
    return apiRequest<ProfileResponse>('profile', '/api/v1/profile', {
      method: 'GET',
    });
  },

  completePatientProfile(body: CompleteProfileBody): Promise<ProfileResponse> {
    return apiRequest<ProfileResponse>('profile', '/api/v1/profile', {
      method: 'PUT',
      body,
    });
  },

  onboardDoctorProfile(body: OnboardDoctorBody): Promise<ProfileResponse> {
    return apiRequest<ProfileResponse>('profile', '/api/v1/profile/professional', {
      method: 'PUT',
      body,
    });
  },
};
