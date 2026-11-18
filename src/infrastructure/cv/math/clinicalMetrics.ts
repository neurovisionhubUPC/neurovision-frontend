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
  bceaDeg2: number; // Bivariate Contour Ellipse Area (deg^2) al 68.2%
  saccadicGain: number; // Amplitud observada vs esperada acotada en [0, 2]
  meanSaccadicLatencyMs: number; // Latencia media de reacción oculomotora tras cambio de objetivo en ms
  leftHemifieldRatio: number; // 0..100 % de muestras en hemicampo izquierdo x < 0.5
  rightHemifieldRatio: number; // 0..100 % de muestras en hemicampo derecho x >= 0.5
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
      dtw[i][j] =
        cost +
        Math.min(
          dtw[i - 1][j], // inserción
          dtw[i][j - 1], // supresión
          dtw[i - 1][j - 1] // coincidencia
        );
    }
  }

  // Distancia normalizada por la longitud del camino de deformación
  return dtw[n][m] / (n + m);
}

/**
 * 4. Bivariate Contour Ellipse Area (BCEA) al 68.2% en grados visuales cuadrados (deg^2)
 * Fórmula: 2.291 * Math.PI * sigmaX_deg * sigmaY_deg * Math.sqrt(1 - rho * rho)
 * (Steinman 1965, Crossland et al. 2004)
 */
export function calculateBCEA(
  gazes: Point2D[],
  canvasWidth: number,
  canvasHeight: number,
  viewingDistanceCm: number = 55,
  pxPerCm: number = 37.8
): number {
  const n = gazes.length;
  if (n < 2) return 0;

  // 1. Centroide en píxeles
  let sumXPx = 0;
  let sumYPx = 0;
  for (let i = 0; i < n; i++) {
    sumXPx += gazes[i].x * canvasWidth;
    sumYPx += gazes[i].y * canvasHeight;
  }
  const meanXPx = sumXPx / n;
  const meanYPx = sumYPx / n;

  // 2. Desviaciones angulares en grados respecto al centroide
  const degX = new Float64Array(n);
  const degY = new Float64Array(n);
  let sumDegX = 0;
  let sumDegY = 0;

  for (let i = 0; i < n; i++) {
    const dxCm = (gazes[i].x * canvasWidth - meanXPx) / pxPerCm;
    const dyCm = (gazes[i].y * canvasHeight - meanYPx) / pxPerCm;
    const thX = (Math.atan(dxCm / viewingDistanceCm) * 180) / Math.PI;
    const thY = (Math.atan(dyCm / viewingDistanceCm) * 180) / Math.PI;
    degX[i] = thX;
    degY[i] = thY;
    sumDegX += thX;
    sumDegY += thY;
  }

  const meanDegX = sumDegX / n;
  const meanDegY = sumDegY / n;

  // 3. Varianza, desviación estándar y covarianza
  let varX = 0;
  let varY = 0;
  let covXY = 0;

  for (let i = 0; i < n; i++) {
    const dX = degX[i] - meanDegX;
    const dY = degY[i] - meanDegY;
    varX += dX * dX;
    varY += dY * dY;
    covXY += dX * dY;
  }

  const sigmaX = Math.sqrt(varX / n);
  const sigmaY = Math.sqrt(varY / n);

  if (sigmaX * sigmaY <= 1e-12) {
    return 0;
  }

  const rhoRaw = covXY / (n * sigmaX * sigmaY);
  const rho = Math.max(-1, Math.min(1, rhoRaw));

  const k = 2.291; // chi-squared con 2 GL para p = 0.682
  const bcea = k * Math.PI * sigmaX * sigmaY * Math.sqrt(Math.max(0, 1 - rho * rho));
  return Math.round(bcea * 100) / 100;
}

/**
 * 5. Ganancia Sacádica (Saccadic Gain)
 * Relación media de amplitud sacádica observada vs esperada, acotada en [0, 2].
 * Cuando el estímulo salta o se posiciona, evalúa la amplitud del desplazamiento ocular
 * en la dirección del cambio. Si el objetivo es estacionario, compara la aproximación
 * ocular relativa al punto de fijación.
 */
export function calculateSaccadicGain(
  history: TrajectoryPoint[],
  canvasWidth: number,
  canvasHeight: number
): number {
  if (history.length < 2) return 1.0;

  const targetJumps: Array<{
    jumpIdx: number;
    expectedAmp: number;
    vecTx: number;
    vecTy: number;
    tJump: number;
    targetEndX: number;
    targetEndY: number;
    prevGazeX: number;
    prevGazeY: number;
  }> = [];

  // Detección de saltos sacádicos del objetivo (desplazamiento >= 15 píxeles)
  for (let i = 1; i < history.length; i++) {
    const prevT = history[i - 1].target;
    const currT = history[i].target;
    const vTx = (currT.x - prevT.x) * canvasWidth;
    const vTy = (currT.y - prevT.y) * canvasHeight;
    const distT = Math.hypot(vTx, vTy);

    if (distT >= 15) {
      targetJumps.push({
        jumpIdx: i,
        expectedAmp: distT,
        vecTx: vTx,
        vecTy: vTy,
        tJump: history[i].timestamp,
        targetEndX: currT.x * canvasWidth,
        targetEndY: currT.y * canvasHeight,
        prevGazeX: history[i - 1].gaze.x * canvasWidth,
        prevGazeY: history[i - 1].gaze.y * canvasHeight
      });
    }
  }

  // Si no hubo saltos dinámicos del objetivo (tarea estacionaria como fijación sostenida)
  if (targetJumps.length === 0) {
    const t0 = history[0].target;
    const g0 = history[0].gaze;
    const initDist = Math.hypot(
      (t0.x - g0.x) * canvasWidth,
      (t0.y - g0.y) * canvasHeight
    );

    // Si ya comenzó fijando el objetivo, ganancia ortométrica ideal (1.0)
    if (initDist < 20) {
      return 1.0;
    }

    // Si comenzó fuera de blanco, medir aproximación durante los primeros 800 ms
    let bestDist = initDist;
    const maxT = history[0].timestamp + 800;
    for (let i = 0; i < history.length; i++) {
      if (history[i].timestamp > maxT) break;
      const d = Math.hypot(
        (history[i].gaze.x - t0.x) * canvasWidth,
        (history[i].gaze.y - t0.y) * canvasHeight
      );
      if (d < bestDist) {
        bestDist = d;
      }
    }
    const observedAmp = initDist - bestDist;
    const gain = observedAmp / initDist;
    return Math.round(Math.max(0, Math.min(2, gain)) * 100) / 100;
  }

  const gains: number[] = [];

  for (let j = 0; j < targetJumps.length; j++) {
    const jump = targetJumps[j];
    const maxWindowTimestamp = jump.tJump + 800;

    let minTargetDist = Infinity;
    let bestGazeEndX = jump.prevGazeX;
    let bestGazeEndY = jump.prevGazeY;

    for (let k = jump.jumpIdx; k < history.length; k++) {
      if (history[k].timestamp > maxWindowTimestamp) break;

      // Si empieza el siguiente salto, cerrar ventana de observación
      if (
        k > jump.jumpIdx &&
        Math.hypot(
          (history[k].target.x - history[k - 1].target.x) * canvasWidth,
          (history[k].target.y - history[k - 1].target.y) * canvasHeight
        ) >= 15
      ) {
        break;
      }

      const gx = history[k].gaze.x * canvasWidth;
      const gy = history[k].gaze.y * canvasHeight;
      const distToT = Math.hypot(gx - jump.targetEndX, gy - jump.targetEndY);

      if (distToT < minTargetDist) {
        minTargetDist = distToT;
        bestGazeEndX = gx;
        bestGazeEndY = gy;
      }
    }

    const vGx = bestGazeEndX - jump.prevGazeX;
    const vGy = bestGazeEndY - jump.prevGazeY;
    const dot = vGx * jump.vecTx + vGy * jump.vecTy;

    if (dot > 0 && jump.expectedAmp > 0) {
      const projectedAmp = dot / jump.expectedAmp;
      const gain = projectedAmp / jump.expectedAmp;
      gains.push(Math.max(0, Math.min(2, gain)));
    } else {
      gains.push(0);
    }
  }

  if (gains.length === 0) return 1.0;
  const meanGain = gains.reduce((acc, val) => acc + val, 0) / gains.length;
  return Math.round(Math.max(0, Math.min(2, meanGain)) * 100) / 100;
}

/**
 * 6. Latencia Media Sacádica (Mean Saccadic Latency)
 * Latencia media de reacción oculomotora tras cambio de objetivo en ms.
 * Mide el tiempo transcurrido entre el salto del estímulo y la iniciación de la
 * sacada motora hacia el nuevo objetivo (normalmente 150-400 ms en humanos).
 */
export function calculateSaccadicLatency(
  history: TrajectoryPoint[],
  canvasWidth: number,
  canvasHeight: number
): number {
  if (history.length < 2) return 0;

  const latencies: number[] = [];

  for (let i = 1; i < history.length; i++) {
    const prevT = history[i - 1].target;
    const currT = history[i].target;
    const vTx = (currT.x - prevT.x) * canvasWidth;
    const vTy = (currT.y - prevT.y) * canvasHeight;
    const distT = Math.hypot(vTx, vTy);

    if (distT < 15) continue;

    const tJump = history[i].timestamp;
    const maxT = tJump + 1200;

    for (let k = i; k < history.length; k++) {
      if (history[k].timestamp > maxT) break;

      const dtMs = history[k].timestamp - history[k - 1].timestamp;
      const dx = (history[k].gaze.x - history[k - 1].gaze.x) * canvasWidth;
      const dy = (history[k].gaze.y - history[k - 1].gaze.y) * canvasHeight;
      const speedPxPerSec = dtMs > 0 ? (Math.hypot(dx, dy) / (dtMs / 1000)) : 0;

      const dot = dx * vTx + dy * vTy;

      // Sacada iniciada: aceleración motora en dirección al estímulo
      const isSaccadeMove = (speedPxPerSec >= 200 || Math.hypot(dx, dy) >= 12) && dot > 0;
      if (isSaccadeMove) {
        const latency = history[k].timestamp - tJump;
        if (latency >= 50 && latency <= 1200) {
          latencies.push(latency);
          break;
        }
      }
    }
  }

  if (latencies.length === 0) {
    // Si no hubo saltos del estímulo pero el gaze inicial estaba fuera del centro
    const t0 = history[0].target;
    const g0 = history[0].gaze;
    const initDist = Math.hypot(
      (t0.x - g0.x) * canvasWidth,
      (t0.y - g0.y) * canvasHeight
    );

    if (initDist >= 30) {
      for (let k = 1; k < history.length; k++) {
        if (history[k].timestamp - history[0].timestamp > 1200) break;
        const dist = Math.hypot(
          (history[k].gaze.x - t0.x) * canvasWidth,
          (history[k].gaze.y - t0.y) * canvasHeight
        );
        if (dist <= initDist * 0.7) {
          return Math.round(history[k].timestamp - history[0].timestamp);
        }
      }
    }
    return 0;
  }

  const meanLatency = latencies.reduce((acc, val) => acc + val, 0) / latencies.length;
  return Math.round(meanLatency);
}

/**
 * 7. Ratios de exploración de hemicampos izquierdo y derecho
 * leftHemifieldRatio: 0..100 % de muestras con x < 0.5
 * rightHemifieldRatio: 0..100 % de muestras con x >= 0.5
 */
export function calculateHemifieldRatios(gazes: Point2D[]): {
  leftHemifieldRatio: number;
  rightHemifieldRatio: number;
} {
  const n = gazes.length;
  if (n === 0) {
    return { leftHemifieldRatio: 0, rightHemifieldRatio: 0 };
  }

  let leftCount = 0;
  for (let i = 0; i < n; i++) {
    if (gazes[i].x < 0.5) {
      leftCount++;
    }
  }

  const leftRatio = (leftCount / n) * 100;
  const rightRatio = ((n - leftCount) / n) * 100;

  return {
    leftHemifieldRatio: Math.round(leftRatio * 100) / 100,
    rightHemifieldRatio: Math.round(rightRatio * 100) / 100
  };
}

/**
 * 8. Generador Integral de Reporte Clínico
 * Preserva compatibilidad total de firma y campos con los consumidores existentes,
 * e incorpora las métricas avanzadas: bceaDeg2, saccadicGain, meanSaccadicLatencyMs,
 * leftHemifieldRatio y rightHemifieldRatio.
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
      fixationStability: 0,
      bceaDeg2: 0,
      saccadicGain: 0,
      meanSaccadicLatencyMs: 0,
      leftHemifieldRatio: 0,
      rightHemifieldRatio: 0
    };
  }

  const gazes = history.map((h) => h.gaze);
  const targets = history.map((h) => h.target);

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
    const dist = Math.hypot(
      history[i].gaze.x - history[i].target.x,
      history[i].gaze.y - history[i].target.y
    );
    if (dist <= targetRadiusNormalized) {
      insideCount++;
    }
  }
  const fixationStability = (insideCount / history.length) * 100;

  // Puntuación de precisión (100% cuando MAD es 0, penalización cuadrática)
  const accuracyScore = Math.max(0, Math.min(100, (1 - madNorm * 3) * 100));

  // Nuevas métricas clínicas
  const bceaDeg2 = calculateBCEA(gazes, canvasWidth, canvasHeight);
  const saccadicGain = calculateSaccadicGain(history, canvasWidth, canvasHeight);
  const meanSaccadicLatencyMs = calculateSaccadicLatency(history, canvasWidth, canvasHeight);
  const { leftHemifieldRatio, rightHemifieldRatio } = calculateHemifieldRatios(gazes);

  return {
    totalSamples: history.length,
    durationMs,
    madNormalized: madNorm,
    madPixels: Math.round(madPx),
    rmseNormalized: rmseNorm,
    rmsePixels: Math.round(rmsePx),
    dtwDistance: dtw,
    accuracyScore: Math.round(accuracyScore),
    fixationStability: Math.round(fixationStability),
    bceaDeg2,
    saccadicGain,
    meanSaccadicLatencyMs,
    leftHemifieldRatio,
    rightHemifieldRatio
  };
}
