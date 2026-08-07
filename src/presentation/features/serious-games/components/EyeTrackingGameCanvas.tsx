import React, { useRef, useEffect, useCallback } from 'react';
import { MedicalPrescription } from '../../../../core/domain/Prescription';
import { GamePhase } from '../../../../core/store/useAppStore';

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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>();
  const lastTimeRef = useRef<number>(0);
  
  // Parámetros Dinámicos desde la Receta Médica
  const { min_fixation_time, visual_field_amplitude } = prescription.parameters;
  
  // Coordenadas de los 9 puntos para la Calibración disfrazada
  const CALIBRATION_GRID = [
    { x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1 }, { x: 0.9, y: 0.1 },
    { x: 0.1, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.9, y: 0.5 },
    { x: 0.1, y: 0.9 }, { x: 0.5, y: 0.9 }, { x: 0.9, y: 0.9 },
  ];

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
      spawnTutorialTarget();
    } else if (gamePhase === 'MAIN_GAME') {
      spawnGameTarget();
    }
  }, [gamePhase, spawnTutorialTarget, spawnGameTarget]);

  const renderLoop = useCallback((time: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !ctx) return;
    var ctx = canvas.getContext('2d');
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

    if (isHovering) {
      target.dwellTimeMs += deltaTime;
      target.color = '#FFFFFF'; 
      
      if (target.dwellTimeMs >= min_fixation_time) {
        if (gamePhase === 'TUTORIAL_CALIBRATION') {
          // En background, aquí se guardarían los vectores de anclaje para la calibración neuronal.
          state.calibrationIndex += 1;
          spawnTutorialTarget();
        } else {
          state.score += 1;
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
    ctx.font = 'bold 24px Inter, sans-serif';
    ctx.fillStyle = '#FFFFFF';
    if (gamePhase === 'TUTORIAL_CALIBRATION') {
      ctx.fillText(`Calentamiento: ¡Sigue la luz mágica! (${state.calibrationIndex}/9)`, 20, 40);
    } else {
      ctx.fillText(`Puntuación: ${state.score}`, 20, 40);
    }

    requestRef.current = requestAnimationFrame(renderLoop);
  }, [width, height, gamePhase, min_fixation_time, spawnTutorialTarget, spawnGameTarget]);

  useEffect(() => {
    requestRef.current = requestAnimationFrame(renderLoop);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [renderLoop]);

  return (
    <div className="flex justify-center items-center rounded-2xl overflow-hidden border-4 border-hc-gray shadow-2xl transition-all">
      <canvas 
        ref={canvasRef} 
        width={width} 
        height={height}
        className="block bg-hc-black"
        style={{ touchAction: 'none' }}
      />
    </div>
  );
};
