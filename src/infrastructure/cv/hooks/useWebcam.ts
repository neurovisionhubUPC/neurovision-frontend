import { useRef, useState, useCallback, useEffect } from 'react';

/**
 * Hook personalizado para la gestión de la cámara web con enfoque de "Privacidad desde el Diseño".
 * Garantiza que el flujo de video (MediaStream) solo viva en la memoria volátil (RAM)
 * de la pestaña actual del navegador.
 */

export const useWebcam = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startWebcam = useCallback(async (deviceId?: string) => {
    try {
      setError(null);
      
      // Validación 1: Verificar contexto seguro (HTTPS o localhost)
      if (!window.isSecureContext) {
        throw new Error('Violación de Privacidad: El acceso a la cámara requiere un contexto seguro (HTTPS).');
      }

      // Detener stream previo si existe antes de cambiar de cámara
      if (videoRef.current && videoRef.current.srcObject) {
        const prevStream = videoRef.current.srcObject as MediaStream;
        prevStream.getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }

      const constraints: MediaStreamConstraints = {
        video: {
          width: { ideal: 2560 }, // Solicitamos 1440p (2K) o superior si está disponible
          height: { ideal: 1440 },
          facingMode: 'user',
          ...(deviceId ? { deviceId: { exact: deviceId } } : {})
        },
        audio: false, // Validación crucial: el sistema NUNCA solicita ni graba audio.
      };

      // Solicitud del stream. Este objeto `stream` es un puntero en RAM a los buffers de hardware.
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      if (videoRef.current) {
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
      stream.getTracks().forEach(track => {
        track.stop();
      });
      
      videoRef.current.srcObject = null;
      setIsStreaming(false);
    }
  }, []);

  // Validación 4: Garbage Collection y limpieza preventiva al desmontar el componente.
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
