'use client';

import { useState, useEffect, useRef } from 'react';
import { Building2, Palette, Phone, Share2, Globe, Save, Loader2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import ImageUploadField from '@/components/ui/ImageUploadField';
import adminApi from '@/lib/api';
import { useSiteSettings } from '@/contexts/SiteSettingsContext';

interface SettingField {
  key: string;
  label: string;
  type: 'text' | 'email' | 'url' | 'tel' | 'select';
  placeholder?: string;
  options?: { value: string; label: string }[];
  swahili?: boolean;
}

const IDENTITY_FIELDS: SettingField[] = [
  { key: 'site_name', label: 'Business Name', type: 'text', placeholder: 'Naro Fashion' },
  { key: 'site_name_sw', label: 'Business Name (Swahili)', type: 'text', placeholder: 'Naro Fashion', swahili: true },
  { key: 'site_description', label: 'Tagline / Description', type: 'text', placeholder: 'Premium Fashion & Clothing in Tanzania' },
  { key: 'site_description_sw', label: 'Tagline (Swahili)', type: 'text', placeholder: '', swahili: true },
  {
    key: 'business_type', label: 'Business Type', type: 'select', options: [
      { value: 'Fashion', label: 'Fashion & Clothing' },
      { value: 'Retail', label: 'General Retail' },
      { value: 'E-commerce', label: 'E-commerce' },
      { value: 'Boutique', label: 'Boutique' },
      { value: 'Bridal', label: 'Bridal & Events' },
    ],
  },
  {
    key: 'currency', label: 'Currency', type: 'select', options: [
      { value: 'TZS', label: 'TZS - Tanzanian Shilling' },
      { value: 'USD', label: 'USD - US Dollar' },
      { value: 'KES', label: 'KES - Kenyan Shilling' },
      { value: 'UGX', label: 'UGX - Ugandan Shilling' },
    ],
  },
];

const CONTACT_FIELDS: SettingField[] = [
  { key: 'contact_email', label: 'Email Address', type: 'email', placeholder: 'hello@example.com' },
  { key: 'contact_phone', label: 'Phone Number', type: 'tel', placeholder: '+255 700 000 000' },
  { key: 'whatsapp_number', label: 'WhatsApp Number', type: 'tel', placeholder: '255700000000' },
  { key: 'contact_address', label: 'Address', type: 'text', placeholder: 'Dar es Salaam, Tanzania' },
  { key: 'contact_address_sw', label: 'Address (Swahili)', type: 'text', placeholder: '', swahili: true },
];

const SOCIAL_FIELDS: SettingField[] = [
  { key: 'instagram_url', label: 'Instagram URL', type: 'url', placeholder: 'https://www.instagram.com/youraccount/' },
  { key: 'facebook_url', label: 'Facebook URL', type: 'url', placeholder: 'https://www.facebook.com/yourpage' },
  { key: 'twitter_url', label: 'Twitter / X URL', type: 'url', placeholder: 'https://x.com/youraccount' },
  { key: 'tiktok_url', label: 'TikTok URL', type: 'url', placeholder: 'https://www.tiktok.com/@youraccount' },
];

const WEBSITE_FIELDS: SettingField[] = [
  { key: 'business_domain', label: 'Business Domain', type: 'text', placeholder: 'narofashion.co.tz' },
];

const IMAGE_SETTINGS = [
  { key: 'company_logo_url', label: 'Company Logo', defaultUrl: '/logo.jpg', size: 140, shape: 'square' as const, hint: 'Full logo used on login pages and branding (recommended: 320×160px)' },
  { key: 'company_icon_url', label: 'Company Icon', defaultUrl: '/icon.jpg', size: 80, shape: 'circle' as const, hint: 'Small circular icon for header and sidebar (recommended: 64×64px)' },
  { key: 'company_favicon_url', label: 'Favicon', defaultUrl: '/favicon.jpg', size: 48, shape: 'square' as const, hint: 'Browser tab icon (recommended: 32×32px)' },
];

export default function BusinessProfilePage() {
  const { refreshSettings } = useSiteSettings();
  const [values, setValues] = useState<Record<string, string>>({});
  const [original, setOriginal] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');

  useEffect(() => {
    const load = async () => {
      try {
        const settings: any[] = await adminApi.getSettings();
        const map: Record<string, string> = {};
        settings.forEach((s: any) => {
          map[s.key] = s.value;
        });
        setValues({ ...map });
        setOriginal({ ...map });
      } catch {
        // fallback — empty settings
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const showMsg = (msg: string, type: 'success' | 'error') => {
    setMessage(msg);
    setMessageType(type);
    setTimeout(() => setMessage(''), 4000);
  };

  const handleChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleImageUpload = async (key: string, file: File): Promise<string> => {
    const result = await adminApi.uploadBranding(file);
    const url = result.url;
    setValues((prev) => ({ ...prev, [key]: url }));
    return url;
  };

  const handleImageReset = (key: string, defaultUrl: string) => {
    setValues((prev) => ({ ...prev, [key]: defaultUrl }));
  };

  const hasChanges = () => {
    return Object.keys(values).some((k) => values[k] !== original[k]) ||
      Object.keys(values).length !== Object.keys(original).length;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const allKeys = [
        ...IDENTITY_FIELDS, ...CONTACT_FIELDS, ...SOCIAL_FIELDS, ...WEBSITE_FIELDS,
      ].map((f) => f.key);
      IMAGE_SETTINGS.forEach((img) => allKeys.push(img.key));

      const changedKeys = allKeys.filter((key) => {
        const val = values[key];
        return val !== undefined && val !== original[key];
      });

      if (changedKeys.length === 0) {
        showMsg('No changes to save.', 'success');
        setSaving(false);
        return;
      }

      let failed = 0;
      for (const key of changedKeys) {
        try {
          await adminApi.updateSetting(key, { value: values[key] ?? '' });
        } catch (err: any) {
          failed++;
          console.error(`Failed to save setting "${key}":`, err?.message || err);
        }
      }

      if (failed > 0) {
        showMsg(`Saved with ${failed} error(s). Check console for details.`, 'error');
      } else {
        setOriginal({ ...values });
        await refreshSettings();
        showMsg('Business profile updated successfully.', 'success');
      }
    } catch (err: any) {
      showMsg(`Failed to save: ${err?.message || 'Unknown error'}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const renderField = (field: SettingField) => {
    const value = values[field.key] || '';
    if (field.type === 'select') {
      return (
        <select
          value={value}
          onChange={(e) => handleChange(field.key, e.target.value)}
          className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold"
        >
          {!value && <option value="">Select...</option>}
          {field.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      );
    }
    return (
      <input
        type={field.type}
        value={value}
        onChange={(e) => handleChange(field.key, e.target.value)}
        placeholder={field.placeholder}
        className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold"
      />
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard/settings"
          className="p-1.5 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Business Profile</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-0.5">
            Configure your business identity, branding, and contact information
          </p>
        </div>
      </div>

      {message && (
        <div className={`rounded-lg px-4 py-3 text-sm border ${
          messageType === 'success'
            ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
            : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400 border-red-200 dark:border-red-800'
        }`}>
          {message}
        </div>
      )}

      {/* Business Identity */}
      <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
          <Building2 className="w-5 h-5 text-brand-gold" />
          <h2 className="font-semibold text-[hsl(var(--foreground))]">Business Identity</h2>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {IDENTITY_FIELDS.map((field) => (
              <div key={field.key}>
                <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">
                  {field.label}
                  {field.swahili && <span className="text-xs text-[hsl(var(--muted-foreground))] ml-1">(SW)</span>}
                </label>
                {renderField(field)}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Branding */}
      <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
          <Palette className="w-5 h-5 text-brand-gold" />
          <h2 className="font-semibold text-[hsl(var(--foreground))]">Branding</h2>
        </div>
        <div className="p-6 space-y-6">
          {IMAGE_SETTINGS.map((img) => (
            <ImageUploadField
              key={img.key}
              label={img.label}
              currentUrl={values[img.key] || img.defaultUrl}
              defaultUrl={img.defaultUrl}
              onUpload={(file) => handleImageUpload(img.key, file)}
              onReset={() => handleImageReset(img.key, img.defaultUrl)}
              previewSize={img.size}
              shape={img.shape}
              hint={img.hint}
            />
          ))}
        </div>
      </div>

      {/* Contact Information */}
      <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
          <Phone className="w-5 h-5 text-brand-gold" />
          <h2 className="font-semibold text-[hsl(var(--foreground))]">Contact Information</h2>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {CONTACT_FIELDS.map((field) => (
              <div key={field.key}>
                <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">
                  {field.label}
                  {field.swahili && <span className="text-xs text-[hsl(var(--muted-foreground))] ml-1">(SW)</span>}
                </label>
                {renderField(field)}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Social Media */}
      <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
          <Share2 className="w-5 h-5 text-brand-gold" />
          <h2 className="font-semibold text-[hsl(var(--foreground))]">Social Media</h2>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {SOCIAL_FIELDS.map((field) => (
              <div key={field.key}>
                <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">{field.label}</label>
                {renderField(field)}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Website */}
      <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
          <Globe className="w-5 h-5 text-brand-gold" />
          <h2 className="font-semibold text-[hsl(var(--foreground))]">Website</h2>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {WEBSITE_FIELDS.map((field) => (
              <div key={field.key}>
                <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">{field.label}</label>
                {renderField(field)}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end sticky bottom-4">
        <Button onClick={handleSave} disabled={saving || !hasChanges()}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving...' : 'Save Business Profile'}
        </Button>
      </div>
    </div>
  );
}
