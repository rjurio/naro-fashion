'use client';

import type { FallbackStyle } from '@/contexts/ParallaxContext';

/**
 * Pure-CSS branded gradient backdrop. Used as the parallax fallback when a
 * tenant has parallax enabled but no image uploaded for a section.
 * Pulls colors from CSS variables already defined in globals.css:
 *   --color-primary    (gold by default)
 *   --color-dark-500   (black by default)
 *   --color-accent     (gold by default)
 * If a tenant overrides these via custom CSS or theming, this component
 * picks up their brand automatically.
 */
export function BrandGradientBackdrop({ style }: { style: FallbackStyle }) {
  if (style === 'NONE') return null;

  // Each style uses different CSS so we render conditionally.
  if (style === 'BRAND_GRADIENT') {
    return (
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'linear-gradient(180deg, var(--color-dark-500, #1A1A1A) 0%, var(--color-primary, #D4AF37) 200%)',
          opacity: 0.85,
        }}
      />
    );
  }

  if (style === 'BRAND_RADIAL') {
    return (
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at top, var(--color-primary, #D4AF37) 0%, var(--color-dark-500, #1A1A1A) 70%)',
          opacity: 0.75,
        }}
      />
    );
  }

  // BRAND_MESH — three overlapping radial spots for a soft mesh feel
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background: 'var(--color-dark-500, #1A1A1A)',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 20% 20%, var(--color-primary, #D4AF37) 0%, transparent 50%)',
          opacity: 0.4,
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 80% 30%, var(--color-accent, #D4AF37) 0%, transparent 45%)',
          opacity: 0.3,
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 90%, var(--color-primary, #D4AF37) 0%, transparent 55%)',
          opacity: 0.25,
        }}
      />
    </div>
  );
}
