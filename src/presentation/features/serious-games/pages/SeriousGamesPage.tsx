import React, { useEffect, useRef, useCallback } from 'react';
import { useWebcam } from '../../../../infrastructure/cv/hooks/useWebcam';
import { useMediaPipeWorker } from '../../../../infrastructure/cv/hooks/useMediaPipeWorker';
import { useGazeSmoother } from '../../../../infrastructure/cv/hooks/useGazeSmoother';
import { useAppStore } from '../../../../core/store/useAppStore';
import { EyeTrackingGameCanvas } from '../components/EyeTrackingGameCanvas';

export const SeriousGamesPage: React.FC = () => {
  const { videoRef, startWebcam, isStreaming, error } = useWebcam();
  const { smooth } = useGazeSmoother(0.05, 0.9, 0.08); 
  const gazeRef = useRef({ x: 0.5, y: 0.5 }); // Cursor al centro por defecto
  const frameRequestRef = useRef<number>(0);
  const debugRef = useRef<HTMLPreElement>(null);

  const gamePhase = useAppStore(state => state.gamePhase);
  const setGamePhase = useAppStore(state => state.setGamePhase);
  
  // Receta Médica por Defecto (si el usuario entra sin loguearse en un portal médico)
  const prescription = useAppStore(state => state.currentPrescription) || {
    prescriptionId: 'demo',
    patientId: 'demo',
    gameId: 'demo',
    parameters: {
      target_speed: 1.0,
      visual_field_amplitude: 0.9, // 90% de la pantalla
      min_fixation_time: 1000 // 1 segundo de fijación para "clickear"
    }
  };

  // 1. Recepción de Coordenadas desde el Worker Cefálico
  const handleWorkerResults = useCallback((results: any) => {
    if (results && results.gaze) {
      // Promediamos ambos ojos para mayor estabilidad
      const left = results.gaze.leftGaze;
      const right = results.gaze.rightGaze;
      
      // Las coordenadas de MediaPipe Compensadas son relativas al centro de la pupila
      // Mapeamos los ratios a coordenadas de pantalla [0, 1] (Ajuste básico de sensibilidad)
      const SENSITIVITY_X = 2.5; 
      const SENSITIVITY_Y = 2.0;
      
      const rawX = 0.5 - ((left.x + right.x) / 2) * SENSITIVITY_X;
      const rawY = 0.5 + ((left.y + right.y) / 2) * SENSITIVITY_Y;

      // Limitamos [0, 1]
      const clampedX = Math.max(0, Math.min(1, rawX));
      const clampedY = Math.max(0, Math.min(1, rawY));

      // Pasamos por el Filtro Anti-Temblor (Adaptive EMA)
      const smoothed = smooth({ x: clampedX, y: clampedY });
      
      // Inyectamos al Canvas Directamente (Zero React Lag)
      gazeRef.current = smoothed;
      
      // Actualizamos el HUD de depuración
      if (debugRef.current) {
        debugRef.current.innerText = `STATUS: PUPILAS DETECTADAS (OK)
Roll Cefálico: ${(results.gaze.headRoll * (180/Math.PI)).toFixed(1)}°
Raw X: ${rawX.toFixed(3)} | Y: ${rawY.toFixed(3)}
Smooth X: ${smoothed.x.toFixed(3)} | Y: ${smoothed.y.toFixed(3)}
Landmarks: ${results.landmarkCount || 0}`;
      }
    } else if (results && results.rawResultsAvailable) {
      if (debugRef.current) {
        debugRef.current.innerText = `STATUS: ROSTRO DETECTADO PERO PUPILAS NO (Landmarks: ${results.landmarkCount || 0}).
La IA encuentra tu cara, pero falla el algoritmo pupilar.`;
      }
    } else {
      if (debugRef.current) {
        debugRef.current.innerText = "STATUS: BUSCANDO ROSTRO...\n¡Asegúrate de tener buena luz y mirar a la cámara!";
      }
    }
  }, [smooth]);

  const { processVideoFrame, isReady, isLoaded } = useMediaPipeWorker(handleWorkerResults);

  // 2. Bucle de Captura del Video (Loop Principal)
  const captureLoop = useCallback(() => {
    if (videoRef.current && isStreaming && isReady()) {
      // Extraemos el frame y lo enviamos al Worker
      processVideoFrame(videoRef.current, performance.now());
    }
    // Llamada recursiva súper rápida
    frameRequestRef.current = requestAnimationFrame(captureLoop);
  }, [isStreaming, isReady, processVideoFrame, videoRef]);

  // Ciclo de vida: Iniciar WebCam y el Loop
  useEffect(() => {
    startWebcam();
    setGamePhase('TUTORIAL_CALIBRATION'); // Iniciamos en modo calentamiento
  }, [startWebcam, setGamePhase]);

  useEffect(() => {
    if (isStreaming) {
      frameRequestRef.current = requestAnimationFrame(captureLoop);
    }
    return () => {
      if (frameRequestRef.current) cancelAnimationFrame(frameRequestRef.current);
    };
  }, [isStreaming, captureLoop]);

  return (
    <div className="min-h-screen bg-hc-black flex flex-col items-center justify-center p-8 relative">
      {/* HUD Superior */}
      <div className="absolute top-4 left-4 right-4 flex justify-between text-hc-white">
        <h2 className="text-2xl font-bold text-hc-yellow">NeuroVision Terapia</h2>
        {!isLoaded && <span className="animate-pulse">Cargando Motores de IA...</span>}
        {error && <span className="text-red-500">{error}</span>}
      </div>

      {/* 
        Video en miniatura (Picture-in-Picture) para que el paciente/clínico 
        pueda verificar que la cámara lo está enfocando correctamente.
      */}
      <video 
        ref={videoRef} 
        className="absolute bottom-4 right-4 w-48 h-36 rounded-xl border-2 border-hc-gray shadow-lg z-50 object-cover opacity-80" 
        playsInline 
        muted 
        autoPlay
      />
      
      {/* Panel de Depuración en Tiempo Real (Actualizado por Ref para evitar Lag) */}
      <div className="absolute bottom-4 left-4 bg-black/80 border border-hc-yellow text-hc-yellow p-4 rounded-xl font-mono text-sm shadow-lg z-50 pointer-events-none">
        <pre ref={debugRef} className="m-0">
          Iniciando telemetría...
        </pre>
      </div>

      {/* Motor Gráfico del Juego */}
      <div className="w-full max-w-5xl aspect-video relative">
        <EyeTrackingGameCanvas 
          gazeRef={gazeRef}
          prescription={prescription}
          gamePhase={gamePhase}
          onPhaseChange={setGamePhase}
          width={1024}
          height={576}
        />
      </div>
    </div>
  );
};
