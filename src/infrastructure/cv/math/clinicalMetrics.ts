export interface Point2D {
  x: number;
  y: number;
}

export interface TrajectoryPoint {
  timestamp: number;
  gaze: Point2D;
  target: Point2D;
}

export interface ClinicalEvaluationReport {
  totalSamples: number;
  durationMs: number;
  madNormalized: number;
  madPixels: number;
  rmseNormalized: number;
  rmsePixels: number;
  dtwDistance: number;
  accuracyScore: number; // 0 - 100%
  fixationStability: number; // 0 - 100% de tiempo dentro del radio objetivo
}

/**
 * 1. Mean Absolute Deviation (MAD) - Vidhya & Resende Faria (2025)
 * MAD = (1/n) * sum(|Gaze_i - Target_i|)
 */
export function calculateMAD(gaze: Point2D[], target: Point2D[]): number {
  const n = Math.min(gaze.length, target.length);
  if (n === 0) return 0;

  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += Math.hypot(gaze[i].x - target[i].x, gaze[i].y - target[i].y);
  }
  return sum / n;
}

/**
 * 2. Root Mean Squared Error (RMSE) - Vidhya & Resende Faria (2025)
 * RMSE = sqrt( (1/n) * sum((Gaze_i - Target_i)^2) )
 */
export function calculateRMSE(gaze: Point2D[], target: Point2D[]): number {
  const n = Math.min(gaze.length, target.length);
  if (n === 0) return 0;

  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const dist = Math.hypot(gaze[i].x - target[i].x, gaze[i].y - target[i].y);
    sumSq += dist * dist;
  }
  return Math.sqrt(sumSq / n);
}

/**
 * Downsampling uniforme para optimizar DTW sin sobrecargar la CPU del navegador.
 */
function downsample(seq: Point2D[], maxPoints: number): Point2D[] {
  if (seq.length <= maxPoints) return seq;
  const step = (seq.length - 1) / (maxPoints - 1);
  const result: Point2D[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.min(seq.length - 1, Math.round(i * step));
    result.push(seq[idx]);
  }
  return result;
}

/**
 * 3. Dynamic Time Warping (DTW) - Vidhya & Resende Faria (2025)
 * Evalúa la similitud temporal y morfológica entre la trayectoria realizada y la esperada,
 * permitiendo variaciones en velocidad y retrasos de respuesta motora.
 */
export function calculateDTW(seqA: Point2D[], seqB: Point2D[], maxSamples: number = 80): number {
  const a = downsample(seqA, maxSamples);
  const b = downsample(seqB, maxSamples);
  const n = a.length;
  const m = b.length;

  if (n === 0 || m === 0) return 0;

  // Matriz de distancias acumuladas (n+1) x (m+1)
  const dtw: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(Infinity));
  dtw[0][0] = 0;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = Math.hypot(a[i - 1].x - b[j - 1].x, a[i - 1].y - b[j - 1].y);
      dtw[i][j] = cost + Math.min(
        dtw[i - 1][j],     // inserción
        dtw[i][j - 1],     // supresión
        dtw[i - 1][j - 1]  // coincidencia
      );
    }
  }

  // Distancia normalizada por la longitud del camino de deformación
  return dtw[n][m] / (n + m);
}

/**
 * 4. Generador Integral de Reporte Clínico
 */
export function generateClinicalReport(
  history: TrajectoryPoint[],
  canvasWidth: number,
  canvasHeight: number,
  targetRadiusNormalized: number = 0.08
): ClinicalEvaluationReport {
  if (history.length === 0) {
    return {
      totalSamples: 0,
      durationMs: 0,
      madNormalized: 0,
      madPixels: 0,
      rmseNormalized: 0,
      rmsePixels: 0,
      dtwDistance: 0,
      accuracyScore: 0,
      fixationStability: 0
    };
  }

  const gazes = history.map(h => h.gaze);
  const targets = history.map(h => h.target);

  const durationMs = history[history.length - 1].timestamp - history[0].timestamp;
  const madNorm = calculateMAD(gazes, targets);
  const rmseNorm = calculateRMSE(gazes, targets);
  const dtw = calculateDTW(gazes, targets);

  // Escala media de píxeles
  const avgDimension = Math.hypot(canvasWidth, canvasHeight);
  const madPx = madNorm * avgDimension;
  const rmsePx = rmseNorm * avgDimension;

  // Porcentaje de fijación estable dentro del radio permitido
  let insideCount = 0;
  for (let i = 0; i < history.length; i++) {
    const dist = Math.hypot(history[i].gaze.x - history[i].target.x, history[i].gaze.y - history[i].target.y);
    if (dist <= targetRadiusNormalized) {
      insideCount++;
    }
  }
  const fixationStability = (insideCount / history.length) * 100;

  // Puntuación de precisión (100% cuando MAD es 0, penalización cuadrática)
  const accuracyScore = Math.max(0, Math.min(100, (1 - madNorm * 3) * 100));

  return {
    totalSamples: history.length,
    durationMs,
    madNormalized: madNorm,
    madPixels: Math.round(madPx),
    rmseNormalized: rmseNorm,
    rmsePixels: Math.round(rmsePx),
    dtwDistance: dtw,
    accuracyScore: Math.round(accuracyScore),
    fixationStability: Math.round(fixationStability)
  };
}
