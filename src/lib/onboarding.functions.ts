import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const AccountType = z.enum(["general", "condition", "teen", "org_member"]);

const OnboardingInput = z.object({
  preferred_name: z.string().trim().min(1).max(60),
  account_type: AccountType,
  privacy_consent: z.literal(true),
  ai_context_consent: z.boolean(),
  age_confirmed_13_plus: z.literal(true),
  intro_text: z.string().trim().max(2000).optional().default(""),
  goals: z.array(z.string().trim().max(80)).max(12).default([]),
  stressors: z.array(z.string().trim().max(80)).max(12).default([]),
  existing_diagnosis: z.string().trim().max(200).optional().default(""),
  communication_preference: z.string().trim().max(120).optional().default(""),
  topics_to_avoid: z.string().trim().max(500).optional().default(""),
  in_professional_care: z.boolean().default(false),
  baseline_mood: z.number().int().min(1).max(5),
  baseline_tags: z.array(z.string().trim().max(40)).max(10).default([]),
});

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const [profile, intro, moods] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("user_profiles").select("*").eq("user_id", userId).maybeSingle(),
      supabase
        .from("mood_logs")
        .select("id, score, note, tags, logged_at, is_baseline")
        .eq("user_id", userId)
        .order("logged_at", { ascending: false })
        .limit(7),
    ]);

    if (profile.error) throw profile.error;

    return {
      profile: profile.data,
      intro: intro.data,
      recentMoods: moods.data ?? [],
    };
  });

export const completeOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => OnboardingInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { error: profileError } = await supabase
      .from("profiles")
      .update({
        preferred_name: data.preferred_name,
        account_type: data.account_type,
        privacy_consent: data.privacy_consent,
        ai_context_consent: data.ai_context_consent,
        age_confirmed_13_plus: data.age_confirmed_13_plus,
        consent_accepted_at: new Date().toISOString(),
        onboarding_completed: true,
      })
      .eq("id", userId);
    if (profileError) throw profileError;

    const { error: introError } = await supabase.from("user_profiles").upsert(
      {
        user_id: userId,
        intro_text: data.intro_text || null,
        goals: data.goals,
        stressors: data.stressors,
        existing_diagnosis: data.existing_diagnosis || null,
        communication_preference: data.communication_preference || null,
        topics_to_avoid: data.topics_to_avoid || null,
        in_professional_care: data.in_professional_care,
      },
      { onConflict: "user_id" },
    );
    if (introError) throw introError;

    const { error: moodError } = await supabase.from("mood_logs").insert({
      user_id: userId,
      score: data.baseline_mood,
      tags: data.baseline_tags,
      is_baseline: true,
    });
    if (moodError) throw moodError;

    return { ok: true };
  });

export const deleteMyData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await supabase.from("mood_logs").delete().eq("user_id", userId);
    await supabase.from("user_profiles").update({
      intro_text: null,
      goals: [],
      stressors: [],
      existing_diagnosis: null,
      communication_preference: null,
      topics_to_avoid: null,
    }).eq("user_id", userId);
    return { ok: true };
  });
