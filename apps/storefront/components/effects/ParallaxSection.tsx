'use client';

import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { useParallaxConfig, type ParallaxSectionKey, type ParallaxEffectType } from '@/contexts/ParallaxContext';
import { BrandGradientBackdrop } from './BrandGradientBackdrop';

interface Props {
  sectionKey: ParallaxSectionKey;
  children?: ReactNode;
  className?: string;
  /** Override container element (default: 'section'). */
  as?: 'section' | 'div';
}

function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < 640;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function ParallaxSection({ sectionKey, children, className = '', as = 'section' }: Props) {
  const { enabled, fallbackStyle, config } = useParallaxConfig(sectionKey);
  const containerRef = useRef<HTMLElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const [zoomScale, setZoomScale] = useState(1);
  const [mobileOrReduced, setMobileOrReduced] = useState(false);

  // Detect mobile / reduced motion once on mount
  useEffect(() => {
    const update = () => setMobileOrReduced(isMobileViewport() || prefersReducedMotion());
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // ZOOM_ON_SCROLL: per-section IntersectionObserver
  useEffect(() => {
    if (!enabled || mobileOrReduced) return;
    if (!config || config.effectType !== 'ZOOM_ON_SCROLL') return;
    const el = containerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          // Map intersection ratio (0–1) to scale 1 → 1.18
          setZoomScale(1 + entry.intersectionRatio * 0.18);
        }
      },
      { threshold: Array.from({ length: 21 }, (_, i) => i / 20) }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [enabled, mobileOrReduced, config]);

  // MOUSE_TILT: per-section pointermove
  useEffect(() => {
    if (!enabled || mobileOrReduced) return;
    if (!config || config.effectType !== 'MOUSE_TILT') return;
    const el = containerRef.current;
    const backdrop = backdropRef.current;
    if (!el || !backdrop) return;

    let raf = 0;
    let targetX = 0;
    let targetY = 0;

    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      targetX = x * 16;
      targetY = y * 16;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        backdrop.style.transform = `translate3d(${targetX}px, ${targetY}px, 0) scale(1.05)`;
      });
    };
    const onLeave = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        backdrop.style.transform = 'translate3d(0, 0, 0) scale(1.05)';
      });
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [enabled, mobileOrReduced, config]);

  const Tag = as as any;

  // Resolution order:
  //   1. Parallax disabled OR mobile OR reduced-motion → render children, no layer
  //   2. Have config with image → render image with effect
  //   3. Fallback style != NONE → render brand gradient
  //   4. Else → render children, no layer
  const showLayer =
    enabled &&
    !mobileOrReduced &&
    (config !== null || fallbackStyle !== 'NONE');

  return (
    <Tag
      ref={containerRef as any}
      className={`relative ${className}`}
    >
      {showLayer && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {config ? (
            <BackdropLayer config={config} backdropRef={backdropRef} zoomScale={zoomScale} />
          ) : (
            <BrandGradientBackdrop style={fallbackStyle} />
          )}
        </div>
      )}
      <div className="relative z-10">{children}</div>
    </Tag>
  );
}

function BackdropLayer({
  config,
  backdropRef,
  zoomScale,
}: {
  config: ReturnType<typeof useParallaxConfig>['config'] & { effectType: ParallaxEffectType };
  backdropRef: React.MutableRefObject<HTMLDivElement | null>;
  zoomScale: number;
}) {
  if (!config) return null;

  const effect = config.effectType;
  const speed = config.scrollSpeed;

  // Build the inline transform style based on effect type.
  // For TRANSLATE_*, MIRROR — uses CSS calc with --parallax-y CSS variable
  // (single global scroll listener writes the value via ParallaxContext).
  let transform = '';
  if (effect === 'TRANSLATE_VERTICAL') {
    transform = `translate3d(0, calc(var(--parallax-y, 0) * 1px * ${speed}), 0) scale(1.1)`;
  } else if (effect === 'TRANSLATE_HORIZONTAL') {
    transform = `translate3d(calc(var(--parallax-y, 0) * 1px * ${speed}), 0, 0) scale(1.1)`;
  } else if (effect === 'MIRROR') {
    transform = `translate3d(0, calc(var(--parallax-y, 0) * -1px * ${speed}), 0) scale(1.1)`;
  } else if (effect === 'ZOOM_ON_SCROLL') {
    transform = `scale(${zoomScale})`;
  } else if (effect === 'MOUSE_TILT') {
    // Set initially, then pointermove handler updates inline style imperatively
    transform = 'translate3d(0, 0, 0) scale(1.05)';
  } else {
    // STATIC and FIXED (FIXED falls back to TRANSLATE_VERTICAL on iOS Safari, handled in context)
    transform = 'scale(1)';
  }

  const imgStyle: CSSProperties = {
    transform,
    filter: config.blurPx > 0 ? `blur(${config.blurPx}px)` : undefined,
    willChange: 'transform',
  };

  // FIXED on desktop browsers other than iOS Safari uses position: fixed clipped via clip-path
  const containerStyle: CSSProperties =
    effect === 'FIXED'
      ? {
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          zIndex: -1,
          clipPath: 'inset(0)',
        }
      : { position: 'absolute', inset: 0 };

  return (
    <div style={containerStyle} ref={effect === 'MOUSE_TILT' ? undefined : undefined}>
      <div ref={backdropRef as any} className="absolute inset-0" style={imgStyle}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={config.imageUrl}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover"
        />
      </div>
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: config.overlayColor,
          opacity: config.overlayOpacity,
        }}
      />
    </div>
  );
}
