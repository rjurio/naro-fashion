'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save, Globe, Loader2, ToggleLeft, LayoutGrid, Building2, Crown } from 'lucide-react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import { useToast } from '@/contexts/ToastContext';
import { adminApi } from '@/lib/api';

interface SettingDef {
  key: string;
  label: string;
  type: 'text' | 'email' | 'url' | 'select' | 'textarea';
  group: string;
  options?: string[];
  defaultValue: string;
  hint?: string;
  /** If true, a paired _sw key is auto-generated for Swahili */
  bilingual?: boolean;
}

const SETTING_DEFINITIONS: SettingDef[] = [
  // General
  { key: 'default_theme', label: 'Default Theme', type: 'select', group: 'General', options: ['Light', 'Dark', 'Standard'], defaultValue: 'Standard' },
  // Features
  { key: 'instagram_feed_visible', label: 'Show Instagram Feed on Storefront', type: 'select', group: 'Features', options: ['true', 'false'], defaultValue: 'true' },
  { key: 'rental_section_visible', label: 'Show Rental Section on Homepage', type: 'select', group: 'Features', options: ['true', 'false'], defaultValue: 'true' },
  // Homepage — New Arrivals
  { key: 'new_arrivals_title', label: 'New Arrivals Title', type: 'text', group: 'Homepage Sections', defaultValue: 'New Arrivals', bilingual: true },
  { key: 'new_arrivals_subtitle', label: 'New Arrivals Subtitle', type: 'text', group: 'Homepage Sections', defaultValue: 'Fresh styles just dropped this week', bilingual: true },
  { key: 'new_arrivals_layout', label: 'New Arrivals Layout', type: 'select', group: 'Homepage Sections', options: ['single_row', 'multi_row'], defaultValue: 'single_row' },
  // Rental Section
  { key: 'rental_section_badge', label: 'Badge Text', type: 'text', group: 'Rental Section', defaultValue: 'Premium Rental Service', bilingual: true },
  { key: 'rental_section_title', label: 'Title', type: 'text', group: 'Rental Section', defaultValue: 'Rent Designer Gowns for Your Special Occasion', bilingual: true },
  { key: 'rental_section_description', label: 'Description', type: 'text', group: 'Rental Section', defaultValue: 'Why buy when you can rent? Access our exclusive collection of designer gowns and formal wear at a fraction of the price.', bilingual: true },
  { key: 'rental_section_features', label: 'Features (one per line)', type: 'textarea', group: 'Rental Section', defaultValue: 'Designer gowns\nDaily rental rates\nCleaning included\n25% down payment\nFree alterations', hint: 'Each line becomes a feature pill on the storefront', bilingual: true },
  { key: 'rental_section_cta', label: 'Button Text', type: 'text', group: 'Rental Section', defaultValue: 'Browse All Gowns', bilingual: true },
];

/** Build full list of keys including _sw variants for bilingual settings */
function getAllKeys(): string[] {
  const keys: string[] = [];
  SETTING_DEFINITIONS.forEach((def) => {
    keys.push(def.key);
    if (def.bilingual) keys.push(`${def.key}_sw`);
  });
  return keys;
}

const groupIcons: Record<string, React.ReactNode> = {
  General: <Globe className="w-5 h-5 text-brand-gold" />,
  Features: <ToggleLeft className="w-5 h-5 text-brand-gold" />,
  'Homepage Sections': <LayoutGrid className="w-5 h-5 text-brand-gold" />,
  'Rental Section': <Crown className="w-5 h-5 text-brand-gold" />,
};

export default function SiteSettingsPage() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [originalValues, setOriginalValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      const data = await adminApi.getSettings();
      const map: Record<string, string> = {};
      if (Array.isArray(data)) {
        data.forEach((s: { key: string; value: string }) => { map[s.key] = s.value; });
      }
      // Merge with defaults
      const merged: Record<string, string> = {};
      SETTING_DEFINITIONS.forEach((def) => {
        merged[def.key] = map[def.key] ?? def.defaultValue;
        if (def.bilingual) {
          merged[`${def.key}_sw`] = map[`${def.key}_sw`] ?? '';
        }
      });
      setValues(merged);
      setOriginalValues(merged);
    } catch { toast.error('Failed to load settings'); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const isDirty = JSON.stringify(values) !== JSON.stringify(originalValues);

  const handleSave = async () => {
    setSaving(true);
    try {
      const allKeys = getAllKeys();
      const promises = allKeys
        .filter((key) => values[key] !== undefined && values[key] !== originalValues[key])
        .map((key) => adminApi.updateSetting(key, { value: values[key] }));
      await Promise.all(promises);
      setOriginalValues({ ...values });
      toast.success('Settings saved');
    } catch { toast.error('Failed to save settings'); }
    finally { setSaving(false); }
  };

  const groups = Array.from(new Set(SETTING_DEFINITIONS.map((s) => s.group)));
  const inputClass = 'w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-gold';

  const renderField = (key: string, def: SettingDef, placeholder: string) => {
    if (def.type === 'select') {
      return (
        <select title={placeholder} value={values[key] || ''} onChange={(e) => setValues({ ...values, [key]: e.target.value })} className={inputClass}>
          {def.options?.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      );
    }
    if (def.type === 'textarea') {
      return (
        <div>
          <textarea
            value={values[key] || ''}
            onChange={(e) => setValues({ ...values, [key]: e.target.value })}
            className={`${inputClass} min-h-[100px] resize-y`}
            placeholder={placeholder}
            rows={4}
          />
          {def.hint && key === def.key && <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">{def.hint}</p>}
        </div>
      );
    }
    return (
      <input type={def.type} value={values[key] || ''} onChange={(e) => setValues({ ...values, [key]: e.target.value })}
        className={inputClass} placeholder={placeholder} />
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
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">Site Settings</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">Configure global storefront settings</p>
        </div>
        <Button onClick={handleSave} disabled={!isDirty || saving}>
          {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : <><Save className="w-4 h-4" /> Save Settings</>}
        </Button>
      </div>

      <Link
        href="/dashboard/settings/business-profile"
        className="flex items-center gap-3 p-4 rounded-xl border border-brand-gold/30 bg-brand-gold/5 hover:bg-brand-gold/10 transition-colors"
      >
        <Building2 className="w-5 h-5 text-brand-gold flex-shrink-0" />
        <div>
          <p className="text-sm font-medium text-[hsl(var(--foreground))]">Business identity settings have moved</p>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Name, logo, contact details, and social links are now in Settings &rarr; Business Profile</p>
        </div>
      </Link>

      {groups.map((group) => (
        <div key={group} className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl overflow-hidden">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
            {groupIcons[group]}
            <h2 className="font-semibold text-[hsl(var(--foreground))]">{group}</h2>
          </div>
          <div className="divide-y divide-[hsl(var(--border))]">
            {SETTING_DEFINITIONS
              .filter((s) => s.group === group)
              .map((def) => (
                <div key={def.key} className="px-6 py-4">
                  {def.bilingual ? (
                    <div className="space-y-3">
                      <label className="text-sm font-medium text-[hsl(var(--foreground))]">{def.label}</label>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <span className="text-[10px] font-bold uppercase tracking-wider bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] px-1.5 py-0.5 rounded">EN</span>
                            <span className="text-xs text-[hsl(var(--muted-foreground))]">English</span>
                          </div>
                          {renderField(def.key, def, `${def.label} (English)`)}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <span className="text-[10px] font-bold uppercase tracking-wider bg-brand-gold/10 text-brand-gold px-1.5 py-0.5 rounded">SW</span>
                            <span className="text-xs text-[hsl(var(--muted-foreground))]">Kiswahili</span>
                          </div>
                          {renderField(`${def.key}_sw`, def, `${def.label} (Kiswahili)`)}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                      <label className="text-sm font-medium text-[hsl(var(--foreground))] sm:w-48 shrink-0">{def.label}</label>
                      <div className="flex-1">
                        {renderField(def.key, def, def.label)}
                      </div>
                    </div>
                  )}
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
