export interface IamAuthHeaders {
  Authorization: `Bearer ${string}`;
}

export type InvitationStatus = 'PENDING' | 'INVITED' | 'ACTIVATED' | 'FAILED';

export interface InviteDoctorBody {
  doctorEmail: string;
}

export interface InvitePatientBody {
  patientEmail: string;
}

export interface ListPatientInvitationsQuery {
  page?: number;
  size?: number;
  status?: InvitationStatus;
}

interface InvitationResponseBase {
  invitationId: string;
  status: InvitationStatus;
  createdAt: string;
  updatedAt: string;
  activatedAt: string | null;
}

export interface DoctorInvitationResponse extends InvitationResponseBase {
  doctorEmail: string;
  doctorSubject: string | null;
}

export interface PatientInvitationResponse extends InvitationResponseBase {
  patientEmail: string;
  patientSubject: string | null;
}

export interface PatientInvitationPageResponse {
  items: PatientInvitationResponse[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export interface IamApiErrorResponse {
  code: string;
  message: string;
}
