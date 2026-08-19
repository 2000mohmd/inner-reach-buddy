// Language catalogue, shared by client UI, server prompts and the crisis gate.
// Kept dependency-free so server-only modules can import it safely.

export const LANGUAGES = [
  { code: "en", label: "English", nativeLabel: "English", dir: "ltr" },
  { code: "ar", label: "Arabic", nativeLabel: "العربية", dir: "rtl" },
  { code: "fr", label: "French", nativeLabel: "Français", dir: "ltr" },
] as const;

export type Language = (typeof LANGUAGES)[number]["code"];

export const DEFAULT_LANGUAGE: Language = "en";

export const LANGUAGE_CODES = LANGUAGES.map((entry) => entry.code) as Language[];

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGE_CODES as string[]).includes(value);
}

export function normalizeLanguage(value: unknown): Language {
  if (isLanguage(value)) return value;
  if (typeof value === "string") {
    const base = value.toLowerCase().split(/[-_]/)[0];
    if (isLanguage(base)) return base;
  }
  return DEFAULT_LANGUAGE;
}

export function languageDir(language: Language): "ltr" | "rtl" {
  return LANGUAGES.find((entry) => entry.code === language)?.dir ?? "ltr";
}

export function isRtl(language: Language): boolean {
  return languageDir(language) === "rtl";
}

/** Human-readable name used inside AI system prompts. */
export function languageName(language: Language): string {
  const entry = LANGUAGES.find((item) => item.code === language);
  return entry ? `${entry.label} (${entry.nativeLabel})` : "English";
}

/**
 * Cheap script sniff for a single message. Used by the crisis gate to decide
 * whether the English regex tier could plausibly have applied at all — NOT a
 * full language detector.
 */
export function detectMessageScript(text: string): "arabic" | "latin" | "other" {
  if (/[\u0600-\u06FF\u0750-\u077F]/.test(text)) return "arabic";
  if (/[A-Za-z\u00C0-\u024F]/.test(text)) return "latin";
  return "other";
}
