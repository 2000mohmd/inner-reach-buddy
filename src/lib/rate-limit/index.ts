// Rate-limiting entry point. Call sites use getRateLimiter() + the RateLimiter
// interface and nothing else.
//
// TODO(rate-limit-transport): the sliding-window state in chat_rate_limits is a
// hot per-message write on the Postgres primary. Decision made — move it to the
// Cloudflare Workers rate-limiting binding (a `ratelimit` binding in the wrangler
// config; no network hop, no new account). Add a CloudflareRateLimiter that
// reads the binding off the request env and switch the return below. Postgres is
// fine until primary write load shows otherwise. chat_usage (the durable
// token/cost counter) stays in Postgres either way.
import type { RateLimiter } from "./types";
import { PostgresRateLimiter } from "./postgres";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MinimalClient = { from: (table: string) => any };

export function getRateLimiter(supabase: MinimalClient): RateLimiter {
  return new PostgresRateLimiter(supabase);
}

export { RATE_LIMIT_MESSAGE } from "./postgres";
export type {
  RateLimiter,
  RateLimitDecision,
  RateLimitReason,
  UsageRecord,
  UsageSummary,
} from "./types";
export { estimateCostUsd } from "./pricing";
