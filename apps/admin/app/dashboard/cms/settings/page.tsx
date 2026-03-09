'use client';

import { useState } from 'react';
import { Save, Globe, Mail, Phone, Palette, Share2 } from 'lucide-react';
import Button from '@/components/ui/Button';

interface Setting {
  key: string;
  label: string;
  value: string;
  type: 'text' | 'email' | 'url' | 'select';
  group: string;
  options?: string[];
}

const initialSettings: Setting[] = [
  { key: 'site_name', label: 'Site Name', value: 'Naro Fashion', type: 'text', group: 'General' },
  { key: 'site_description', label: 'Site Description', value: 'Your premier fashion destination in Tanzania', type: 'text', group: 'General' },
  { key: 'contact_email', label: 'Contact Email', value: 'info@narofashion.co.tz', type: 'email', group: 'Contact' },
  { key: 'contact_phone', label: 'Contact Phone', value: '+255712000000', type: 'text', group: 'Contact' },
  { key: 'currency', label: 'Currency', value: 'TZS', type: 'select', group: 'General', options: ['TZS', 'USD', 'KES', 'UGX'] },
  { key: 'default_theme', label: 'Default Theme', value: 'Standard', type: 'select', group: 'General', options: ['Light', 'Dark', 'Standard'] },
  { key: 'facebook_url', label: 'Facebook', value: 'https://facebook.com/narofashion', type: 'url', group: 'Social Media' },
  { key: 'instagram_url', label: 'Instagram', value: 'https://instagram.com/narofashion', type: 'url', group: 'Social Media' },
  { key: 'twitter_url', label: 'Twitter / X', value: 'https://x.com/narofashion', type: 'url', group: 'Social Media' },
];

const groupIcons: Record<string, React.ReactNode> = {
  General: <Globe className="w-5 h-5 text-brand-gold" />,
  Contact: <Mail className="w-5 h-5 text-brand-gold" />,
  'Social Media': <Share2 className="w-5 h-5 text-brand-gold" />,
};

export default function SiteSettingsPage() {
  const [settings, setSettings] = useState<Setting[]>(initialSettings);
  const [saved, setSaved] = useState(false);

  const updateSetting = (key: string, value: string) => {
    setSettings((prev) => prev.map((s) => (s.key === key ? { ...s, value } : s)));
    setSaved(false);
  };

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const groups = Array.from(new Set(settings.map((s) => s.group)));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Site Settings</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
            Configure global storefront settings
          </p>
        </div>
        <Button onClick={handleSave}>
          <Save className="w-4 h-4" />
          {saved ? 'Saved!' : 'Save Settings'}
        </Button>
      </div>

      {saved && (
        <div className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 rounded-lg px-4 py-3 text-sm">
          Settings saved successfully.
        </div>
      )}

      {/* Settings Groups */}
      {groups.map((group) => (
        <div key={group} className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl overflow-hidden">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
            {groupIcons[group]}
            <h2 className="font-semibold text-[hsl(var(--foreground))]">{group}</h2>
          </div>
          <div className="divide-y divide-[hsl(var(--border))]">
            {settings
              .filter((s) => s.group === group)
              .map((setting) => (
                <div
                  key={setting.key}
                  className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-6 py-4"
                >
                  <label className="text-sm font-medium text-[hsl(var(--foreground))] sm:w-40 shrink-0">
                    {setting.label}
                  </label>
                  <div className="flex-1">
                    {setting.type === 'select' ? (
                      <select
                        value={setting.value}
                        onChange={(e) => updateSetting(setting.key, e.target.value)}
                        className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold"
                      >
                        {setting.options?.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={setting.type}
                        value={setting.value}
                        onChange={(e) => updateSetting(setting.key, e.target.value)}
                        className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold"
                      />
                    )}
                  </div>
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
