"use client";

import React, { createContext, useCallback, useContext, useEffect } from "react";
import en from "./en";
import zh from "./zh";
import { usePreferences } from "@/lib/preferences-context";
import type { Locale } from "@/lib/preferences-types";

export type { Locale } from "@/lib/preferences-types";

const translations: Record<Locale, Record<string, string>> = { en, zh };

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: "en",
  setLocale: () => {},
  t: (key: string) => key,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const { preferences, updatePreferences } = usePreferences();
  const locale = preferences.locale;

  const setLocale = useCallback((newLocale: Locale) => {
    void updatePreferences({ locale: newLocale }).catch(() => undefined);
  }, [updatePreferences]);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      const dict = translations[locale] ?? translations.en;
      let text = dict[key] ?? key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          text = text.replace(`\${${k}}`, String(v));
        }
      }
      return text;
    },
    [locale],
  );

  // Update html lang attribute when locale changes
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("lang", locale);
    }
  }, [locale]);

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
