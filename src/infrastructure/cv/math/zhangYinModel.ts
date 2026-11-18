import {
  applyZIndexRecalibration,
  evaluateRidgeVector,
  fitLinearRegression,
  fitRidgeRegression,
  robustAverageNumbers,
  type DecoupledModel,
  type RidgeGazeModel2D,
} from './gazeEnhancements';

export interface Point2D {
  x: number;
  y: number;
}
export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface IntrinsicEyeFeatures {
  uL: number;
  vL: number;
  uR: number;
  vR: number;
  uAvg: number;
  vAvg: number;
  blendX: number;
  blendY: number;
}

export interface RawMetrics {
  pupilL: Point3D;
  pupilR: Point3D;
  corners: {
    LO: Point3D; // Left Outer
    LI: Point3D; // Left Inner
    RI: Point3D; // Right Inner
    RO: Point3D; // Right Outer
  };
  eyeFeatures?: IntrinsicEyeFeatures;
  glabella?: Point3D;
  irisDiameter?: number;
  ear?: {
    left: number;
    right: number;
    avg: number;
    isBlinking: boolean;
  };
  headPose: { yaw: number; pitch: number; roll: number };
}

export interface CalibrationData {
  Ls: Point2D; // Coeficientes de escala Izquierdo
  Rs: Point2D; // Coeficientes de escala Derecho
  leftModel?: DecoupledModel; // Modelo desacoplado X/Y ojo izquierdo
  rightModel?: DecoupledModel; // Modelo desacoplado X/Y ojo derecho
  ridgeModel?: RidgeGazeModel2D; // Modelo multivariante 2D Ridge (híbrido iris + blendshapes + pose)
  theta0: number; // Yaw base (C1)
  beta0: number; // Pitch base (C1)
  IPD0: number; // Inter-Pupillary Distance base (C1)
  baselineGlabella?: Point2D; // Glabela base (C1 - Chhimpa et al., 2024)
  baselineIrisDiameter?: number; // Diámetro medio del iris base (C1)
  Lc: Point2D; // Benchmark del centro ojo Izquierdo
  Rc: Point2D; // Benchmark del centro ojo Derecho
  cornersBenchmark: {
    LI: Point2D;
    LO: Point2D;
    RI: Point2D;
    RO: Point2D;
  };
}

/**
 * Extrae las coordenadas intrínsecas del ojo (invariantes a traslación cefálica, distancia Z e inclinación roll).
 * Si el worker ya las calculó (con párpados y blendshapes), las usa directamente; de lo contrario las deriva de las comisuras.
 */
export function extractNormalizedEyeFeatures(m: RawMetrics): IntrinsicEyeFeatures {
  if (m.eyeFeatures) {
    return m.eyeFeatures;
  }

  const projectEye = (
    pupil: Point2D,
    leftMost: Point2D,
    rightMost: Point2D
  ): { u: number; v: number } => {
    const dx = rightMost.x - leftMost.x;
    const dy = rightMost.y - leftMost.y;
    const width = Math.max(0.0001, Math.hypot(dx, dy));
    const exX = dx / width;
    const exY = dy / width;
    const eyX = -exY;
    const eyY = exX;

    const midX = (leftMost.x + rightMost.x) / 2;
    const midY = (leftMost.y + rightMost.y) / 2;
    const rx = pupil.x - midX;
    const ry = pupil.y - midY;

    return {
      u: (rx * exX + ry * exY) / width,
      v: (rx * eyX + ry * eyY) / width,
    };
  };

  const left = projectEye(m.pupilL, m.corners.LO, m.corners.LI);
  const right = projectEye(m.pupilR, m.corners.RI, m.corners.RO);

  return {
    uL: left.u,
    vL: left.v,
    uR: right.u,
    vR: right.v,
    uAvg: (left.u + right.u) / 2,
    vAvg: (left.v + right.v) / 2,
    blendX: 0,
    blendY: 0,
  };
}

/**
 * Construye las señales fusionadas (geometría de iris normalizada + blendshapes oculares de apariencia).
 */
export function computeFusedEyeSignals(m: RawMetrics): {
  uL: number;
  vL: number;
  uR: number;
  vR: number;
  uFused: number;
  vFused: number;
} {
  const feat = extractNormalizedEyeFeatures(m);
  // En el eje vertical el desplazamiento en píxeles del iris es pequeño; fusionar con blendY multiplica la sensibilidad vertical.
  const uFused = feat.uAvg - feat.blendX * 0.14;
  const vFused = feat.vAvg + feat.blendY * 0.22;

  return {
    uL: feat.uL - feat.blendX * 0.14,
    vL: feat.vL + feat.blendY * 0.22,
    uR: feat.uR - feat.blendX * 0.14,
    vR: feat.vR + feat.blendY * 0.22,
    uFused,
    vFused,
  };
}

/**
 * Procesa las muestras capturadas en un punto de calibración:
 * 1. Filtra parpadeos (EAR < 0.19 o blink blendshape alto).
 * 2. Descarta únicamente el primer 15% residual (ya que CalibrationOverlay purga los primeros 550ms de latencia sacádica).
 * 3. Agrega cada coordenada mediante Mediana + Recorte MAD (`robustAverageNumbers`) para eliminar microsacadas y outliers.
 */
export function processFixationSamples(samples: RawMetrics[]): RawMetrics | null {
  if (samples.length < 1) return null;

  const nonBlinking = samples.filter((s) => !s.ear?.isBlinking);
  const candidateSamples = nonBlinking.length >= 3 ? nonBlinking : samples;

  const discardCount =
    candidateSamples.length > 8 ? Math.floor(candidateSamples.length * 0.15) : 0;
  const validSamples = candidateSamples.slice(discardCount);

  const glabellaSamples = validSamples.filter((s) => s.glabella);
  const avgGlabella =
    glabellaSamples.length > 0
      ? {
          x: robustAverageNumbers(glabellaSamples.map((s) => s.glabella!.x)),
          y: robustAverageNumbers(glabellaSamples.map((s) => s.glabella!.y)),
          z: robustAverageNumbers(glabellaSamples.map((s) => s.glabella!.z)),
        }
      : undefined;

  const irisSamples = validSamples.filter((s) => typeof s.irisDiameter === 'number');
  const avgIrisDiameter =
    irisSamples.length > 0
      ? robustAverageNumbers(irisSamples.map((s) => s.irisDiameter!))
      : undefined;

  const extractedFeatures = validSamples.map(extractNormalizedEyeFeatures);
  const avgEyeFeatures: IntrinsicEyeFeatures = {
    uL: robustAverageNumbers(extractedFeatures.map((f) => f.uL)),
    vL: robustAverageNumbers(extractedFeatures.map((f) => f.vL)),
    uR: robustAverageNumbers(extractedFeatures.map((f) => f.uR)),
    vR: robustAverageNumbers(extractedFeatures.map((f) => f.vR)),
    uAvg: robustAverageNumbers(extractedFeatures.map((f) => f.uAvg)),
    vAvg: robustAverageNumbers(extractedFeatures.map((f) => f.vAvg)),
    blendX: robustAverageNumbers(extractedFeatures.map((f) => f.blendX)),
    blendY: robustAverageNumbers(extractedFeatures.map((f) => f.blendY)),
  };

  return {
    pupilL: {
      x: robustAverageNumbers(validSamples.map((s) => s.pupilL.x)),
      y: robustAverageNumbers(validSamples.map((s) => s.pupilL.y)),
      z: robustAverageNumbers(validSamples.map((s) => s.pupilL.z)),
    },
    pupilR: {
      x: robustAverageNumbers(validSamples.map((s) => s.pupilR.x)),
      y: robustAverageNumbers(validSamples.map((s) => s.pupilR.y)),
      z: robustAverageNumbers(validSamples.map((s) => s.pupilR.z)),
    },
    corners: {
      LO: {
        x: robustAverageNumbers(validSamples.map((s) => s.corners.LO.x)),
        y: robustAverageNumbers(validSamples.map((s) => s.corners.LO.y)),
        z: 0,
      },
      LI: {
        x: robustAverageNumbers(validSamples.map((s) => s.corners.LI.x)),
        y: robustAverageNumbers(validSamples.map((s) => s.corners.LI.y)),
        z: 0,
      },
      RI: {
        x: robustAverageNumbers(validSamples.map((s) => s.corners.RI.x)),
        y: robustAverageNumbers(validSamples.map((s) => s.corners.RI.y)),
        z: 0,
      },
      RO: {
        x: robustAverageNumbers(validSamples.map((s) => s.corners.RO.x)),
        y: robustAverageNumbers(validSamples.map((s) => s.corners.RO.y)),
        z: 0,
      },
    },
    eyeFeatures: avgEyeFeatures,
    glabella: avgGlabella,
    irisDiameter: avgIrisDiameter,
    headPose: {
      yaw: robustAverageNumbers(validSamples.map((s) => s.headPose.yaw)),
      pitch: robustAverageNumbers(validSamples.map((s) => s.headPose.pitch)),
      roll: robustAverageNumbers(validSamples.map((s) => s.headPose.roll)),
    },
  };
}

function buildFeatureVector(
  m: RawMetrics,
  theta0: number,
  beta0: number
): number[] {
  const fused = computeFusedEyeSignals(m);
  const dYaw = m.headPose.yaw - theta0;
  const dPitch = m.headPose.pitch - beta0;

  // [bias, uFused, vFused, crossTerm u*v, dYaw, dPitch]
  return [
    1.0,
    fused.uFused,
    fused.vFused,
    fused.uFused * fused.vFused,
    dYaw,
    dPitch,
  ];
}

/**
 * Calcula la calibración híbrida de 9 puntos combinando:
 * 1. Regresión Lineal OLS desacoplada sobre coordenadas intrínsecas normalizadas (leftModel / rightModel).
 * 2. Regresión Multivariante 2D Ridge con acoplamiento cruzado y compensación continua de pose cefálica (ridgeModel).
 */
export function computeCalibrationData(
  calibMetrics: RawMetrics[],
  screenPoints: Point2D[]
): CalibrationData {
  const c1 = calibMetrics[0];
  const theta0 = c1.headPose.yaw;
  const beta0 = c1.headPose.pitch;

  const fusedList = calibMetrics.map(computeFusedEyeSignals);
  const targetsX = screenPoints.slice(0, calibMetrics.length).map((p) => p.x);
  const targetsY = screenPoints.slice(0, calibMetrics.length).map((p) => p.y);

  // 1. Regresión Desacoplada OLS sobre coordenadas intrínsecas normalizadas por ancho de ojo
  const regLX = fitLinearRegression(
    fusedList.map((f) => f.uL),
    targetsX
  );
  const regLY = fitLinearRegression(
    fusedList.map((f) => f.vL),
    targetsY
  );
  const regRX = fitLinearRegression(
    fusedList.map((f) => f.uR),
    targetsX
  );
  const regRY = fitLinearRegression(
    fusedList.map((f) => f.vR),
    targetsY
  );

  // 2. Regresión Multivariante 2D Ridge (incluye término cruzado u*v y compensación de pose)
  const featureMatrix = calibMetrics.map((m) =>
    buildFeatureVector(m, theta0, beta0)
  );
  const ridgeX = fitRidgeRegression(featureMatrix, targetsX, 1.5e-4);
  const ridgeY = fitRidgeRegression(featureMatrix, targetsY, 1.5e-4);

  const ridgeModel: RidgeGazeModel2D | undefined =
    ridgeX && ridgeY
      ? {
          weightsX: ridgeX.weights,
          weightsY: ridgeY.weights,
          r2X: ridgeX.r2,
          r2Y: ridgeY.r2,
        }
      : undefined;

  const IPD0 = Math.hypot(c1.pupilR.x - c1.pupilL.x, c1.pupilR.y - c1.pupilL.y);

  // Conservamos Ls/Rs firmados en escala intrínseca para compatibilidad
  const safeSlope = (s: number, defaultSlope: number) =>
    Number.isFinite(s) && Math.abs(s) > 0.25 ? s : defaultSlope;

  return {
    Ls: {
      x: safeSlope(regLX.slope, -4.2),
      y: safeSlope(regLY.slope, 5.5),
    },
    Rs: {
      x: safeSlope(regRX.slope, -4.2),
      y: safeSlope(regRY.slope, 5.5),
    },
    leftModel: {
      slopeX: safeSlope(regLX.slope, -4.2),
      interceptX: Number.isFinite(regLX.intercept) ? regLX.intercept : 0.5,
      slopeY: safeSlope(regLY.slope, 5.5),
      interceptY: Number.isFinite(regLY.intercept) ? regLY.intercept : 0.5,
      r2X: Math.max(regLX.r2, ridgeModel?.r2X ?? 0),
      r2Y: Math.max(regLY.r2, ridgeModel?.r2Y ?? 0),
    },
    rightModel: {
      slopeX: safeSlope(regRX.slope, -4.2),
      interceptX: Number.isFinite(regRX.intercept) ? regRX.intercept : 0.5,
      slopeY: safeSlope(regRY.slope, 5.5),
      interceptY: Number.isFinite(regRY.intercept) ? regRY.intercept : 0.5,
      r2X: Math.max(regRX.r2, ridgeModel?.r2X ?? 0),
      r2Y: Math.max(regRY.r2, ridgeModel?.r2Y ?? 0),
    },
    ridgeModel,
    theta0,
    beta0,
    IPD0,
    baselineGlabella: c1.glabella ? { x: c1.glabella.x, y: c1.glabella.y } : undefined,
    baselineIrisDiameter: c1.irisDiameter || 0,
    Lc: { x: c1.pupilL.x, y: c1.pupilL.y },
    Rc: { x: c1.pupilR.x, y: c1.pupilR.y },
    cornersBenchmark: {
      LI: { x: c1.corners.LI.x, y: c1.corners.LI.y },
      LO: { x: c1.corners.LO.x, y: c1.corners.LO.y },
      RI: { x: c1.corners.RI.x, y: c1.corners.RI.y },
      RO: { x: c1.corners.RO.x, y: c1.corners.RO.y },
    },
  };
}

export function initializeTrackingState(_calib: CalibrationData): void {
  // Stateless per-frame intrinsic eye coordinates eliminate drift accumulation
}

/**
 * Inferencia de punto de mirada en tiempo real:
 * 1. Evalúa las coordenadas intrínsecas del ojo en el frame actual (cancelando traslación y roll frame a frame).
 * 2. Combina la predicción del modelo Multivariante 2D Ridge con la regresión OLS firmada binocular.
 * 3. Aplica ajuste suave de profundidad Z (IPD / diámetro de iris).
 */
export function predictGazePoint(
  currentMetrics: RawMetrics,
  calib: CalibrationData
): Point2D {
  const fused = computeFusedEyeSignals(currentMetrics);

  // 1. Predicción base mediante regresión lineal OLS firmada con intercepto real
  let olsX = 0.5;
  let olsY = 0.5;
  if (calib.leftModel && calib.rightModel) {
    const lx = calib.leftModel.slopeX * fused.uL + calib.leftModel.interceptX;
    const rx = calib.rightModel.slopeX * fused.uR + calib.rightModel.interceptX;
    const ly = calib.leftModel.slopeY * fused.vL + calib.leftModel.interceptY;
    const ry = calib.rightModel.slopeY * fused.vR + calib.rightModel.interceptY;
    olsX = (lx + rx) / 2;
    olsY = (ly + ry) / 2;
  } else {
    olsX = 0.5 + fused.uFused * calib.Ls.x;
    olsY = 0.5 + fused.vFused * calib.Ls.y;
  }

  // 2. Predicción mediante modelo Multivariante 2D Ridge (incluye término cruzado y pose cefálica)
  let rawX = olsX;
  let rawY = olsY;

  if (calib.ridgeModel) {
    const featVec = buildFeatureVector(currentMetrics, calib.theta0, calib.beta0);
    const ridgePredX = evaluateRidgeVector(calib.ridgeModel.weightsX, featVec);
    const ridgePredY = evaluateRidgeVector(calib.ridgeModel.weightsY, featVec);

    if (Number.isFinite(ridgePredX) && calib.ridgeModel.r2X >= 0.15) {
      rawX = ridgePredX * 0.75 + olsX * 0.25;
    }
    if (Number.isFinite(ridgePredY) && calib.ridgeModel.r2Y >= 0.15) {
      rawY = ridgePredY * 0.75 + olsY * 0.25;
    }
  }

  // 3. Compensación suave por rotación cefálica residual si no hubo varianza de cabeza durante calibración
  const dYaw = currentMetrics.headPose.yaw - calib.theta0;
  const dPitch = currentMetrics.headPose.pitch - calib.beta0;
  const headAssistX = -Math.tan(dYaw) * 0.35;
  const headAssistY = -Math.tan(dPitch) * 0.35;

  const combinedGaze = {
    x: Math.max(0, Math.min(1, rawX + headAssistX * 0.25)),
    y: Math.max(0, Math.min(1, rawY + headAssistY * 0.25)),
  };

  // 4. Re-Calibración Dinámica suave en Eje Z
  return applyZIndexRecalibration(combinedGaze, currentMetrics, {
    baselineIPD: calib.IPD0,
    baselineIrisDiameter: calib.baselineIrisDiameter,
    screenMidpoint: { x: 0.5, y: 0.5 },
  });
}
