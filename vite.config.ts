import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@mediapipe/tasks-vision'],
  },
  server: {
    proxy: {
      // IAM Service (8081)
      '/api/v1/doctor-invitations': {
        target: 'http://127.0.0.1:8081',
        changeOrigin: true,
      },
      '/api/v1/patient-invitations': {
        target: 'http://127.0.0.1:8081',
        changeOrigin: true,
      },
      // Profile Service (8082)
      '/api/v1/profile': {
        target: 'http://127.0.0.1:8082',
        changeOrigin: true,
      },
      // Clinical Service (8083)
      '/api/v1/clinical-patients': {
        target: 'http://127.0.0.1:8083',
        changeOrigin: true,
      },
      '/api/v1/me': {
        target: 'http://127.0.0.1:8083',
        changeOrigin: true,
      },
      // Telemetry Service (8084)
      '/api/v1/telemetry': {
        target: 'http://127.0.0.1:8084',
        changeOrigin: true,
      },
      // Analytics Service (8085)
      '/api/v1/analytics': {
        target: 'http://127.0.0.1:8085',
        changeOrigin: true,
      },
      // Readiness health proxies
      '/health/iam': {
        target: 'http://127.0.0.1:8081',
        changeOrigin: true,
        rewrite: () => '/q/health/ready',
      },
      '/health/profile': {
        target: 'http://127.0.0.1:8082',
        changeOrigin: true,
        rewrite: () => '/q/health/ready',
      },
      '/health/clinical': {
        target: 'http://127.0.0.1:8083',
        changeOrigin: true,
        rewrite: () => '/q/health/ready',
      },
      '/health/telemetry': {
        target: 'http://127.0.0.1:8084',
        changeOrigin: true,
        rewrite: () => '/q/health/ready',
      },
      '/health/analytics': {
        target: 'http://127.0.0.1:8085',
        changeOrigin: true,
        rewrite: () => '/q/health/ready',
      },
      // OpenAPI / Swagger schema proxies
      '/swagger/iam': {
        target: 'http://127.0.0.1:8081',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/swagger\/iam/, '/q/openapi'),
      },
      '/swagger/profile': {
        target: 'http://127.0.0.1:8082',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/swagger\/profile/, '/q/openapi'),
      },
      '/swagger/clinical': {
        target: 'http://127.0.0.1:8083',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/swagger\/clinical/, '/q/openapi'),
      },
      '/swagger/telemetry': {
        target: 'http://127.0.0.1:8084',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/swagger\/telemetry/, '/q/openapi'),
      },
      '/swagger/analytics': {
        target: 'http://127.0.0.1:8085',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/swagger\/analytics/, '/q/openapi'),
      },
    },
  },
});
