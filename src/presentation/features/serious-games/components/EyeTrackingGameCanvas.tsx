import React, { useRef, useEffect, useCallback, useState } from 'react';
import type { MedicalPrescription } from '../../../../core/domain/Prescription';
import type { GamePhase } from '../../../../core/store/useAppStore';
import { 
  type TrajectoryPoint, 
  type ClinicalEvaluationReport,
  generateClinicalReport 
} from '../../../../infrastructure/cv/math/clinicalMetrics';
import { Award, CheckCircle, Activity, Clock, RotateCcw, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export interface Point2D {
  x: number;
  y: number;
}

export interface EyeTrackingGameCanvasProps {
  gazeRef: React.MutableRefObject<Point2D>;
  prescription: MedicalPrescription;
  gamePhase: GamePhase;
  onPhaseChange: (newPhase: GamePhase) => void;
  width?: number;
  height?: number;
}

interface TargetNode {
  x: number;
  y: number;
  radius: number;
  color: string;
  dwellTimeMs: number;
}

export const EyeTrackingGameCanvas: React.FC<EyeTrackingGameCanvasProps> = ({ 
  gazeRef, 
  prescription,
  gamePhase,
  onPhaseChange,
  width = 800, 
  height = 600 
}) => {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const trajectoryRef = useRef<TrajectoryPoint[]>([]);
  const [report, setReport] = useState<ClinicalEvaluationReport | null>(null);
  
  // Parámetros Dinámicos desde la Receta Médica
  const { min_fixation_time, visual_field_amplitude } = prescription.parameters;
  
  // Coordenadas de los 9 puntos para la Calibración disfrazada
  const CALIBRATION_GRID = [
    { x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1 }, { x: 0.9, y: 0.1 },
    { x: 0.1, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.9, y: 0.5 },
    { x: 0.1, y: 0.9 }, { x: 0.5, y: 0.9 }, { x: 0.9, y: 0.9 },
  ];

  const TARGET_GOAL = 8; // Número de objetivos para completar la sesión de prueba

  const gameState = useRef({
    score: 0,
    calibrationIndex: 0,
    currentTarget: {
      x: width / 2,
      y: height / 2,
      radius: 40,
      color: '#FFFF00', 
      dwellTimeMs: 0
    } as TargetNode,
  });

  const finishSession = useCallback(() => {
    const finalReport = generateClinicalReport(trajectoryRef.current, width, height, 40 / Math.hypot(width, height));
    setReport(finalReport);
    onPhaseChange('FINISHED');
  }, [width, height, onPhaseChange]);

  const spawnGameTarget = useCallback(() => {
    const margin = 50;
    // Aplicamos visual_field_amplitude: reduce el área jugable según la receta
    const activeWidth = (width - margin * 2) * visual_field_amplitude;
    const activeHeight = (height - margin * 2) * visual_field_amplitude;
    
    // Centramos el área activa
    const offsetX = (width - activeWidth) / 2;
    const offsetY = (height - activeHeight) / 2;

    gameState.current.currentTarget = {
      x: offsetX + Math.random() * activeWidth,
      y: offsetY + Math.random() * activeHeight,
      radius: 40,
      color: '#FFFF00',
      dwellTimeMs: 0
    };
  }, [width, height, visual_field_amplitude]);

  const spawnTutorialTarget = useCallback(() => {
    const idx = gameState.current.calibrationIndex;
    if (idx >= CALIBRATION_GRID.length) {
      // Tutorial Completado silenciosamente. Iniciamos el juego real.
      onPhaseChange('MAIN_GAME');
      trajectoryRef.current = [];
      spawnGameTarget();
      return;
    }
    
    const point = CALIBRATION_GRID[idx];
    gameState.current.currentTarget = {
      x: point.x * width,
      y: point.y * height,
      radius: 50, // Más grande para el tutorial
      color: '#00FFFF', // Color "Magia" para el tutorial
      dwellTimeMs: 0
    };
  }, [width, height, onPhaseChange, spawnGameTarget]);

  // Inicializar objetivo según la fase
  useEffect(() => {
    if (gamePhase === 'TUTORIAL_CALIBRATION') {
      gameState.current.calibrationIndex = 0;
      trajectoryRef.current = [];
      setReport(null);
      spawnTutorialTarget();
    } else if (gamePhase === 'MAIN_GAME') {
      trajectoryRef.current = [];
      setReport(null);
      spawnGameTarget();
    }
  }, [gamePhase, spawnTutorialTarget, spawnGameTarget]);

  const renderLoop = useCallback((time: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const deltaTime = time - lastTimeRef.current;
    lastTimeRef.current = time;

    ctx.fillStyle = '#000000'; 
    ctx.fillRect(0, 0, width, height);

    const cursorX = gazeRef.current.x * width;
    const cursorY = gazeRef.current.y * height;
    
    const state = gameState.current;
    const target = state.currentTarget;

    const dist = Math.hypot(target.x - cursorX, target.y - cursorY);
    const isHovering = dist < target.radius * 1.5; 

    // Registro continuo de trayectorias clínicas (Vidhya & Resende Faria, 2025)
    if (gamePhase === 'MAIN_GAME') {
      trajectoryRef.current.push({
        timestamp: time,
        gaze: { x: gazeRef.current.x, y: gazeRef.current.y },
        target: { x: target.x / width, y: target.y / height }
      });
    }

    if (isHovering) {
      target.dwellTimeMs += deltaTime;
      target.color = '#FFFFFF'; 
      
      if (target.dwellTimeMs >= min_fixation_time) {
        if (gamePhase === 'TUTORIAL_CALIBRATION') {
          state.calibrationIndex += 1;
          spawnTutorialTarget();
        } else {
          state.score += 1;
          if (state.score >= TARGET_GOAL) {
            finishSession();
            return;
          }
          spawnGameTarget();
        }
      }
    } else {
      target.dwellTimeMs = Math.max(0, target.dwellTimeMs - deltaTime * 2);
      target.color = gamePhase === 'TUTORIAL_CALIBRATION' ? '#00FFFF' : '#FFFF00';
    }

    // Dibujar Objetivo
    ctx.beginPath();
    ctx.arc(target.x, target.y, target.radius, 0, Math.PI * 2);
    ctx.fillStyle = target.color;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();

    // Dibujar anillo de progreso
    if (target.dwellTimeMs > 0) {
      const progressRatio = Math.min(1, target.dwellTimeMs / min_fixation_time);
      ctx.beginPath();
      ctx.arc(target.x, target.y, target.radius + 15, -Math.PI / 2, (-Math.PI / 2) + (Math.PI * 2 * progressRatio));
      ctx.strokeStyle = gamePhase === 'TUTORIAL_CALIBRATION' ? '#00FFFF' : '#FFFF00';
      ctx.lineWidth = 6;
      ctx.stroke();
    }

    // Cursor (Para debugging clínico)
    ctx.beginPath();
    ctx.arc(cursorX, cursorY, 10, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.fill();

    // Texto de HUD
    ctx.font = 'bold 20px Inter, sans-serif';
    ctx.fillStyle = '#FFFFFF';
    if (gamePhase === 'TUTORIAL_CALIBRATION') {
      ctx.fillText(`Calentamiento: ¡Sigue la luz mágica! (${state.calibrationIndex}/9)`, 20, 36);
    } else if (gamePhase === 'MAIN_GAME') {
      ctx.fillText(`Objetivos: ${state.score} / ${TARGET_GOAL}`, 20, 36);
      
      // Métrica Instantánea en Píxeles
      ctx.font = '14px monospace';
      ctx.fillStyle = '#26A69A';
      ctx.fillText(`Error Distancia: ${Math.round(dist)} px`, 20, 60);
    }

    if (gamePhase !== 'FINISHED') {
      requestRef.current = requestAnimationFrame(renderLoop);
    }
  }, [width, height, gamePhase, min_fixation_time, spawnTutorialTarget, spawnGameTarget, finishSession]);

  useEffect(() => {
    if (gamePhase !== 'FINISHED') {
      requestRef.current = requestAnimationFrame(renderLoop);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [renderLoop, gamePhase]);

  return (
    <div className="relative flex justify-center items-center rounded-2xl overflow-hidden border-4 border-neutral/30 shadow-2xl transition-all">
      <canvas 
        ref={canvasRef} 
        width={width} 
        height={height}
        className="block bg-hc-black"
        style={{ touchAction: 'none' }}
      />

      {/* Botón flotante para terminar antes de tiempo si el paciente se cansa */}
      {gamePhase === 'MAIN_GAME' && (
        <button
          onClick={finishSession}
          className="absolute top-4 right-4 px-4 py-2 bg-neutral/80 hover:bg-neutral text-white text-sm font-semibold rounded-lg shadow-md transition-colors"
        >
          Finalizar Ejercicio
        </button>
      )}

      {/* Overlay de Resultados Clínicos (Vidhya & Resende Faria, 2025) */}
      {gamePhase === 'FINISHED' && report && (
        <div className="absolute inset-0 bg-primary/95 text-white flex flex-col items-center justify-center p-8 z-30 animate-in fade-in duration-300">
          <div className="bg-bgSecondary/10 border border-white/20 rounded-2xl p-8 max-w-xl w-full text-center shadow-2xl backdrop-blur-sm">
            <div className="flex justify-center mb-4">
              <Award className="text-secondary w-16 h-16" />
            </div>
            
            <h2 className="text-3xl font-bold mb-2">¡Sesión Terapéutica Completada!</h2>
            <p className="text-neutral/80 text-sm mb-6">
              Métricas computadas según modelos de evaluación oculomotora continua (MAD, RMSE, DTW).
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8 text-left">
              {/* Precisión Global */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <div className="flex items-center text-secondary text-xs font-semibold mb-1">
                  <CheckCircle size={14} className="mr-1" /> Precisión Global
                </div>
                <div className="text-2xl font-bold text-white">{report.accuracyScore}%</div>
              </div>

              {/* MAD */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <div className="flex items-center text-tertiary text-xs font-semibold mb-1">
                  <Activity size={14} className="mr-1" /> Error MAD
                </div>
                <div className="text-xl font-bold text-white">{report.madPixels} px</div>
                <div className="text-[10px] text-neutral/70">{(report.madNormalized * 100).toFixed(1)}% pantalla</div>
              </div>

              {/* RMSE */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <div className="flex items-center text-blue-400 text-xs font-semibold mb-1">
                  <Activity size={14} className="mr-1" /> Error RMSE
                </div>
                <div className="text-xl font-bold text-white">{report.rmsePixels} px</div>
                <div className="text-[10px] text-neutral/70">Varianza espacial</div>
              </div>

              {/* DTW */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <div className="flex items-center text-purple-400 text-xs font-semibold mb-1">
                  <Activity size={14} className="mr-1" /> DTW Score
                </div>
                <div className="text-xl font-bold text-white">{(report.dtwDistance * 100).toFixed(1)}</div>
                <div className="text-[10px] text-neutral/70">Fidelidad de ruta</div>
              </div>

              {/* Estabilidad */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <div className="flex items-center text-green-400 text-xs font-semibold mb-1">
                  <CheckCircle size={14} className="mr-1" /> Fijación Foveal
                </div>
                <div className="text-xl font-bold text-white">{report.fixationStability}%</div>
                <div className="text-[10px] text-neutral/70">Tiempo en blanco</div>
              </div>

              {/* Duración */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <div className="flex items-center text-yellow-400 text-xs font-semibold mb-1">
                  <Clock size={14} className="mr-1" /> Duración
                </div>
                <div className="text-xl font-bold text-white">{(report.durationMs / 1000).toFixed(1)} s</div>
                <div className="text-[10px] text-neutral/70">{report.totalSamples} muestras</div>
              </div>
            </div>

            {/* Acciones */}
            <div className="flex space-x-4">
              <button
                onClick={() => onPhaseChange('TUTORIAL_CALIBRATION')}
                className="flex-1 py-3 bg-white/10 hover:bg-white/20 rounded-xl font-bold flex items-center justify-center space-x-2 transition-all border border-white/20"
              >
                <RotateCcw size={18} />
                <span>Repetir</span>
              </button>

              <button
                onClick={() => navigate('/patient/dashboard')}
                className="flex-1 py-3 bg-secondary hover:bg-secondary/80 rounded-xl font-bold flex items-center justify-center space-x-2 transition-all shadow-lg"
              >
                <ArrowLeft size={18} />
                <span>Ir al Dashboard</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

