import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, ArrowRight } from 'lucide-react';
import { AccessibleButton } from '../components/AccessibleButton';
import { useAppStore } from '../../../../core/store/useAppStore';

export const WelcomePage: React.FC = () => {
  const navigate = useNavigate();
  const setHasCompletedOnboarding = useAppStore(state => state.setHasCompletedOnboarding);

  const handleStart = () => {
    setHasCompletedOnboarding(true);
    // Para esta prueba, navegaremos a una ruta de juegos por defecto (que crearemos en el futuro)
    navigate('/serious-games');
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 text-center bg-hc-black">
      <div className="max-w-4xl mx-auto space-y-12">
        <div className="flex justify-center mb-8">
          <div className="bg-hc-yellow text-hc-black p-8 rounded-full">
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
            onClick={() => alert("Información de ayuda (En desarrollo)")}
          >
            Necesito Ayuda
          </AccessibleButton>
        </div>
      </div>
    </main>
  );
};
