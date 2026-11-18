export interface ProfileAuthHeaders {
  Authorization: `Bearer ${string}`;
}

export type ProfileType = 'PATIENT' | 'DOCTOR';
export type ProfileStatus = 'PENDING_COMPLETION' | 'ACTIVE';

export interface CompleteProfileBody {
  firstName: string;
  lastName: string;
  documentNumber?: string | null;
  birthDate?: string | null;
  phone?: string | null;
}

export interface OnboardDoctorBody extends CompleteProfileBody {
  specialty?: string | null;
  /** Six ASCII digits after trimming, excluding 000000. Preserve leading zeros. */
  medicalLicense?: string | null;
}

export interface ProfileResponse {
  id: string;
  profileType: ProfileType;
  status: ProfileStatus;
  firstName: string | null;
  lastName: string | null;
  documentNumber: string | null;
  birthDate: string | null;
  phone: string | null;
  specialty: string | null;
  medicalLicense: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileApiErrorResponse {
  code: string;
  message: string;
}
