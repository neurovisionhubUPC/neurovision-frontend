import React, { useState } from 'react';
import { 
  CheckCircle2, 
  Clock, 
  Flame, 
  Calendar as CalendarIcon, 
  Compass, 
  Search, 
  Volume2, 
  Target, 
  Play, 
  Check, 
  Pause, 
  PhoneCall, 
  MessageSquare, 
  LogOut, 
  Eye, 
  AlertTriangle,
  Type
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../../../core/store/useAppStore';

export const PatientDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [highContrast, setHighContrast] = useState(false);
  const [activeTab, setActiveTab] = useState<'inicio' | 'ejercicios' | 'progreso'>('inicio');
  const [isResting, setIsResting] = useState(false);
  const [restSeconds, setRestSeconds] = useState(120);

  const startRest = () => {
    setIsResting(true);
    setRestSeconds(120);
    const interval = setInterval(() => {
      setRestSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setIsResting(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  return (
    <div className={`min-h-screen bg-[#F3FAFF] font-sans text-[#1C2A39] flex flex-col justify-between ${highContrast ? 'text-lg' : ''}`}>
      {/* Top Navbar */}
      <header className="bg-white border-b border-[#E2EEF5] px-6 lg:px-12 py-3.5 flex items-center justify-between sticky top-0 z-30 shadow-xs">
        {/* Brand / Logo */}
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-full bg-[#E6F6FF] flex items-center justify-center text-[#26A69A]">
            <Eye size={24} className="stroke-[2.5]" />
          </div>
          <span className="text-xl font-bold tracking-tight text-[#1C2A39]">
            NeuroVisión<span className="block text-xs font-semibold text-[#455A64] -mt-1 tracking-normal">Rehab</span>
          </span>
        </div>

        {/* Center Navigation Links */}
        <nav className="hidden md:flex items-center space-x-8">
          <button 
            onClick={() => setActiveTab('inicio')}
            className={`font-semibold text-sm transition-all pb-1.5 relative ${
              activeTab === 'inicio' ? 'text-[#1C2A39] border-b-2 border-[#1C2A39]' : 'text-[#455A64] hover:text-[#1C2A39]'
            }`}
          >
            Inicio
          </button>
          <button 
            onClick={() => setActiveTab('ejercicios')}
            className={`font-semibold text-sm transition-all pb-1.5 relative ${
              activeTab === 'ejercicios' ? 'text-[#1C2A39] border-b-2 border-[#1C2A39]' : 'text-[#455A64] hover:text-[#1C2A39]'
            }`}
          >
            Ejercicios
          </button>
          <button 
            onClick={() => setActiveTab('progreso')}
            className={`font-semibold text-sm transition-all pb-1.5 relative ${
              activeTab === 'progreso' ? 'text-[#1C2A39] border-b-2 border-[#1C2A39]' : 'text-[#455A64] hover:text-[#1C2A39]'
            }`}
          >
            Progreso
          </button>
        </nav>

        {/* Actions (Emergency + Logout) */}
        <div className="flex items-center space-x-3">
          <button 
            onClick={() => alert('Llamando a soporte de emergencia...')}
            className="flex items-center space-x-2 bg-[#B71C1C] hover:bg-[#9B1717] text-white px-5 py-2.5 rounded-xl font-bold text-sm shadow-sm transition-all active:scale-95"
          >
            <PhoneCall size={18} className="fill-white" />
            <span>Emergency Call</span>
          </button>

          <button 
            onClick={() => useAppStore.getState().logout()}
            title="Cerrar sesión"
            className="w-10 h-10 rounded-xl border border-[#D5E5EF] flex items-center justify-center text-[#455A64] hover:bg-[#F3FAFF] hover:text-[#1C2A39] transition-all"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-7">
        
        {/* Patient Greeting & Status Header Card */}
        <div className="bg-white border border-[#DCEBF4] rounded-2xl p-6 sm:p-7 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-3">
            {/* Badges row */}
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex items-center space-x-1.5 bg-[#E6F6FF] text-[#1C2A39] font-medium text-xs px-3 py-1 rounded-md border border-[#CDE9FA]">
                <CalendarIcon size={14} className="text-[#26A69A]" />
                <span>Hoy: Miércoles, 28 de Octubre</span>
              </span>
              <span className="inline-flex items-center space-x-1.5 bg-[#FFF2E2] text-[#B85D19] font-bold text-xs px-3 py-1 rounded-md border border-[#FFE2C2]">
                <Flame size={14} className="fill-[#F4A261] text-[#F4A261]" />
                <span>Días seguidos: 5 🔥</span>
              </span>
            </div>

            {/* Title */}
            <div>
              <h1 className="text-3xl sm:text-4xl font-extrabold text-[#1C2A39] tracking-tight">
                ¡Hola, Roberto!
              </h1>
              <div className="flex items-center space-x-1.5 text-xs sm:text-sm text-[#455A64] font-medium mt-1.5">
                <CheckCircle2 size={16} className="text-[#26A69A] shrink-0 fill-[#E6F6FF]" />
                <span>Supervisado por Dr. Chen - Protocolo de Telerehabilitación Neuro-Oftalmológica</span>
              </div>
            </div>
          </div>

          {/* Accessibility pill */}
          <div className="bg-[#EBF7FD] border border-[#CDE9FA] rounded-xl p-3 flex items-center space-x-4 shrink-0">
            <div className="flex items-start space-x-2.5">
              <div className="p-1.5 rounded-md bg-white text-[#1C2A39] shadow-2xs">
                <Type size={18} />
              </div>
              <div className="leading-tight">
                <p className="text-xs font-bold text-[#1C2A39]">Texto de Alta Visibilidad</p>
                <p className="text-[10px] text-[#455A64]">WCAG 2.2 AAA Activo</p>
              </div>
            </div>
            <button 
              onClick={() => setHighContrast(!highContrast)}
              className="bg-white hover:bg-neutral-50 text-[#1C2A39] border border-[#BDE0F3] px-3 py-1.5 rounded-lg text-xs font-bold shadow-2xs transition-all active:scale-95"
            >
              {highContrast ? 'Normal -' : 'Aumentar +'}
            </button>
          </div>
        </div>

        {/* Section Heading */}
        <div className="border-l-4 border-[#0F6F62] pl-3.5 space-y-0.5">
          <h2 className="text-2xl font-bold text-[#1C2A39] tracking-tight">
            Tus Ejercicios para Hoy
          </h2>
          <p className="text-sm text-[#455A64]">
            Complete sus sesiones pautadas para estimular la recuperación visual y reconexión neuronal.
          </p>
        </div>

        {/* Exercises Grid (2 Columns) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
          
          {/* Card 1: PENDIENTE (Exploración Visual) */}
          <div className="bg-white border border-[#DCEBF4] rounded-2xl overflow-hidden shadow-xs flex flex-col justify-between border-t-4 border-t-[#F4A261]">
            <div className="p-6 sm:p-7 space-y-5">
              {/* Badge & Module */}
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center space-x-1.5 bg-[#FFF2E2] text-[#B85D19] px-3 py-1 rounded-md text-xs font-bold tracking-wider">
                  <Clock size={14} />
                  <span>PENDIENTE</span>
                </span>
                <span className="text-xs font-semibold text-[#455A64] bg-[#F3FAFF] px-2.5 py-1 rounded border border-[#E2EEF5]">
                  Módulo 1 de 2
                </span>
              </div>

              {/* Title */}
              <div>
                <h3 className="text-2xl font-bold text-[#1C2A39]">Exploración Visual</h3>
                <p className="text-sm text-[#455A64] font-medium">(Visual Scanning)</p>
              </div>

              {/* Specs Box */}
              <div className="bg-[#F0F8FD] rounded-xl p-4 space-y-2.5 text-xs text-[#1C2A39] border border-[#E1F0FA]">
                <div className="flex items-center space-x-2.5">
                  <Clock size={16} className="text-[#0F6F62] shrink-0" />
                  <span><strong>Tiempo estimado:</strong> 10 mins</span>
                </div>
                <div className="flex items-center space-x-2.5">
                  <Volume2 size={16} className="text-[#0F6F62] shrink-0" />
                  <span><strong>Dificultad:</strong> Guiada con estímulo sonoro</span>
                </div>
                <div className="flex items-start space-x-2.5">
                  <Target size={16} className="text-[#0F6F62] shrink-0 mt-0.5" />
                  <span><strong>Objetivo:</strong> Ampliar campo visual periférico y seguimiento sacádico.</span>
                </div>
              </div>

              {/* Calibration Status Strip */}
              <div className="bg-[#1C2A39] text-white rounded-xl p-3 flex items-center justify-between px-4">
                <div className="flex items-center space-x-2 text-xs">
                  <Compass size={16} className="text-[#26A69A]" />
                  <span>Trayectoria guiada: Ondas concéntricas suaves</span>
                </div>
                <span className="bg-[#2B3E52] text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded text-[#8AE2D6]">
                  CALIBRADO
                </span>
              </div>
            </div>

            {/* Action Button */}
            <div className="p-6 sm:p-7 pt-0">
              <button 
                onClick={() => navigate('/serious-games')}
                className="w-full py-4 bg-[#0F6F62] hover:bg-[#0C584E] text-white font-bold rounded-xl shadow-sm flex items-center justify-center space-x-2 text-base tracking-wide transition-all active:scale-[0.99]"
              >
                <span>INICIAR AHORA</span>
                <Play size={18} className="fill-white" />
              </button>
            </div>
          </div>

          {/* Card 2: COMPLETADO (Búsqueda Visual) */}
          <div className="bg-white border border-[#DCEBF4] rounded-2xl overflow-hidden shadow-xs flex flex-col justify-between border-t-4 border-t-[#26A69A]">
            <div className="p-6 sm:p-7 space-y-5">
              {/* Badge & Module */}
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center space-x-1.5 bg-[#DCF8F2] text-[#0F6F62] px-3 py-1 rounded-md text-xs font-bold tracking-wider">
                  <Check size={14} className="stroke-[3]" />
                  <span>COMPLETADO</span>
                </span>
                <span className="text-xs font-semibold text-[#455A64] bg-[#F3FAFF] px-2.5 py-1 rounded border border-[#E2EEF5]">
                  Módulo 2 de 2
                </span>
              </div>

              {/* Title */}
              <div>
                <h3 className="text-2xl font-bold text-[#1C2A39]">Búsqueda Visual</h3>
                <p className="text-sm text-[#455A64] font-medium">(Visual Search)</p>
              </div>

              {/* Completed Metrics Box */}
              <div className="bg-[#F0F8FD] rounded-xl p-4 space-y-2.5 text-xs text-[#1C2A39] border border-[#E1F0FA]">
                <div className="flex items-center space-x-2.5">
                  <Clock size={16} className="text-[#0F6F62] shrink-0" />
                  <span><strong>Sesión:</strong> Completado a las 10:15 AM (12 mins)</span>
                </div>
                <div className="flex items-center space-x-2.5">
                  <Target size={16} className="text-[#0F6F62] shrink-0" />
                  <span><strong>Puntuación de Acierto:</strong> <span className="text-[#0F6F62] font-bold text-sm">92%</span></span>
                </div>
                <div className="flex items-start space-x-2.5">
                  <CheckCircle2 size={16} className="text-[#0F6F62] shrink-0 mt-0.5" />
                  <span><strong>Respuesta clínica:</strong> Precisión dentro del rango óptimo pautado.</span>
                </div>
              </div>

              {/* Neuro-Sensorial Response Box */}
              <div className="bg-[#EBF7FD] rounded-xl p-3.5 flex items-start space-x-3 border border-[#CDE9FA]">
                <div className="w-7 h-7 rounded-lg bg-[#26A69A] text-white flex items-center justify-center shrink-0 mt-0.5">
                  <Search size={14} />
                </div>
                <div className="text-xs">
                  <p className="font-bold text-[#1C2A39]">Respuesta Neurosensorial</p>
                  <p className="text-[#455A64] mt-0.5">Tiempos de fijación ocular sincronizados con éxito.</p>
                </div>
              </div>
            </div>

            {/* Action Button */}
            <div className="p-6 sm:p-7 pt-0">
              <button 
                onClick={() => alert('Mostrando resumen detallado de la sesión completada...')}
                className="w-full py-3.5 bg-white hover:bg-[#F3FAFF] text-[#1C2A39] border-2 border-[#1C2A39] font-bold rounded-xl shadow-2xs flex items-center justify-center space-x-2 text-sm tracking-wide transition-all active:scale-[0.99]"
              >
                <span>Ver Resumen del Ejercicio</span>
                <CheckCircle2 size={17} className="text-[#26A69A]" />
              </button>
            </div>
          </div>

        </div>

        {/* Health / Fatigue Alert Banner */}
        <div className="bg-[#FFE5D2] border border-[#FCD2B3] rounded-2xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start space-x-3.5">
            <div className="w-8 h-8 rounded-full bg-[#B85D19] text-white flex items-center justify-center shrink-0 mt-0.5">
              <AlertTriangle size={18} />
            </div>
            <div>
              <h4 className="font-bold text-sm sm:text-base text-[#1C2A39]">
                Recordatorio de Salud Ocular
              </h4>
              <p className="text-xs sm:text-sm text-[#455A64] mt-0.5 max-w-2xl leading-relaxed">
                Si sientes fatiga visual o mareo, recuerda descansar la vista cerrando los ojos durante 2 minutos o contacta a tu especialista de inmediato.
              </p>
            </div>
          </div>

          <button 
            onClick={startRest}
            disabled={isResting}
            className="bg-[#3D1E0C] hover:bg-[#2B1406] text-white px-5 py-3 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center space-x-2 shrink-0 transition-all shadow-xs active:scale-95 disabled:opacity-75"
          >
            <Pause size={16} className="fill-white" />
            <span>{isResting ? `Descansando (${restSeconds}s)` : 'Pausar 2 min'}</span>
          </button>
        </div>

        {/* Technical Support Banner */}
        <div className="bg-[#E4F4FF] border border-[#CDE9FA] rounded-2xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-3.5">
            <div className="w-10 h-10 rounded-full bg-white text-[#26A69A] border border-[#CDE9FA] flex items-center justify-center shrink-0">
              <PhoneCall size={20} />
            </div>
            <div>
              <h4 className="font-bold text-sm sm:text-base text-[#1C2A39]">
                ¿Tienes dudas o necesitas ayuda técnica?
              </h4>
              <p className="text-xs text-[#455A64] mt-0.5">
                Nuestro equipo clínico y soporte telefónico está disponible.
              </p>
            </div>
          </div>

          <a 
            href="https://wa.me/"
            target="_blank"
            rel="noreferrer"
            className="bg-white hover:bg-neutral-50 text-[#1C2A39] border border-[#1C2A39] px-5 py-3 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center space-x-2.5 shrink-0 transition-all shadow-2xs active:scale-95"
          >
            <MessageSquare size={16} className="text-[#0F6F62]" />
            <span>Asistencia Inmediata por Teléfono / WhatsApp</span>
          </a>
        </div>

      </main>

      {/* Footer */}
      <footer className="border-t border-[#E2EEF5] bg-white py-4 px-6 lg:px-12 mt-12 text-xs text-[#455A64] flex flex-col sm:flex-row items-center justify-between gap-2">
        <div className="flex items-center space-x-2">
          <span className="text-[#26A69A] font-bold">♿</span>
          <span>Interfaz adaptada</span>
        </div>
        <div>
          Plataforma Médica Homologada © 2024 NeuroVisión Rehab
        </div>
      </footer>
    </div>
  );
};
