import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { computeCompensatedGaze } from './headCompensation';

let faceLandmarker: FaceLandmarker | null = null;

// Inicializamos el entorno de WebAssembly (WASM) en el hilo secundario
async function initializeMediaPipe() {
  try {
    // Obtenemos los binarios compilados de WASM (se descargan o leen de caché)
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
    );
    
    // Instanciamos el modelo matemático pesado (delegando a la GPU/CPU interna vía WASM)
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
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
        rawResultsAvailable: results.faceLandmarks.length > 0
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
