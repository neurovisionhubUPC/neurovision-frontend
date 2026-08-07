import { useRef, useCallback } from 'react';

export interface Point2D {
  x: number;
  y: number;
}

/**
 * Hook para suavizado de señales biométricas en tiempo real.
 * Implementa un filtro de Media Móvil Exponencial Adaptativa (Adaptive EMA), 
 * inspirado en el algoritmo '1 Euro Filter'. Es ideal para HCI (Human-Computer Interaction)
 * ya que neutraliza los temblores neurológicos sin introducir latencia perceptible
 * durante los movimientos intencionales rápidos.
 * 
 * @param alphaMin Nivel de suavizado en reposo (menor = más suave, filtra temblores).
 * @param alphaMax Nivel de suavizado en movimiento (mayor = menos lag, rastrea movimientos rápidos).
 * @param velocityThreshold Distancia normalizada a partir de la cual se considera un movimiento intencional rápido.
 */
export const useGazeSmoother = (
  alphaMin: number = 0.05, 
  alphaMax: number = 0.90, 
  velocityThreshold: number = 0.1
) => {
  const previousPoint = useRef<Point2D | null>(null);

  const smooth = useCallback((rawGaze: Point2D): Point2D => {
    // Si es el primer fotograma, inicializamos el búfer sin suavizar
    if (!previousPoint.current) {
      previousPoint.current = rawGaze;
      return rawGaze;
    }

    const prev = previousPoint.current;
    
    // 1. Derivada Temporal (Velocidad Espacial)
    // Calculamos la distancia (magnitud) entre el último punto conocido y la lectura cruda actual.
    const distance = Math.hypot(rawGaze.x - prev.x, rawGaze.y - prev.y);
    
    // 2. Coeficiente Dinámico de Suavizado (Alpha)
    // Transicionamos suavemente desde alphaMin hasta alphaMax basado en la velocidad del ojo.
    const velocityRatio = Math.min(1, distance / velocityThreshold);
    const dynamicAlpha = alphaMin + velocityRatio * (alphaMax - alphaMin);

    // 3. Ecuación de Media Móvil Exponencial (EMA)
    // S_t = S_{t-1} + alpha * (X_t - S_{t-1})
    const smoothedPoint = {
      x: prev.x + dynamicAlpha * (rawGaze.x - prev.x),
      y: prev.y + dynamicAlpha * (rawGaze.y - prev.y)
    };

    // Actualizamos la ventana de tiempo
    previousPoint.current = smoothedPoint;
    return smoothedPoint;
  }, [alphaMin, alphaMax, velocityThreshold]);

  /**
   * Resetea el historial del búfer. Útil si la cara del usuario se pierde
   * de la cámara y queremos evitar interpolaciones erráticas al re-detectarla.
   */
  const resetBuffer = useCallback(() => {
    previousPoint.current = null;
  }, []);

  return { smooth, resetBuffer };
};
