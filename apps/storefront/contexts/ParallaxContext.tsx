'use client';

import { createContext, useContext, useEffect, useState, useRef, type ReactNode } from 'react';
import { cmsApi } from '@/lib/api';

export type ParallaxEffectType =
  | 'TRANSLATE_VERTICAL'
  | 'TRANSLATE_HORIZONTAL'
  | 'FIXED'
  | 'ZOOM_ON_SCROLL'
  | 'MIRROR'
  | 'MOUSE_TILT'
  | 'STATIC';

export type ParallaxSectionKey =
  | 'HERO_AMBIENT'
  | 'CATEGORIES'
  | 'NEW_ARRIVALS'
  | 'RENTAL'
  | 'WEDDINGS'
  | 'INSTAGRAM'
  | 'FOOTER_BAND';

export type FallbackStyle = 'BRAND_GRADIENT' | 'BRAND_RADIAL' | 'BRAND_MESH' | 'NONE';

export interface ParallaxSectionConfig {
  id: string;
  sectionKey: ParallaxSectionKey;
  title?: string | null;
  imageUrl: string;
  effectType: ParallaxEffectType;
  scrollSpeed: number;
  overlayOpacity: number;
  overlayColor: string;
  blurPx: number;
  isActive: boolean;
  sortOrder: number;
}

interface ParallaxContextValue {
  enabled: boolean;
  fallbackStyle: FallbackStyle;
  configs: Record<string, ParallaxSectionConfig>;
  loading: boolean;
}

const ParallaxContext = createContext<ParallaxContextValue>({
  enabled: false,
  fallbackStyle: 'BRAND_GRADIENT',
  configs: {},
  loading: true,
});

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1').replace('/api/v1', '');

function resolveImageUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('/uploads')) return `${API_ORIGIN}${url}`;
  return url;
}

function isIOSSafari(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  const isIOS = /iP(ad|hone|od)/.test(ua);
  const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);
  return isIOS && isSafari;
}

export function ParallaxProvider({ children }: { children: ReactNode }) {
  const [configs, setConfigs] = useState<Record<string, ParallaxSectionConfig>>({});
  const [enabled, setEnabled] = useState(false);
  const [fallbackStyle, setFallbackStyle] = useState<FallbackStyle>('BRAND_GRADIENT');
  const [loading, setLoading] = useState(true);
  const rafRef = useRef<number>(0);

  // Step 1: Load CMS settings to determine if parallax is enabled.
  // Step 2: If enabled, load parallax-section configs.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await cmsApi.getSettings().catch(() => [] as any[]);
        if (cancelled) return;

        const map: Record<string, string> = {};
        if (Array.isArray(settings)) {
          settings.forEach((s: any) => { map[s.key] = s.value; });
        }
        const parallaxOn = map.parallax_enabled === 'true';
        const rawFallback = (map.parallax_default_fallback || 'BRAND_GRADIENT') as FallbackStyle;
        const fb: FallbackStyle = ['BRAND_GRADIENT', 'BRAND_RADIAL', 'BRAND_MESH', 'NONE'].includes(rawFallback)
          ? rawFallback
          : 'BRAND_GRADIENT';

        setEnabled(parallaxOn);
        setFallbackStyle(fb);

        if (parallaxOn) {
          const rows = await cmsApi.getParallaxSections().catch(() => [] as any[]);
          if (cancelled) return;
          if (Array.isArray(rows)) {
            const cfgMap: Record<string, ParallaxSectionConfig> = {};
            rows.forEach((r: any) => {
              const cfg: ParallaxSectionConfig = {
                id: r.id,
                sectionKey: r.sectionKey,
                title: r.title,
                imageUrl: resolveImageUrl(r.imageUrl),
                effectType: r.effectType,
                scrollSpeed: typeof r.scrollSpeed === 'number' ? r.scrollSpeed : Number(r.scrollSpeed) || 0.35,
                overlayOpacity: typeof r.overlayOpacity === 'number' ? r.overlayOpacity : Number(r.overlayOpacity) || 0,
                overlayColor: r.overlayColor || '#000000',
                blurPx: r.blurPx || 0,
                isActive: r.isActive !== false,
                sortOrder: r.sortOrder || 0,
              };
              // iOS Safari: FIXED gets buggy with bg-fixed; coerce to TRANSLATE_VERTICAL
              if (cfg.effectType === 'FIXED' && isIOSSafari()) {
                cfg.effectType = 'TRANSLATE_VERTICAL';
              }
              cfgMap[cfg.sectionKey] = cfg;
            });
            setConfigs(cfgMap);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Global scroll listener: writes --parallax-y onto :root.
  // One listener for the whole page, shared by all TRANSLATE_*/MIRROR backdrops.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!enabled) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    const isMobile = window.innerWidth < 640;
    if (isMobile) return;

    const root = document.documentElement;
    const onScroll = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        root.style.setProperty('--parallax-y', `${window.scrollY}`);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [enabled]);

  return (
    <ParallaxContext.Provider value={{ enabled, fallbackStyle, configs, loading }}>
      {children}
    </ParallaxContext.Provider>
  );
}

export function useParallax() {
  return useContext(ParallaxContext);
}

export function useParallaxConfig(sectionKey: ParallaxSectionKey) {
  const ctx = useParallax();
  return {
    enabled: ctx.enabled,
    fallbackStyle: ctx.fallbackStyle,
    config: ctx.configs[sectionKey] ?? null,
  };
}
