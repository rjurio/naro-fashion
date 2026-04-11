'use client';

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { cmsApi } from '@/lib/api';

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
  acceptedPaymentMethods: string[];
  mapLatitude: string;
  mapLongitude: string;
}

const DEFAULTS: BusinessProfile = {
  businessName: 'Naro Fashion',
  businessNameSw: '',
  tagline: 'Premium Fashion & Clothing in Tanzania',
  taglineSw: '',
  businessType: 'Fashion',
  contactEmail: 'hello@narofashion.co.tz',
  contactPhone: '+255 700 000 000',
  contactAddress: 'Dar es Salaam, Tanzania',
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
  acceptedPaymentMethods: ['VISA', 'MASTERCARD', 'MPESA', 'TIGOPESA'],
  mapLatitude: '',
  mapLongitude: '',
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
}

const SiteSettingsContext = createContext<SiteSettingsContextValue>({
  settings: DEFAULTS,
  loading: true,
});

export function SiteSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<BusinessProfile>(DEFAULTS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    cmsApi
      .getBusinessProfile()
      .then((data: BusinessProfile) => setSettings(resolveProfile(data)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <SiteSettingsContext.Provider value={{ settings, loading }}>
      {children}
    </SiteSettingsContext.Provider>
  );
}

export function useSiteSettings() {
  return useContext(SiteSettingsContext);
}
