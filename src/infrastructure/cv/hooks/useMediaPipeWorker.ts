import { useEffect, useRef, useCallback } from 'react';

/**
 * Hook personalizado para manejar la concurrencia del Web Worker.
 * Actúa como puente bidireccional entre la UI (React) y WASM (Worker).
 */
export const useMediaPipeWorker = (onResults: (results: any) => void) => {
  const workerRef = useRef<Worker | null>(null);
  const isReadyRef = useRef(false);

  useEffect(() => {
    // 1. Instanciamos el Worker. Vite soporta la importación de workers usando `?worker` o URLs.
    workerRef.current = new Worker(
      new URL('../worker/mediapipe.worker.ts', import.meta.url), 
      { type: 'module' }
    );

    // 2. Escuchamos las respuestas que provienen del hilo secundario (WASM)
    workerRef.current.onmessage = (event: MessageEvent) => {
      const { type, results } = event.data;
      
      if (type === 'INITIALIZED') {
        isReadyRef.current = true;
        console.log("⚡ [React] Web Worker y WASM Inicializados.");
      } else if (type === 'RESULTS') {
        // Enviar coordenadas JSON a la UI
        onResults(results);
      }
    };

    // 3. Matar el worker cuando el componente se desmonta por seguridad
    return () => {
      workerRef.current?.terminate();
      isReadyRef.current = false;
    };
  }, [onResults]);

  /**
   * Extrae un frame del video HTML y lo transfiere al Web Worker.
   */
  const processVideoFrame = useCallback(async (video: HTMLVideoElement, timestamp: number) => {
    if (!workerRef.current || !isReadyRef.current) return;
    
    // PRIVACIDAD POR DISEÑO: No pasamos el <video> (no se puede), y no usamos base64.
    // createImageBitmap convierte el frame del hardware de decodificación a un bitmap en RAM crudo.
    try {
      const bitmap = await createImageBitmap(video);
      
      // TRANSFERABLE OBJECTS: Al pasar `bitmap` en el segundo parámetro (array),
      // DESPRENDEMOS el frame de la memoria del hilo principal y lo "movemos" al Worker.
      // Esto logra la transferencia más rápida posible (Zero-Copy) e impide 
      // que el hilo principal se quede con una copia (Alta seguridad).
      workerRef.current.postMessage({
        type: 'PROCESS_FRAME',
        image: bitmap,
        timestamp
      }, [bitmap]);

    } catch (e) {
      // Errores al extraer bitmap (por ejemplo, video no listo)
      console.warn("Frame descartado por saturación o video pausado.", e);
    }
  }, []);

  return { 
    processVideoFrame, 
    isReady: () => isReadyRef.current 
  };
};
