import { apiRequest } from './httpClient';
import type {
  DoctorInvitationResponse,
  InviteDoctorBody,
  InvitePatientBody,
  ListPatientInvitationsQuery,
  PatientInvitationPageResponse,
  PatientInvitationResponse,
} from './contracts';

export const iamApi = {
  inviteDoctor(body: InviteDoctorBody): Promise<DoctorInvitationResponse> {
    return apiRequest<DoctorInvitationResponse>('iam', '/api/v1/doctor-invitations', {
      method: 'POST',
      body,
    });
  },

  activateMyDoctorAccount(): Promise<DoctorInvitationResponse> {
    return apiRequest<DoctorInvitationResponse>('iam', '/api/v1/doctor-invitations/me/activation', {
      method: 'PUT',
    });
  },

  listPatientInvitations(query?: ListPatientInvitationsQuery): Promise<PatientInvitationPageResponse> {
    return apiRequest<PatientInvitationPageResponse>('iam', '/api/v1/patient-invitations', {
      method: 'GET',
      query: query
        ? {
            page: query.page,
            size: query.size,
            status: query.status,
          }
        : undefined,
    });
  },

  invitePatient(body: InvitePatientBody): Promise<PatientInvitationResponse> {
    return apiRequest<PatientInvitationResponse>('iam', '/api/v1/patient-invitations', {
      method: 'POST',
      body,
    });
  },

  activateMyPatientAccount(): Promise<PatientInvitationResponse> {
    return apiRequest<PatientInvitationResponse>('iam', '/api/v1/patient-invitations/me/activation', {
      method: 'PUT',
    });
  },
};
