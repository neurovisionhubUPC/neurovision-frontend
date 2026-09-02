import { useRef, useState, useCallback, useEffect } from 'react';

/**
 * Hook personalizado para la gestión de la cámara web con enfoque de "Privacidad desde el Diseño".
 * Garantiza que el flujo de video (MediaStream) solo viva en la memoria volátil (RAM)
 * de la pestaña actual del navegador.
 */

// Restringimos explícitamente el audio por privacidad y solicitamos resolución óptima para CV.
const STRICT_VIDEO_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    width: { ideal: 2560 }, // Solicitamos 1440p (2K) o superior si está disponible
    height: { ideal: 1440 },
    facingMode: 'user',
  },
  audio: false, // Validación crucial: el sistema NUNCA solicita ni graba audio.
};

export const useWebcam = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startWebcam = useCallback(async () => {
    try {
      setError(null);
      
      // Validación 1: Verificar contexto seguro (HTTPS o localhost)
      // getUserMedia no permite transmitir sin cifrado local o de red.
      if (!window.isSecureContext) {
        throw new Error('Violación de Privacidad: El acceso a la cámara requiere un contexto seguro (HTTPS).');
      }

      // Solicitud del stream. Este objeto `stream` es un puntero en RAM a los buffers de hardware.
      const stream = await navigator.mediaDevices.getUserMedia(STRICT_VIDEO_CONSTRAINTS);
      
      if (videoRef.current) {
        // Validación 2: El stream se asigna directamente al srcObject (referencia volátil),
        // NUNCA como un src de string codificado (blob URL base64) que pudiera cachearse en disco.
        videoRef.current.srcObject = stream;
        
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play();
          setIsStreaming(true);
        };
      }
    } catch (err: any) {
      setError(err.message || 'Permiso de cámara denegado o dispositivo no encontrado.');
      setIsStreaming(false);
    }
  }, []);

  const stopWebcam = useCallback(() => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      
      // Validación 3: Destrucción inmediata del pipeline a nivel hardware.
      // Detener cada track purga instantáneamente los buffers de captura en RAM.
      stream.getTracks().forEach(track => {
        track.stop();
      });
      
      videoRef.current.srcObject = null;
      setIsStreaming(false);
    }
  }, []);

  // Validación 4: Garbage Collection y limpieza preventiva al desmontar el componente.
  // Evita procesos fantasmas de la cámara si el usuario cambia de pestaña o ruta.
  useEffect(() => {
    return () => {
      stopWebcam();
    };
  }, [stopWebcam]);

  return {
    videoRef,
    isStreaming,
    error,
    startWebcam,
    stopWebcam
  };
};
