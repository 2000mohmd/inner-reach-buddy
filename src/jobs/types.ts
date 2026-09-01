// Deferred background jobs — an extension point, kept deliberately small.
//
// The rest of the app only needs two operations: enqueue a job (producers, on a
// request path) and drain the queue (the scheduled sweep). The *transport* — a
// Postgres `job_queue` table today — lives in queue.ts so the
// "Cloudflare Queues vs. Supabase pg_cron + pg_net" decision can be made later
// without touching any call site.
//
// Nothing in src/jobs/ runs on a user's request path except a fast enqueue()
// insert (with an immediate, non-blocking fallback — see queue.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type ServiceClient = SupabaseClient<Database>;

/**
 * Discriminated union of every kind of deferred work. Handlers (handlers.ts)
 * must be idempotent — a job can be retried or, in the degraded path, run more
 * than once.
 */
export type Job = {
  kind: "summarize_thread";
  userId: string;
  /** The thread the user just moved away from; the handler summarizes the
   *  previous one relative to this. */
  sinceThreadId: string;
};
// Future deferred work (weekly_digest, effectiveness_recompute, …) is added as
// further members here once the queue transport is chosen.

export const JOB_KINDS = ["summarize_thread"] as const;
