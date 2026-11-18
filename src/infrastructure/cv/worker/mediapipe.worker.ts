import { FaceLandmarker } from '@mediapipe/tasks-vision';

let faceLandmarker: FaceLandmarker | null = null;

async function initializeMediaPipe() {
  try {
    // EL HACK DEFINITIVO PARA VITE + WORKERS:
    // Vite fuerza a los Web Workers a usar { type: "module" } en desarrollo.
    // MediaPipe WASM requiere ejecutarse en el scope global para registrar su ModuleFactory.
    // - `import()` lo ejecuta en un scope cerrado y falla. 
    // - `importScripts()` está bloqueado por el navegador en workers modulares.
    // La única salida nativa es descargar el loader como texto y evaluarlo globalmente.
    
    const wasmLoaderUrl = "https://unpkg.com/@mediapipe/tasks-vision@0.10.12/wasm/vision_wasm_internal.js";
    const wasmBinaryUrl = "https://unpkg.com/@mediapipe/tasks-vision@0.10.12/wasm/vision_wasm_internal.wasm";
    
    console.log("Descargando WASM loader estático...");
    const response = await fetch(wasmLoaderUrl);
    const scriptText = await response.text();
    
    // Evaluamos el script en el contexto global y forzamos la exposición del factory
    const patchedScript = scriptText + "\nif (typeof createMediaPipeModule !== 'undefined') { self.createMediaPipeModule = createMediaPipeModule; }\n";
    (0, eval)(patchedScript);
    
    const visionPaths = {
      wasmLoaderPath: wasmLoaderUrl,
      wasmBinaryPath: wasmBinaryUrl
    };
    
    // Instanciamos el modelo matemático pesado
    faceLandmarker = await FaceLandmarker.createFromOptions(visionPaths, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        delegate: "GPU" // Aceleración por hardware si está disponible
      },
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      runningMode: "VIDEO",
      numFaces: 1,
    });
    
    // Notificamos a React que el binario está cargado y listo para devorar frames
    self.postMessage({ type: 'INITIALIZED' });
  } catch (error) {
    console.error("WASM Worker Error:", error);
    self.postMessage({ type: 'ERROR', error: 'Fallo al inicializar Face Landmarker' });
  }
}

initializeMediaPipe();

// Puente de recepción (postMessage) desde el hilo de React
self.onmessage = async (event: MessageEvent) => {
  if (!faceLandmarker) return;
  
  const { type, image, timestamp } = event.data;
  
  if (type === 'PROCESS_FRAME') {
    // image es un ImageBitmap (bitmap volatil en RAM transferido directamente)
    
    try {
      // Inferencia Matemática en WASM (No congela la UI porque estamos en background)
      const results = faceLandmarker.detectForVideo(image, timestamp);
      
      let rawMetrics = null;
      if (results.faceLandmarks && results.faceLandmarks.length > 0) {
        const landmarks = results.faceLandmarks[0];
        
        // Extracción de pose usando la Matriz de Transformación Facial (col-major 4x4)
        let yaw = 0;
        let pitch = 0;
        let roll = 0;
        if (results.facialTransformationMatrixes && results.facialTransformationMatrixes.length > 0) {
          const matrix = results.facialTransformationMatrixes[0].data; 
          // Extract Euler angles (MediaPipe matrix is column-major)
          yaw = Math.asin(-matrix[2]);
          pitch = Math.atan2(matrix[6], matrix[10]);
          roll = Math.atan2(matrix[1], matrix[0]);
        }
        
        // Extracción de landmarks palpebrales para EAR (Eye Aspect Ratio - Vidhya & Resende Faria, 2025)
        const leftEyeContour = [landmarks[33], landmarks[160], landmarks[158], landmarks[133], landmarks[153], landmarks[144]];
        const rightEyeContour = [landmarks[362], landmarks[385], landmarks[387], landmarks[263], landmarks[373], landmarks[380]];

        const dist2D = (p1: { x: number; y: number }, p2: { x: number; y: number }) => Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const calcEAR = (pts: { x: number; y: number }[]) => {
          const v1 = dist2D(pts[1], pts[5]);
          const v2 = dist2D(pts[2], pts[4]);
          const h = dist2D(pts[0], pts[3]);
          return h > 0.0001 ? (v1 + v2) / (2.0 * h) : 0;
        };

        const leftEAR = calcEAR(leftEyeContour);
        const rightEAR = calcEAR(rightEyeContour);

        // Extract ARKit Oculomotor Blendshapes (already computed by MediaPipe FaceLandmarker)
        const blendMap: Record<string, number> = {};
        if (results.faceBlendshapes && results.faceBlendshapes.length > 0) {
          const cats = results.faceBlendshapes[0].categories;
          for (let i = 0; i < cats.length; i++) {
            blendMap[cats[i].categoryName] = cats[i].score;
          }
        }

        const eyeBlinkLeft = blendMap['eyeBlinkLeft'] ?? 0;
        const eyeBlinkRight = blendMap['eyeBlinkRight'] ?? 0;
        const isBlinking =
          leftEAR < 0.19 ||
          rightEAR < 0.19 ||
          eyeBlinkLeft > 0.55 ||
          eyeBlinkRight > 0.55;

        // 5-Point Iris Centroids (reduces single-landmark quantum jitter by sqrt(5))
        const computeIrisCentroid = (indices: number[], fallbackIdx: number) => {
          let sx = 0, sy = 0, sz = 0, count = 0;
          for (const idx of indices) {
            const pt = landmarks[idx];
            if (pt) {
              sx += pt.x;
              sy += pt.y;
              sz += pt.z ?? 0;
              count++;
            }
          }
          if (count === 0) {
            const fb = landmarks[fallbackIdx] || { x: 0.5, y: 0.5, z: 0 };
            return { x: fb.x, y: fb.y, z: fb.z ?? 0 };
          }
          return { x: sx / count, y: sy / count, z: sz / count };
        };

        const pupilL = computeIrisCentroid([468, 469, 470, 471, 472], 468);
        const pupilR = computeIrisCentroid([473, 474, 475, 476, 477], 473);

        // Roll-invariant & Scale-invariant Intrinsic Eye Coordinates (u, v)
        // Projects iris displacement onto the anatomical canthal axis (outer <-> inner corner)
        // and normalizes by palpebral fissure width so head translation, Z-depth, and head roll cancel out.
        const computeIntrinsicEyeCoords = (
          pupil: { x: number; y: number },
          leftMostCorner: { x: number; y: number },
          rightMostCorner: { x: number; y: number },
          upperLid?: { x: number; y: number },
          lowerLid?: { x: number; y: number }
        ) => {
          const dxCorner = rightMostCorner.x - leftMostCorner.x;
          const dyCorner = rightMostCorner.y - leftMostCorner.y;
          const eyeWidth = Math.max(0.0001, Math.hypot(dxCorner, dyCorner));

          // Unit vectors along the palpebral axis (ex) and perpendicular to it (ey)
          const exX = dxCorner / eyeWidth;
          const exY = dyCorner / eyeWidth;
          const eyX = -exY;
          const eyY = exX;

          const midX = (leftMostCorner.x + rightMostCorner.x) / 2;
          let midY = (leftMostCorner.y + rightMostCorner.y) / 2;
          if (upperLid && lowerLid) {
            const lidMidY = (upperLid.y + lowerLid.y) / 2;
            midY = midY * 0.65 + lidMidY * 0.35;
          }

          const relX = pupil.x - midX;
          const relY = pupil.y - midY;

          const u = (relX * exX + relY * exY) / eyeWidth;
          const v = (relX * eyX + relY * eyY) / eyeWidth;
          return { u, v, eyeWidth };
        };

        const leftIntrinsic = computeIntrinsicEyeCoords(
          pupilL,
          landmarks[33],
          landmarks[133],
          landmarks[159],
          landmarks[145]
        );
        const rightIntrinsic = computeIntrinsicEyeCoords(
          pupilR,
          landmarks[362],
          landmarks[263],
          landmarks[386],
          landmarks[374]
        );

        // Blendshape gaze signals: horizontal & vertical appearance cues
        // Note: in camera image space, looking to the user's right (screen right) corresponds to
        // left eye looking IN (nasal) and right eye looking OUT (temporal).
        const lookInL = blendMap['eyeLookInLeft'] ?? 0;
        const lookOutL = blendMap['eyeLookOutLeft'] ?? 0;
        const lookUpL = blendMap['eyeLookUpLeft'] ?? 0;
        const lookDownL = blendMap['eyeLookDownLeft'] ?? 0;

        const lookInR = blendMap['eyeLookInRight'] ?? 0;
        const lookOutR = blendMap['eyeLookOutRight'] ?? 0;
        const lookUpR = blendMap['eyeLookUpRight'] ?? 0;
        const lookDownR = blendMap['eyeLookDownRight'] ?? 0;

        const blendX = ((lookInL - lookOutL) + (lookOutR - lookInR)) / 2;
        const blendY = ((lookDownL - lookUpL) + (lookDownR - lookUpR)) / 2;

        // Anclaje Cefálico Rígido (Glabela - Landmark 168 - Chhimpa et al., 2024)
        const glabella = landmarks[168] ? { x: landmarks[168].x, y: landmarks[168].y, z: landmarks[168].z } : { x: 0.5, y: 0.5, z: 0 };

        // Diámetro Horizontal del Iris (MediaPipe 469-471 / 474-476)
        const irisDiameterL = (landmarks[469] && landmarks[471]) ? dist2D(landmarks[469], landmarks[471]) : 0;
        const irisDiameterR = (landmarks[474] && landmarks[476]) ? dist2D(landmarks[474], landmarks[476]) : 0;
        const irisDiameterAvg = (irisDiameterL + irisDiameterR) / 2;

        rawMetrics = {
          pupilL,
          pupilR,
          corners: {
            LO: landmarks[33],
            LI: landmarks[133],
            RI: landmarks[362],
            RO: landmarks[263]
          },
          eyeFeatures: {
            uL: leftIntrinsic.u,
            vL: leftIntrinsic.v,
            uR: rightIntrinsic.u,
            vR: rightIntrinsic.v,
            uAvg: (leftIntrinsic.u + rightIntrinsic.u) / 2,
            vAvg: (leftIntrinsic.v + rightIntrinsic.v) / 2,
            blendX,
            blendY
          },
          glabella,
          irisDiameter: irisDiameterAvg,
          ear: {
            left: leftEAR,
            right: rightEAR,
            avg: (leftEAR + rightEAR) / 2,
            isBlinking
          },
          headPose: { yaw, pitch, roll }
        };
      }
      
      // Enviamos el resultado crudo para que el modelo Zhang & Yin en React lo procese
      self.postMessage({ 
        type: 'RESULTS', 
        rawMetrics: rawMetrics,
        rawResultsAvailable: results.faceLandmarks.length > 0,
        landmarkCount: results.faceLandmarks.length > 0 ? results.faceLandmarks[0].length : 0
      });
      
    } catch (e) {
      console.error("Error durante la inferencia biométrica", e);
    } finally {
      // PRIVACIDAD Y RENDIMIENTO: Destruir el frame de la RAM al instante
      // Al cerrar el ImageBitmap, la recolección de basura es instantánea y se
      // asegura de que el fotograma no sobrevive ni un milisegundo extra.
      if (image && typeof image.close === 'function') {
        image.close();
      }
    }
  }
};
