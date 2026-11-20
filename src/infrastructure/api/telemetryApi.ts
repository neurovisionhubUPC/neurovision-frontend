import { apiRequest } from './httpClient.ts';
import type {
  TelemetryBatchAcceptedResponse,
  TelemetryBatchBody,
  TelemetrySamplesPageResponse,
  TelemetrySamplesQueryParams,
} from './contracts';

export const telemetryApi = {
  sendTelemetryBatch(body: TelemetryBatchBody): Promise<TelemetryBatchAcceptedResponse> {
    return apiRequest<TelemetryBatchAcceptedResponse>('telemetry', '/api/v1/telemetry/batches', {
      method: 'POST',
      body,
    });
  },

  getHistoricalSamples(
    therapySessionId: string,
    query: TelemetrySamplesQueryParams
  ): Promise<TelemetrySamplesPageResponse> {
    return apiRequest<TelemetrySamplesPageResponse>(
      'telemetry',
      `/api/v1/telemetry/sessions/${encodeURIComponent(therapySessionId)}/samples`,
      {
        method: 'GET',
        query: {
          streamId: query.streamId,
          from: query.from,
          to: query.to,
          limit: query.limit,
          cursor: query.cursor,
        },
      }
    );
  },
};
