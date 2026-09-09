import React, { useEffect, useState } from 'react';
import { useCalibrationStore, CALIBRATION_POINTS } from '../../../../core/store/useCalibrationStore';
import { processFixationSamples, computeCalibrationData } from '../../../../infrastructure/cv/math/zhangYinModel';
import { useAppStore } from '../../../../core/store/useAppStore';

export const CalibrationOverlay: React.FC = () => {
  const { currentPointIndex, nextPoint, processedMetrics, completeCalibration, isPreCalibrating } = useCalibrationStore();
  const setGamePhase = useAppStore(state => state.setGamePhase);
  const [progress, setProgress] = useState(0);

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

    // Cada punto dura exactamente 2 segundos.
    const pointDurationMs = 2000;
    const interval = 50; // Update progress bar every 50ms
    const saccadicLatencyMs = 500; // Descarte de Latencia Sacádica Inicial (Chhimpa et al., 2024)
    let elapsed = 0;

    // Purgamos samples residuales del punto anterior
    useCalibrationStore.setState({ rawSamples: [] });

    const timer = setInterval(() => {
      elapsed += interval;
      setProgress((elapsed / pointDurationMs) * 100);

      // Descarte de sacada inicial (500 ms): Purgamos los datos mientras el ojo saltaba al objetivo
      if (elapsed === saccadicLatencyMs) {
        useCalibrationStore.setState({ rawSamples: [] });
      }

      if (elapsed >= pointDurationMs) {
        clearInterval(timer);
        // Procesamos la recolección actual desde el getState para evitar stale closures
        const currentSamples = useCalibrationStore.getState().rawSamples;
        const result = processFixationSamples(currentSamples);
        if (result) {
          nextPoint(result);
        } else {
          // Si no hay suficientes samples válidos (ej. parpadeo prolongado), reintentamos el punto
          console.warn("Muestras insuficientes o parpadeo continuo. Reintentando punto...");
          setProgress(0);
          useCalibrationStore.setState({ rawSamples: [] });
        }
      }
    }, interval);

    return () => clearInterval(timer);
  }, [currentPointIndex, processedMetrics, nextPoint, completeCalibration, setGamePhase, isPreCalibrating]);

  if (currentPointIndex >= CALIBRATION_POINTS.length) return null;
  if (isPreCalibrating) return null; // No mostrar puntos aún

  const currentPoint = CALIBRATION_POINTS[currentPointIndex];

  return (
    <div className="absolute inset-0 bg-hc-black/90 z-40 flex items-center justify-center pointer-events-auto">
      <div className="text-hc-white absolute top-10 text-center">
        <h2 className="text-3xl font-bold text-hc-yellow mb-2">Calibración Oculomotora</h2>
        <p className="text-xl">Mira fijamente el punto rojo central durante 2 segundos.</p>
        <p className="text-hc-gray mt-2">Punto {currentPointIndex + 1} de 5</p>
      </div>

      <div 
        className="absolute w-12 h-12 -ml-6 -mt-6 rounded-full bg-red-600 shadow-[0_0_20px_rgba(220,38,38,0.8)] flex items-center justify-center transition-all duration-300"
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

        {/* Temporizador numérico en el centro */}
        <span className="text-white font-bold text-xs">
          {progress < 75 ? (2 - (progress / 100) * 2).toFixed(1) + 's' : 'OK'}
        </span>
      </div>
    </div>
  );
};
