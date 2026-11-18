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

// 7. Promedio Estadístico Robusto con Recorte por Mediana + MAD (Median Absolute Deviation)
// Elimina microsacadas, bordes de parpadeo y outliers durante la captura de cada punto de calibración.
export function robustAverageNumbers(values: number[]): number {
  if (values.length === 0) return 0;
  if (values.length <= 2) {
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

  const absDevs = sorted.map((v) => Math.abs(v - median));
  const sortedDevs = [...absDevs].sort((a, b) => a - b);
  const mad =
    sortedDevs.length % 2 === 1
      ? sortedDevs[mid]
      : (sortedDevs[mid - 1] + sortedDevs[mid]) / 2;

  // Si todas las muestras son casi idénticas, retornar mediana
  if (mad <= 1e-7) return median;

  // Umbral 2.5 * sigma equivalente (1.4826 * 2.5 = 3.7 * MAD)
  const maxAllowedDev = 3.2 * mad;
  const inliers = values.filter((v) => Math.abs(v - median) <= maxAllowedDev);
  if (inliers.length === 0) return median;

  return inliers.reduce((a, b) => a + b, 0) / inliers.length;
}

// 8. Regresión Multivariante 2D con Regularización Ridge (Tikhonov)
// Mapea el vector de características oculomotoras y pose cefálica directamente a (screenX, screenY).
export interface RidgeGazeModel2D {
  weightsX: number[];
  weightsY: number[];
  r2X: number;
  r2Y: number;
}

function solveLinearSystemGaussJordan(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const aug: number[][] = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxAbs = Math.abs(aug[col][col]);
    for (let row = col + 1; row < n; row++) {
      const val = Math.abs(aug[row][col]);
      if (val > maxAbs) {
        maxAbs = val;
        pivotRow = row;
      }
    }

    if (maxAbs < 1e-11) return null;

    if (pivotRow !== col) {
      const tmp = aug[col];
      aug[col] = aug[pivotRow];
      aug[pivotRow] = tmp;
    }

    const pivotVal = aug[col][col];
    for (let j = col; j <= n; j++) {
      aug[col][j] /= pivotVal;
    }

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      if (Math.abs(factor) < 1e-12) continue;
      for (let j = col; j <= n; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  return aug.map((row) => row[n]);
}

export function fitRidgeRegression(
  featureMatrix: number[][],
  targets: number[],
  lambda: number = 1e-4
): { weights: number[]; r2: number } | null {
  const nSamples = featureMatrix.length;
  if (nSamples === 0 || featureMatrix[0].length === 0) return null;
  const nFeatures = featureMatrix[0].length;

  const XtX: number[][] = Array.from({ length: nFeatures }, () =>
    Array(nFeatures).fill(0)
  );
  const Xty: number[] = Array(nFeatures).fill(0);

  for (let i = 0; i < nSamples; i++) {
    const row = featureMatrix[i];
    const y = targets[i];
    for (let j = 0; j < nFeatures; j++) {
      Xty[j] += row[j] * y;
      for (let k = j; k < nFeatures; k++) {
        XtX[j][k] += row[j] * row[k];
      }
    }
  }

  for (let j = 0; j < nFeatures; j++) {
    for (let k = 0; k < j; k++) {
      XtX[j][k] = XtX[k][j];
    }
    // No penalizar el término de sesgo (índice 0 = 1.0)
    if (j > 0) {
      XtX[j][j] += lambda;
    }
  }

  const weights = solveLinearSystemGaussJordan(XtX, Xty);
  if (!weights) return null;

  const meanY = targets.reduce((a, b) => a + b, 0) / nSamples;
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < nSamples; i++) {
    let pred = 0;
    for (let j = 0; j < nFeatures; j++) {
      pred += featureMatrix[i][j] * weights[j];
    }
    ssRes += Math.pow(targets[i] - pred, 2);
    ssTot += Math.pow(targets[i] - meanY, 2);
  }

  const r2 = ssTot > 1e-9 ? Math.max(0, Math.min(1, 1 - ssRes / ssTot)) : 0;
  return { weights, r2 };
}

export function evaluateRidgeVector(weights: number[], features: number[]): number {
  let sum = 0;
  const len = Math.min(weights.length, features.length);
  for (let i = 0; i < len; i++) {
    sum += weights[i] * features[i];
  }
  return sum;
}

