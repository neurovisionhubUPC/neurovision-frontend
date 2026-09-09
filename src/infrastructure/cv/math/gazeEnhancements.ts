export interface EyeLandmark {
  x: number;
  y: number;
  z?: number;
}

export interface EARResult {
  left: number;
  right: number;
  avg: number;
  isBlinking: boolean;
}

// 1. Distancia Euclidiana 2D
export function euclideanDistance(p1: EyeLandmark, p2: EyeLandmark): number {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

// 2. Cálculo de EAR (Vidhya & Resende Faria, 2025)
// EAR = (|P2 - P6| + |P3 - P5|) / (2 * |P1 - P4|)
export function calculateEAR(eyeMesh: EyeLandmark[]): number {
  if (!eyeMesh || eyeMesh.length < 6) return 0;

  const p1 = eyeMesh[0]; // Esquina 1
  const p2 = eyeMesh[1]; // Superior 1
  const p3 = eyeMesh[2]; // Superior 2
  const p4 = eyeMesh[3]; // Esquina 2
  const p5 = eyeMesh[4]; // Inferior 2
  const p6 = eyeMesh[5]; // Inferior 1

  const vertical1 = euclideanDistance(p2, p6);
  const vertical2 = euclideanDistance(p3, p5);
  const horizontal = euclideanDistance(p1, p4);

  if (horizontal <= 0.0001) return 0;
  return (vertical1 + vertical2) / (2.0 * horizontal);
}

// 3. Validador de Frame (Filtro Anti-Parpadeo EAR < 0.20)
export function evaluateBlink(leftEye: EyeLandmark[], rightEye: EyeLandmark[]): EARResult {
  const leftEAR = calculateEAR(leftEye);
  const rightEAR = calculateEAR(rightEye);
  const avg = (leftEAR + rightEAR) / 2;
  const BLINK_THRESHOLD = 0.20;

  return {
    left: leftEAR,
    right: rightEAR,
    avg,
    isBlinking: leftEAR < BLINK_THRESHOLD || rightEAR < BLINK_THRESHOLD
  };
}

// 4. Compensación de Traslación por Glabela (Chhimpa et al., 2024)
// Corrige el desplazamiento rápido de la cabeza mediante un anclaje óseo rígido (punto 168)
export function applyGlabellaCompensation(
  gazePoint: { x: number; y: number },
  currentGlabella: { x: number; y: number },
  baselineGlabella: { x: number; y: number },
  factor: number = 1.15
): { x: number; y: number } {
  const hmx = currentGlabella.x - baselineGlabella.x;
  const hmy = currentGlabella.y - baselineGlabella.y;

  return {
    x: Math.max(0, Math.min(1, gazePoint.x - hmx * factor)),
    y: Math.max(0, Math.min(1, gazePoint.y - hmy * factor)),
  };
}

// 5. Regresión Lineal por Mínimos Cuadrados Ordinarios (OLS) Desacoplada por Eje (Chhimpa et al., 2024)
export interface LinearRegressionResult {
  slope: number;
  intercept: number;
  r2: number;
}

export interface DecoupledModel {
  slopeX: number;
  interceptX: number;
  slopeY: number;
  interceptY: number;
  r2X: number;
  r2Y: number;
}

export function fitLinearRegression(xVals: number[], yVals: number[]): LinearRegressionResult {
  const n = xVals.length;
  if (n < 2) return { slope: 0, intercept: 0.5, r2: 0 };

  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xVals[i];
    sumY += yVals[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let numerator = 0;
  let denomX = 0;
  let denomY = 0;

  for (let i = 0; i < n; i++) {
    const dx = xVals[i] - meanX;
    const dy = yVals[i] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  if (denomX <= 1e-9) {
    return { slope: 0, intercept: meanY, r2: 0 };
  }

  const slope = numerator / denomX;
  const intercept = meanY - slope * meanX;
  const r2 = denomY > 1e-9 ? Math.pow(numerator, 2) / (denomX * denomY) : 0;

  return { slope, intercept, r2 };
}

// 6. Re-Calibración Dinámica en Eje Z por Diámetro de Iris / IPD (Chhimpa et al., 2024)
export interface DepthCalibrationParams {
  baselineIrisDiameter?: number;
  baselineIPD?: number;
  screenMidpoint?: { x: number; y: number };
}

export function applyZIndexRecalibration(
  currentPoint: { x: number; y: number },
  currentMetrics: { irisDiameter?: number; pupilL: { x: number; y: number }; pupilR: { x: number; y: number } },
  params: DepthCalibrationParams
): { x: number; y: number } {
  const midpoint = params.screenMidpoint || { x: 0.5, y: 0.5 };
  
  // Determinamos el ratio de profundidad actual respecto al baseline de calibración
  let ratio = 1.0;

  if (params.baselineIPD && params.baselineIPD > 0) {
    const currentIPD = Math.hypot(currentMetrics.pupilR.x - currentMetrics.pupilL.x, currentMetrics.pupilR.y - currentMetrics.pupilL.y);
    if (currentIPD > 0.001) {
      ratio = currentIPD / params.baselineIPD;
    }
  } else if (params.baselineIrisDiameter && params.baselineIrisDiameter > 0 && currentMetrics.irisDiameter) {
    ratio = currentMetrics.irisDiameter / params.baselineIrisDiameter;
  }

  const diff = Math.abs(ratio - 1.0);

  // Umbral sensible: solo re-escala si el paciente se desplazó más de un 5% en Z
  if (diff > 0.05) {
    // Factor de transformación angular según Chhimpa et al. (2024)
    const factorAdjustment = 1 + (ratio - 1) / 2;

    const scaledX = midpoint.x + (currentPoint.x - midpoint.x) * factorAdjustment;
    const scaledY = midpoint.y + (currentPoint.y - midpoint.y) * factorAdjustment;

    return {
      x: Math.max(0, Math.min(1, scaledX)),
      y: Math.max(0, Math.min(1, scaledY))
    };
  }

  return currentPoint;
}

