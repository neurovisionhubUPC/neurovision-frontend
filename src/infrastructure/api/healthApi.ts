import type { BackendServiceName } from './httpClient';

export interface ServiceHealthInfo {
  service: BackendServiceName;
  label: string;
  port: number;
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
  swaggerUrl: string;
}> = [
  {
    service: 'iam',
    label: 'IAM & Invitaciones',
    port: 8081,
    healthPath: '/health/iam',
    swaggerUrl: 'http://localhost:8081/q/swagger-ui/',
  },
  {
    service: 'profile',
    label: 'Profile (Médico / Paciente)',
    port: 8082,
    healthPath: '/health/profile',
    swaggerUrl: 'http://localhost:8082/q/swagger-ui/',
  },
  {
    service: 'clinical',
    label: 'Clinical (Planes, Sesiones & PDF)',
    port: 8083,
    healthPath: '/health/clinical',
    swaggerUrl: 'http://localhost:8083/q/swagger-ui/',
  },
  {
    service: 'telemetry',
    label: 'Telemetry (Ingesta TimescaleDB)',
    port: 8084,
    healthPath: '/health/telemetry',
    swaggerUrl: 'http://localhost:8084/q/swagger-ui/',
  },
  {
    service: 'analytics',
    label: 'Analytics (Streams & Trials MongoDB)',
    port: 8085,
    healthPath: '/health/analytics',
    swaggerUrl: 'http://localhost:8085/q/swagger-ui/',
  },
];

export async function checkAllServicesHealth(): Promise<{
  services: ServiceHealthInfo[];
  statusMap: Record<BackendServiceName, boolean>;
}> {
  const results = await Promise.all(
    BACKEND_SERVICES_META.map(async (meta): Promise<ServiceHealthInfo> => {
      const start = performance.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      try {
        const res = await fetch(meta.healthPath, { signal: controller.signal });
        clearTimeout(timer);
        const latencyMs = Math.round(performance.now() - start);
        if (!res.ok) {
          return {
            service: meta.service,
            label: meta.label,
            port: meta.port,
            swaggerUrl: meta.swaggerUrl,
            ready: false,
            statusText: `HTTP ${res.status}`,
            latencyMs,
          };
        }
        const json = (await res.json()) as { status?: string };
        const isUp = json?.status === 'UP';
        return {
          service: meta.service,
          label: meta.label,
          port: meta.port,
          swaggerUrl: meta.swaggerUrl,
          ready: isUp,
          statusText: json?.status || 'UP',
          latencyMs,
        };
      } catch {
        clearTimeout(timer);
        return {
          service: meta.service,
          label: meta.label,
          port: meta.port,
          swaggerUrl: meta.swaggerUrl,
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
