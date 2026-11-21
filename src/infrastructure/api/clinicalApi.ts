import { apiRequest, apiRequestBlob } from './httpClient.ts';
import type {
  AppendTherapeuticConfigurationBody,
  AssignedPatientDetailResponse,
  AssignedPatientsQueryParams,
  AssignedPatientsResponse,
  CreateTherapyPlanBody,
  DoctorReportSelectionQuery,
  DoctorReportSnapshotResponse,
  DoctorReportSnapshotsQuery,
  DoctorReportSnapshotsResponse,
  DoctorSessionReport,
  DoctorTherapySessionDetailResponse,
  DoctorTherapySessionsQueryParams,
  DoctorTherapySessionsResponse,
  PatientActivityEventBody,
  PatientCurrentSessionResponse,
  PatientSessionCompletionBody,
  PatientSessionProgressResponse,
  PatientTherapyPlanResponse,
  PatientTherapySessionDetailResponse,
  PatientTherapySessionResponse,
  RehabilitationContextPatchBody,
  RehabilitationContextResponse,
  ReviseTherapyPlanBody,
  StartPatientTherapySessionBody,
  TherapeuticConfigurationResponse,
  TherapyPlanDetailResponse,
  TherapyPlanResponse,
  TherapyPlanRevisionResponse,
  TherapyPlansQueryParams,
  TherapyPlansResponse,
} from './contracts';

export const clinicalApi = {
  // === Doctor: Assigned Patients & Rehabilitation Context ===
  listAssignedPatients(query?: AssignedPatientsQueryParams): Promise<AssignedPatientsResponse> {
    return apiRequest<AssignedPatientsResponse>('clinical', '/api/v1/clinical-patients', {
      method: 'GET',
      query: query ? { page: query.page, size: query.size } : undefined,
    });
  },

  getAssignedPatientDetail(clinicalPatientId: string): Promise<AssignedPatientDetailResponse> {
    return apiRequest<AssignedPatientDetailResponse>(
      'clinical',
      `/api/v1/clinical-patients/${encodeURIComponent(clinicalPatientId)}`,
      { method: 'GET' }
    );
  },

  getRehabilitationContext(clinicalPatientId: string): Promise<RehabilitationContextResponse> {
    return apiRequest<RehabilitationContextResponse>(
      'clinical',
      `/api/v1/clinical-patients/${encodeURIComponent(clinicalPatientId)}/rehabilitation-context`,
      { method: 'GET' }
    );
  },

  patchRehabilitationContext(
    clinicalPatientId: string,
    body: RehabilitationContextPatchBody
  ): Promise<RehabilitationContextResponse> {
    return apiRequest<RehabilitationContextResponse>(
      'clinical',
      `/api/v1/clinical-patients/${encodeURIComponent(clinicalPatientId)}/rehabilitation-context`,
      { method: 'PATCH', body }
    );
  },

  // === Doctor: Therapy Plans, Configurations & Revisions ===
  createTherapyPlan(
    clinicalPatientId: string,
    body: CreateTherapyPlanBody
  ): Promise<TherapyPlanResponse> {
    return apiRequest<TherapyPlanResponse>(
      'clinical',
      `/api/v1/clinical-patients/${encodeURIComponent(clinicalPatientId)}/therapy-plans`,
      { method: 'POST', body }
    );
  },

  listTherapyPlans(
    clinicalPatientId: string,
    query?: TherapyPlansQueryParams
  ): Promise<TherapyPlansResponse> {
    return apiRequest<TherapyPlansResponse>(
      'clinical',
      `/api/v1/clinical-patients/${encodeURIComponent(clinicalPatientId)}/therapy-plans`,
      {
        method: 'GET',
        query: query
          ? { page: query.page, size: query.size, status: query.status }
          : undefined,
      }
    );
  },

  getTherapyPlanDetail(
    clinicalPatientId: string,
    therapyPlanId: string
  ): Promise<TherapyPlanDetailResponse> {
    return apiRequest<TherapyPlanDetailResponse>(
      'clinical',
      `/api/v1/clinical-patients/${encodeURIComponent(clinicalPatientId)}/therapy-plans/${encodeURIComponent(therapyPlanId)}`,
      { method: 'GET' }
    );
  },

  appendConfiguration(
    clinicalPatientId: string,
    therapyPlanId: string,
    body: AppendTherapeuticConfigurationBody
  ): Promise<TherapeuticConfigurationResponse> {
    return apiRequest<TherapeuticConfigurationResponse>(
      'clinical',
      `/api/v1/clinical-patients/${encodeURIComponent(clinicalPatientId)}/therapy-plans/${encodeURIComponent(therapyPlanId)}/configurations`,
      { method: 'POST', body }
    );
  },

  reviseTherapyPlan(
    clinicalPatientId: string,
    therapyPlanId: string,
    body: ReviseTherapyPlanBody
  ): Promise<TherapyPlanRevisionResponse> {
    return apiRequest<TherapyPlanRevisionResponse>(
      'clinical',
      `/api/v1/clinical-patients/${encodeURIComponent(clinicalPatientId)}/therapy-plans/${encodeURIComponent(therapyPlanId)}/revisions`,
      { method: 'POST', body }
    );
  },

  // === Doctor: Session History ===
  listDoctorTherapySessions(
    clinicalPatientId: string,
    query?: DoctorTherapySessionsQueryParams
  ): Promise<DoctorTherapySessionsResponse> {
    return apiRequest<DoctorTherapySessionsResponse>(
      'clinical',
      `/api/v1/clinical-patients/${encodeURIComponent(clinicalPatientId)}/therapy-sessions`,
      {
        method: 'GET',
        query: query
          ? {
              page: query.page,
              size: query.size,
              exerciseCode: query.exerciseCode,
              status: query.status,
              from: query.from,
              to: query.to,
            }
          : undefined,
      }
    );
  },

  getDoctorTherapySessionDetail(
    clinicalPatientId: string,
    therapySessionId: string
  ): Promise<DoctorTherapySessionDetailResponse> {
    return apiRequest<DoctorTherapySessionDetailResponse>(
      'clinical',
      `/api/v1/clinical-patients/${encodeURIComponent(clinicalPatientId)}/therapy-sessions/${encodeURIComponent(therapySessionId)}`,
      { method: 'GET' }
    );
  },

  // === Doctor: Session Reports & PDF Snapshots ===
  previewSessionReport(
    clinicalPatientId: string,
    therapySessionId: string,
    selector?: DoctorReportSelectionQuery
  ): Promise<DoctorSessionReport> {
    return apiRequest<DoctorSessionReport>(
      'clinical',
      `/api/v1/clinical-patients/${encodeURIComponent(clinicalPatientId)}/therapy-sessions/${encodeURIComponent(therapySessionId)}/report-preview`,
      {
        method: 'GET',
        query: selector as Record<string, string | undefined> | undefined,
      }
    );
  },

  createReportSnapshot(
    clinicalPatientId: string,
    therapySessionId: string,
    idempotencyKey: string,
    selector?: DoctorReportSelectionQuery
  ): Promise<DoctorReportSnapshotResponse> {
    // CRITICAL per backend contract: NO JSON body and NO Content-Type header!
    return apiRequest<DoctorReportSnapshotResponse>(
      'clinical',
      `/api/v1/clinical-patients/${encodeURIComponent(clinicalPatientId)}/therapy-sessions/${encodeURIComponent(therapySessionId)}/report-snapshots`,
      {
        method: 'POST',
        idempotencyKey,
        query: selector as Record<string, string | undefined> | undefined,
      }
    );
  },

  listReportSnapshots(
    clinicalPatientId: string,
    therapySessionId: string,
    query?: DoctorReportSnapshotsQuery
  ): Promise<DoctorReportSnapshotsResponse> {
    return apiRequest<DoctorReportSnapshotsResponse>(
      'clinical',
      `/api/v1/clinical-patients/${encodeURIComponent(clinicalPatientId)}/therapy-sessions/${encodeURIComponent(therapySessionId)}/report-snapshots`,
      {
        method: 'GET',
        query: query ? { page: query.page, size: query.size } : undefined,
      }
    );
  },

  getReportSnapshotDetail(
    clinicalPatientId: string,
    therapySessionId: string,
    reportSnapshotId: string
  ): Promise<DoctorReportSnapshotResponse> {
    return apiRequest<DoctorReportSnapshotResponse>(
      'clinical',
      `/api/v1/clinical-patients/${encodeURIComponent(clinicalPatientId)}/therapy-sessions/${encodeURIComponent(therapySessionId)}/report-snapshots/${encodeURIComponent(reportSnapshotId)}`,
      { method: 'GET' }
    );
  },

  async downloadReportSnapshotPdf(
    clinicalPatientId: string,
    therapySessionId: string,
    reportSnapshotId: string
  ): Promise<{ blob: Blob; filename: string }> {
    const { blob, filename } = await apiRequestBlob(
      'clinical',
      `/api/v1/clinical-patients/${encodeURIComponent(clinicalPatientId)}/therapy-sessions/${encodeURIComponent(therapySessionId)}/report-snapshots/${encodeURIComponent(reportSnapshotId)}/pdf`,
      { method: 'GET' }
    );
    return {
      blob,
      filename: filename || `session-report-${reportSnapshotId}.pdf`,
    };
  },

  // === Patient: Plans & Session Execution ===
  listMyTherapyPlans(): Promise<PatientTherapyPlanResponse[]> {
    return apiRequest<PatientTherapyPlanResponse[]>('clinical', '/api/v1/me/therapy-plans', {
      method: 'GET',
    });
  },

  startTherapySession(
    therapyPlanId: string,
    body: StartPatientTherapySessionBody,
    idempotencyKey: string
  ): Promise<PatientTherapySessionResponse> {
    return apiRequest<PatientTherapySessionResponse>(
      'clinical',
      `/api/v1/me/therapy-plans/${encodeURIComponent(therapyPlanId)}/sessions`,
      {
        method: 'POST',
        body,
        idempotencyKey,
      }
    );
  },

  getCurrentSession(): Promise<PatientCurrentSessionResponse> {
    return apiRequest<PatientCurrentSessionResponse>('clinical', '/api/v1/me/therapy-sessions/current', {
      method: 'GET',
    });
  },

  getPatientSessionDetail(therapySessionId: string): Promise<PatientTherapySessionDetailResponse> {
    return apiRequest<PatientTherapySessionDetailResponse>(
      'clinical',
      `/api/v1/me/therapy-sessions/${encodeURIComponent(therapySessionId)}`,
      { method: 'GET' }
    );
  },

  sendActivityEvent(
    therapySessionId: string,
    body: PatientActivityEventBody,
    options?: { signal?: AbortSignal }
  ): Promise<PatientSessionProgressResponse> {
    return apiRequest<PatientSessionProgressResponse>(
      'clinical',
      `/api/v1/me/therapy-sessions/${encodeURIComponent(therapySessionId)}/activity-events`,
      {
        method: 'POST',
        body,
        signal: options?.signal,
      }
    );
  },

  getSessionProgress(
    therapySessionId: string,
    options?: { signal?: AbortSignal }
  ): Promise<PatientSessionProgressResponse> {
    return apiRequest<PatientSessionProgressResponse>(
      'clinical',
      `/api/v1/me/therapy-sessions/${encodeURIComponent(therapySessionId)}/progress`,
      { method: 'GET', signal: options?.signal }
    );
  },

  completeSession(
    therapySessionId: string,
    body: PatientSessionCompletionBody,
    idempotencyKey: string,
    options?: { signal?: AbortSignal }
  ): Promise<PatientSessionProgressResponse> {
    return apiRequest<PatientSessionProgressResponse>(
      'clinical',
      `/api/v1/me/therapy-sessions/${encodeURIComponent(therapySessionId)}/completion`,
      {
        method: 'PUT',
        body,
        idempotencyKey,
        signal: options?.signal,
      }
    );
  },
};
