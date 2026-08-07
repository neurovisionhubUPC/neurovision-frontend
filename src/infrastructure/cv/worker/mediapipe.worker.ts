import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { computeCompensatedGaze } from './headCompensation';

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
      
      let compensatedData = null;
      if (results.faceLandmarks && results.faceLandmarks.length > 0) {
        // Ejecutamos a máxima velocidad (30+ Hz) nuestro algoritmo vectorial
        compensatedData = computeCompensatedGaze(results.faceLandmarks[0]);
      }
      
      // Enviamos el resultado procesado, omitiendo la enorme malla de landmarks crudos
      // para reducir el peso de serialización del postMessage y aumentar los FPS.
      self.postMessage({ 
        type: 'RESULTS', 
        gaze: compensatedData,
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
