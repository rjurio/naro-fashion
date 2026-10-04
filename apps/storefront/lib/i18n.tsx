'use client';

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import en from '@/messages/en.json';
import sw from '@/messages/sw.json';

export type Locale = 'en' | 'sw';
type Messages = typeof en;

const messages: Record<Locale, Messages> = { en, sw };

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextType | null>(null);

export const LOCALE_COOKIE = 'locale';

function persistLocale(locale: Locale) {
  try {
    localStorage.setItem('locale', locale);
  } catch {
    /* storage unavailable */
  }
  // Mirrored to a cookie so the server can render <html lang> correctly.
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
}

export function I18nProvider({
  children,
  initialLocale = 'en',
}: {
  children: ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(
    messages[initialLocale] ? initialLocale : 'en',
  );

  useEffect(() => {
    let saved: Locale | null = null;
    try {
      saved = localStorage.getItem('locale') as Locale | null;
    } catch {
      /* storage unavailable */
    }
    if (saved && messages[saved]) {
      setLocaleState(saved);
      // Back-fill the cookie for visitors whose choice predates it.
      persistLocale(saved);
    }
  }, []);

  // Keep <html lang> in sync with the active locale (screen readers, hyphenation).
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    persistLocale(newLocale);
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
