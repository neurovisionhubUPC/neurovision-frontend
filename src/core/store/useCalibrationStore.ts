import { create } from 'zustand';
import type { RawMetrics, CalibrationData, Point2D } from '../../infrastructure/cv/math/zhangYinModel';

export const CALIBRATION_POINTS: Point2D[] = [
  { x: 0.5, y: 0.5 }, // Centro
  { x: 0.5, y: 0.1 }, // Arriba
  { x: 0.1, y: 0.5 }, // Izquierda
  { x: 0.5, y: 0.9 }, // Abajo
  { x: 0.9, y: 0.5 }, // Derecha
];

interface CalibrationState {
  isCalibrating: boolean;
  currentPointIndex: number;
  rawSamples: RawMetrics[];
  processedMetrics: RawMetrics[]; // Guarda el resultado promediado de cada punto
  calibrationData: CalibrationData | null;
  
  startCalibration: () => void;
  addSample: (sample: RawMetrics) => void;
  nextPoint: (processed: RawMetrics) => void;
  completeCalibration: (data: CalibrationData) => void;
  reset: () => void;
}

export const useCalibrationStore = create<CalibrationState>((set) => ({
  isCalibrating: false,
  currentPointIndex: 0,
  rawSamples: [],
  processedMetrics: [],
  calibrationData: null,

  startCalibration: () => set({ 
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
