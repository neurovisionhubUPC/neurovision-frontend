import React, { useEffect, useState } from 'react';
import { 
  CheckCircle2, 
  Sun, 
  HelpCircle, 
  ArrowRight, 
  RotateCcw, 
  Lock, 
  Sparkles, 
  Layers, 
  ChevronDown, 
  Info,
  AlertTriangle,
  ShieldAlert
} from 'lucide-react';
import { useEnvironmentalValidation } from '../../../../infrastructure/cv/hooks/useEnvironmentalValidation';

interface PreCalibrationViewProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  pipCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  isStreaming: boolean;
  onStartCalibration: () => void;
  onRetryCamera: (deviceId?: string) => void;
  rawMetricsRef: React.RefObject<any>;
  fps?: number;
}

export const PreCalibrationView: React.FC<PreCalibrationViewProps> = ({
  videoRef,
  pipCanvasRef,
  isStreaming,
  onStartCalibration,
  onRetryCamera,
  rawMetricsRef,
  fps = 60
}) => {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');

  // Validación y Telemetría en tiempo real de luz, tapa y distancia (Zero Lag via Ref)
  const validation = useEnvironmentalValidation(videoRef, isStreaming, rawMetricsRef);
  const { camera, lighting, distance, canProceed, blockReason } = validation;

  // Cargar dispositivos de video disponibles
  useEffect(() => {
    async function getDevices() {
      try {
        const devList = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devList.filter(d => d.kind === 'videoinput');
        setDevices(videoInputs);
        if (videoInputs.length > 0 && !selectedDevice) {
          setSelectedDevice(videoInputs[0].deviceId);
        }
      } catch (err) {
        console.warn('No se pudieron listar cámaras:', err);
      }
    }
    getDevices();
  }, [selectedDevice]);

  const handleDeviceChange = (deviceId: string) => {
    setSelectedDevice(deviceId);
    onRetryCamera(deviceId);
  };

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6 animate-in fade-in duration-300">
      
      {/* Header Banner */}
      <div className="space-y-2">
        <div className="inline-flex items-center space-x-2 bg-[#DCF8F2] text-[#0F6F62] px-3.5 py-1 rounded-full text-xs font-bold tracking-wide">
          <span className="w-2 h-2 rounded-full bg-[#26A69A] animate-pulse"></span>
          <span>CALIBRACIÓN PREVIA ACTIVA</span>
        </div>

        <h1 className="text-3xl sm:text-4xl font-extrabold text-[#1C2A39] tracking-tight">
          Alineación Visual y Verificación Técnica
        </h1>
        <p className="text-sm sm:text-base text-[#455A64] max-w-3xl leading-relaxed">
          Siéntese en una posición cómoda frente al ordenador. El sistema detectará automáticamente sus ojos para garantizar que las terapias de fijación y rastreo funcionen con la máxima precisión médica.
        </p>
      </div>

      {/* Main Grid: Left Webcam Box, Right Conditions Check */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Left Column (5 Cols): Video feed & Device Selector */}
        <div className="lg:col-span-5 space-y-4">
          {/* Video Container Box */}
          <div className="relative bg-[#0E1722] rounded-2xl overflow-hidden shadow-md border-2 border-[#1C2A39]/20 aspect-4/3 flex items-center justify-center">
            
            {/* Top Badges */}
            <div className="absolute top-3.5 left-3.5 right-3.5 flex justify-between items-center z-20 pointer-events-none">
              <span className={`inline-flex items-center space-x-2 text-[11px] font-bold px-3 py-1.5 rounded-lg border backdrop-blur-xs ${
                camera.isCovered 
                  ? 'bg-red-950/80 text-red-300 border-red-500/30' 
                  : 'bg-[#1C2A39]/80 text-[#26A69A] border-white/10'
              }`}>
                <span className={`w-2 h-2 rounded-full ${camera.isCovered ? 'bg-red-400' : 'bg-[#26A69A] animate-ping'}`}></span>
                <span>{camera.isCovered ? 'SENSOR BLOQUEADO' : `SENSOR OCULAR ACTIVO (${isStreaming ? `${fps} Hz` : 'Conectando...'})`}</span>
              </span>

              <span className={`inline-flex items-center space-x-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg border backdrop-blur-xs ${
                distance.hasFace ? 'bg-[#1C2A39]/80 text-[#8AE2D6] border-white/10' : 'bg-[#1C2A39]/80 text-amber-300 border-amber-500/20'
              }`}>
                <Sparkles size={13} />
                <span>{distance.hasFace ? 'Rostro Enfocado' : 'Buscando Rostro'}</span>
              </span>
            </div>

            {/* Video Stream Element */}
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="w-full h-full object-cover -scale-x-100 opacity-95"
            />

            {/* Overlay Landmarks Canvas */}
            <canvas
              ref={pipCanvasRef}
              width={640}
              height={480}
              className="absolute inset-0 w-full h-full object-cover -scale-x-100 pointer-events-none z-10"
            />

            {/* Aviso si la cámara está tapada físicamente */}
            {camera.isCovered && (
              <div className="absolute inset-0 bg-black/85 backdrop-blur-xs flex flex-col items-center justify-center p-6 text-center z-25 text-white space-y-3">
                <div className="w-12 h-12 rounded-full bg-red-600/30 text-red-400 flex items-center justify-center border border-red-500/40">
                  <ShieldAlert size={28} />
                </div>
                <div className="space-y-1">
                  <h4 className="font-bold text-base text-red-200">Tapa o Protector de Cámara Detectado</h4>
                  <p className="text-xs text-neutral-300 max-w-xs leading-relaxed">
                    No se recibe señal luminosa en el sensor. Retire la pestaña de privacidad física para habilitar el seguimiento ocular.
                  </p>
                </div>
              </div>
            )}

            {/* Futuristic Alignment Hologram Overlay */}
            {!camera.isCovered && (
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-15">
                {/* Outer Head Silhouette Circle */}
                <div className={`relative w-[240px] h-[300px] rounded-[120px] border-2 transition-all duration-300 flex items-center justify-center ${
                  distance.hasFace 
                    ? distance.status === 'OPTIMAL'
                      ? 'border-[#26A69A]/90 shadow-[0_0_30px_rgba(38,166,154,0.4)]' 
                      : 'border-amber-400/80 shadow-[0_0_20px_rgba(251,191,36,0.25)]'
                    : 'border-white/30 border-dashed'
                }`}>
                  {/* Badge instruction above head */}
                  <span className="absolute -top-3.5 bg-[#1C2A39]/90 text-white text-[11px] font-semibold px-3 py-1 rounded-full border border-white/20 backdrop-blur-xs">
                    {distance.hasFace ? 'Rostro Detectado' : 'Alinee su rostro y ojos aquí'}
                  </span>

                  {/* Eye guide indicators */}
                  <div className="flex items-center space-x-8 mt-2">
                    <div className="flex flex-col items-center space-x-0.5">
                      <div className={`w-12 h-10 rounded-xl border-2 flex items-center justify-center transition-all ${
                        distance.hasFace ? 'border-[#26A69A] bg-[#26A69A]/15' : 'border-white/40'
                      }`}>
                        <div className={`w-2.5 h-2.5 rounded-full ${distance.hasFace ? 'bg-[#26A69A]' : 'bg-white/40'}`} />
                      </div>
                      <span className="text-[9px] font-bold tracking-widest text-[#8AE2D6] mt-1.5">
                        OJO IZQ.
                      </span>
                    </div>

                    <div className="flex flex-col items-center space-x-0.5">
                      <div className={`w-12 h-10 rounded-xl border-2 flex items-center justify-center transition-all ${
                        distance.hasFace ? 'border-[#26A69A] bg-[#26A69A]/15' : 'border-white/40'
                      }`}>
                        <div className={`w-2.5 h-2.5 rounded-full ${distance.hasFace ? 'bg-[#26A69A]' : 'bg-white/40'}`} />
                      </div>
                      <span className="text-[9px] font-bold tracking-widest text-[#8AE2D6] mt-1.5">
                        OJO DER.
                      </span>
                    </div>
                  </div>

                  {/* Nose / mouth subtle line */}
                  <div className="absolute bottom-16 w-4 h-3 border-b-2 border-r-2 border-white/30 rounded-br-xs" />
                </div>
              </div>
            )}

            {/* Medical Privacy Banner at the bottom */}
            <div className="absolute bottom-3 left-3 right-3 bg-[#1C2A39]/90 backdrop-blur-xs text-white p-3 rounded-xl border border-white/10 z-20 flex items-start space-x-2.5 text-xs">
              <Lock size={15} className="text-[#26A69A] shrink-0 mt-0.5" />
              <p className="text-[11px] leading-relaxed text-neutral-200">
                <strong className="text-white font-semibold">Privacidad Médica Garantizada:</strong> Su imagen nunca se graba ni se transmite por internet. El rastreo de la mirada se ejecuta de forma local y 100% segura en este equipo.
              </p>
            </div>

            {/* Corner Decorative Tech Brackets */}
            <div className="absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-[#26A69A] pointer-events-none" />
            <div className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-[#26A69A] pointer-events-none" />
            <div className="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-[#26A69A] pointer-events-none" />
            <div className="absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-[#26A69A] pointer-events-none" />
          </div>

          {/* Device Selection Card */}
          <div className="bg-white border border-[#DCEBF4] rounded-2xl p-4 sm:p-5 shadow-xs space-y-3">
            <label className="block text-xs font-bold text-[#1C2A39]">
              Dispositivo de Cámara:
            </label>
            <div className="relative">
              <select
                value={selectedDevice}
                onChange={(e) => handleDeviceChange(e.target.value)}
                className="w-full bg-[#F8FBFE] border border-[#CDE9FA] rounded-xl px-4 py-2.5 text-xs sm:text-sm font-semibold text-[#1C2A39] appearance-none pr-10 focus:outline-none focus:border-[#26A69A]"
              >
                {devices.length > 0 ? (
                  devices.map((d, idx) => (
                    <option key={d.deviceId || idx} value={d.deviceId}>
                      {d.label || `Cámara ${idx + 1} HD (1080p)`}
                    </option>
                  ))
                ) : (
                  <option value="">Cámara Integrada HD (FaceTime / USB 1080p)</option>
                )}
              </select>
              <ChevronDown size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#455A64] pointer-events-none" />
            </div>

            <button
              onClick={() => onRetryCamera(selectedDevice)}
              className="inline-flex items-center space-x-2 bg-white hover:bg-[#F3FAFF] text-[#1C2A39] border border-[#D5E5EF] px-4 py-2 rounded-xl text-xs font-bold shadow-2xs transition-all active:scale-95"
            >
              <RotateCcw size={14} />
              <span>Volver a Probar</span>
            </button>
          </div>
        </div>

        {/* Right Column (7 Cols): Conditions Checklist & Clinical Tip */}
        <div className="lg:col-span-7 space-y-4">
          
          <div className="space-y-1">
            <h3 className="text-xl font-bold text-[#1C2A39]">Comprobación de Condiciones</h3>
            <p className="text-xs sm:text-sm text-[#455A64]">
              Asegúrese de que el entorno esté listo para una sesión precisa, cómoda y sin fatiga visual.
            </p>
          </div>

          {/* Condition 1: Cámara detectada y activa */}
          <div className={`bg-white border rounded-2xl p-5 shadow-xs flex items-start space-x-4 transition-all ${
            camera.passed ? 'border-[#DCEBF4]' : 'border-red-200 bg-red-50/20'
          }`}>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
              camera.passed ? 'bg-[#DCF8F2] text-[#0F6F62]' : 'bg-red-100 text-red-600'
            }`}>
              {camera.passed ? (
                <CheckCircle2 size={22} className="stroke-[2.5]" />
              ) : (
                <AlertTriangle size={22} className="stroke-[2.5]" />
              )}
            </div>
            <div className="flex-1 space-y-1.5">
              <div className="flex items-center justify-between">
                <h4 className="text-sm sm:text-base font-bold text-[#1C2A39]">
                  1. Cámara detectada y activa
                </h4>
                <span className={`inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-bold ${
                  camera.passed ? 'bg-[#DCF8F2] text-[#0F6F62]' : 'bg-red-100 text-red-700'
                }`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
                  <span>{camera.label}</span>
                </span>
              </div>
              <p className="text-xs sm:text-sm text-[#455A64] leading-relaxed">
                {camera.description}
              </p>
            </div>
          </div>

          {/* Condition 2: Iluminación de la habitación */}
          <div className={`bg-white border rounded-2xl p-5 shadow-xs flex items-start space-x-4 transition-all ${
            lighting.passed ? 'border-[#DCEBF4]' : 'border-amber-200 bg-amber-50/20'
          }`}>
            <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 mt-0.5 ${
              lighting.passed 
                ? 'bg-[#E6F6FF] text-[#26A69A] border-[#CDE9FA]' 
                : 'bg-amber-100 text-amber-700 border-amber-300'
            }`}>
              <Sun size={22} />
            </div>
            <div className="flex-1 space-y-2.5">
              <div className="flex items-center justify-between">
                <h4 className="text-sm sm:text-base font-bold text-[#1C2A39]">
                  2. Iluminación de la habitación
                </h4>
                <span className={`inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-bold ${
                  lighting.passed ? 'bg-[#DCF8F2] text-[#0F6F62]' : 'bg-amber-100 text-amber-700'
                }`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
                  <span>{lighting.label}</span>
                </span>
              </div>
              <p className="text-xs sm:text-sm text-[#455A64] leading-relaxed">
                {lighting.description}
              </p>
              
              {/* Lighting Slider indicator dinámico */}
              <div className="space-y-1">
                <div className="relative w-full h-2.5 bg-[#E2EEF5] rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-linear-to-r from-[#F4A261] via-[#26A69A] to-[#F4A261] transition-all duration-300 rounded-full" 
                    style={{ width: `${lighting.percentage}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-[#455A64] font-semibold">
                  <span className={lighting.status === 'LOW' ? 'text-amber-700 font-bold' : ''}>Poca Luz</span>
                  <span className={`uppercase tracking-wider ${lighting.status === 'OPTIMAL' ? 'text-[#0F6F62] font-bold' : ''}`}>
                    ZONA RECOMENDADA (250-550 Lux)
                  </span>
                  <span className={lighting.status === 'EXCESSIVE' ? 'text-red-700 font-bold' : ''}>Exceso / Reflejo</span>
                </div>
              </div>
            </div>
          </div>

          {/* Condition 3: Distancia del rostro */}
          <div className={`bg-white border rounded-2xl p-5 shadow-xs flex items-start space-x-4 transition-all ${
            distance.passed ? 'border-[#DCEBF4]' : 'border-amber-200 bg-amber-50/20'
          }`}>
            <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 mt-0.5 ${
              distance.passed 
                ? 'bg-[#E6F6FF] text-[#26A69A] border-[#CDE9FA]' 
                : 'bg-amber-100 text-amber-700 border-amber-300'
            }`}>
              <Layers size={20} />
            </div>
            <div className="flex-1 space-y-2.5">
              <div className="flex items-center justify-between">
                <h4 className="text-sm sm:text-base font-bold text-[#1C2A39]">
                  3. Distancia del rostro (40 - 60 cm)
                </h4>
                <span className={`inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-bold ${
                  distance.passed 
                    ? 'bg-[#DCF8F2] text-[#0F6F62]' 
                    : distance.hasFace ? 'bg-[#FFF2E2] text-[#B85D19]' : 'bg-neutral-100 text-neutral-600'
                }`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
                  <span>{distance.label}</span>
                </span>
              </div>
              <p className="text-xs sm:text-sm text-[#455A64] leading-relaxed">
                {distance.description}
              </p>

              {/* Distance Slider with Target Pointer en tiempo real */}
              <div className="space-y-1 pt-1">
                <div className="relative w-full h-2.5 bg-[#E2EEF5] rounded-full">
                  {/* Recommended middle zone (40cm a 60cm en rango 30-70cm = 25% a 75%) */}
                  <div className="absolute left-[25%] right-[25%] h-full bg-[#A7E7DC] rounded-full" />
                  
                  {/* Indicator Dot */}
                  {distance.hasFace && (
                    <div 
                      className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 border-2 border-white rounded-full shadow-xs transition-all duration-200 ${
                        distance.passed ? 'bg-[#0F6F62]' : 'bg-[#B85D19]'
                      }`}
                      style={{ left: `${distance.percentage}%` }}
                    />
                  )}
                </div>
                <div className="flex justify-between text-[10px] text-[#455A64] font-semibold">
                  <span className={distance.status === 'TOO_CLOSE' ? 'text-amber-700 font-bold' : ''}>Muy Cerca (&lt;38 cm)</span>
                  <span className="font-bold text-[#1C2A39]">
                    {distance.hasFace ? `${distance.distanceCm} cm (Ideal: 50 cm)` : 'Esperando Rostro'}
                  </span>
                  <span className={distance.status === 'TOO_FAR' ? 'text-amber-700 font-bold' : ''}>Muy Lejos (&gt;62 cm)</span>
                </div>
              </div>
            </div>
          </div>

          {/* Clinical Tip Box */}
          <div className="bg-[#EBF7FD] border border-[#CDE9FA] rounded-2xl p-4 sm:p-5 flex items-start space-x-3.5">
            <div className="w-6 h-6 rounded-full bg-[#1C2A39] text-white flex items-center justify-center shrink-0 mt-0.5">
              <Info size={14} />
            </div>
            <p className="text-xs sm:text-sm text-[#1C2A39] leading-relaxed">
              <strong className="font-bold">Consejo Clínico del Terapeuta:</strong> Si utiliza gafas graduadas para lectura o uso de ordenador, puede usarlas con normalidad. El software compensará los cristales automáticamente.
            </p>
          </div>

        </div>

      </div>

      {/* Mandatory Condition Blocking Notice (si alguna condición no se cumple) */}
      {!canProceed && blockReason && (
        <div className="bg-[#FFF4E5] border border-[#FFE2C2] text-[#B85D19] p-4 rounded-xl flex items-center space-x-3 text-xs sm:text-sm">
          <AlertTriangle size={18} className="shrink-0" />
          <span>
            <strong>Condición pendiente:</strong> {blockReason}
          </span>
        </div>
      )}

      {/* Bottom Actions Bar */}
      <div className="pt-4 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-[#DCEBF4]">
        <button
          onClick={() => alert('Soporte de asistencia en camino por WhatsApp o Teléfono...')}
          className="w-full sm:w-auto inline-flex items-center justify-center space-x-2 bg-white hover:bg-neutral-50 text-[#1C2A39] border-2 border-[#1C2A39] px-6 py-3.5 rounded-xl font-bold text-sm shadow-2xs transition-all active:scale-95"
        >
          <HelpCircle size={18} />
          <span>¿Dificultades para ajustar? Pedir Asistencia</span>
        </button>

        <button
          onClick={onStartCalibration}
          disabled={!canProceed}
          className={`w-full sm:w-auto inline-flex items-center justify-center space-x-2.5 px-8 py-3.5 rounded-xl font-bold text-base shadow-sm transition-all ${
            canProceed
              ? 'bg-[#0F6F62] hover:bg-[#0C584E] text-white active:scale-95 cursor-pointer shadow-[0_4px_14px_rgba(15,111,98,0.35)]'
              : 'bg-neutral-300 text-neutral-500 cursor-not-allowed opacity-75'
          }`}
          title={!canProceed && blockReason ? blockReason : 'Iniciar la calibración de 9 puntos'}
        >
          <span>Todo Listo · Calibrar Ojos</span>
          <ArrowRight size={19} />
        </button>
      </div>

    </div>
  );
};
