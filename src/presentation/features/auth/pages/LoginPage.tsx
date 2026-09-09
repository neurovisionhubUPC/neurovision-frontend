import React from 'react';
import loginImage from '../../../../assets/login-image.png';
import type { UserRole } from '../../../../core/store/useAppStore';

interface LoginPageProps {
  onLoginSuccess: (role: UserRole) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  return (
    <div className="h-screen overflow-hidden flex bg-bgMain font-sans">
      {/* Columna Izquierda - Imagen */}
      <div className="hidden lg:flex lg:w-[45%] p-4 pl-4 pr-0 h-full">
        <div className="w-full h-full relative rounded-xl overflow-hidden border-2 border-white/20">
          <img
            src={loginImage}
            alt="NeuroVision abstract"
            className="w-full h-full object-cover"
          />
        </div>
      </div>

      {/* Columna Derecha - Formulario */}
      <div className="w-full lg:w-[55%] flex items-center justify-center p-8 sm:p-12 lg:p-24 bg-bgMain h-full">
        <div className="w-full max-w-md flex flex-col justify-center">
          <h1 className="text-[2.5rem] font-bold text-primary mb-3 leading-tight tracking-tight">
            Bienvenido a<br />NeuroVisión Rehab
          </h1>
          <p className="text-neutral mb-12 text-base">
            Seleccione el rol con el que desea ingresar a la plataforma (Mock Mode).
          </p>

          <div className="space-y-6">
            <button
              onClick={() => onLoginSuccess('PATIENT')}
              className="w-full py-5 bg-secondary text-white font-bold rounded-xl shadow-md hover:bg-[#1E8A80] transition-colors flex items-center justify-center space-x-3 text-lg"
            >
              <span>Vista de Paciente</span>
            </button>

            <button
              onClick={() => onLoginSuccess('SPECIALIST')}
              className="w-full py-5 bg-primary text-white font-bold rounded-xl shadow-md hover:bg-[#131f2b] transition-colors flex items-center justify-center space-x-3 text-lg"
            >
              <span>Vista de Especialista</span>
            </button>
          </div>

          <div className="mt-12 text-center">
            <span className="text-neutral/70 text-sm italic">
              El backend está temporalmente deshabilitado.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
