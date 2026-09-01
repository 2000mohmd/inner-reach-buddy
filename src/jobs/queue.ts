// Postgres-backed job transport, with a safe degradation path.
//
// enqueueJob(): INSERTs a row into `job_queue` using the service-role client and
// returns. If that fails for any reason — the migration is not applied yet, no
// SUPABASE_SERVICE_ROLE_KEY in this environment, a transient DB error — it falls
// back to running the job as a FLOATING, un-awaited promise on the caller's own
// client. Non-durable (the job is lost if the runtime tears down first), but the
// caller's response is never delayed. That trade is deliberate: a chat reply
// must always come back immediately.
//
// drainJobs(): called by the scheduled sweep. Claims a bounded batch with
// SKIP-LOCKED semantics (via the claim_jobs SQL function), runs each handler
// within a wall-clock budget, and reschedules failures with exponential backoff
// up to MAX_ATTEMPTS, after which the row is dead-lettered. Whatever powers the
// schedule — Cloudflare Queues, Supabase pg_cron + pg_net, an external cron —
// only needs to call the sweep endpoint; this function does not care which.
//
// TODO(queue-transport): once "Cloudflare Queues vs. pg_cron + pg_net" is
// decided, a real producer/consumer binding replaces the table here. Call sites
// (enqueueJob) and handlers do not change.
import type { Job, ServiceClient } from "./types";
import { runJob } from "./handlers";

const MAX_ATTEMPTS = 5;

type JobRow = { id: string; kind: string; payload: Job; attempts: number };

/**
 * @param fallbackClient the caller's Supabase client, used ONLY if the durable
 *   insert fails (e.g. the user-scoped client inside a request handler).
 */
export async function enqueueJob(fallbackClient: ServiceClient, job: Job): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("job_queue")
      .insert({ kind: job.kind, payload: job });
    if (error) throw error;
    return; // durable enqueue succeeded — the sweep will run it
  } catch (err) {
    console.warn(
      "job_queue enqueue unavailable; running job best-effort off the response path",
      err instanceof Error ? err.message : err,
    );
    // Floating on purpose: never await. An occasional lost or repeated job is
    // harmless because every handler is idempotent.
    void runJob(fallbackClient, job).catch((runErr) =>
      console.error("best-effort job run failed", job.kind, runErr),
    );
  }
}

export type DrainResult = {
  claimed: number;
  completed: number;
  failed: number;
  timedOut: boolean;
};

export async function drainJobs(
  admin: ServiceClient,
  opts: { budgetMs: number; max: number },
): Promise<DrainResult> {
  const deadline = Date.now() + Math.max(0, opts.budgetMs);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any;

  let claimedRows: JobRow[] = [];
  try {
    const { data, error } = await db.rpc("claim_jobs", { p_limit: Math.max(0, opts.max) });
    if (error) throw error;
    claimedRows = (data ?? []) as JobRow[];
  } catch (err) {
    console.error("claim_jobs unavailable — job queue not drained this sweep", err);
    return { claimed: 0, completed: 0, failed: 0, timedOut: false };
  }

  let completed = 0;
  let failed = 0;
  let timedOut = false;

  for (const row of claimedRows) {
    if (Date.now() > deadline) {
      timedOut = true;
      // Release the claim so the next sweep retries it immediately.
      await db.from("job_queue").update({ locked_at: null }).eq("id", row.id);
      continue;
    }
    try {
      await runJob(admin, row.payload);
      await db
        .from("job_queue")
        .update({ completed_at: new Date().toISOString() })
        .eq("id", row.id);
      completed += 1;
    } catch (err) {
      failed += 1;
      const attempts = row.attempts + 1;
      const dead = attempts >= MAX_ATTEMPTS;
      const backoffMs = Math.min(60 * 60_000, 2 ** attempts * 30_000);
      await db
        .from("job_queue")
        .update({
          locked_at: null,
          attempts,
          last_error: String(err instanceof Error ? err.message : err).slice(0, 500),
          run_after: new Date(Date.now() + backoffMs).toISOString(),
          completed_at: dead ? new Date().toISOString() : null,
          dead_lettered: dead,
        })
        .eq("id", row.id);
      console.error(
        `job ${row.kind} failed (attempt ${attempts}${dead ? ", dead-lettered" : ""})`,
        err,
      );
    }
  }

  return { claimed: claimedRows.length, completed, failed, timedOut };
}
