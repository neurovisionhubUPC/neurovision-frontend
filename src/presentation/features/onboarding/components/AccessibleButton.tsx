import React from 'react';

interface AccessibleButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary';
  icon?: React.ReactNode;
}

export const AccessibleButton: React.FC<AccessibleButtonProps> = ({ 
  children, 
  variant = 'primary', 
  icon,
  className = '',
  ...props 
}) => {
  const baseStyles = "flex items-center justify-center gap-4 w-full md:w-auto px-8 py-6 text-2xl font-bold rounded-xl transition-transform active:scale-95";
  
  const variants = {
    primary: "bg-hc-yellow text-hc-black hover:bg-white border-4 border-hc-yellow",
    secondary: "bg-transparent text-hc-yellow border-4 border-hc-yellow hover:bg-hc-gray hover:text-white hover:border-white"
  };

  return (
    <button 
      className={`${baseStyles} ${variants[variant]} ${className}`}
      {...props}
    >
      {icon && <span aria-hidden="true" className="w-8 h-8">{icon}</span>}
      {children}
    </button>
  );
};
