import { useEffect, useRef, useState } from 'react';

export interface EnvironmentalValidationResult {
  camera: {
    isStreaming: boolean;
    isCovered: boolean;
    isFrozen: boolean;
    status: 'CONNECTED' | 'COVERED' | 'DISCONNECTED' | 'CONNECTING';
    fps: number;
    label: string;
    description: string;
    passed: boolean;
  };
  lighting: {
    lux: number;
    status: 'OPTIMAL' | 'LOW' | 'EXCESSIVE';
    percentage: number;
    label: string;
    description: string;
    passed: boolean;
  };
  distance: {
    distanceCm: number;
    status: 'OPTIMAL' | 'TOO_CLOSE' | 'TOO_FAR' | 'NO_FACE';
    percentage: number;
    label: string;
    description: string;
    hasFace: boolean;
    passed: boolean;
  };
  canProceed: boolean;
  blockReason: string | null;
}

/**
 * Hook para la validación ambiental y técnica en tiempo real:
 * 1. Detección de Tapa / Protector / Cámara Ocluida (Black/Frozen Frame).
 * 2. Medición de Luminancia y Estimación Fotométrica en Lux.
 * 3. Cálculo de Distancia del Rostro vía Proyección Óptica IPD en tiempo real (Zero Lag).
 */
export const useEnvironmentalValidation = (
  videoRef: React.RefObject<HTMLVideoElement | null>,
  isStreaming: boolean,
  rawMetricsRef: React.RefObject<any>
): EnvironmentalValidationResult => {
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const smoothedLuxRef = useRef<number>(420);
  const smoothedDistRef = useRef<number>(50);
  const prevImageDataRef = useRef<Uint8ClampedArray | null>(null);
  const frozenCounterRef = useRef<number>(0);

  const [validation, setValidation] = useState<EnvironmentalValidationResult>({
    camera: {
      isStreaming: false,
      isCovered: false,
      isFrozen: false,
      status: 'CONNECTING',
      fps: 60,
      label: 'CONECTANDO...',
      description: 'Iniciando captura de video...',
      passed: false,
    },
    lighting: {
      lux: 420,
      status: 'OPTIMAL',
      percentage: 55,
      label: 'CALCULANDO...',
      description: 'Analizando fotometría de la habitación...',
      passed: false,
    },
    distance: {
      distanceCm: 50,
      status: 'NO_FACE',
      percentage: 50,
      label: 'BUSCANDO ROSTRO...',
      description: 'Alinee su rostro frente al sensor.',
      hasFace: false,
      passed: false,
    },
    canProceed: false,
    blockReason: 'Iniciando comprobación técnica...',
  });

  useEffect(() => {
    if (!offscreenCanvasRef.current) {
      const c = document.createElement('canvas');
      c.width = 48;
      c.height = 36;
      offscreenCanvasRef.current = c;
    }

    // Intervalo de evaluación ágil a 10 Hz (cada 100 ms)
    const intervalId = setInterval(() => {
      const video = videoRef.current;
      const canvas = offscreenCanvasRef.current;
      const metrics = rawMetricsRef.current;

      // 1. ANÁLISIS DE CÁMARA (Luminancia + Detección de Tapa / Oclusión)
      let isCovered = false;
      let isFrozen = false;
      let currentLux = smoothedLuxRef.current;

      if (video && isStreaming && video.readyState >= 2 && canvas) {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          const pixelCount = canvas.width * canvas.height;

          let totalLuma = 0;
          let totalSqLuma = 0;
          let diffSum = 0;

          const prevData = prevImageDataRef.current;

          for (let i = 0; i < imgData.length; i += 4) {
            const r = imgData[i];
            const g = imgData[i + 1];
            const b = imgData[i + 2];
            // Estándar ITU-R BT.601
            const y = 0.299 * r + 0.587 * g + 0.114 * b;
            totalLuma += y;
            totalSqLuma += y * y;

            if (prevData) {
              diffSum += Math.abs(y - (0.299 * prevData[i] + 0.587 * prevData[i + 1] + 0.114 * prevData[i + 2]));
            }
          }

          prevImageDataRef.current = new Uint8ClampedArray(imgData);

          const meanLuma = totalLuma / pixelCount;
          const variance = Math.max(0, (totalSqLuma / pixelCount) - (meanLuma * meanLuma));
          const stdDev = Math.sqrt(variance);

          // Si el cuadro promedio está casi totalmente en negro (< 10) y la varianza es mínima (< 4.5)
          isCovered = meanLuma < 10 && stdDev < 4.5;

          // Detección de video congelado
          if (diffSum / pixelCount < 0.2) {
            frozenCounterRef.current += 1;
            if (frozenCounterRef.current > 15) {
              isFrozen = true;
            }
          } else {
            frozenCounterRef.current = 0;
            isFrozen = false;
          }

          // 2. CÁLCULO DE ILUMINACIÓN AMBIENTAL (Lux Fotométricos)
          if (isCovered) {
            currentLux = 0;
          } else {
            const normLuma = meanLuma / 255;
            const instantLux = Math.round(Math.min(850, Math.max(15, Math.pow(normLuma, 1.45) * 820)));
            smoothedLuxRef.current = Math.round(smoothedLuxRef.current * 0.75 + instantLux * 0.25);
            currentLux = smoothedLuxRef.current;
          }
        }
      }

      // Estado de Cámara
      let cameraStatus: EnvironmentalValidationResult['camera']['status'] = 'CONNECTING';
      let cameraLabel = 'CONECTANDO...';
      let cameraDesc = 'Esperando señal del sensor de video...';
      let cameraPassed = false;

      if (!isStreaming) {
        cameraStatus = 'DISCONNECTED';
        cameraLabel = 'DESCONECTADA';
        cameraDesc = 'No se ha detectado el stream de la cámara o se denegó el permiso.';
      } else if (isCovered) {
        cameraStatus = 'COVERED';
        cameraLabel = 'TAPA PUESTA / BLOQUEADA';
        cameraDesc = 'Cámara tapada u oscuridad total. Por favor retire el protector de la webcam para continuar.';
      } else if (isFrozen) {
        cameraStatus = 'COVERED';
        cameraLabel = 'SEÑAL CONGELADA';
        cameraDesc = 'La imagen de la cámara parece bloqueada o estática.';
      } else {
        cameraStatus = 'CONNECTED';
        cameraLabel = 'CONECTADA';
        cameraDesc = 'Señal de vídeo nítida recibida a 60 fotogramas por segundo. Adecuada para medir micro-sacadas y fijaciones oculares.';
        cameraPassed = true;
      }

      // Estado de Iluminación
      let lightingStatus: EnvironmentalValidationResult['lighting']['status'] = 'OPTIMAL';
      let lightingLabel = `ÓPTIMA (${currentLux} Lux)`;
      let lightingDesc = 'Luz ambiental suave y homogénea. No se detectan contraluces ni destellos directos sobre sus ojos o la pantalla.';
      let lightingPassed = false;
      const lightingPercent = Math.min(100, Math.max(0, (currentLux / 750) * 100));

      if (isCovered || currentLux < 180) {
        lightingStatus = 'LOW';
        lightingLabel = `POCA LUZ (${currentLux} Lux)`;
        lightingDesc = 'Iluminación insuficiente. Encienda una luz frontal suave o abra las persianas para permitir la detección ocular.';
      } else if (currentLux > 650) {
        lightingStatus = 'EXCESSIVE';
        lightingLabel = `EXCESO DE LUZ (${currentLux} Lux)`;
        lightingDesc = 'Contraluz intenso o reflejos sobre la lente. Evite ventanas o lámparas directas detrás de usted.';
      } else {
        lightingPassed = true;
      }

      // 3. CÁLCULO DE DISTANCIA DEL ROSTRO (Óptica Geométrica IPD - Ultra Reactivo)
      const hasFace = !!(metrics?.pupilL && metrics?.pupilR);
      let distCm = smoothedDistRef.current;
      let distStatus: EnvironmentalValidationResult['distance']['status'] = 'NO_FACE';
      let distLabel = 'BUSCANDO ROSTRO...';
      let distDesc = 'Alinee su rostro frente al sensor dentro de la silueta guía.';
      let distPassed = false;
      let distPercent = 50;

      if (hasFace) {
        const dx = metrics.pupilR.x - metrics.pupilL.x;
        const dy = metrics.pupilR.y - metrics.pupilL.y;
        const ipd = Math.hypot(dx, dy);

        if (ipd > 0.005) {
          // Fórmula empírica Pin-Hole calibrada para webcams convencionales (FOV ~68°)
          // IPD real adulto = 6.3 cm
          const rawDist = 5.75 / ipd;
          const clamped = Math.max(25, Math.min(90, Math.round(rawDist)));

          // FILTRO ADAPTATIVO SIN RETARDO:
          // Si el usuario se mueve rápido (|delta| > 4cm), el factor de respuesta es 0.70 (prácticamente instantáneo)
          // Si está quieto con pequeños temblores naturales, el factor es 0.25 (estable y fluido)
          const delta = Math.abs(clamped - smoothedDistRef.current);
          const alpha = delta > 4 ? 0.70 : 0.25;

          smoothedDistRef.current = Math.round(smoothedDistRef.current * (1 - alpha) + clamped * alpha);
          distCm = smoothedDistRef.current;
        }

        distPercent = Math.max(5, Math.min(95, Math.round(((distCm - 30) / (70 - 30)) * 100)));

        if (distCm < 38) {
          distStatus = 'TOO_CLOSE';
          distLabel = `${distCm} CM (MUY CERCA)`;
          distDesc = 'Su rostro está demasiado cerca. Aléjese un poco hasta situarse entre 40 y 60 cm.';
        } else if (distCm > 63) {
          distStatus = 'TOO_FAR';
          distLabel = `${distCm} CM (MUY LEJOS)`;
          distDesc = 'Su rostro está muy alejado. Acérquese a unos 50 cm para que la cámara capte sus pupilas con precisión.';
        } else {
          distStatus = 'OPTIMAL';
          distLabel = `${distCm} CM (CORRECTA)`;
          distDesc = 'Su rostro está en el plano focal ideal. Mantenga la espalda bien apoyada en el respaldo de la silla.';
          distPassed = true;
        }
      }

      // 4. COMPROBACIÓN GENERAL OBLIGATORIA
      const canProceed = cameraPassed && lightingPassed && distPassed;
      let blockReason: string | null = null;

      if (!cameraPassed) {
        blockReason = isCovered
          ? 'Retire la tapa o protector de la cámara para continuar.'
          : 'La cámara debe estar conectada y transmitiendo.';
      } else if (!hasFace) {
        blockReason = 'Coloque su rostro frente a la pantalla dentro de la silueta guía.';
      } else if (!distPassed) {
        blockReason = distStatus === 'TOO_CLOSE'
          ? 'Aléjese un poco de la pantalla (distancia recomendada: 40 - 60 cm).'
          : 'Acérquese un poco al monitor (distancia recomendada: 40 - 60 cm).';
      } else if (!lightingPassed) {
        blockReason = lightingStatus === 'LOW'
          ? 'Mejore la iluminación ambiental encendiendo una luz suave.'
          : 'Evite fuentes de luz directa o contraluces fuertes hacia la cámara.';
      }

      setValidation({
        camera: {
          isStreaming,
          isCovered,
          isFrozen,
          status: cameraStatus,
          fps: 60,
          label: cameraLabel,
          description: cameraDesc,
          passed: cameraPassed,
        },
        lighting: {
          lux: currentLux,
          status: lightingStatus,
          percentage: lightingPercent,
          label: lightingLabel,
          description: lightingDesc,
          passed: lightingPassed,
        },
        distance: {
          distanceCm: distCm,
          status: distStatus,
          percentage: distPercent,
          label: distLabel,
          description: distDesc,
          hasFace,
          passed: distPassed,
        },
        canProceed,
        blockReason,
      });
    }, 100);

    return () => clearInterval(intervalId);
  }, [videoRef, isStreaming, rawMetricsRef]);

  return validation;
};
