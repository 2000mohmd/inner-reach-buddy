// Job dispatch. Pure routing — the real work stays in the existing *.server.ts
// modules. Every handler must be idempotent.
import type { Job, ServiceClient } from "./types";

export async function runJob(supabase: ServiceClient, job: Job): Promise<void> {
  switch (job.kind) {
    case "summarize_thread": {
      const { findPreviousThread, ensureThreadSummary } =
        await import("@/lib/thread-summary.server");
      const previousThreadId = await findPreviousThread(supabase, job.userId, job.sinceThreadId);
      if (!previousThreadId) return;
      // ensureThreadSummary is already no-op-if-exists and fail-open. It is also
      // where the Phase 11 session-drift crisis sweep runs — deferring it here
      // does not touch the per-message crisis gate, which runs earlier in
      // sendMessage, before the rate limiter.
      await ensureThreadSummary(supabase, job.userId, previousThreadId);
      return;
    }
    default: {
      const exhaustive: never = job.kind;
      throw new Error(`unknown job kind: ${String(exhaustive)}`);
    }
  }
}
