export interface TelemetryAuthHeaders {
  Authorization: `Bearer ${string}`;
}

export interface TelemetryBatchHeaders extends TelemetryAuthHeaders {
  'Content-Type': 'application/json';
}

export interface TelemetryGazeSampleBody {
  offsetMs: number;
  x: number;
  y: number;
  confidence: number;
}

export interface TelemetryGameplaySampleBody {
  offsetMs: number;
  playerX: number;
  playerY: number;
  targetX: number;
  targetY: number;
  score: number;
  speed: number;
  progress: number;
}

export interface TelemetryBatchBody {
  schemaVersion: 1;
  batchId: string;
  therapySessionId: string;
  streamId: string;
  sequence: number;
  capturedAt: string;
  sentAt: string;
  gazeSamples: TelemetryGazeSampleBody[];
  gameplaySamples: TelemetryGameplaySampleBody[];
}

export interface TelemetryBatchAcceptedResponse {
  code: 'BROKER_ACCEPTED';
}

export interface TelemetrySamplesPathParams {
  therapySessionId: string;
}

export interface TelemetrySamplesQueryParams {
  streamId: string;
  /** Inclusive sample-time bound, expressed as an ISO instant. */
  from: string;
  /** Exclusive sample-time bound, expressed as an ISO instant. */
  to: string;
  limit?: number;
  cursor?: string;
}

export interface TelemetryHistoricalSample {
  sampleTime: string;
  batchId: string;
  sequenceNumber: number;
  kind: 'GAZE' | 'GAMEPLAY';
  index: number;
  offsetMs: number;
  serverReceivedAt: string;
  x: number | null;
  y: number | null;
  confidence: number | null;
  playerX: number | null;
  playerY: number | null;
  targetX: number | null;
  targetY: number | null;
  score: number | null;
  speed: number | null;
  progress: number | null;
}

export interface TelemetrySamplesPageResponse {
  contractVersion: 1;
  samples: TelemetryHistoricalSample[];
  nextCursor: string | null;
}

/** Controller error envelope; ingestion validation codes depend on the rejected field. */
export interface TelemetryApiErrorResponse {
  code: string;
}
