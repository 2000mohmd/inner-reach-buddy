// Lightweight per-user chat rate limit. Applies ONLY to the normal
// conversational path — the crisis-detection gate is never rate-limited.

const WINDOW_MS = 10 * 60 * 1000;
const MAX_MESSAGES = 20;

export const RATE_LIMIT_MESSAGE =
  "Let's take a short breather — we've covered a lot quickly. Try again in a few minutes and I'll be right here.";

type MinimalClient = {
  from: (table: string) => any;
};

/** Returns whether the user may send another message in the current window. */
export async function checkRateLimit(
  supabase: MinimalClient,
  userId: string,
): Promise<{ allowed: boolean }> {
  const now = Date.now();

  const { data, error } = await supabase
    .from("chat_rate_limits")
    .select("window_start, count")
    .eq("user_id", userId)
    .maybeSingle();

  // Never block a conversation because the limiter itself failed.
  if (error) {
    console.error("rate limit read failed", error);
    return { allowed: true };
  }

  const windowStart = data ? new Date(data.window_start).getTime() : 0;
  const withinWindow = Boolean(data) && now - windowStart < WINDOW_MS;

  if (withinWindow && (data?.count ?? 0) >= MAX_MESSAGES) {
    return { allowed: false };
  }

  const next = withinWindow
    ? { user_id: userId, window_start: new Date(windowStart).toISOString(), count: (data?.count ?? 0) + 1 }
    : { user_id: userId, window_start: new Date(now).toISOString(), count: 1 };

  const upsert = await supabase.from("chat_rate_limits").upsert(next, { onConflict: "user_id" });
  if (upsert.error) console.error("rate limit write failed", upsert.error);

  return { allowed: true };
}
