// What a given user is currently allowed to do. The mobile client reads this to
// gate the chat composer, show an upgrade prompt, unlock premium features, etc.
//
// The daily message cap (`dailyLimit`) comes from chat-limits.ts —
// `dailyMessageCap(tier)` — which is the SAME function the rate limiter enforces
// with, so what we advertise here cannot drift from what we enforce. `usedToday`
// is read from chat_rate_limits.day_count (the counter the limiter actually
// checks), not chat_usage, so `remainingToday` matches enforcement exactly.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { dailyCapResetsAt, dailyMessageCap, isUnlimitedishTier } from "./chat-limits";

type Client = SupabaseClient<Database>;

export type SubscriptionTier = "free" | "premium" | "org";

export type Entitlements = {
  tier: SubscriptionTier;
  chat: {
    unlimited: boolean; // premium/org — effectively uncapped for UX
    dailyLimit: number; // the real per-tier daily cap, always present
    dailyCredits: number | null; // free tier only (== dailyLimit); null when unlimited
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

export async function getEntitlementsFor(supabase: Client, userId: string): Promise<Entitlements> {
  const today = new Date().toISOString().slice(0, 10);

  const [profileRes, rlRes] = await Promise.all([
    supabase.from("profiles").select("subscription_tier").eq("id", userId).maybeSingle(),
    // day_count is the counter the limiter enforces on. If the daily-cap columns
    // aren't present yet, this errors and we treat usage as 0.
    supabase
      .from("chat_rate_limits")
      .select("day_start, day_count")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  const tier = ((profileRes.data?.subscription_tier as SubscriptionTier | null) ??
    "free") as SubscriptionTier;

  const rl = rlRes.error ? null : rlRes.data;
  const usedToday = rl?.day_start === today ? (rl?.day_count ?? 0) : 0;

  const dailyLimit = dailyMessageCap(tier);
  const unlimited = isUnlimitedishTier(tier);

  return {
    tier,
    chat: {
      unlimited,
      dailyLimit,
      dailyCredits: unlimited ? null : dailyLimit,
      usedToday,
      remainingToday: unlimited ? null : Math.max(0, dailyLimit - usedToday),
      resetsAt: dailyCapResetsAt(),
    },
    features: {
      unlimitedHistory: unlimited,
      liveSessions: false,
      dataExport: unlimited,
    },
  };
}
