export type BackendServiceName = 'iam' | 'profile' | 'clinical' | 'telemetry' | 'analytics';

export const DEFAULT_DEPLOY_GATEWAY_URL = 'https://api-neurovision.fzcards.com';

function stripTrailingSlash(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export function isLocalDevelopmentHost(): boolean {
  if (typeof window === 'undefined' || !window.location) {
    return true;
  }
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function resolveEnvBaseUrl(serviceEnvValue: string | undefined): string {
  if (serviceEnvValue && serviceEnvValue.trim()) {
    return stripTrailingSlash(serviceEnvValue);
  }
  const sharedEnv =
    import.meta.env?.VITE_API_BASE_URL || import.meta.env?.VITE_API_URL || '';
  if (sharedEnv && sharedEnv.trim()) {
    return stripTrailingSlash(sharedEnv);
  }
  if (!isLocalDevelopmentHost()) {
    return DEFAULT_DEPLOY_GATEWAY_URL;
  }
  return '';
}

const SERVICE_BASE_URLS: Record<BackendServiceName, string> = {
  iam: resolveEnvBaseUrl(import.meta.env?.VITE_IAM_API_URL),
  profile: resolveEnvBaseUrl(import.meta.env?.VITE_PROFILE_API_URL),
  clinical: resolveEnvBaseUrl(import.meta.env?.VITE_CLINICAL_API_URL),
  telemetry: resolveEnvBaseUrl(import.meta.env?.VITE_TELEMETRY_API_URL),
  analytics: resolveEnvBaseUrl(import.meta.env?.VITE_ANALYTICS_API_URL),
};

export function getServiceBaseUrl(service: BackendServiceName): string {
  return SERVICE_BASE_URLS[service];
}

let tokenGetter: () => string | null = () => null;
let tokenRefresher: (() => Promise<string | null>) | null = null;
let tokenNeedsRefreshChecker: ((token: string | null) => boolean) | null = null;

export function registerAccessTokenGetter(getter: () => string | null): void {
  tokenGetter = getter;
}

export function getRegisteredAccessToken(): string | null {
  return tokenGetter();
}

export function registerAccessTokenRefresher(
  refresher: () => Promise<string | null>,
  needsRefreshChecker?: (token: string | null) => boolean
): void {
  tokenRefresher = refresher;
  tokenNeedsRefreshChecker = needsRefreshChecker ?? null;
}

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function createUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback RFC4122 v4 generator
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const rand = (Math.random() * 16) | 0;
    const val = char === 'x' ? rand : (rand & 0x3) | 0x8;
    return val.toString(16);
  });
}

export function buildQueryString(
  params?: Record<string, string | number | boolean | null | undefined>
): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      search.append(key, String(value));
    }
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  headers?: Record<string, string>;
  idempotencyKey?: string;
  accessToken?: string | null;
  signal?: AbortSignal;
}

function buildRequestHeaders(options: ApiRequestOptions): Record<string, string> {
  const headers: Record<string, string> = {
    ...(options.headers || {}),
  };

  const token = options.accessToken !== undefined ? options.accessToken : tokenGetter();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (options.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }

  // IMPORTANT: Only attach Content-Type when an explicit JSON body is present.
  // Backend endpoints without body (e.g. POST /report-snapshots, PUT /activation) reject stray Content-Type/body.
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  return headers;
}

async function parseErrorResponse(response: Response): Promise<ApiError> {
  const status = response.status;
  let code = `HTTP_${status}`;
  let message = response.statusText || `Error HTTP ${status}`;
  let details: unknown = null;

  try {
    const rawText = await response.text();
    if (rawText) {
      try {
        const parsed = JSON.parse(rawText) as { code?: string; status?: string; message?: string };
        details = parsed;
        if (parsed.code) code = parsed.code;
        else if (parsed.status) code = parsed.status;
        if (parsed.message) message = parsed.message;
        else if (parsed.code) message = parsed.code;
        else if (parsed.status) message = parsed.status;
      } catch {
        message = rawText.slice(0, 240);
      }
    }
  } catch {
    // Ignore body parse failure
  }

  return new ApiError(status, code, message, details);
}

export async function apiRequest<T>(
  service: BackendServiceName,
  path: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const baseUrl = SERVICE_BASE_URLS[service];
  const qs = buildQueryString(options.query);
  const url = `${baseUrl}${path}${qs}`;

  // Proactive refresh when token is expired or within 60s of expiring
  if (
    options.accessToken === undefined &&
    tokenRefresher &&
    tokenNeedsRefreshChecker &&
    tokenNeedsRefreshChecker(tokenGetter())
  ) {
    try {
      await tokenRefresher();
    } catch {
      // Fall through to normal fetch; 401 handler below will catch if invalid
    }
  }

  const executeFetch = async (overrideToken?: string | null): Promise<Response> => {
    const reqOptions =
      overrideToken !== undefined ? { ...options, accessToken: overrideToken } : options;
    const fetchOptions: RequestInit = {
      method: reqOptions.method || 'GET',
      headers: buildRequestHeaders(reqOptions),
      signal: reqOptions.signal,
    };

    if (reqOptions.body !== undefined) {
      fetchOptions.body = JSON.stringify(reqOptions.body);
    }

    return fetch(url, fetchOptions);
  };

  let response = await executeFetch();

  // Reactive 401 retry: refresh once via REFRESH_TOKEN_AUTH and replay request
  if (response.status === 401 && options.accessToken === undefined && tokenRefresher) {
    try {
      const refreshedToken = await tokenRefresher();
      if (refreshedToken) {
        response = await executeFetch(refreshedToken);
      }
    } catch {
      // Return original 401 error below
    }
  }

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json') || contentType.includes('problem+json')) {
    return (await response.json()) as T;
  }

  const text = await response.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

export async function apiRequestBlob(
  service: BackendServiceName,
  path: string,
  options: ApiRequestOptions = {}
): Promise<{ blob: Blob; filename: string | null }> {
  const baseUrl = SERVICE_BASE_URLS[service];
  const qs = buildQueryString(options.query);
  const url = `${baseUrl}${path}${qs}`;

  if (
    options.accessToken === undefined &&
    tokenRefresher &&
    tokenNeedsRefreshChecker &&
    tokenNeedsRefreshChecker(tokenGetter())
  ) {
    try {
      await tokenRefresher();
    } catch {
      // Ignore proactive refresh error
    }
  }

  let response = await fetch(url, {
    method: options.method || 'GET',
    headers: buildRequestHeaders(options),
    signal: options.signal,
  });

  if (response.status === 401 && options.accessToken === undefined && tokenRefresher) {
    try {
      const refreshedToken = await tokenRefresher();
      if (refreshedToken) {
        response = await fetch(url, {
          method: options.method || 'GET',
          headers: buildRequestHeaders({ ...options, accessToken: refreshedToken }),
          signal: options.signal,
        });
      }
    } catch {
      // Return original 401 error below
    }
  }

  // Always check HTTP status BEFORE reading blob, per backend integration doc
  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  const disposition = response.headers.get('content-disposition');
  let filename: string | null = null;
  if (disposition) {
    const match = disposition.match(/filename="?([^"]+)"?/i);
    if (match?.[1]) {
      filename = match[1];
    }
  }

  const blob = await response.blob();
  return { blob, filename };
}

export function extractApiErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return `[${err.status}] ${err.code}: ${err.message}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return 'Error desconocido al comunicarse con el backend.';
}
