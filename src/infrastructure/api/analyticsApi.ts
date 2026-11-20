import { apiRequest } from './httpClient.ts';
import type {
  AnalyticsDataOrigin,
  AnalyticsExerciseSlug,
  AnalyticsGazePlotQuery,
  AnalyticsGazePlotResponse,
  AnalyticsHeatmapResponse,
  AnalyticsReplayQuery,
  AnalyticsReplayResponse,
  AnalyticsStreamsQuery,
  AnalyticsStreamsResponse,
  AnalyticsSummaryResponse,
  AnalyticsTrialReceipt,
  CompensatorySaccadeTrialBody,
  CompensatorySaccadeTrialSummary,
  ReportMode,
  ReportSelector,
  StandardScanningTrialBody,
  StandardScanningTrialSummary,
  SustainedFixationTrialBody,
  SustainedFixationTrialSummary,
  SystematicExplorationTrialBody,
  SystematicExplorationTrialSummary,
  VisualSearchTrialBody,
  VisualSearchTrialSummary,
} from './contracts';

export type AnyTrialBody =
  | VisualSearchTrialBody
  | StandardScanningTrialBody
  | SustainedFixationTrialBody
  | CompensatorySaccadeTrialBody
  | SystematicExplorationTrialBody;

export type AnyTrialSummary =
  | VisualSearchTrialSummary
  | StandardScanningTrialSummary
  | SustainedFixationTrialSummary
  | CompensatorySaccadeTrialSummary
  | SystematicExplorationTrialSummary;

export function modeToAnalyticsSlug(mode: ReportMode): AnalyticsExerciseSlug {
  switch (mode) {
    case 'TARGET_SEARCH_WITH_DISTRACTORS':
      return 'visual-search';
    case 'STANDARD_SCANNING':
      return 'standard-scanning';
    case 'SUSTAINED_TARGET_FIXATION':
      return 'sustained-fixation';
    case 'COMPENSATORY_SACCADE':
      return 'compensatory-saccade';
    case 'SYSTEMATIC_EXPLORATION':
      return 'systematic-exploration';
  }
}

export function modeToReportSelectorKey(mode: ReportMode): ReportSelector {
  switch (mode) {
    case 'TARGET_SEARCH_WITH_DISTRACTORS':
      return 'visualSearchDataOrigin';
    case 'STANDARD_SCANNING':
      return 'standardScanningDataOrigin';
    case 'SUSTAINED_TARGET_FIXATION':
      return 'sustainedFixationDataOrigin';
    case 'COMPENSATORY_SACCADE':
      return 'compensatorySaccadeDataOrigin';
    case 'SYSTEMATIC_EXPLORATION':
      return 'systematicExplorationDataOrigin';
  }
}

export const analyticsApi = {
  listSessionStreams(
    therapySessionId: string,
    query?: AnalyticsStreamsQuery
  ): Promise<AnalyticsStreamsResponse> {
    return apiRequest<AnalyticsStreamsResponse>(
      'analytics',
      `/api/v1/analytics/sessions/${encodeURIComponent(therapySessionId)}/streams`,
      {
        method: 'GET',
        query: query ? { page: query.page, size: query.size } : undefined,
      }
    );
  },

  getStreamSummary(therapySessionId: string, streamId: string): Promise<AnalyticsSummaryResponse> {
    return apiRequest<AnalyticsSummaryResponse>(
      'analytics',
      `/api/v1/analytics/sessions/${encodeURIComponent(therapySessionId)}/streams/${encodeURIComponent(streamId)}/summary`,
      { method: 'GET' }
    );
  },

  getStreamHeatmap(therapySessionId: string, streamId: string): Promise<AnalyticsHeatmapResponse> {
    return apiRequest<AnalyticsHeatmapResponse>(
      'analytics',
      `/api/v1/analytics/sessions/${encodeURIComponent(therapySessionId)}/streams/${encodeURIComponent(streamId)}/heatmap`,
      { method: 'GET' }
    );
  },

  getStreamGazePlot(
    therapySessionId: string,
    streamId: string,
    query?: AnalyticsGazePlotQuery
  ): Promise<AnalyticsGazePlotResponse> {
    return apiRequest<AnalyticsGazePlotResponse>(
      'analytics',
      `/api/v1/analytics/sessions/${encodeURIComponent(therapySessionId)}/streams/${encodeURIComponent(streamId)}/gaze-plot`,
      {
        method: 'GET',
        query: query ? { pageSize: query.pageSize, cursor: query.cursor } : undefined,
      }
    );
  },

  getStreamReplay(
    therapySessionId: string,
    streamId: string,
    query?: AnalyticsReplayQuery
  ): Promise<AnalyticsReplayResponse> {
    return apiRequest<AnalyticsReplayResponse>(
      'analytics',
      `/api/v1/analytics/sessions/${encodeURIComponent(therapySessionId)}/streams/${encodeURIComponent(streamId)}/replay`,
      {
        method: 'GET',
        query: query
          ? {
              pageSize: query.pageSize,
              gazeCursor: query.gazeCursor,
              gameplayCursor: query.gameplayCursor,
            }
          : undefined,
      }
    );
  },

  submitTrialResult(
    therapySessionId: string,
    slug: AnalyticsExerciseSlug,
    body: AnyTrialBody
  ): Promise<AnalyticsTrialReceipt> {
    return apiRequest<AnalyticsTrialReceipt>(
      'analytics',
      `/api/v1/analytics/sessions/${encodeURIComponent(therapySessionId)}/${slug}/trial-results`,
      {
        method: 'POST',
        body,
      }
    );
  },

  getTrialSummary<T extends AnyTrialSummary = AnyTrialSummary>(
    therapySessionId: string,
    slug: AnalyticsExerciseSlug,
    dataOrigin: AnalyticsDataOrigin = 'PRODUCER_REPORTED'
  ): Promise<T> {
    return apiRequest<T>(
      'analytics',
      `/api/v1/analytics/sessions/${encodeURIComponent(therapySessionId)}/${slug}/summary`,
      {
        method: 'GET',
        query: { dataOrigin },
      }
    );
  },
};
