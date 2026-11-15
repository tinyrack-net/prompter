import { createContext, type ReactNode, useContext, useEffect, useMemo } from 'react';
import { useHydrated } from '~/lib/use-hydrated.ts';
import { useSettings } from '~/state/settings-store.ts';
import { detectBrowserLanguage, type Language, resolveLanguage } from '~core/language.ts';
import { MESSAGES, type Messages } from './messages.ts';

interface I18n {
  language: Language;
  t: Messages;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [settings] = useSettings();
  // The browser language is unknown on the server; English is used until hydration.
  const hydrated = useHydrated();
  const language = resolveLanguage(settings.uiLanguage, () =>
    hydrated ? detectBrowserLanguage() : 'en',
  );

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo(() => ({ language, t: MESSAGES[language] }), [language]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}
