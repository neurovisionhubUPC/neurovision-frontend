export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface CompensatedGaze {
  leftGaze: { x: number, y: number };
  rightGaze: { x: number, y: number };
  headRoll: number; // Radianes
}

/**
 * Motor Matemático de Compensación Cefálica.
 * 
 * Este algoritmo aísla el movimiento intrínseco del globo ocular del movimiento
 * extrínseco del cráneo. Para lograrlo en tiempo real sin requerir calibraciones
 * complejas:
 * 
 * 1. Calcula el centroide del zócalo ocular (Translation Compensation).
 * 2. Resta el centroide a la coordenada pupilar cruda.
 * 3. Mide la inclinación craneal entre ambos ojos y aplica una matriz de rotación inversa (Roll Compensation).
 * 4. Normaliza la magnitud vectorial basada en el ancho del ojo (Depth/Z-axis Compensation).
 */
export function computeCompensatedGaze(landmarks: Point3D[]): CompensatedGaze | null {
  // Índices estándar del MediaPipe Face Mesh (478 landmarks con irises)
  // Ojo Izquierdo: 33 (borde externo), 133 (borde interno)
  // Ojo Derecho: 362 (borde interno), 263 (borde externo)
  // Iris Izquierdo (centro): 468
  // Iris Derecho (centro): 473
  
  const leftEyeOuter = landmarks[33];
  const leftEyeInner = landmarks[133];
  const rightEyeInner = landmarks[362];
  const rightEyeOuter = landmarks[263];
  
  const leftIris = landmarks[468];
  const rightIris = landmarks[473];

  if (!leftIris || !rightIris || !leftEyeOuter || !rightEyeOuter) {
    return null; // El frame no detectó los ojos con claridad
  }

  // 1. TRASLACIÓN: Centros rígidos de referencia (zócalos oculares)
  const leftEyeCenter = {
    x: (leftEyeOuter.x + leftEyeInner.x) / 2,
    y: (leftEyeOuter.y + leftEyeInner.y) / 2,
  };
  
  const rightEyeCenter = {
    x: (rightEyeOuter.x + rightEyeInner.x) / 2,
    y: (rightEyeOuter.y + rightEyeInner.y) / 2,
  };

  // Vectores pupilares crudos (Movimiento pupila - Movimiento Zócalo = Movimiento Aislado)
  const rawPupilL = {
    x: leftIris.x - leftEyeCenter.x,
    y: leftIris.y - leftEyeCenter.y
  };
  
  const rawPupilR = {
    x: rightIris.x - rightEyeCenter.x,
    y: rightIris.y - rightEyeCenter.y
  };

  // 2. ROTACIÓN (Roll): Cálculo del ángulo de inclinación de la cabeza
  const dX = rightEyeCenter.x - leftEyeCenter.x;
  const dY = rightEyeCenter.y - leftEyeCenter.y;
  const headRoll = Math.atan2(dY, dX); 
  
  // Matriz de Rotación Inversa para neutralizar el balanceo cefálico
  const cosT = Math.cos(-headRoll);
  const sinT = Math.sin(-headRoll);

  const rotate = (p: {x: number, y: number}) => ({
    x: p.x * cosT - p.y * sinT,
    y: p.x * sinT + p.y * cosT
  });

  const compensatedL = rotate(rawPupilL);
  const compensatedR = rotate(rawPupilR);

  // 3. ESCALA (Z-axis / Proximidad a la cámara)
  // Normalizar dividiendo por el ancho de cada ojo. Si el paciente se acerca,
  // el vector crece, pero el ancho del ojo también, manteniendo el radio estable.
  const leftEyeWidth = Math.hypot(leftEyeOuter.x - leftEyeInner.x, leftEyeOuter.y - leftEyeInner.y);
  const rightEyeWidth = Math.hypot(rightEyeOuter.x - rightEyeInner.x, rightEyeOuter.y - rightEyeInner.y);

  return {
    leftGaze: {
      x: compensatedL.x / leftEyeWidth,
      y: compensatedL.y / leftEyeWidth
    },
    rightGaze: {
      x: compensatedR.x / rightEyeWidth,
      y: compensatedR.y / rightEyeWidth
    },
    headRoll
  };
}
