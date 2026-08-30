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
  headPose: { yaw: number; pitch: number; roll: number; };
}

export interface CalibrationData {
  Ls: Point2D; // Coeficientes de escala Izquierdo
  Rs: Point2D; // Coeficientes de escala Derecho
  theta0: number; // Yaw base (C1)
  beta0: number;  // Pitch base (C1)
  IPD0: number;   // Inter-Pupillary Distance base (C1)
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
  // Para evitar que el sistema se quede atascado en PCs lentas, aceptaremos incluso 1 muestra.
  if (samples.length < 1) return null;

  // Descartamos el 75% inicial, pero si solo hay 1 a 3 muestras, conservamos la última.
  const discardCount = samples.length > 3 ? Math.floor(samples.length * 0.75) : samples.length - 1; 
  const validSamples = samples.slice(discardCount);
  
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

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
    headPose: {
      yaw: avg(validSamples.map(s => s.headPose.yaw)),
      pitch: avg(validSamples.map(s => s.headPose.pitch)),
      roll: avg(validSamples.map(s => s.headPose.roll))
    }
  };
}

/**
 * Calcula los coeficientes de escala a partir de los 5 puntos estandarizados.
 * C1=Centro, C2=Arriba, C3=Izq, C4=Abajo, C5=Der.
 * @param calibMetrics Array ordenado de 5 métricas procesadas (C1 a C5).
 * @param screenPoints Puntos de la pantalla en espacio normalizado [0, 1].
 */
export function computeCalibrationData(calibMetrics: RawMetrics[], screenPoints: Point2D[]): CalibrationData {
  const [c1, c2, c3, c4, c5] = calibMetrics;
  const [, p2, p3, p4, p5] = screenPoints; 

  // Utilidad para extraer la posición relativa de la pupila (aislando el movimiento de la cabeza)
  const getRelL = (m: RawMetrics) => ({
    x: m.pupilL.x - (m.corners.LO.x + m.corners.LI.x) / 2,
    y: m.pupilL.y - (m.corners.LO.y + m.corners.LI.y) / 2
  });
  
  const getRelR = (m: RawMetrics) => ({
    x: m.pupilR.x - (m.corners.RO.x + m.corners.RI.x) / 2,
    y: m.pupilR.y - (m.corners.RO.y + m.corners.RI.y) / 2
  });

  const relL2 = getRelL(c2), relL3 = getRelL(c3), relL4 = getRelL(c4), relL5 = getRelL(c5);
  const relR2 = getRelR(c2), relR3 = getRelR(c3), relR4 = getRelR(c4), relR5 = getRelR(c5);

  // Cálculo de Escala (Ls y Rs) según Zhang & Yin
  let LsX = (p5.x - p3.x) / (relL5.x - relL3.x);
  let LsY = (p4.y - p2.y) / (relL4.y - relL2.y);

  let RsX = (p5.x - p3.x) / (relR5.x - relR3.x);
  let RsY = (p4.y - p2.y) / (relR4.y - relR2.y);

  // Sanitización de Coeficientes
  // Aumentamos el máximo a 500 para pantallas pequeñas (13") donde el ojo se mueve poquísimo.
  const clamp = (val: number, min = 10, max = 500) => {
    if (isNaN(val) || !isFinite(val)) return 50; 
    return Math.max(min, Math.min(max, Math.abs(val))) * Math.sign(val);
  };

  LsX = clamp(LsX);
  LsY = clamp(LsY);
  RsX = clamp(RsX);
  RsY = clamp(RsY);

  const IPD0 = Math.hypot(c1.pupilR.x - c1.pupilL.x, c1.pupilR.y - c1.pupilL.y);

  // Benchmarks del Centro (Punto 1)
  return {
    Ls: { x: LsX, y: LsY },
    Rs: { x: RsX, y: RsY },
    theta0: c1.headPose.yaw,
    beta0: c1.headPose.pitch,
    IPD0: IPD0,
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
  // Nota: Al igual que en la versión estática, x está invertido por el espejo de la cámara, y necesita ajustarse.
  // El coeficiente de regresión Ls, Rs puede ser negativo, así que se ajustará automáticamente.
  const LG = { 
    x: currentH.x - (Lb.x * calib.Ls.x), 
    y: currentH.y + (Lb.y * calib.Ls.y) 
  };
  const RG = { 
    x: currentH.x - (Rb.x * calib.Rs.x), 
    y: currentH.y + (Rb.y * calib.Rs.y) 
  };

  // Punto final combinado
  return {
    x: Math.max(0, Math.min(1, (LG.x + RG.x) / 2)),
    y: Math.max(0, Math.min(1, (LG.y + RG.y) / 2))
  };
}
