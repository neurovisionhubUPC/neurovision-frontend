import React, { useEffect, useRef, useCallback } from 'react';
import { useWebcam } from '../../../../infrastructure/cv/hooks/useWebcam';
import { useMediaPipeWorker } from '../../../../infrastructure/cv/hooks/useMediaPipeWorker';
import { useGazeSmoother } from '../../../../infrastructure/cv/hooks/useGazeSmoother';
import { useAppStore } from '../../../../core/store/useAppStore';
import { useCalibrationStore } from '../../../../core/store/useCalibrationStore';
import { initializeTrackingState, predictGazePoint } from '../../../../infrastructure/cv/math/zhangYinModel';
import { EyeTrackingGameCanvas } from '../components/EyeTrackingGameCanvas';
import { CalibrationOverlay } from '../components/CalibrationOverlay';

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

  const { calibrationData, addSample } = useCalibrationStore();

  const pipCanvasRef = useRef<HTMLCanvasElement>(null);

  // 1. Recepción de Coordenadas desde el Worker Cefálico
  const handleWorkerResults = useCallback((results: any) => {
    
    // Dibujar Landmarks en el Canvas PIP (si existe)
    if (pipCanvasRef.current && results && results.rawMetrics) {
      const ctx = pipCanvasRef.current.getContext('2d');
      if (ctx) {
        const { width, height } = pipCanvasRef.current;
        ctx.clearRect(0, 0, width, height);
        
        // Función helper para dibujar un punto
        const drawPoint = (p: {x: number, y: number}, color: string, radius = 2) => {
          ctx.beginPath();
          ctx.arc(p.x * width, p.y * height, radius, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();
        };

        const metrics = results.rawMetrics;
        // Dibujar pupilas (Rojo)
        drawPoint(metrics.pupilL, '#FF0000', 3);
        drawPoint(metrics.pupilR, '#FF0000', 3);
        
        // Dibujar comisuras (Verde)
        drawPoint(metrics.corners.LI, '#00FF00');
        drawPoint(metrics.corners.LO, '#00FF00');
        drawPoint(metrics.corners.RI, '#00FF00');
        drawPoint(metrics.corners.RO, '#00FF00');
      }
    } else if (pipCanvasRef.current) {
       const ctx = pipCanvasRef.current.getContext('2d');
       if (ctx) ctx.clearRect(0, 0, pipCanvasRef.current.width, pipCanvasRef.current.height);
    }

    // Modo Calibración: Acumulamos samples puros y actualizamos HUD
    if (useAppStore.getState().gamePhase === 'CALIBRATION') {
      if (results && results.rawMetrics) {
        addSample(results.rawMetrics);
        if (debugRef.current) {
          debugRef.current.innerText = `STATUS: CALIBRANDO...
Rostro: Detectado (Landmarks: ${results.landmarkCount || 0})
Yaw: ${(results.rawMetrics.headPose.yaw * (180/Math.PI)).toFixed(1)}° | Pitch: ${(results.rawMetrics.headPose.pitch * (180/Math.PI)).toFixed(1)}°`;
        }
      } else if (results && results.rawResultsAvailable) {
        if (debugRef.current) {
          debugRef.current.innerText = `STATUS: ROSTRO DETECTADO (Pero sin pupilas precisas).
Landmarks: ${results.landmarkCount || 0}`;
        }
      } else {
        if (debugRef.current) {
           debugRef.current.innerText = "STATUS: BUSCANDO ROSTRO...\n¡Asegúrate de tener buena luz y mirar a la cámara!";
        }
      }
      return;
    }

    // Modo Juego (Tracking): Usamos el motor de Zhang & Yin
    if (calibrationData && results && results.rawMetrics) {
      // 1. Predecir mirada combinando pose de cabeza y vectores pupilares
      const predictedGaze = predictGazePoint(results.rawMetrics, calibrationData);
      
      // 2. Filtro Anti-Temblor (Adaptive EMA)
      const smoothed = smooth(predictedGaze);
      
      // 3. Inyectamos al Canvas Directamente (Zero React Lag)
      gazeRef.current = smoothed;
      
      // Actualizamos el HUD de depuración
      if (debugRef.current) {
        debugRef.current.innerText = `STATUS: TRACKING ACTIVO (Zhang & Yin)
Yaw: ${(results.rawMetrics.headPose.yaw * (180/Math.PI)).toFixed(1)}° | Pitch: ${(results.rawMetrics.headPose.pitch * (180/Math.PI)).toFixed(1)}°
Gaze X: ${predictedGaze.x.toFixed(3)} | Y: ${predictedGaze.y.toFixed(3)}
Smooth X: ${smoothed.x.toFixed(3)} | Y: ${smoothed.y.toFixed(3)}`;
      }
    } else if (results && results.rawResultsAvailable) {
      if (debugRef.current) {
        debugRef.current.innerText = `STATUS: ROSTRO DETECTADO (Esperando Calibración o Pupilas).
Landmarks: ${results.landmarkCount || 0}`;
      }
    } else {
      if (debugRef.current) {
        debugRef.current.innerText = "STATUS: BUSCANDO ROSTRO...\n¡Asegúrate de tener buena luz y mirar a la cámara!";
      }
    }
  }, [smooth, calibrationData, addSample]);

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

  useEffect(() => {
    if (calibrationData) {
      initializeTrackingState(calibrationData);
    }
  }, [calibrationData]);

  // Ciclo de vida: Iniciar WebCam y el Loop
  useEffect(() => {
    startWebcam();
    setGamePhase('CALIBRATION'); // Forzar calibración inicial
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

      <div className="absolute bottom-4 right-4 w-48 h-36 z-50">
        <video 
          ref={videoRef} 
          className="w-full h-full rounded-xl border-2 border-hc-gray shadow-lg object-cover opacity-80" 
          playsInline 
          muted 
          autoPlay
        />
        <canvas 
          ref={pipCanvasRef}
          width={192} // 48 rem = 192px approx
          height={144} // 36 rem = 144px approx
          className="absolute top-0 left-0 w-full h-full rounded-xl pointer-events-none"
        />
      </div>
      
      <div className="absolute bottom-4 left-4 bg-black/80 border border-hc-yellow text-hc-yellow p-4 rounded-xl font-mono text-sm shadow-lg z-50 pointer-events-none">
        <pre ref={debugRef} className="m-0">
          Iniciando telemetría...
        </pre>
      </div>

      {gamePhase === 'CALIBRATION' && <CalibrationOverlay />}

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
