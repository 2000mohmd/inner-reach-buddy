import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  LANGUAGE_CODES,
  LANGUAGE_COOKIE,
  normalizeLanguage,
  type Language,
} from "./i18n/languages";

/**
 * The preference cookie, read server-side for the first render. No auth — it is
 * just the visitor's UI-language choice. Falls back to the default language.
 */
export const getPreferredLanguage = createServerFn({ method: "GET" }).handler(
  async (): Promise<Language> => {
    const { getCookie } = await import("@tanstack/react-start/server");
    return normalizeLanguage(getCookie(LANGUAGE_COOKIE));
  },
);

function parseLanguage(input: unknown): Language {
  if (typeof input === "string" && (LANGUAGE_CODES as string[]).includes(input)) {
    return input as Language;
  }
  throw new Error("Unsupported language");
}

/** Persist the signed-in user's language to their profile. */
export const setMyLanguage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseLanguage)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("profiles").update({ language: data }).eq("id", userId);
    if (error) throw error;
    return { language: data };
  });

/** Read the signed-in user's stored language (null if unset / on error). */
export const getMyLanguage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Language | null> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("profiles")
      .select("language")
      .eq("id", userId)
      .maybeSingle();
    if (error || !data?.language) return null;
    return normalizeLanguage(data.language);
  });
