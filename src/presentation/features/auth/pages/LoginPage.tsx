import React, { useState } from 'react';
import loginImage from '../../../../assets/login-image.png';

interface LoginPageProps {
  onLoginSuccess: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: Implement actual authentication logic here
    console.log('Logging in with', email, password);
    onLoginSuccess();
  };

  return (
    <div className="min-h-screen flex bg-bgMain font-sans">
      {/* Columna Izquierda - Imagen */}
      <div className="hidden lg:flex lg:w-[45%] p-4 pl-4 pr-0">
        <div className="w-full h-full relative rounded-xl overflow-hidden border-2 border-white/20">
          <img 
            src={loginImage} 
            alt="NeuroVision abstract" 
            className="w-full h-full object-cover"
          />
        </div>
      </div>

      {/* Columna Derecha - Formulario */}
      <div className="w-full lg:w-[55%] flex items-center justify-center p-8 sm:p-12 lg:p-24 bg-bgMain">
        <div className="w-full max-w-md">
          <h1 className="text-[2.5rem] font-bold text-primary mb-3 leading-tight tracking-tight">
            Bienvenido a<br />NeuroVisión Rehab
          </h1>
          <p className="text-neutral mb-10 text-base">
            Por favor, ingrese sus credenciales para continuar.
          </p>

          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label className="block text-sm font-bold text-primary mb-2">
                Correo Electrónico
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ejemplo@correo.com"
                className="w-full px-4 py-3 border-2 border-neutral/20 rounded focus:outline-none focus:border-secondary focus:ring-0 text-primary placeholder-neutral/50 bg-white"
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-primary mb-2">
                Contraseña
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-3 border-2 border-neutral/20 rounded focus:outline-none focus:border-secondary focus:ring-0 text-primary placeholder-neutral/50 bg-white"
              />
            </div>

            <div className="flex items-center">
              <input
                type="checkbox"
                id="remember"
                className="w-5 h-5 border-2 border-neutral/40 text-primary accent-primary rounded cursor-pointer"
              />
              <label htmlFor="remember" className="ml-3 text-sm text-primary cursor-pointer">
                Recordarme
              </label>
            </div>

            <button
              type="submit"
              className="w-full py-4 bg-secondary text-white font-bold rounded shadow-md hover:bg-[#1E8A80] transition-colors mt-2"
            >
              INICIAR SESIÓN
            </button>
          </form>

          <div className="mt-10 text-center">
            <a href="#" className="text-primary font-bold text-sm underline hover:text-secondary transition-colors underline-offset-4">
              ¿Olvidó su contraseña?
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
