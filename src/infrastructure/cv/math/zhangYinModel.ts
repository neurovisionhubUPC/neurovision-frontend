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
  Ls: Point2D; // Escala ojo izquierdo
  Rs: Point2D; // Escala ojo derecho
  theta0: number; // Yaw inicial (radianes)
  beta0: number;  // Pitch inicial (radianes)
  Lc: Point2D; // Benchmark pupila izquierda (raw coords)
  Rc: Point2D; // Benchmark pupila derecha (raw coords)
  cornersBenchmark: {
    LI: Point2D;
    LO: Point2D;
    RI: Point2D;
    RO: Point2D;
  };
}

/**
 * Filtra los samples descartando el 75% inicial (aprox 1.5s de 2s) y promediando matemáticamente el 25% final.
 * @param samples Colección de métricas capturadas durante los 2 segundos.
 */
export function processFixationSamples(samples: RawMetrics[]): RawMetrics | null {
  // Exigimos al menos 4 muestras para garantizar un mínimo de calidad estadística
  if (samples.length < 4) return null;

  // Descartamos el 75% inicial de las muestras (sacádicos de búsqueda)
  const discardCount = Math.floor(samples.length * 0.75); 
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
  const [, p2, p3, p4, p5] = screenPoints; // p1 = Centro (omitido, no se usa en Ls/Rs directo)

  // Cálculo de Escala (Ls y Rs) según Zhang & Yin (2025)
  // Escala = Delta Pantalla / Delta Pupila
  
  // Ojo Izquierdo
  const LsX = (p5.x - p3.x) / (c5.pupilL.x - c3.pupilL.x);
  const LsY = (p4.y - p2.y) / (c4.pupilL.y - c2.pupilL.y);

  // Ojo Derecho
  const RsX = (p5.x - p3.x) / (c5.pupilR.x - c3.pupilR.x);
  const RsY = (p4.y - p2.y) / (c4.pupilR.y - c2.pupilR.y);

  // Benchmarks del Centro (Punto 1)
  return {
    Ls: { x: LsX, y: LsY },
    Rs: { x: RsX, y: RsY },
    theta0: c1.headPose.yaw,
    beta0: c1.headPose.pitch,
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
  const threshold = 2 * (Math.PI / 180);
  const deltaTheta = Math.abs(thetaAct - lastTheta);
  const deltaBeta = Math.abs(betaAct - lastBeta);
  
  const isHeadMotion = deltaTheta > threshold || deltaBeta > threshold;
  
  // Factor empírico de proyección angular a la pantalla
  const d_norm = 2.0; 

  if (isHeadMotion) {
    // Paso B: Cálculo del Head-Pointing
    const dx = d_norm * (Math.tan(thetaAct) - Math.tan(calib.theta0));
    const dy = d_norm * (Math.tan(betaAct) - Math.tan(calib.beta0));
    
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
