import { create } from 'zustand';
import type { RawMetrics, CalibrationData, Point2D } from '../../infrastructure/cv/math/zhangYinModel';

export const CALIBRATION_POINTS: Point2D[] = [
  { x: 0.5, y: 0.5 }, // 1. Centro (Usado como base para IPD y Offset)
  { x: 0.5, y: 0.1 }, // 2. Centro Arriba
  { x: 0.1, y: 0.5 }, // 3. Centro Izquierda
  { x: 0.5, y: 0.9 }, // 4. Centro Abajo
  { x: 0.9, y: 0.5 }, // 5. Centro Derecha
  { x: 0.1, y: 0.1 }, // 6. Esquina Sup. Izquierda
  { x: 0.9, y: 0.1 }, // 7. Esquina Sup. Derecha
  { x: 0.1, y: 0.9 }, // 8. Esquina Inf. Izquierda
  { x: 0.9, y: 0.9 }  // 9. Esquina Inf. Derecha
];

interface CalibrationState {
  isPreCalibrating: boolean;
  isCalibrating: boolean;
  currentPointIndex: number;
  rawSamples: RawMetrics[];
  processedMetrics: RawMetrics[];
  calibrationData: CalibrationData | null;
  
  startPreCalibration: () => void;
  startCalibration: () => void;
  addSample: (sample: RawMetrics) => void;
  nextPoint: (processed: RawMetrics) => void;
  completeCalibration: (data: CalibrationData) => void;
  reset: () => void;
}

export const useCalibrationStore = create<CalibrationState>((set) => ({
  isPreCalibrating: true, // Empieza en la pantalla de pre-calibración por defecto
  isCalibrating: false,
  currentPointIndex: 0,
  rawSamples: [],
  processedMetrics: [],
  calibrationData: null,

  startPreCalibration: () => set({
    isPreCalibrating: true,
    isCalibrating: false,
    calibrationData: null
  }),

  startCalibration: () => set({ 
    isPreCalibrating: false,
    isCalibrating: true, 
    currentPointIndex: 0, 
    rawSamples: [], 
    processedMetrics: [],
    calibrationData: null
  }),
  
  addSample: (sample) => set((state) => ({
    rawSamples: [...state.rawSamples, sample]
  })),

  nextPoint: (processed) => set((state) => ({
    processedMetrics: [...state.processedMetrics, processed],
    currentPointIndex: state.currentPointIndex + 1,
    rawSamples: [] // Limpiar para el siguiente punto
  })),

  completeCalibration: (data) => set({
    isCalibrating: false,
    calibrationData: data,
    rawSamples: []
  }),

  reset: () => set({
    isCalibrating: false,
    currentPointIndex: 0,
    rawSamples: [],
    processedMetrics: [],
    calibrationData: null
  })
}));
