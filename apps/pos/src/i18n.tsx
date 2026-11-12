import { createContext, useContext, useState, type ReactNode } from 'react';
import { sv } from './sv';

/**
 * UI text is written in English in the code and wrapped in t(). Swedish comes from the
 * dictionary in sv.ts, keyed by the English text; a missing entry falls back to English.
 * i18n.test.ts fails if a t('…') string has no Swedish entry.
 */
export type Lang = 'en' | 'sv';

const STORAGE_KEY = 'pos.lang';

function savedLang(): Lang {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'en' || value === 'sv') return value;
  } catch {
    // Storage blocked: use the default.
  }
  return 'en';
}

let current: Lang = savedLang();

/** Translates English UI text. {name} placeholders are filled from vars. */
export function translate(text: string, vars?: Record<string, string | number>): string {
  const base = current === 'sv' ? (sv[text] ?? text) : text;
  return vars
    ? base.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? `{${key}}`))
    : base;
}

const LanguageContext = createContext<{ lang: Lang; setLang: (lang: Lang) => void }>({
  lang: current,
  setLang: () => {},
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setState] = useState<Lang>(current);
  const setLang = (next: Lang) => {
    current = next;
    document.documentElement.lang = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage blocked: the choice lasts until reload.
    }
    setState(next);
  };
  return <LanguageContext.Provider value={{ lang, setLang }}>{children}</LanguageContext.Provider>;
}

/** Returns t(); using it re-renders the component when the language changes. */
export function useT() {
  useContext(LanguageContext);
  return translate;
}

export function LanguageToggle() {
  const { lang, setLang } = useContext(LanguageContext);
  return (
    <div className="lang-toggle" role="group" aria-label="Language / Språk">
      {(['en', 'sv'] as const).map((l) => (
        <button
          key={l}
          type="button"
          className={lang === l ? 'active' : ''}
          aria-pressed={lang === l}
          onClick={() => setLang(l)}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
