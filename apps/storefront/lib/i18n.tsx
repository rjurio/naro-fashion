'use client';

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import en from '@/messages/en.json';
import sw from '@/messages/sw.json';

type Locale = 'en' | 'sw';
type Messages = typeof en;

const messages: Record<Locale, Messages> = { en, sw };

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextType | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  useEffect(() => {
    const saved = localStorage.getItem('locale') as Locale;
    if (saved && messages[saved]) setLocaleState(saved);
  }, []);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem('locale', newLocale);
    document.documentElement.lang = newLocale;
  }, []);

  const t = useCallback((key: string): string => {
    const keys = key.split('.');
    let value: unknown = messages[locale];
    for (const k of keys) {
      if (value && typeof value === 'object') {
        value = (value as Record<string, unknown>)[k];
      } else {
        return key; // fallback to key
      }
    }
    return typeof value === 'string' ? value : key;
  }, [locale]);

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used within I18nProvider');
  return context;
}

export function useTranslation(namespace?: string) {
  const { t, locale, setLocale } = useI18n();
  const nt = useCallback((key: string) => {
    return namespace ? t(`${namespace}.${key}`) : t(key);
  }, [t, namespace]);
  return { t: nt, locale, setLocale };
}
