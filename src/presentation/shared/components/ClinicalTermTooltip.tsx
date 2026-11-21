import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle } from 'lucide-react';
import {
  CLINICAL_METRIC_GLOSSARY,
  getClinicalMetricCopy,
  type ClinicalAudience,
  type ClinicalMetricTermId,
} from '../glossary/clinicalMetricGlossary';

export interface ClinicalTermTooltipProps {
  termId: ClinicalMetricTermId;
  audience: ClinicalAudience;
  theme?: 'dark' | 'light';
  children?: React.ReactNode;
  showIcon?: boolean;
  iconSize?: number;
  className?: string;
  ariaLabel?: string;
  printHiddenIcon?: boolean;
}

interface PopoverCoords {
  top: number;
  left: number;
  ready: boolean;
}

export const ClinicalTermTooltip: React.FC<ClinicalTermTooltipProps> = ({
  termId,
  audience,
  theme,
  children,
  showIcon = true,
  iconSize = 13,
  className = '',
  ariaLabel,
  printHiddenIcon = true,
}) => {
  const resolvedTheme: 'dark' | 'light' =
    theme ?? (audience === 'patient' ? 'dark' : 'light');
  const entry = CLINICAL_METRIC_GLOSSARY[termId];
  const copy = getClinicalMetricCopy(termId, audience);

  const tooltipId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState<PopoverCoords>({
    top: -9999,
    left: -9999,
    ready: false,
  });

  const clearScheduledClose = useCallback(() => {
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const openTooltip = useCallback(() => {
    clearScheduledClose();
    setIsOpen(true);
  }, [clearScheduledClose]);

  const scheduleClose = useCallback(() => {
    clearScheduledClose();
    closeTimeoutRef.current = window.setTimeout(() => {
      setIsOpen(false);
    }, 140);
  }, [clearScheduledClose]);

  const closeImmediately = useCallback(() => {
    clearScheduledClose();
    setIsOpen(false);
  }, [clearScheduledClose]);

  const updatePosition = useCallback(() => {
    const triggerEl = triggerRef.current;
    const popoverEl = popoverRef.current;
    if (!triggerEl || !popoverEl) return;

    const triggerRect = triggerEl.getBoundingClientRect();
    const popW = popoverEl.offsetWidth || 300;
    const popH = popoverEl.offsetHeight || 190;
    const margin = 12;
    const gap = 8;

    const centeredLeft = triggerRect.left + triggerRect.width / 2 - popW / 2;
    const clampedLeft = Math.max(
      margin,
      Math.min(centeredLeft, window.innerWidth - popW - margin)
    );

    const spaceAbove = triggerRect.top - margin;
    const spaceBelow = window.innerHeight - triggerRect.bottom - margin;
    const placeAbove = spaceAbove >= popH + gap || spaceAbove > spaceBelow;

    const rawTop = placeAbove
      ? triggerRect.top - popH - gap
      : triggerRect.bottom + gap;

    const clampedTop = Math.max(
      margin,
      Math.min(rawTop, window.innerHeight - popH - margin)
    );

    setCoords({ top: clampedTop, left: clampedLeft, ready: true });
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) {
      setCoords((prev) => (prev.ready ? { ...prev, ready: false } : prev));
      return;
    }
    updatePosition();
  }, [isOpen, termId, audience, updatePosition]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeImmediately();
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (
        triggerRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return;
      }
      closeImmediately();
    };

    const handleScrollOrResize = () => {
      closeImmediately();
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [isOpen, closeImmediately]);

  useEffect(() => {
    return () => {
      clearScheduledClose();
    };
  }, [clearScheduledClose]);

  const isDark = resolvedTheme === 'dark';

  const triggerBaseClass = isDark
    ? 'inline-flex items-center gap-1 align-middle text-left rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-[#84F5E8] cursor-help transition-colors'
    : 'inline-flex items-center gap-1 align-middle text-left rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-[#006A62] cursor-help transition-colors';

  const iconClass = isDark
    ? 'text-slate-300/80 hover:text-[#84F5E8] shrink-0'
    : 'text-[#44474C] hover:text-[#006A62] shrink-0';

  const popoverSurfaceClass = isDark
    ? 'bg-[#0B1E2D] text-slate-100 border border-[#26A69A]/50 shadow-2xl'
    : 'bg-white text-[#071524] border border-[#006A62]/30 shadow-xl ring-1 ring-[#071524]/10';

  const popoverHeaderClass = isDark
    ? 'bg-[#10293D] border-b border-white/10'
    : 'bg-[#F3FAFF] border-b border-[#071524]/10';

  const roleBadgeClass = isDark
    ? 'bg-[#26A69A]/25 text-[#84F5E8] border border-[#84F5E8]/30'
    : 'bg-[#E6F6FF] text-[#006A62] border border-[#006A62]/20';

  const accentLabelClass = isDark ? 'text-[#84F5E8]' : 'text-[#006A62]';
  const bodyTextClass = isDark ? 'text-slate-200' : 'text-[#334155]';
  const calloutClass = isDark
    ? 'bg-black/30 border border-[#26A69A]/30 text-slate-100'
    : 'bg-[#E6F6FF]/80 border border-[#006A62]/20 text-[#071524]';

  const effectiveAriaLabel =
    ariaLabel ?? `Explicación de ${entry.title}: qué es y para qué sirve`;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onMouseEnter={openTooltip}
        onMouseLeave={scheduleClose}
        onFocus={openTooltip}
        onBlur={scheduleClose}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          clearScheduledClose();
          setIsOpen((prev) => !prev);
        }}
        aria-label={effectiveAriaLabel}
        aria-expanded={isOpen}
        aria-describedby={isOpen ? tooltipId : undefined}
        className={`${triggerBaseClass} ${className}`.trim()}
      >
        {children && (
          <span className="underline decoration-dotted underline-offset-4 decoration-current/60">
            {children}
          </span>
        )}
        {showIcon && (
          <HelpCircle
            size={iconSize}
            aria-hidden="true"
            className={`${iconClass} ${printHiddenIcon ? 'print:hidden' : ''}`.trim()}
          />
        )}
      </button>

      {isOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            id={tooltipId}
            role="tooltip"
            onMouseEnter={openTooltip}
            onMouseLeave={scheduleClose}
            style={{
              position: 'fixed',
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              zIndex: 9999,
              visibility: coords.ready ? 'visible' : 'hidden',
            }}
            className={`w-[min(330px,calc(100vw-24px))] rounded-xl overflow-hidden text-left text-xs leading-relaxed ${popoverSurfaceClass}`}
          >
            <div className={`px-3.5 py-2.5 flex items-start justify-between gap-2 ${popoverHeaderClass}`}>
              <div className="min-w-0">
                <div className={`font-bold text-xs leading-snug ${isDark ? 'text-white' : 'text-[#071524]'}`}>
                  {entry.title}
                </div>
                {entry.shortTag && (
                  <div className={`text-[10px] font-medium mt-0.5 ${isDark ? 'text-slate-300' : 'text-[#44474C]'}`}>
                    {entry.shortTag}
                  </div>
                )}
              </div>
              <span
                className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${roleBadgeClass}`}
              >
                {audience === 'patient' ? 'Guía práctica' : 'Referencia clínica'}
              </span>
            </div>

            <div className="p-3.5 space-y-2 text-[11px]">
              <div>
                <span className={`font-bold uppercase tracking-wider text-[10px] block mb-0.5 ${accentLabelClass}`}>
                  ¿Qué es?
                </span>
                <p className={bodyTextClass}>{copy.whatItIs}</p>
              </div>

              <div>
                <span className={`font-bold uppercase tracking-wider text-[10px] block mb-0.5 ${accentLabelClass}`}>
                  ¿Para qué sirve?
                </span>
                <p className={bodyTextClass}>{copy.whyItMatters}</p>
              </div>

              <div className={`rounded-lg px-2.5 py-2 ${calloutClass}`}>
                <span className={`font-bold uppercase tracking-wider text-[10px] block mb-0.5 ${accentLabelClass}`}>
                  Cómo leerlo
                </span>
                <p>{copy.howToRead}</p>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
