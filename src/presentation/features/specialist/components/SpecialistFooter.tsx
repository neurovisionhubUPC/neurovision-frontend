import React from 'react';

export const SpecialistFooter: React.FC = () => {
  return (
    <footer className="bg-[#E6F6FF] text-[#071E27] w-full py-6 px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-4 border-t border-[#071524]/10 mt-auto text-xs">
      <div className="flex flex-col sm:flex-row items-center gap-2">
        <span className="font-bold text-[#071524]">NeuroVisión Rehab</span>
        <span className="text-[#44474C]">
          © 2024 NeuroVisión Rehab. Clinical Accessibility Standards Compliant (ISO 13485 / Ley 29733).
        </span>
      </div>

      <div className="flex items-center gap-6">
        <a href="#" className="text-[#44474C] hover:text-[#071524] transition-colors">
          Privacy Policy
        </a>
        <a href="#" className="text-[#44474C] hover:text-[#071524] transition-colors">
          Terms of Service
        </a>
        <a href="#" className="text-[#006A62] underline font-bold transition-colors">
          Accessibility Support
        </a>
      </div>
    </footer>
  );
};
