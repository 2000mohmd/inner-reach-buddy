// Lightweight per-user preferences the mobile client needs on launch:
// companion persona (tone the AI adopts) and theme. Language already lives in
// language.functions.ts. Backed by columns on `profiles` — see migration
// 20260902000100_profile_preferences.sql.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Client = SupabaseClient<Database>;

export const COMPANION_PERSONAS = ["warm", "direct", "reflective"] as const;
export type CompanionPersona = (typeof COMPANION_PERSONAS)[number];

export const THEME_PREFERENCES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const PERSONA_DESCRIPTIONS: Record<CompanionPersona, string> = {
  warm: "Gentle and validating. The default.",
  direct: "Plain-spoken and practical, fewer soft edges.",
  reflective: "Quieter, asks more than it tells.",
};

export type Preferences = {
  companionPersona: CompanionPersona;
  theme: ThemePreference;
  language: string;
};

const DEFAULTS: Preferences = { companionPersona: "warm", theme: "system", language: "en" };

// companion_persona / theme_preference are added by migration
// 20260902000100 and are not in the generated Database types until Lovable
// regenerates them; a loose view of the client keeps this file typechecking.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseClient = { from: (table: string) => any };

export async function getPreferencesFor(supabase: Client, userId: string): Promise<Preferences> {
  const { data } = await (supabase as unknown as LooseClient)
    .from("profiles")
    .select("companion_persona, theme_preference, language")
    .eq("id", userId)
    .maybeSingle();

  const row = (data ?? {}) as Record<string, string | null>;
  const persona = row["companion_persona"];
  const theme = row["theme_preference"];
  return {
    companionPersona: COMPANION_PERSONAS.includes(persona as CompanionPersona)
      ? (persona as CompanionPersona)
      : DEFAULTS.companionPersona,
    theme: THEME_PREFERENCES.includes(theme as ThemePreference)
      ? (theme as ThemePreference)
      : DEFAULTS.theme,
    language: row["language"] ?? DEFAULTS.language,
  };
}

export async function setPreferencesFor(
  supabase: Client,
  userId: string,
  patch: { companionPersona?: CompanionPersona | undefined; theme?: ThemePreference | undefined },
): Promise<Preferences> {
  const update: Record<string, string> = {};
  if (patch.companionPersona) update["companion_persona"] = patch.companionPersona;
  if (patch.theme) update["theme_preference"] = patch.theme;

  if (Object.keys(update).length > 0) {
    const { error } = await (supabase as unknown as LooseClient)
      .from("profiles")
      .update(update)
      .eq("id", userId);
    if (error) throw error;
  }
  return getPreferencesFor(supabase, userId);
}
