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
        
        rawMetrics = {
          pupilL: landmarks[468],
          pupilR: landmarks[473],
          corners: {
            LO: landmarks[33],
            LI: landmarks[133],
            RI: landmarks[362],
            RO: landmarks[263]
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
