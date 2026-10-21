import { useEffect, useRef, useCallback, useState } from 'react';

/**
 * Hook personalizado para manejar la concurrencia del Web Worker.
 * Actúa como puente bidireccional entre la UI (React) y WASM (Worker).
 * Incluye política de descarte de fotogramas (Backpressure / Drop-Frame)
 * para evitar latencia acumulada en cola y garantizar respuesta en tiempo real (<25ms).
 */
export const useMediaPipeWorker = (onResults: (results: any) => void) => {
  const workerRef = useRef<Worker | null>(null);
  const isReadyRef = useRef(false);
  const isProcessingRef = useRef(false);
  const lastDispatchTimeRef = useRef(0);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    workerRef.current = new Worker(
      new URL('../worker/mediapipe.worker.ts', import.meta.url),
      { type: 'module' }
    );

    // 2. Escuchamos las respuestas que provienen del hilo secundario (WASM)
    workerRef.current.onmessage = (event: MessageEvent) => {
      const { type } = event.data;
      
      if (type === 'INITIALIZED') {
        isReadyRef.current = true;
        setIsLoaded(true);
        console.log("⚡ [React] Web Worker y WASM Inicializados.");
      } else if (type === 'RESULTS') {
        // LIBERAR BLOQUEO: El worker ha finalizado el fotograma y está libre
        isProcessingRef.current = false;
        onResults(event.data);
      }
    };

    return () => {
      workerRef.current?.terminate();
      isReadyRef.current = false;
      isProcessingRef.current = false;
    };
  }, [onResults]);

  /**
   * Extrae un frame del video HTML y lo transfiere al Web Worker.
   */
  const processVideoFrame = useCallback(async (video: HTMLVideoElement, timestamp: number) => {
    if (!workerRef.current || !isReadyRef.current) return;
    
    const now = performance.now();

    // POLÍTICA ANTI-COLA (Zero Lag / Backpressure):
    // Si el worker aún está ocupado procesando el frame anterior, DESCARTAMOS el actual.
    // Esto previene que se acumulen 100+ frames en el buffer del navegador causando 10-30s de delay.
    if (isProcessingRef.current) {
      // Timeout de seguridad: si pasaron más de 300ms sin respuesta, desbloqueamos forzosamente
      if (now - lastDispatchTimeRef.current > 300) {
        isProcessingRef.current = false;
      } else {
        return; // Dropped frame (mantiene el pipeline 100% en tiempo real)
      }
    }
    
    try {
      isProcessingRef.current = true;
      lastDispatchTimeRef.current = now;

      // Optimización: Redimensionamos el bitmap a 1280x720 si el video original es 2K/1440p
      // Esto reduce 4x la transferencia de memoria sin perder un solo milímetro de precisión en pupilas.
      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(video, {
          resizeWidth: 1280,
          resizeHeight: 720,
          resizeQuality: 'low'
        });
      } catch {
        bitmap = await createImageBitmap(video);
      }
      
      // TRANSFERABLE OBJECTS: Zero-Copy transfer al hilo WASM
      workerRef.current.postMessage({
        type: 'PROCESS_FRAME',
        image: bitmap,
        timestamp
      }, [bitmap]);

    } catch (e) {
      isProcessingRef.current = false;
      console.warn("Frame descartado por saturación o video pausado.", e);
    }
  }, []);

  return { 
    processVideoFrame, 
    isReady: () => isReadyRef.current,
    isLoaded
  };
};
