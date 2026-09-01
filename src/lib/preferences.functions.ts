import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  COMPANION_PERSONAS,
  PERSONA_DESCRIPTIONS,
  THEME_PREFERENCES,
  getPreferencesFor,
  setPreferencesFor,
  type Preferences,
} from "./preferences.server";

const PatchInput = z
  .object({
    companionPersona: z.enum(COMPANION_PERSONAS).optional(),
    theme: z.enum(THEME_PREFERENCES).optional(),
  })
  .refine((v) => v.companionPersona !== undefined || v.theme !== undefined, {
    message: "Provide companionPersona and/or theme",
  });

export const getMyPreferences = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Preferences> => {
    return getPreferencesFor(context.supabase, context.userId);
  });

export const setMyPreferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PatchInput.parse(input))
  .handler(async ({ data, context }): Promise<Preferences> => {
    return setPreferencesFor(context.supabase, context.userId, data);
  });

/** Static catalogue for the persona picker. No auth needed. */
export const listCompanionPersonas = createServerFn({ method: "GET" }).handler(async () => {
  return COMPANION_PERSONAS.map((id) => ({ id, description: PERSONA_DESCRIPTIONS[id] }));
});
