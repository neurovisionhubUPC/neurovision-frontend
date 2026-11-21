import React, { useEffect, useState } from 'react';
import { useCalibrationStore, CALIBRATION_POINTS } from '../../../../core/store/useCalibrationStore';
import { processFixationSamples, computeCalibrationData } from '../../../../infrastructure/cv/math/zhangYinModel';
import { useAppStore } from '../../../../core/store/useAppStore';

export const CalibrationOverlay: React.FC = () => {
  const { currentPointIndex, nextPoint, processedMetrics, completeCalibration, isPreCalibrating } = useCalibrationStore();
  const setGamePhase = useAppStore(state => state.setGamePhase);
  const [progress, setProgress] = useState(0);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (isPreCalibrating) return; // Esperar a que el usuario presione el botón

    // Si ya completamos los puntos, calculamos la escala
    if (currentPointIndex >= CALIBRATION_POINTS.length) {
      if (processedMetrics.length === CALIBRATION_POINTS.length) {
        const calibData = computeCalibrationData(processedMetrics, CALIBRATION_POINTS);
        completeCalibration(calibData);
        setGamePhase('TUTORIAL_CALIBRATION'); // Volvemos al juego
      }
      return;
    }

    // Cada punto dura 2.2 segundos (550ms de transición sacádica + 1650ms de captura foveal limpia).
    const pointDurationMs = 2200;
    const interval = 50; // Update progress bar every 50ms
    const saccadicLatencyMs = 550; // Descarte de Latencia Sacádica Inicial (Chhimpa et al., 2024)
    let elapsed = 0;

    // Purgamos samples residuales del punto anterior
    useCalibrationStore.setState({ rawSamples: [] });

    const timer = setInterval(() => {
      elapsed += interval;
      setProgress((elapsed / pointDurationMs) * 100);

      // Descarte de sacada inicial (550 ms): Purgamos los datos mientras el ojo saltaba al objetivo
      if (elapsed === saccadicLatencyMs) {
        useCalibrationStore.setState({ rawSamples: [] });
      }

      if (elapsed >= pointDurationMs) {
        clearInterval(timer);
        // Procesamos la recolección actual desde el getState para evitar stale closures
        const currentSamples = useCalibrationStore.getState().rawSamples;
        const result = processFixationSamples(currentSamples);
        if (result) {
          setProgress(0);
          nextPoint(result);
        } else {
          // Si no hay suficientes samples válidos (ej. parpadeo prolongado o cambio de elemento video),
          // reintentamos el punto reiniciando el temporizador de forma reactiva.
          console.warn("Muestras insuficientes o parpadeo continuo. Reintentando punto...");
          setProgress(0);
          useCalibrationStore.setState({ rawSamples: [] });
          setRetryCount((c) => c + 1);
        }
      }
    }, interval);

    return () => clearInterval(timer);
  }, [currentPointIndex, retryCount, processedMetrics, nextPoint, completeCalibration, setGamePhase, isPreCalibrating]);

  if (currentPointIndex >= CALIBRATION_POINTS.length) return null;
  if (isPreCalibrating) return null; // No mostrar puntos aún

  const currentPoint = CALIBRATION_POINTS[currentPointIndex];

  return (
    <div className="fixed inset-0 bg-hc-black/95 z-50 flex items-center justify-center pointer-events-auto">
      <div className="text-hc-white absolute top-[22%] left-1/2 -translate-x-1/2 w-full max-w-xl px-4 text-center pointer-events-none">
        <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold text-hc-yellow mb-1.5">
          Calibración Oculomotora de Alta Precisión
        </h2>
        <p className="text-sm sm:text-base lg:text-lg text-white/95">
          Mira fijamente el punto blanco en el centro del círculo rojo sin mover la cabeza.
        </p>
        <p className="text-xs sm:text-sm text-white/75 font-semibold mt-2">
          Punto {currentPointIndex + 1} de {CALIBRATION_POINTS.length}
        </p>
      </div>

      <div 
        className="absolute w-12 h-12 -ml-6 -mt-6 rounded-full bg-red-600 shadow-[0_0_24px_rgba(220,38,38,0.85)] flex items-center justify-center transition-all duration-200"
        style={{ 
          left: `${currentPoint.x * 100}%`, 
          top: `${currentPoint.y * 100}%` 
        }}
      >
        {/* Anillo de progreso SVG */}
        <svg className="absolute w-16 h-16 transform -rotate-90">
          <circle cx="32" cy="32" r="28" stroke="rgba(255,255,255,0.2)" strokeWidth="4" fill="none" />
          <circle 
            cx="32" cy="32" r="28" 
            stroke="#FBBF24" 
            strokeWidth="4" 
            fill="none" 
            strokeDasharray={2 * Math.PI * 28}
            strokeDashoffset={2 * Math.PI * 28 * (1 - progress / 100)}
            className="transition-all duration-75"
          />
        </svg>

        {/* Punto de anclaje foveal exacto en el centro */}
        <div className="w-2.5 h-2.5 rounded-full bg-white shadow-[0_0_6px_#ffffff]" />

        {/* Temporizador numérico debajo del objetivo */}
        <span className="absolute -bottom-6 text-white font-bold text-[11px] font-mono">
          {progress < 80 ? (2.2 - (progress / 100) * 2.2).toFixed(1) + 's' : 'OK'}
        </span>
      </div>
    </div>
  );
};
