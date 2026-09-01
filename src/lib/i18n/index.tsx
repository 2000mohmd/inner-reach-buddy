// Lightweight, SSR-safe i18n runtime. No external dependency: a provider,
// a `t()` lookup over nested JSON message files, and document lang/dir sync.
//
// Adding strings: put the English copy in locales/en.json and the same key in
// ar.json / fr.json, then call t("section.key") in the component.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import en from "./locales/en.json";
import ar from "./locales/ar.json";
import fr from "./locales/fr.json";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_COOKIE,
  LANGUAGE_STORAGE_KEY,
  languageDir,
  normalizeLanguage,
  type Language,
} from "./languages";

export * from "./languages";

type Messages = Record<string, unknown>;

const BUNDLES: Record<Language, Messages> = { en, ar, fr };

// LANGUAGE_STORAGE_KEY / LANGUAGE_COOKIE now live in ./languages (re-exported
// via `export * from "./languages"` above) so dependency-free server modules
// can import them.

function lookup(bundle: Messages, key: string): string | null {
  let node: unknown = bundle;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return null;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : null;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/** Resolves a key in the active language, falling back to English, then the key. */
export function translate(
  language: Language,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const hit = lookup(BUNDLES[language] ?? BUNDLES[DEFAULT_LANGUAGE], key);
  const fallback = hit ?? lookup(BUNDLES[DEFAULT_LANGUAGE], key);
  if (fallback === null) {
    if (import.meta.env.DEV) console.warn(`[i18n] missing translation key: ${key}`);
    return key;
  }
  return interpolate(fallback, vars);
}

type LanguageContextValue = {
  language: Language;
  dir: "ltr" | "rtl";
  setLanguage: (next: Language) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

function readStoredLanguage(): Language | null {
  if (typeof document === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored) return normalizeLanguage(stored);
  } catch {
    // localStorage can be unavailable (private mode); fall through to cookie.
  }
  const cookie = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${LANGUAGE_COOKIE}=`));
  return cookie ? normalizeLanguage(cookie.split("=")[1]) : null;
}

function persistLanguage(language: Language) {
  if (typeof document === "undefined") return;
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Non-fatal: the cookie below still carries the preference.
  }
  document.cookie = `${LANGUAGE_COOKIE}=${language}; path=/; max-age=31536000; samesite=lax`;
}

export function LanguageProvider({
  children,
  initialLanguage = DEFAULT_LANGUAGE,
}: {
  children: ReactNode;
  initialLanguage?: Language;
}) {
  // Server render always uses initialLanguage so markup matches; the stored
  // preference is applied after hydration to avoid a mismatch.
  const [language, setLanguageState] = useState<Language>(initialLanguage);

  useEffect(() => {
    const stored = readStoredLanguage();
    if (stored && stored !== language) setLanguageState(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = language;
    document.documentElement.dir = languageDir(language);
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    const normalized = normalizeLanguage(next);
    persistLanguage(normalized);
    setLanguageState(normalized);
  }, []);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      dir: languageDir(language),
      setLanguage,
      t: (key, vars) => translate(language, key, vars),
    }),
    [language, setLanguage],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useTranslation(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (context) return context;
  // Safe default so components can render outside the provider (e.g. tests).
  return {
    language: DEFAULT_LANGUAGE,
    dir: "ltr",
    setLanguage: () => undefined,
    t: (key, vars) => translate(DEFAULT_LANGUAGE, key, vars),
  };
}
