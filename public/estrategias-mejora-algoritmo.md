# Estrategias Avanzadas de Optimización para el Algoritmo de Seguimiento Ocular y Calibración Web

Documento técnico de especificaciones e integración arquitectónica para refactorizar el pipeline de visión computacional Client-Side (`headCompensation.ts`, `SeriousGamesPage.tsx`, `useGazeSmoother.ts`).

---

## 📄 Resumen Ejecutivo

Este documento sintetiza las mejores estrategias metodológicas, matemáticas y algorítmicas extraídas de las investigaciones de **Vidhya & Resende Faria (2025)** (*CNN.pdf*) y **Chhimpa et al. (2024)** (*10752957.pdf*), integradas de manera armónica con el modelo de calibración de **Zhang & Yin (2025)**.

El objetivo es elevar la precisión espacial de la aplicación web de telerrehabilitación oculomotora (pasando de un enfoque puramente geométrico estático a un sistema dinámico adaptativo), garantizando:
1. **Inmunidad ante parpadeos y movimientos sacádicos iniciales.**
2. **Re-calibración continua en el eje Z** cuando el usuario modifica su distancia a la cámara (sin pausar la sesión).
3. **Compensación de traslación rápida de cabeza** mediante anclaje en el punto de la glabela.
4. **Desacoplamiento de regresión por ejes (X / Y)** para mitigar el ruido vertical por oclusión palpebral.
5. **Métricas de evaluación clínica basadas en trayectorias continuas** (MAD, RMSE, DTW) para cuantificar la recuperación funcional.

---

## 🛠️ 1. Filtrado de Calidad y Preprocesamiento Ocular

### 1.1 Detección Activa de Parpadeos vía EAR (Eye Aspect Ratio)
* **Fuente:** Vidhya & Resende Faria (2025).
* **Problema:** Los parpadeos causan saltos abruptos (*spikes*) en los landmarks pupilares de MediaPipe, corrompiendo el filtro de suavizado y distorsionando las lecturas de calibración.
* **Fórmula Matemática:**
  $$\text{EAR} = \frac{|P_2 - P_6| + |P_3 - P_5|}{2 \cdot |P_1 - P_4|}$$
  *Donde $P_1 \dots P_6$ son los 6 puntos clave del contorno palpebral provistos por MediaPipe FaceMesh.*
* **Regla de Filtrado:** Si $\text{EAR} < 0.2$, se detecta un cierre ocular o parpadeo. El fotograma debe descartarse de inmediato o congelar la coordenada previa del cursor.

### 1.2 Descarte de Latencia Sacádica Inicial (Filtro de 500 ms)
* **Fuente:** Chhimpa et al. (2024).
* **Problema:** Al mover el punto de calibración a una nueva posición en pantalla, el ojo humano sufre un retardo foveal (movimiento sacádico de reorientación). Si se capturan datos durante este lapso, la calibración almacenará coordenadas no fijadas.
* **Estrategia:** Ignorar automáticamente los primeros **500 ms (0.5 s)** de datos registrados al aparecer cada nuevo objetivo en la interfaz de calibración.

---

## 📐 2. Compensación Cefálica y Re-calibración Z en Tiempo Real

### 2.1 Anclaje Posicional de Cabeza vía Glabela
* **Fuente:** Chhimpa et al. (2024).
* **Concepto:** Registrar las coordenadas del punto medio entre las cejas (glabela: $G_x, G_y$) durante el fotograma base central de la calibración ($G'_x, G'_y$).
* **Vector de Corrección:**
  $$H_{mx} = G_x - G'_x , \quad H_{my} = G_y - G'_y$$
  $$\text{Gaze}_{\text{corrected}} = \text{Gaze}_{\text{raw}} - (H_m \cdot 1.15)$$
* **Beneficio:** Ofrece una compensación de traslación cefálica de altísima eficiencia computacional (<0.2 ms por frame).

### 2.2 Re-Calibración Dinámica en Eje Z por Diámetro de Iris
* **Fuente:** Chhimpa et al. (2024).
* **Concepto:** Durante el punto central de calibración, se almacena el diámetro horizontal medio del iris en píxeles ($A'_D$). Si en tiempo real el paciente se acerca o aleja, el diámetro cambia ($AD$).
* **Formulación Dinámica:**
  $$\text{ID}_d = |AD - A'_D|$$
  $$S_f = \frac{A'_D + \text{ID}_d}{A'_D}$$
* **Transformación Escalada:** Si $(S_f - S_{\text{prev}}) > 0.1$, se recalculan las coordenadas de calibración transformándolas respecto al centro de la pantalla $(X'_m, Y'_m)$:
  $$N_x = X'_m + \left(1 + \frac{S_f - 1}{2}\right) \cdot (X'_m - x)$$
  $$N_y = Y'_m + \left(1 + \frac{S_f - 1}{2}\right) \cdot (Y'_m - y)$$
* **Beneficio:** Evita que el usuario tenga que pausar el juego o ejercicio para recalibrar manualmente si cambia de postura respecto al monitor.

---

## 🎯 3. Regresión Desacoplada por Ejes (X / Y) y Calibración Adaptativa

### 3.1 Separación de Regresores para Eje X y Eje Y
* **Fuente:** Chhimpa et al. (2024).
* **Fundamento:** El eje vertical ($Y$) presenta mayor ruido por interferencia del párpado superior durante miradas hacia abajo. Entrenar o calcular la regresión de forma aislada ($X_v = \alpha X_I + \beta$ y $Y_v = \alpha Y_I + \beta$) previene que el ruido en $Y$ contamine la estabilidad en $X$.

---

## 📊 4. Módulo de Evaluación Oculomotora de Trayectorias Dinámicas

* **Fuente:** Vidhya & Resende Faria (2025).
* **Aplicación Clínico-Terapéutica:** Para medir cuantitativamente la evolución del paciente durante el ejercicio (Smooth Pursuit / Seguimiento Lento):
  1. **Mean Absolute Deviation (MAD):**
     $$\text{MAD} = \frac{1}{n} \sum_{i=1}^{n} |\text{Gaze}_i - \text{Target}_i|$$
  2. **Root Mean Squared Error (RMSE):**
     $$\text{RMSE} = \sqrt{\frac{1}{n} \sum_{i=1}^{n} (\text{Gaze}_i - \text{Target}_i)^2}$$
  3. **Dynamic Time Warping (DTW):** Evalúa la similitud temporal entre la trayectoria realizada y la trayectoria esperada.

---

## 💻 5. Código Helper de Referencia para el Agente (TypeScript)

### 5.1 Filtrado de Calidad y Re-calibración Z (`gazeEnhancements.ts`)

```typescript
export interface EyeLandmark {
  x: number;
  y: number;
}

export interface CalibrationParams {
  baselineIrisDiameter: number; // A'D
  baselineGlabella: { x: number; y: number }; // G'x, G'y
  screenMidpoint: { x: number; y: number }; // X'm, Y'm
}

// 1. Cálculo de Distancia Euclidiana
export function euclideanDistance(p1: EyeLandmark, p2: EyeLandmark): number {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

// 2. Cálculo de EAR (Vidhya & Resende Faria, 2025)
export function calculateEAR(eyeMesh: EyeLandmark[]): number {
  // Puntos estándar de contorno palpebral
  const p1 = eyeMesh[0]; // Esquina izquierda
  const p4 = eyeMesh[3]; // Esquina derecha
  const p2 = eyeMesh[1]; // Superior 1
  const p6 = eyeMesh[5]; // Inferior 1
  const p3 = eyeMesh[2]; // Superior 2
  const p5 = eyeMesh[4]; // Inferior 2

  const vertical1 = euclideanDistance(p2, p6);
  const vertical2 = euclideanDistance(p3, p5);
  const horizontal = euclideanDistance(p1, p4);

  if (horizontal === 0) return 0;
  return (vertical1 + vertical2) / (2.0 * horizontal);
}

// 3. Validador de Frame (Filtro Anti-Parpadeo EAR < 0.2)
export function isValidGazeFrame(leftEye: EyeLandmark[], rightEye: EyeLandmark[]): boolean {
  const leftEAR = calculateEAR(leftEye);
  const rightEAR = calculateEAR(rightEye);
  const BLINK_THRESHOLD = 0.20;

  return leftEAR >= BLINK_THRESHOLD && rightEAR >= BLINK_THRESHOLD;
}

// 4. Re-calibración Z por Diámetro de Iris (Chhimpa et al., 2024)
export function applyZIndexRecalibration(
  currentPoint: { x: number; y: number },
  currentIrisDiameter: number,
  params: CalibrationParams
): { x: number; y: number } {
  if (params.baselineIrisDiameter <= 0) return currentPoint;

  const idDiff = Math.abs(currentIrisDiameter - params.baselineIrisDiameter);
  
  if (idDiff > 0.1) {
    const scalingFactor = (params.baselineIrisDiameter + idDiff) / params.baselineIrisDiameter;
    const factorAdjustment = 1 + (scalingFactor - 1) / 2;

    const scaledX = params.screenMidpoint.x + factorAdjustment * (params.screenMidpoint.x - currentPoint.x);
    const scaledY = params.screenMidpoint.y + factorAdjustment * (params.screenMidpoint.y - currentPoint.y);

    return { x: scaledX, y: scaledY };
  }

  return currentPoint;
}

// 5. Compensación de Traslación por Glabela (Chhimpa et al., 2024)
export function applyGlabellaCompensation(
  gazePoint: { x: number; y: number },
  currentGlabella: { x: number; y: number },
  baselineGlabella: { x: number; y: number }
): { x: number; y: number } {
  const hmx = currentGlabella.x - baselineGlabella.x;
  const hmy = currentGlabella.y - baselineGlabella.y;

  return {
    x: gazePoint.x - hmx * 1.15,
    y: gazePoint.y - hmy * 1.15,
  };
}
```

---

## 📋 Resumen de Instrucciones para el Agente de Desarrollo

1. **En `SeriousGamesPage.tsx`:**
   - Incorporar un retardo de `500 ms` al capturar cada punto de la calibración de 5 puntos para ignorar el ruido de la sacada foveal inicial.
   - Evaluar `isValidGazeFrame()` en cada iteración del bucle de animación para pausar o congelar temporalmente el cursor durante los parpadeos.

2. **En `headCompensation.ts`:**
   - Integrar `applyGlabellaCompensation()` para realizar la corrección rápida de traslación cefálica.
   - Integrar `applyZIndexRecalibration()` utilizando el diámetro medio del iris capturado en el punto central de calibración.
   - Entrenar/calcular los regresores lineales de los ejes X e Y por separado.

3. **En `useGazeSmoother.ts`:**
   - Alimentar el filtro de Media Móvil Exponencial Adaptativa (EMA) únicamente con los puntos procesados y validados por las capas de preprocesamiento y re-calibración Z.
