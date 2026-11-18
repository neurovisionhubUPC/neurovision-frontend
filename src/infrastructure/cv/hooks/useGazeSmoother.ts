import { useRef, useCallback } from 'react';

export interface Point2D {
  x: number;
  y: number;
}

function median3(a: number, b: number, c: number): number {
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
}

/**
 * Hook para suavizado de señales oculomotoras en tiempo real.
 * Combina:
 * 1. Filtro de Mediana de ventana corta (3 muestras) para suprimir picos espurios de 1 frame de MediaPipe sin introducir lag.
 * 2. Filtro 1-Euro Adaptativo (velocidad-dependiente): alta estabilidad durante fijación foveal y baja latencia durante sacadas.
 */
export const useGazeSmoother = (
  alphaMin: number = 0.08,
  alphaMax: number = 0.88,
  velocityThreshold: number = 0.065
) => {
  const previousPoint = useRef<Point2D | null>(null);
  const historyRef = useRef<Point2D[]>([]);

  const smooth = useCallback(
    (rawGaze: Point2D): Point2D => {
      const clampedRaw: Point2D = {
        x: Math.max(0, Math.min(1, rawGaze.x)),
        y: Math.max(0, Math.min(1, rawGaze.y)),
      };

      historyRef.current.push(clampedRaw);
      if (historyRef.current.length > 3) {
        historyRef.current.shift();
      }

      let filteredInput = clampedRaw;
      if (historyRef.current.length === 3) {
        const [p0, p1, p2] = historyRef.current;
        filteredInput = {
          x: median3(p0.x, p1.x, p2.x),
          y: median3(p0.y, p1.y, p2.y),
        };
      }

      if (!previousPoint.current) {
        previousPoint.current = filteredInput;
        return filteredInput;
      }

      const prev = previousPoint.current;
      const distance = Math.hypot(filteredInput.x - prev.x, filteredInput.y - prev.y);

      // Deadzone micro-tremor suppression (< 0.35% screen jitter)
      if (distance < 0.0035) {
        return prev;
      }

      // Non-linear quadratic ramp from alphaMin to alphaMax for crisp saccades and rock-solid fixations
      const linearRatio = Math.min(1, distance / Math.max(0.01, velocityThreshold));
      const dynamicAlpha =
        alphaMin + Math.pow(linearRatio, 1.35) * (alphaMax - alphaMin);

      const smoothedPoint = {
        x: prev.x + dynamicAlpha * (filteredInput.x - prev.x),
        y: prev.y + dynamicAlpha * (filteredInput.y - prev.y),
      };

      previousPoint.current = smoothedPoint;
      return smoothedPoint;
    },
    [alphaMin, alphaMax, velocityThreshold]
  );

  const resetBuffer = useCallback(() => {
    previousPoint.current = null;
    historyRef.current = [];
  }, []);

  return { smooth, resetBuffer };
};
