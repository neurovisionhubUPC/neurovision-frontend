export interface AnalyticsAuthHeaders { Authorization: `Bearer ${string}`; }
export interface AnalyticsJsonHeaders extends AnalyticsAuthHeaders { 'Content-Type': 'application/json'; }
export interface AnalyticsSessionPathParams { therapySessionId: string; }
export interface AnalyticsStreamPathParams extends AnalyticsSessionPathParams { streamId: string; }
export interface AnalyticsStreamsQuery { page?: number; size?: number; }
export interface AnalyticsGazePlotQuery { pageSize?: number; cursor?: string; }
export interface AnalyticsReplayQuery { pageSize?: number; gazeCursor?: string; gameplayCursor?: string; }
export interface AnalyticsErrorResponse { code: string; }

interface SampleCounts { gaze: number; gameplay: number; total: number; }
interface SequenceRange { fromInclusive: number; toInclusive: number; }
interface TimeRange { minimum: string; maximum: string; }
interface Grid { rows: number; columns: number; cellCounts: number[]; }
interface NumericSummary { count: number; minimum: number | null; maximum: number | null; mean: number | null; }
interface OrderedNumeric {
  distribution: NumericSummary;
  first: number | null;
  last: number | null;
  signedDelta: number | null;
}
interface ObservationBounds {
  minimumSequence: number;
  missingSequenceRanges: SequenceRange[];
  lateArrivalCount: number;
  unknownSessionBoundary: boolean;
  observedTimeRange: TimeRange | null;
}
interface ProjectionIdentity extends AnalyticsStreamPathParams {
  sourceSchemaVersion: number;
  calculationVersion: string;
  revision: number;
}

export interface AnalyticsStreamsResponse extends AnalyticsSessionPathParams {
  page: number;
  size: number;
  hasNext: boolean;
  items: { streamId: string; calculationVersion: string; revision: number; sampleCounts: SampleCounts }[];
}

export interface AnalyticsSummaryResponse extends ProjectionIdentity {
  schemaVersion: number;
  completeness: ObservationBounds & {
    maximumSequence: number; highSequence: number; missingSequenceRangeCount: number;
    missingSequenceRangesTruncated: boolean; sampleCounts: SampleCounts;
  };
  metrics: {
    confidence: NumericSummary;
    confidenceHistogram: number[];
    heatmap: Grid;
    coverage: {
      occupiedCellCount: number; occupiedCellRatio: number;
      boundingBox: { minimumX: number; minimumY: number; maximumX: number; maximumY: number;
        width: number; height: number; area: number } | null;
    };
    gazePath: { totalDistance: number; velocity: NumericSummary; excludedNonPositiveDeltaCount: number };
    gameplay: { playerTargetDistance: NumericSummary; score: OrderedNumeric; speed: OrderedNumeric; progress: OrderedNumeric };
  };
}

export interface AnalyticsHeatmapResponse extends ProjectionIdentity, ObservationBounds, Grid {
  contractVersion: number;
  coordinateSpace: string;
  cellWeight: string;
  confidenceFiltered: boolean;
  maximumSequence: number;
  highSequence: number;
  gazeSampleCount: number;
}

export interface AnalyticsGazePlotResponse {
  contractVersion: 1;
  pointSemantics: 'OBSERVED_GAZE_SAMPLES';
  calculationVersion: string;
  projectionRevision: number;
  completeness: ObservationBounds & { sourceSchemaVersion: number; highSequence: number; observedGazePointCount: number };
  points: {
    sequence: number; gazeSampleIndex: number; effectiveTime: string;
    x: number; y: number; confidence: number; segmentBreakBefore: boolean;
  }[];
  nextCursor: string | null;
}

interface ReplaySample {
  batchId: string; sequence: number; sourceArrayIndex: number; capturedAt: string;
  offsetMs: number; effectiveTime: string; segmentBreakBefore: boolean;
}
interface ReplayLane<T> { samples: T[]; nextCursor: string | null; knownMissingSequenceRanges: SequenceRange[]; }

export type AnalyticsDataOrigin = 'SYNTHETIC' | 'PRODUCER_REPORTED';
export interface AnalyticsTrialSummaryQuery { dataOrigin: AnalyticsDataOrigin; }
interface TrialBody {
  schemaVersion: 1;
  trialId: string;
  dataOrigin: AnalyticsDataOrigin;
}
type DwellResult =
  | { outcome: 'SUCCESS'; confirmedDwellMs: number }
  | { outcome: 'TIMEOUT' | 'INTERRUPTED'; confirmedDwellMs: null };

export type VisualSearchTrialBody = TrialBody & DwellResult & { searchDurationMs: number };
export type StandardScanningTrialBody = TrialBody & DwellResult & { localizationDurationMs: number };
export type CompensatorySaccadeTrialBody = TrialBody & DwellResult & { elapsedMs: number };
export interface SustainedFixationTrialBody extends TrialBody {
  outcome: 'SUCCESS' | 'TIMEOUT' | 'INTERRUPTED';
  elapsedMs: number;
  insideTargetMs: number;
  longestContinuousInsideMs: number;
}
export type ExplorationOutcome = 'COMPLETED' | 'TIMED_OUT' | 'INTERRUPTED';
export interface SystematicExplorationTrialBody extends TrialBody {
  outcome: ExplorationOutcome;
  elapsedMs: number;
  visits: {
    quadrant: 'TOP_LEFT' | 'TOP_RIGHT' | 'BOTTOM_LEFT' | 'BOTTOM_RIGHT';
    timeToVisitMs: number;
    confirmedDwellMs: number;
  }[];
}
export interface AnalyticsTrialReceipt {
  status: 'CREATED' | 'ALREADY_STORED';
}
export interface AnalyticsTrialSubmissionError {
  status: 'INVALID_RESULT' | 'INVALID_TOKEN' | 'DENIED' | 'CONFLICT' | 'PAYLOAD_TOO_LARGE'
    | 'UNSUPPORTED_MEDIA_TYPE' | 'UNAVAILABLE' | 'WRITE_OUTCOME_UNKNOWN';
}
interface AnalyticsTrialSummary extends AnalyticsSessionPathParams {
  calculationVersion: string;
  configurationId: string;
  configurationVersion: number;
  dataOrigin: AnalyticsDataOrigin;
  reportedTrialCount: number;
}
export interface VisualSearchTrialSummary extends AnalyticsTrialSummary {
  hitCount: number;
  omissionCount: number;
  interruptedCount: number;
  eligibleSearchCount: number;
  medianSearchDurationMs: number | null;
}
export interface StandardScanningTrialSummary extends AnalyticsTrialSummary {
  detectedTargetCount: number;
  omissionCount: number;
  interruptedCount: number;
  eligibleLocalizationCount: number;
  medianLocalizationDurationMs: number | null;
}
export interface SustainedFixationTrialSummary extends AnalyticsTrialSummary {
  totalInsideTargetMs: number;
  completedTargetCount: number;
}
export interface CompensatorySaccadeTrialSummary extends AnalyticsTrialSummary {
  reachedTargetCount: number;
  medianTimeToTargetMs: number | null;
}
export interface SystematicExplorationTrialSummary extends AnalyticsTrialSummary {
  traversals: {
    trialId: string;
    outcome: ExplorationOutcome;
    visitedRegionCount: number;
    coveragePercent: number;
    elapsedMs: number;
  }[];
}

export interface AnalyticsReplayResponse extends AnalyticsStreamPathParams {
  contractVersion: 1;
  source: 'admitted-telemetry-kafka-v1';
  projectionRevision: number;
  sourceSchemaVersion: number;
  minimumSequence: number;
  maximumSequence: number;
  unknownSessionBoundary: boolean;
  gazeSamples: ReplayLane<ReplaySample & { x: number | null; y: number | null; confidence: number | null }>;
  gameplaySamples: ReplayLane<ReplaySample & {
    playerX: number | null; playerY: number | null; targetX: number | null; targetY: number | null;
    score: number | null; speed: number | null; progress: number | null;
  }>;
}

export type AnalyticsExerciseSlug =
  | 'visual-search'
  | 'standard-scanning'
  | 'sustained-fixation'
  | 'compensatory-saccade'
  | 'systematic-exploration';
