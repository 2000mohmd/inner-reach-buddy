// Single source of truth for the per-user daily message cap.
//
// The enforcer (rate-limit/postgres.ts) and the reporter
// (entitlements.server.ts / GET /api/v1/entitlements) BOTH derive the number
// from `dailyMessageCap(tier)` here — so the limit we advertise is exactly the
// limit we enforce. Previously the enforcer used a flat CHAT_DAILY_MESSAGE_CAP
// for everyone while entitlements reported a separate FREE_DAILY_CHAT_CREDITS,
// and the two could drift.

export type ChatTier = "free" | "premium" | "org";

function envInt(key: string, fallback: number): number {
  const raw = Number(process.env[key]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

/** Free tier: 8 messages/day by default. Tune with FREE_DAILY_MESSAGE_CAP. */
export const FREE_DAILY_MESSAGE_CAP = envInt(
  "FREE_DAILY_MESSAGE_CAP",
  // Legacy name, still honoured so an existing deployment env doesn't silently change.
  envInt("FREE_DAILY_CHAT_CREDITS", 8),
);

/** Premium / org: the high cap. Tune with CHAT_DAILY_MESSAGE_CAP. */
export const HIGH_DAILY_MESSAGE_CAP = envInt("CHAT_DAILY_MESSAGE_CAP", 200);

/** premium and org are treated as effectively uncapped for UX purposes. */
export function isUnlimitedishTier(tier: string | null | undefined): boolean {
  return tier === "premium" || tier === "org";
}

/** The daily message cap that actually applies to this user's tier. */
export function dailyMessageCap(tier: string | null | undefined): number {
  return isUnlimitedishTier(tier) ? HIGH_DAILY_MESSAGE_CAP : FREE_DAILY_MESSAGE_CAP;
}

/** ISO timestamp of the next UTC midnight — when the daily cap resets. */
export function dailyCapResetsAt(now: Date = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0),
  ).toISOString();
}
