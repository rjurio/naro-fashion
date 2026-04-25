'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useParallax } from '@/contexts/ParallaxContext';

/**
 * One-shot fade+slide-up on viewport entry. Gated by the global parallax
 * toggle so tenants who don't want any motion get clean flat layouts.
 * Respects prefers-reduced-motion via globals.css.
 */
export function RevealOnScroll({
  children,
  className = '',
  threshold = 0.1,
}: {
  children: ReactNode;
  className?: string;
  threshold?: number;
}) {
  const { enabled } = useParallax();
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setVisible(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [enabled, threshold]);

  if (!enabled) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div
      ref={ref}
      className={`reveal-on-scroll ${visible ? 'is-visible' : ''} ${className}`}
    >
      {children}
    </div>
  );
}
