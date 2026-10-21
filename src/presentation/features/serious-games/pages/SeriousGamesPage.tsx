import React, { useEffect, useRef, useCallback, useState } from 'react';
import { useWebcam } from '../../../../infrastructure/cv/hooks/useWebcam';
import { useMediaPipeWorker } from '../../../../infrastructure/cv/hooks/useMediaPipeWorker';
import { useGazeSmoother } from '../../../../infrastructure/cv/hooks/useGazeSmoother';
import { useAppStore } from '../../../../core/store/useAppStore';
import { useCalibrationStore } from '../../../../core/store/useCalibrationStore';
import { initializeTrackingState, predictGazePoint } from '../../../../infrastructure/cv/math/zhangYinModel';
import { EyeTrackingGameCanvas } from '../components/EyeTrackingGameCanvas';
import { CalibrationOverlay } from '../components/CalibrationOverlay';
import { PreCalibrationView } from '../components/PreCalibrationView';

export const SeriousGamesPage: React.FC = () => {
  const { videoRef, startWebcam, stopWebcam, isStreaming, error } = useWebcam();
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

  const { calibrationData, addSample, isPreCalibrating, startCalibration } = useCalibrationStore();
  const [heatmapPos, setHeatmapPos] = useState({ x: 0.5, y: 0.5 });
  const rawMetricsRef = useRef<any>(null);

  const pipCanvasRef = useRef<HTMLCanvasElement>(null);

  // 1. Recepción de Coordenadas desde el Worker Cefálico
  const handleWorkerResults = useCallback((results: any) => {
    if (results && results.rawMetrics) {
      rawMetricsRef.current = results.rawMetrics;
    }

    // Dibujar Landmarks en el Canvas PIP (si existe)
    if (pipCanvasRef.current && results && results.rawMetrics) {
      const ctx = pipCanvasRef.current.getContext('2d');
      if (ctx) {
        const { width, height } = pipCanvasRef.current;
        ctx.clearRect(0, 0, width, height);

        // Función helper para dibujar un punto
        const drawPoint = (p: { x: number, y: number }, color: string, radius = 2) => {
          ctx.beginPath();
          ctx.arc(p.x * width, p.y * height, radius, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();
        };

        const metrics = results.rawMetrics;
        // Dibujar pupilas (Rojo / Turquesa según fase)
        drawPoint(metrics.pupilL, '#26A69A', 3.5);
        drawPoint(metrics.pupilR, '#26A69A', 3.5);

        // Dibujar comisuras (Verde / Cyan)
        drawPoint(metrics.corners.LI, '#8AE2D6', 2);
        drawPoint(metrics.corners.LO, '#8AE2D6', 2);
        drawPoint(metrics.corners.RI, '#8AE2D6', 2);
        drawPoint(metrics.corners.RO, '#8AE2D6', 2);
      }
    } else if (pipCanvasRef.current) {
      const ctx = pipCanvasRef.current.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, pipCanvasRef.current.width, pipCanvasRef.current.height);
    }

    // Modo Calibración: Acumulamos samples puros y actualizamos HUD
    if (useAppStore.getState().gamePhase === 'CALIBRATION') {
      if (results && results.rawMetrics) {
        const isBlinking = results.rawMetrics.ear?.isBlinking;

        // Solo acumulamos si el ojo está abierto (Filtro EAR anti-parpadeo)
        if (!isBlinking) {
          addSample(results.rawMetrics);
        }

        // --- LÓGICA DE HEATMAP (FEEDBACK VISUAL APROXIMADO DURANTE CALIBRACIÓN) ---
        const leftCenter = { x: (results.rawMetrics.corners.LO.x + results.rawMetrics.corners.LI.x) / 2, y: (results.rawMetrics.corners.LO.y + results.rawMetrics.corners.LI.y) / 2 };
        const rightCenter = { x: (results.rawMetrics.corners.RO.x + results.rawMetrics.corners.RI.x) / 2, y: (results.rawMetrics.corners.RO.y + results.rawMetrics.corners.RI.y) / 2 };

        const rawPupilL = { x: results.rawMetrics.pupilL.x - leftCenter.x, y: results.rawMetrics.pupilL.y - leftCenter.y };
        const rawPupilR = { x: results.rawMetrics.pupilR.x - rightCenter.x, y: results.rawMetrics.pupilR.y - rightCenter.y };

        const rawX = 0.5 - ((rawPupilL.x + rawPupilR.x) / 2) * 50.0;
        const rawY = 0.5 + ((rawPupilL.y + rawPupilR.y) / 2) * 40.0;

        if (!isBlinking) {
          setHeatmapPos({
            x: smooth({ x: Math.max(0, Math.min(1, rawX)), y: 0 }).x,
            y: smooth({ x: 0, y: Math.max(0, Math.min(1, rawY)) }).y
          });
        }

        if (debugRef.current) {
          debugRef.current.innerText = `STATUS: CALIBRANDO... ${isBlinking ? '👁️ [PARPADEO DETECTADO - Muestra omitida]' : ''}
Rostro: Detectado (Landmarks: ${results.landmarkCount || 0})
EAR: ${results.rawMetrics.ear ? results.rawMetrics.ear.avg.toFixed(3) : 'N/A'}
Yaw: ${(results.rawMetrics.headPose.yaw * (180 / Math.PI)).toFixed(1)}° | Pitch: ${(results.rawMetrics.headPose.pitch * (180 / Math.PI)).toFixed(1)}°`;
        }
      } else if (results && results.rawResultsAvailable) {
        if (debugRef.current) {
          debugRef.current.innerText = `STATUS: ROSTRO DETECTADO (Esperando pupilas)...`;
        }
      }
      return;
    }

    // Modo Juego (Tracking): Usamos el motor de Zhang & Yin + Compensación Glabela
    if (calibrationData && results && results.rawMetrics) {
      if (results.rawMetrics.ear?.isBlinking) {
        return;
      }

      const predictedGaze = predictGazePoint(results.rawMetrics, calibrationData);
      const smoothed = smooth(predictedGaze);
      gazeRef.current = smoothed;

      if (debugRef.current) {
        const r2X = calibrationData.leftModel?.r2X ? (calibrationData.leftModel.r2X * 100).toFixed(0) : 'N/A';
        const r2Y = calibrationData.leftModel?.r2Y ? (calibrationData.leftModel.r2Y * 100).toFixed(0) : 'N/A';

        debugRef.current.innerText = `STATUS: TRACKING ACTIVO (9 Pts OLS + Z-Recalib)
Fidelidad Calibración: R² X: ${r2X}% | R² Y: ${r2Y}%
EAR: ${results.rawMetrics.ear ? results.rawMetrics.ear.avg.toFixed(3) : 'N/A'}
Yaw: ${(results.rawMetrics.headPose.yaw * (180 / Math.PI)).toFixed(1)}° | Pitch: ${(results.rawMetrics.headPose.pitch * (180 / Math.PI)).toFixed(1)}°
Gaze X: ${predictedGaze.x.toFixed(3)} | Y: ${predictedGaze.y.toFixed(3)}`;
      }
    }
  }, [smooth, calibrationData, addSample]);

  const { processVideoFrame, isReady, isLoaded } = useMediaPipeWorker(handleWorkerResults);

  // 2. Bucle de Captura del Video (Loop Principal)
  const captureLoop = useCallback(() => {
    if (videoRef.current && isStreaming && isReady()) {
      processVideoFrame(videoRef.current, performance.now());
    }
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
    <div className={`min-h-screen ${isPreCalibrating ? 'bg-[#F3FAFF] text-[#1C2A39] p-6 lg:p-12' : 'bg-[#000000] text-white p-8'} flex flex-col items-center justify-center relative transition-colors duration-300 font-sans`}>
      
      {/* VISTA 1: CALIBRACIÓN PREVIA Y CONDICIONES (MOCKUP EXACTO) */}
      {isPreCalibrating ? (
        <PreCalibrationView
          videoRef={videoRef}
          pipCanvasRef={pipCanvasRef}
          isStreaming={isStreaming}
          onStartCalibration={startCalibration}
          onRetryCamera={(deviceId?: string) => {
            stopWebcam();
            startWebcam(deviceId);
          }}
          rawMetricsRef={rawMetricsRef}
          fps={60}
        />
      ) : (
        /* VISTA 2: CALIBRACIÓN DE 9 PUNTOS / JUEGO ACTIVO */
        <>
          {/* HUD Superior Minimalista */}
          <div className="absolute top-4 left-6 right-6 flex justify-between items-center text-white/80 z-40">
            <h2 className="text-xl font-bold tracking-tight text-[#26A69A]">NeuroVisión Terapia</h2>
            {!isLoaded && <span className="text-xs bg-white/10 px-3 py-1 rounded-full animate-pulse">Cargando Motores de IA...</span>}
            {error && <span className="text-xs bg-red-900/60 text-red-200 px-3 py-1 rounded-full">{error}</span>}
          </div>

          {/* PIP Video flotante abajo a la derecha */}
          <div className="fixed bottom-4 right-4 z-50 w-48 h-36 rounded-xl overflow-hidden shadow-2xl border-2 border-white/20 bg-black">
            <video 
              ref={videoRef} 
              className="w-full h-full object-cover -scale-x-100 opacity-90" 
              playsInline 
              muted 
              autoPlay
            />
            <canvas 
              ref={pipCanvasRef}
              width={192}
              height={144}
              className="absolute inset-0 w-full h-full -scale-x-100 pointer-events-none"
            />
          </div>

          {/* HUD Telemetría flotante abajo a la izquierda */}
          <div className="fixed bottom-4 left-4 bg-black/80 backdrop-blur-xs border border-white/10 text-[#8AE2D6] p-3.5 rounded-xl font-mono text-xs shadow-xl z-50 pointer-events-none">
            <pre ref={debugRef} className="m-0 leading-tight">
              Iniciando telemetría...
            </pre>
          </div>

          {/* Overlay de los 9 Puntos de Calibración */}
          {gamePhase === 'CALIBRATION' && (
            <>
              <CalibrationOverlay />
              {/* Heatmap Visualizador en tiempo real */}
              <div
                className="absolute w-28 h-28 rounded-full pointer-events-none z-100 transition-transform duration-75"
                style={{
                  left: `${heatmapPos.x * 100}%`,
                  top: `${heatmapPos.y * 100}%`,
                  transform: 'translate(-50%, -50%)',
                  background: 'radial-gradient(circle, rgba(38, 166, 154, 0.6) 0%, rgba(38, 166, 154, 0) 70%)',
                  filter: 'blur(6px)'
                }}
              />
            </>
          )}

          {/* Motor Gráfico del Juego (Serious Games) */}
          <div className="w-full max-w-5xl aspect-video relative z-20">
            <EyeTrackingGameCanvas
              gazeRef={gazeRef}
              prescription={prescription}
              gamePhase={gamePhase}
              onPhaseChange={setGamePhase}
              width={1024}
              height={576}
            />
          </div>
        </>
      )}

    </div>
  );
};
