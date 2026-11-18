import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, ArrowRight, HelpCircle, X, Sun, ShieldAlert, Monitor, CheckCircle2 } from 'lucide-react';
import { AccessibleButton } from '../components/AccessibleButton';
import { useAppStore } from '../../../../core/store/useAppStore';

export const WelcomePage: React.FC = () => {
  const navigate = useNavigate();
  const setHasCompletedOnboarding = useAppStore(state => state.setHasCompletedOnboarding);
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isHelpOpen) {
        setIsHelpOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isHelpOpen]);

  const handleStart = () => {
    setHasCompletedOnboarding(true);
    navigate('/serious-games');
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 text-center bg-hc-black">
      <div className="max-w-4xl mx-auto space-y-12">
        <div className="flex justify-center mb-8">
          <div className="bg-hc-yellow text-hc-black p-8 rounded-full shadow-lg">
            <Eye size={120} strokeWidth={1.5} />
          </div>
        </div>
        
        <div className="space-y-6">
          <h1 className="text-5xl md:text-6xl font-bold text-hc-yellow tracking-tight">
            Bienvenido a NeuroVision
          </h1>
          <p className="text-2xl md:text-3xl text-hc-white max-w-3xl mx-auto leading-relaxed">
            Plataforma de evaluación y entrenamiento visual mediante seguimiento ocular.
          </p>
        </div>

        <div className="pt-12 flex flex-col sm:flex-row items-center justify-center gap-6">
          <AccessibleButton 
            onClick={handleStart}
            icon={<ArrowRight size={32} />}
          >
            Comenzar Evaluación
          </AccessibleButton>
          
          <AccessibleButton 
            variant="secondary"
            onClick={() => setIsHelpOpen(true)}
            icon={<HelpCircle size={32} />}
          >
            Necesito Ayuda
          </AccessibleButton>
        </div>
      </div>

      {/* Modal Accesible de Ayuda Rápida y Guía Visual */}
      {isHelpOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-modal-title"
          className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto animate-in fade-in duration-200"
        >
          <div className="bg-[#0E1722] border-4 border-hc-yellow text-white max-w-2xl w-full rounded-2xl p-6 sm:p-8 space-y-6 shadow-2xl relative my-auto text-left">
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-4 border-b-2 border-hc-yellow/30 pb-4">
              <div className="space-y-1">
                <span className="inline-flex items-center gap-1.5 bg-hc-yellow text-hc-black px-3 py-0.5 rounded text-xs font-black uppercase tracking-wider">
                  <CheckCircle2 size={14} /> Guía Visual Accesible
                </span>
                <h2 id="help-modal-title" className="text-2xl sm:text-3xl font-extrabold text-hc-yellow tracking-tight">
                  ¿Cómo funciona tu sesión de hoy?
                </h2>
                <p className="text-sm sm:text-base text-neutral-300">
                  Prepara tu entorno siguiendo estos 4 sencillos pasos antes de comenzar.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsHelpOpen(false)}
                aria-label="Cerrar ventana de ayuda"
                className="bg-transparent hover:bg-white/10 text-hc-yellow border-2 border-hc-yellow rounded-xl p-2 transition-transform active:scale-95 shrink-0"
              >
                <X size={24} />
              </button>
            </div>

            {/* 4 Step Cards */}
            <div className="space-y-4">
              {/* Step 1 */}
              <div className="bg-black/60 border-2 border-neutral-700 hover:border-hc-yellow rounded-xl p-4 flex items-start gap-4 transition-colors">
                <div className="w-12 h-12 rounded-xl bg-hc-yellow text-hc-black flex items-center justify-center shrink-0">
                  <Monitor size={24} strokeWidth={2.5} />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base sm:text-lg font-bold text-hc-yellow">
                    1. Ubicación frente a la cámara (50 cm)
                  </h3>
                  <p className="text-xs sm:text-sm text-neutral-200 leading-relaxed">
                    Siéntate erguido y cómodo frente a la pantalla a la distancia de tu brazo extendido (~50 cm). Tus ojos deben quedar a la altura de la parte superior del monitor.
                  </p>
                </div>
              </div>

              {/* Step 2 */}
              <div className="bg-black/60 border-2 border-neutral-700 hover:border-hc-yellow rounded-xl p-4 flex items-start gap-4 transition-colors">
                <div className="w-12 h-12 rounded-xl bg-hc-yellow text-hc-black flex items-center justify-center shrink-0">
                  <Sun size={24} strokeWidth={2.5} />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base sm:text-lg font-bold text-hc-yellow">
                    2. Iluminación adecuada en la habitación
                  </h3>
                  <p className="text-xs sm:text-sm text-neutral-200 leading-relaxed">
                    Asegúrate de contar con luz homogénea (250 a 550 Lux). Evita ventanas directas o lámparas a tus espaldas para que no se generen reflejos en tus gafas o en la pantalla.
                  </p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="bg-black/60 border-2 border-neutral-700 hover:border-hc-yellow rounded-xl p-4 flex items-start gap-4 transition-colors">
                <div className="w-12 h-12 rounded-xl bg-hc-yellow text-hc-black flex items-center justify-center shrink-0">
                  <Eye size={24} strokeWidth={2.5} />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base sm:text-lg font-bold text-hc-yellow">
                    3. Calibración rápida de la mirada (9 Puntos)
                  </h3>
                  <p className="text-xs sm:text-sm text-neutral-200 leading-relaxed">
                    Verás 9 puntos aparecer secuencialmente en la pantalla. Síguelos solo con la mirada sin mover la cabeza. Puedes utilizar tus gafas habituales con tranquilidad.
                  </p>
                </div>
              </div>

              {/* Step 4 */}
              <div className="bg-black/60 border-2 border-neutral-700 hover:border-hc-yellow rounded-xl p-4 flex items-start gap-4 transition-colors">
                <div className="w-12 h-12 rounded-xl bg-hc-yellow text-hc-black flex items-center justify-center shrink-0">
                  <ShieldAlert size={24} strokeWidth={2.5} />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base sm:text-lg font-bold text-hc-yellow">
                    4. Pausas y seguridad ante fatiga visual
                  </h3>
                  <p className="text-xs sm:text-sm text-neutral-200 leading-relaxed">
                    Si en algún momento sientes fatiga ocular, mareo o visión doble, cierra los ojos durante 2 minutos o solicita apoyo. Tu comodidad y seguridad son lo primero.
                  </p>
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="pt-2 flex flex-col sm:flex-row items-center justify-end gap-3 border-t-2 border-hc-yellow/30">
              <button
                type="button"
                onClick={() => setIsHelpOpen(false)}
                className="w-full sm:w-auto px-6 py-3 rounded-xl border-2 border-neutral-400 text-neutral-200 hover:text-white hover:border-white font-bold text-sm transition-all"
              >
                Entendido, Cerrar Guía
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsHelpOpen(false);
                  handleStart();
                }}
                className="w-full sm:w-auto px-6 py-3 rounded-xl bg-hc-yellow hover:bg-white text-hc-black font-extrabold text-sm flex items-center justify-center gap-2 transition-all active:scale-95 shadow-md"
              >
                <span>Comenzar Evaluación Ahora</span>
                <ArrowRight size={18} />
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};
