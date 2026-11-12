import {
  ActionIcon,
  SegmentedControl,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { IconMoon, IconSun } from '@tabler/icons-react';
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

export function LanguageToggle({ size = 'xs' }: { size?: 'xs' | 'sm' }) {
  const { lang, setLang } = useContext(LanguageContext);
  return (
    <SegmentedControl
      size={size}
      radius="xl"
      aria-label="Language / Språk"
      value={lang}
      onChange={(value) => setLang(value as Lang)}
      data={[
        { value: 'en', label: 'EN' },
        { value: 'sv', label: 'SV' },
      ]}
    />
  );
}

/** Light / dark switch; Mantine remembers the choice per device. */
export function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme('light');
  const label = translate(scheme === 'dark' ? 'Light mode' : 'Dark mode');
  return (
    <Tooltip label={label}>
      <ActionIcon
        variant="default"
        size="lg"
        radius="xl"
        aria-label={label}
        onClick={() => setColorScheme(scheme === 'dark' ? 'light' : 'dark')}
      >
        {scheme === 'dark' ? (
          <IconSun size={18} stroke={1.6} />
        ) : (
          <IconMoon size={18} stroke={1.6} />
        )}
      </ActionIcon>
    </Tooltip>
  );
}
