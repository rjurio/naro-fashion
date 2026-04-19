'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import adminApi from '@/lib/api';

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1').replace('/api/v1', '');

export interface BusinessProfile {
  businessName: string;
  businessNameSw: string;
  tagline: string;
  taglineSw: string;
  businessType: string;
  contactEmail: string;
  contactPhone: string;
  contactAddress: string;
  contactAddressSw: string;
  whatsappNumber: string;
  instagramUrl: string;
  facebookUrl: string;
  twitterUrl: string;
  tiktokUrl: string;
  logoUrl: string;
  iconUrl: string;
  faviconUrl: string;
  domain: string;
  currency: string;
}

const DEFAULTS: BusinessProfile = {
  businessName: 'Naro Fashion',
  businessNameSw: '',
  tagline: 'Premium Fashion & Clothing in Tanzania',
  taglineSw: '',
  businessType: 'Fashion',
  contactEmail: 'hello@narofashion.co.tz',
  contactPhone: '0753968554',
  contactAddress: 'Kibada/Kigamboni, Dar es Salaam, Tanzania',
  contactAddressSw: '',
  whatsappNumber: '255759047287',
  instagramUrl: 'https://www.instagram.com/narofashion2019/',
  facebookUrl: '',
  twitterUrl: '',
  tiktokUrl: '',
  logoUrl: '/logo.jpg',
  iconUrl: '/icon.jpg',
  faviconUrl: '/favicon.jpg',
  domain: 'narofashion.co.tz',
  currency: 'TZS',
};

function resolveUrl(url: string): string {
  if (url.startsWith('/uploads')) return `${API_ORIGIN}${url}`;
  return url;
}

function resolveProfile(profile: BusinessProfile): BusinessProfile {
  return {
    ...profile,
    logoUrl: resolveUrl(profile.logoUrl),
    iconUrl: resolveUrl(profile.iconUrl),
    faviconUrl: resolveUrl(profile.faviconUrl),
  };
}

interface SiteSettingsContextValue {
  settings: BusinessProfile;
  loading: boolean;
  refreshSettings: () => Promise<void>;
}

const SiteSettingsContext = createContext<SiteSettingsContextValue>({
  settings: DEFAULTS,
  loading: true,
  refreshSettings: async () => {},
});

export function SiteSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<BusinessProfile>(DEFAULTS);
  const [loading, setLoading] = useState(true);

  const fetchSettings = useCallback(async () => {
    try {
      const data: BusinessProfile = await adminApi.getBusinessProfile();
      setSettings(resolveProfile(data));
    } catch {
      // keep defaults
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const refreshSettings = useCallback(async () => {
    await fetchSettings();
  }, [fetchSettings]);

  return (
    <SiteSettingsContext.Provider value={{ settings, loading, refreshSettings }}>
      {children}
    </SiteSettingsContext.Provider>
  );
}

export function useSiteSettings() {
  return useContext(SiteSettingsContext);
}
