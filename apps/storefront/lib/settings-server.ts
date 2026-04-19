const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

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

export async function getBusinessProfile(): Promise<BusinessProfile> {
  try {
    const res = await fetch(`${API_URL}/cms/settings/business-profile`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) throw new Error('Failed to fetch');
    return res.json();
  } catch {
    return DEFAULTS;
  }
}
