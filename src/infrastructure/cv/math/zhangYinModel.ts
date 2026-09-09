import { 
  applyGlabellaCompensation, 
  fitLinearRegression, 
  applyZIndexRecalibration,
  type DecoupledModel 
} from './gazeEnhancements';

export interface Point2D { x: number; y: number; }
export interface Point3D { x: number; y: number; z: number; }

export interface RawMetrics {
  pupilL: Point3D;
  pupilR: Point3D;
  corners: {
    LO: Point3D; // Left Outer
    LI: Point3D; // Left Inner
    RI: Point3D; // Right Inner
    RO: Point3D; // Right Outer
  };
  glabella?: Point3D;
  irisDiameter?: number;
  ear?: {
    left: number;
    right: number;
    avg: number;
    isBlinking: boolean;
  };
  headPose: { yaw: number; pitch: number; roll: number; };
}

export interface CalibrationData {
  Ls: Point2D; // Coeficientes de escala Izquierdo
  Rs: Point2D; // Coeficientes de escala Derecho
  leftModel?: DecoupledModel; // Modelo desacoplado X/Y ojo izquierdo
  rightModel?: DecoupledModel; // Modelo desacoplado X/Y ojo derecho
  theta0: number; // Yaw base (C1)
  beta0: number;  // Pitch base (C1)
  IPD0: number;   // Inter-Pupillary Distance base (C1)
  baselineGlabella?: Point2D; // Glabela base (C1 - Chhimpa et al., 2024)
  baselineIrisDiameter?: number; // Diámetro medio del iris base (C1)
  Lc: Point2D; // Benchmark del centro ojo Izquierdo
  Rc: Point2D; // Benchmark del centro ojo Derecho
  cornersBenchmark: {
    LI: Point2D; LO: Point2D; RI: Point2D; RO: Point2D;
  };
}

/**
 * Filtra los samples descartando el 75% inicial (aprox 1.5s de 2s) y promediando matemáticamente el 25% final.
 * @param samples Colección de métricas capturadas durante los 2 segundos.
 */
export function processFixationSamples(samples: RawMetrics[]): RawMetrics | null {
  if (samples.length < 1) return null;

  // 1. Filtrado de parpadeos: Descartar muestras corruptas por cierre palpebral (EAR < 0.20)
  const nonBlinking = samples.filter(s => !s.ear?.isBlinking);
  const candidateSamples = nonBlinking.length > 0 ? nonBlinking : samples;

  // 2. Descarte de latencia inicial: conservar el último 25% (o última muestra si hay pocas)
  const discardCount = candidateSamples.length > 3 ? Math.floor(candidateSamples.length * 0.75) : candidateSamples.length - 1; 
  const validSamples = candidateSamples.slice(discardCount);
  
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  const glabellaSamples = validSamples.filter(s => s.glabella);
  const avgGlabella = glabellaSamples.length > 0 ? {
    x: avg(glabellaSamples.map(s => s.glabella!.x)),
    y: avg(glabellaSamples.map(s => s.glabella!.y)),
    z: avg(glabellaSamples.map(s => s.glabella!.z))
  } : undefined;

  const irisSamples = validSamples.filter(s => typeof s.irisDiameter === 'number');
  const avgIrisDiameter = irisSamples.length > 0 ? avg(irisSamples.map(s => s.irisDiameter!)) : undefined;

  return {
    pupilL: {
      x: avg(validSamples.map(s => s.pupilL.x)),
      y: avg(validSamples.map(s => s.pupilL.y)),
      z: avg(validSamples.map(s => s.pupilL.z))
    },
    pupilR: {
      x: avg(validSamples.map(s => s.pupilR.x)),
      y: avg(validSamples.map(s => s.pupilR.y)),
      z: avg(validSamples.map(s => s.pupilR.z))
    },
    corners: {
      LO: { x: avg(validSamples.map(s => s.corners.LO.x)), y: avg(validSamples.map(s => s.corners.LO.y)), z: 0 },
      LI: { x: avg(validSamples.map(s => s.corners.LI.x)), y: avg(validSamples.map(s => s.corners.LI.y)), z: 0 },
      RI: { x: avg(validSamples.map(s => s.corners.RI.x)), y: avg(validSamples.map(s => s.corners.RI.y)), z: 0 },
      RO: { x: avg(validSamples.map(s => s.corners.RO.x)), y: avg(validSamples.map(s => s.corners.RO.y)), z: 0 },
    },
    glabella: avgGlabella,
    irisDiameter: avgIrisDiameter,
    headPose: {
      yaw: avg(validSamples.map(s => s.headPose.yaw)),
      pitch: avg(validSamples.map(s => s.headPose.pitch)),
      roll: avg(validSamples.map(s => s.headPose.roll))
    }
  };
}

/**
 * Calcula los coeficientes de escala y el modelo desacoplado X / Y (Chhimpa et al., 2024; Zhang & Yin, 2025)
 * a partir de los 9 puntos estandarizados de calibración (Centro, 4 bordes cardinales, 4 esquinas).
 * @param calibMetrics Array de métricas procesadas (hasta 9 puntos).
 * @param screenPoints Puntos de la pantalla en espacio normalizado [0, 1].
 */
export function computeCalibrationData(calibMetrics: RawMetrics[], screenPoints: Point2D[]): CalibrationData {
  const c1 = calibMetrics[0];

  // Utilidad para extraer la posición relativa de la pupila (aislando el movimiento de la cabeza)
  const getRelL = (m: RawMetrics) => ({
    x: m.pupilL.x - (m.corners.LO.x + m.corners.LI.x) / 2,
    y: m.pupilL.y - (m.corners.LO.y + m.corners.LI.y) / 2
  });
  
  const getRelR = (m: RawMetrics) => ({
    x: m.pupilR.x - (m.corners.RO.x + m.corners.RI.x) / 2,
    y: m.pupilR.y - (m.corners.RO.y + m.corners.RI.y) / 2
  });

  // Extraemos las coordenadas relativas de todos los puntos recogidos (hasta 9)
  const relsL = calibMetrics.map(getRelL);
  const relsR = calibMetrics.map(getRelR);

  const targetsX = screenPoints.slice(0, calibMetrics.length).map(p => p.x);
  const targetsY = screenPoints.slice(0, calibMetrics.length).map(p => p.y);

  // Regresión Desacoplada por Ejes (Chhimpa et al., 2024)
  // El eje Y se aísla por completo del eje X para evitar que la caída del párpado superior contamine X.
  const regLX = fitLinearRegression(relsL.map(r => r.x), targetsX);
  const regLY = fitLinearRegression(relsL.map(r => r.y), targetsY);

  const regRX = fitLinearRegression(relsR.map(r => r.x), targetsX);
  const regRY = fitLinearRegression(relsR.map(r => r.y), targetsY);

  // Sanitización de Coeficientes
  // Aumentamos el rango de clamp [10, 500] para pantallas pequeñas (13") donde el ojo se desplaza escasos píxeles.
  const clamp = (val: number, min = 10, max = 500) => {
    if (isNaN(val) || !isFinite(val)) return 50; 
    return Math.max(min, Math.min(max, Math.abs(val))) * Math.sign(val);
  };

  // En la proyección en espejo, el valor absoluto de la pendiente representa la sensibilidad
  let LsX = clamp(Math.abs(regLX.slope) > 0.1 ? Math.abs(regLX.slope) : 50);
  let LsY = clamp(Math.abs(regLY.slope) > 0.1 ? Math.abs(regLY.slope) : 50);
  let RsX = clamp(Math.abs(regRX.slope) > 0.1 ? Math.abs(regRX.slope) : 50);
  let RsY = clamp(Math.abs(regRY.slope) > 0.1 ? Math.abs(regRY.slope) : 50);

  const IPD0 = Math.hypot(c1.pupilR.x - c1.pupilL.x, c1.pupilR.y - c1.pupilL.y);

  // Benchmarks del Centro (Punto 1)
  return {
    Ls: { x: LsX, y: LsY },
    Rs: { x: RsX, y: RsY },
    leftModel: {
      slopeX: regLX.slope,
      interceptX: regLX.intercept,
      slopeY: regLY.slope,
      interceptY: regLY.intercept,
      r2X: regLX.r2,
      r2Y: regLY.r2
    },
    rightModel: {
      slopeX: regRX.slope,
      interceptX: regRX.intercept,
      slopeY: regRY.slope,
      interceptY: regRY.intercept,
      r2X: regRX.r2,
      r2Y: regRY.r2
    },
    theta0: c1.headPose.yaw,
    beta0: c1.headPose.pitch,
    IPD0: IPD0,
    baselineGlabella: c1.glabella ? { x: c1.glabella.x, y: c1.glabella.y } : undefined,
    baselineIrisDiameter: c1.irisDiameter || 0,
    Lc: { x: c1.pupilL.x, y: c1.pupilL.y },
    Rc: { x: c1.pupilR.x, y: c1.pupilR.y },
    cornersBenchmark: {
      LI: { x: c1.corners.LI.x, y: c1.corners.LI.y },
      LO: { x: c1.corners.LO.x, y: c1.corners.LO.y },
      RI: { x: c1.corners.RI.x, y: c1.corners.RI.y },
      RO: { x: c1.corners.RO.x, y: c1.corners.RO.y }
    }
  };
}

// Variables temporales para mantener la dinámica de la cabeza
let currentH: Point2D = { x: 0.5, y: 0.5 };
let currentLcStar: Point2D = { x: 0, y: 0 };
let currentRcStar: Point2D = { x: 0, y: 0 };
let lastTheta = 0;
let lastBeta = 0;

export function initializeTrackingState(calib: CalibrationData) {
  currentH = { x: 0.5, y: 0.5 }; // Centro de pantalla
  currentLcStar = { ...calib.Lc };
  currentRcStar = { ...calib.Rc };
  lastTheta = calib.theta0;
  lastBeta = calib.beta0;
}

/**
 * Bucle Adaptativo de Inferencia en Tiempo Real
 */
export function predictGazePoint(currentMetrics: RawMetrics, calib: CalibrationData): Point2D {
  const { yaw: thetaAct, pitch: betaAct } = currentMetrics.headPose;
  
  // Umbral de 2 grados (en radianes: 2 * Math.PI / 180 = ~0.0349)
  const threshold = (2 * Math.PI) / 180;
  const deltaYaw = Math.abs(thetaAct - lastTheta);
  const deltaPitch = Math.abs(betaAct - lastBeta);
  
  // Constante de proyección (ahora dinámica basada en la profundidad IPD)
  const IPD_act = Math.hypot(currentMetrics.pupilR.x - currentMetrics.pupilL.x, currentMetrics.pupilR.y - currentMetrics.pupilL.y);
  const IPD_ratio = calib.IPD0 / (IPD_act || 0.0001); // Evitar div 0
  const d_act = 2.0 * IPD_ratio; 
  
  let dx = 0, dy = 0;
  
  if (deltaYaw > threshold || deltaPitch > threshold) {
    // Paso B: Cálculo del Head-Pointing
    if (Math.abs(deltaYaw) > threshold) {
        dx = d_act * (Math.tan(thetaAct) - Math.tan(calib.theta0));
    }
    if (Math.abs(deltaPitch) > threshold) {
        dy = d_act * (Math.tan(betaAct) - Math.tan(calib.beta0));
    }
    
    // O(x,y) = Centro de pantalla = 0.5
    // En screen coords, yaw positivo -> mirada a la derecha (x aumenta)
    // Pitch positivo -> mirar arriba (y disminuye)
    currentH = { x: 0.5 - dx, y: 0.5 - dy };

    // Paso C: Actualización Dinámica de Benchmarks Pupilares (Lc*, Rc*)
    const { corners } = currentMetrics;
    const { cornersBenchmark: cb } = calib;
    
    const deltaL_x = (corners.LI.x - cb.LI.x + corners.LO.x - cb.LO.x) / 2;
    const deltaL_y = (corners.LI.y - cb.LI.y + corners.LO.y - cb.LO.y) / 2;
    currentLcStar = { x: calib.Lc.x + deltaL_x, y: calib.Lc.y + deltaL_y };

    const deltaR_x = (corners.RI.x - cb.RI.x + corners.RO.x - cb.RO.x) / 2;
    const deltaR_y = (corners.RI.y - cb.RI.y + corners.RO.y - cb.RO.y) / 2;
    currentRcStar = { x: calib.Rc.x + deltaR_x, y: calib.Rc.y + deltaR_y };

    // Update last pose state
    lastTheta = thetaAct;
    lastBeta = betaAct;
  }

  // Paso D: Predicción y Proyección del Gaze Point
  const { pupilL, pupilR } = currentMetrics;
  
  // Vector de desviación
  const Lb = { x: pupilL.x - currentLcStar.x, y: pupilL.y - currentLcStar.y };
  const Rb = { x: pupilR.x - currentRcStar.x, y: pupilR.y - currentRcStar.y };

  // Proyección de la mirada de cada ojo
  const LG = { 
    x: currentH.x - (Lb.x * calib.Ls.x), 
    y: currentH.y + (Lb.y * calib.Ls.y) 
  };
  const RG = { 
    x: currentH.x - (Rb.x * calib.Rs.x), 
    y: currentH.y + (Rb.y * calib.Rs.y) 
  };

  // Punto final combinado
  const combinedGaze = {
    x: Math.max(0, Math.min(1, (LG.x + RG.x) / 2)),
    y: Math.max(0, Math.min(1, (LG.y + RG.y) / 2))
  };

  // Compensación Cefálica Rápida por Glabela (Chhimpa et al., 2024)
  let compensated = combinedGaze;
  if (currentMetrics.glabella && calib.baselineGlabella) {
    compensated = applyGlabellaCompensation(combinedGaze, currentMetrics.glabella, calib.baselineGlabella, 1.15);
  }

  // Re-Calibración Dinámica en Eje Z (Chhimpa et al., 2024)
  const zRecalibrated = applyZIndexRecalibration(
    compensated,
    currentMetrics,
    {
      baselineIPD: calib.IPD0,
      baselineIrisDiameter: calib.baselineIrisDiameter,
      screenMidpoint: { x: 0.5, y: 0.5 }
    }
  );

  return zRecalibrated;
}
