// What a given user is currently allowed to do. The mobile client reads this to
// gate the chat composer, show an upgrade prompt, unlock premium features, etc.
//
// Free tier gets ONE companion message per UTC day (the daily credit); premium
// and org are unlimited. The counter reuses chat_usage.day_messages, which
// sendMessage already increments, so this stays in sync without a second write.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Client = SupabaseClient<Database>;

export type SubscriptionTier = "free" | "premium" | "org";

const FREE_DAILY_CHAT_CREDITS = Number(process.env["FREE_DAILY_CHAT_CREDITS"] ?? 1);

export type Entitlements = {
  tier: SubscriptionTier;
  chat: {
    unlimited: boolean;
    dailyCredits: number | null; // null when unlimited
    usedToday: number;
    remainingToday: number | null; // null when unlimited
    resetsAt: string; // ISO — next UTC midnight
  };
  features: {
    unlimitedHistory: boolean;
    liveSessions: boolean; // not built yet; always false
    dataExport: boolean;
  };
};

function nextUtcMidnight(): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0),
  ).toISOString();
}

export async function getEntitlementsFor(supabase: Client, userId: string): Promise<Entitlements> {
  const today = new Date().toISOString().slice(0, 10);

  const [profileRes, usageRes] = await Promise.all([
    supabase.from("profiles").select("subscription_tier").eq("id", userId).maybeSingle(),
    supabase.from("chat_usage").select("day, day_messages").eq("user_id", userId).maybeSingle(),
  ]);

  const tier = ((profileRes.data?.subscription_tier as SubscriptionTier | null) ??
    "free") as SubscriptionTier;
  const usedToday = usageRes.data?.day === today ? (usageRes.data?.day_messages ?? 0) : 0;
  const unlimited = tier !== "free";

  return {
    tier,
    chat: {
      unlimited,
      dailyCredits: unlimited ? null : FREE_DAILY_CHAT_CREDITS,
      usedToday,
      remainingToday: unlimited ? null : Math.max(0, FREE_DAILY_CHAT_CREDITS - usedToday),
      resetsAt: nextUtcMidnight(),
    },
    features: {
      unlimitedHistory: unlimited,
      liveSessions: false,
      dataExport: unlimited,
    },
  };
}
