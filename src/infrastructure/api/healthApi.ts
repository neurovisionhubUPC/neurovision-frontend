import {
  getRegisteredAccessToken,
  getServiceBaseUrl,
  type BackendServiceName,
} from './httpClient';

export interface ServiceHealthInfo {
  service: BackendServiceName;
  label: string;
  port: number;
  endpointDisplay: string;
  swaggerUrl: string;
  ready: boolean;
  statusText: string;
  latencyMs: number | null;
}

export const BACKEND_SERVICES_META: Array<{
  service: BackendServiceName;
  label: string;
  port: number;
  healthPath: string;
  gatewayProbePath: string;
  routePrefixLabel: string;
  swaggerUrl: string;
}> = [
  {
    service: 'iam',
    label: 'IAM & Invitaciones',
    port: 8081,
    healthPath: '/health/iam',
    gatewayProbePath: '/api/v1/patient-invitations/00000000-0000-0000-0000-000000000000',
    routePrefixLabel: '/api/v1/patient-invitations',
    swaggerUrl: 'http://localhost:8081/q/swagger-ui/',
  },
  {
    service: 'profile',
    label: 'Profile (Médico / Paciente)',
    port: 8082,
    healthPath: '/health/profile',
    gatewayProbePath: '/api/v1/profile',
    routePrefixLabel: '/api/v1/profile',
    swaggerUrl: 'http://localhost:8082/q/swagger-ui/',
  },
  {
    service: 'clinical',
    label: 'Clinical (Planes, Sesiones & PDF)',
    port: 8083,
    healthPath: '/health/clinical',
    gatewayProbePath: '/api/v1/me/therapy-sessions/current',
    routePrefixLabel: '/api/v1/clinical-patients',
    swaggerUrl: 'http://localhost:8083/q/swagger-ui/',
  },
  {
    service: 'telemetry',
    label: 'Telemetry (Ingesta TimescaleDB)',
    port: 8084,
    healthPath: '/health/telemetry',
    gatewayProbePath:
      '/api/v1/telemetry/sessions/00000000-0000-0000-0000-000000000000/samples',
    routePrefixLabel: '/api/v1/telemetry',
    swaggerUrl: 'http://localhost:8084/q/swagger-ui/',
  },
  {
    service: 'analytics',
    label: 'Analytics (Streams & Trials MongoDB)',
    port: 8085,
    healthPath: '/health/analytics',
    gatewayProbePath:
      '/api/v1/analytics/therapy-sessions/00000000-0000-0000-0000-000000000000/summary',
    routePrefixLabel: '/api/v1/analytics',
    swaggerUrl: 'http://localhost:8085/q/swagger-ui/',
  },
];

export function getServiceEndpointDisplay(
  meta: (typeof BACKEND_SERVICES_META)[number]
): { endpointDisplay: string; swaggerUrl: string; isGatewayMode: boolean } {
  const baseUrl = getServiceBaseUrl(meta.service);
  if (!baseUrl) {
    return {
      endpointDisplay: `:${meta.port}`,
      swaggerUrl: meta.swaggerUrl,
      isGatewayMode: false,
    };
  }
  return {
    endpointDisplay: meta.routePrefixLabel,
    swaggerUrl: '',
    isGatewayMode: true,
  };
}

export async function checkAllServicesHealth(): Promise<{
  services: ServiceHealthInfo[];
  statusMap: Record<BackendServiceName, boolean>;
}> {
  const token = getRegisteredAccessToken();

  const results = await Promise.all(
    BACKEND_SERVICES_META.map(async (meta): Promise<ServiceHealthInfo> => {
      const baseUrl = getServiceBaseUrl(meta.service);
      const { endpointDisplay, swaggerUrl, isGatewayMode } = getServiceEndpointDisplay(meta);
      const start = performance.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);

      try {
        if (!isGatewayMode) {
          // Local dev mode: use Vite dev proxy /health/<service> -> 127.0.0.1:808X/q/health/ready
          const res = await fetch(meta.healthPath, { signal: controller.signal });
          clearTimeout(timer);
          const latencyMs = Math.round(performance.now() - start);
          const contentType = res.headers.get('content-type') || '';

          if (res.ok && contentType.includes('application/json')) {
            const json = (await res.json()) as { status?: string };
            const isUp = json?.status === 'UP';
            return {
              service: meta.service,
              label: meta.label,
              port: meta.port,
              endpointDisplay,
              swaggerUrl,
              ready: isUp,
              statusText: json?.status || 'UP',
              latencyMs,
            };
          }

          return {
            service: meta.service,
            label: meta.label,
            port: meta.port,
            endpointDisplay,
            swaggerUrl,
            ready: false,
            statusText: !res.ok ? `HTTP ${res.status}` : 'DOWN / Sin conexión',
            latencyMs,
          };
        }

        // Deployed API Gateway mode (e.g. https://api-neurovision.fzcards.com):
        // Probe the service's actual routed prefix on the gateway.
        // Any HTTP status < 500 (200, 400, 401, 403, 404) confirms the microservice container
        // is alive and reachable behind Traefik/Gateway; 502/503/504 or network failure means DOWN.
        const headers: Record<string, string> = {};
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const probeUrl = `${baseUrl}${meta.gatewayProbePath}`;
        const res = await fetch(probeUrl, {
          method: 'GET',
          headers,
          signal: controller.signal,
        });
        clearTimeout(timer);
        const latencyMs = Math.round(performance.now() - start);
        const isServiceReachable = res.status > 0 && res.status < 500;

        return {
          service: meta.service,
          label: meta.label,
          port: meta.port,
          endpointDisplay,
          swaggerUrl,
          ready: isServiceReachable,
          statusText: isServiceReachable ? 'UP' : `HTTP ${res.status}`,
          latencyMs,
        };
      } catch {
        clearTimeout(timer);
        return {
          service: meta.service,
          label: meta.label,
          port: meta.port,
          endpointDisplay,
          swaggerUrl,
          ready: false,
          statusText: 'DOWN / Sin conexión',
          latencyMs: null,
        };
      }
    })
  );

  const statusMap: Record<BackendServiceName, boolean> = {
    iam: false,
    profile: false,
    clinical: false,
    telemetry: false,
    analytics: false,
  };
  for (const item of results) {
    statusMap[item.service] = item.ready;
  }

  return { services: results, statusMap };
}
