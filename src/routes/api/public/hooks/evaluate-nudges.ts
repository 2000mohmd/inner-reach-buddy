import { createFileRoute } from "@tanstack/react-router";

/**
 * Proactive-coaching sweep. Callable by pg_cron / Cloudflare Queues / an
 * external scheduler with the dedicated NUDGE_SWEEP_SECRET in an
 * `x-sweep-secret` header.
 *
 * NOTE: this previously checked SUPABASE_PUBLISHABLE_KEY, which is NOT a secret
 * — the publishable/anon key ships in the client bundle, so anyone could have
 * triggered the sweep. It is now a dedicated server-only secret.
 *
 * SCALE: this used to loop synchronously over up to 500 users doing effectiveness
 * recompute + nudge eval + weekly digest inside one HTTP handler, which would
 * exceed Cloudflare Workers' request time limit well before 500. It now runs
 * against a wall-clock BUDGET: it processes a bounded batch of users starting
 * from a persisted cursor (public.sweep_state), and the next scheduled
 * invocation resumes where this one stopped. Call it every 1-2 minutes.
 *
 * Crisis escalation runs first, unconditionally, every invocation — it is never
 * subject to the cursor or the budget.
 */

const SWEEP_NAME = "evaluate_nudges";
const ACTIVE_WINDOW_DAYS = 30;

const num = (key: string, fallback: number) => {
  const raw = Number(process.env[key]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
};

export const Route = createFileRoute("/api/public/hooks/evaluate-nudges")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-sweep-secret");
        const expected = process.env["NUDGE_SWEEP_SECRET"];
        if (!expected || !provided || provided !== expected) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const BUDGET_MS = num("NUDGE_SWEEP_BUDGET_MS", 50_000);
        const USER_BATCH = num("NUDGE_SWEEP_USER_BATCH", 25);
        const JOB_BATCH = num("NUDGE_SWEEP_JOB_BATCH", 20);
        const deadline = Date.now() + BUDGET_MS;
        const timeLeft = () => deadline - Date.now();

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { evaluateNudgesFor } = await import("@/lib/nudges.server");
        const { generateWeeklyDigestFor } = await import("@/lib/weekly-digest.server");
        const { computeEffectivenessFor, hasNewActivitySince } =
          await import("@/lib/effectiveness.server");

        // --- 1. Crisis escalation: unreviewed crisis events older than 30 min
        // get a repeat, more urgent admin email. First, always, no budget cap. ---
        let escalated = 0;
        try {
          const { escalateUnreviewedCrisisEvents } = await import("@/lib/crisis-alert.server");
          const result = await escalateUnreviewedCrisisEvents(supabaseAdmin);
          escalated = result.escalated;
        } catch (escalationError) {
          console.error("crisis escalation sweep failed", escalationError);
        }

        // --- 1b. 12-hour "haven't heard from you" chat check-in. Cheap (bounded
        // scan, small batch) and time-sensitive, so it also runs every
        // invocation rather than being folded into the cursor-paged per-user
        // pass below. ---
        let chatCheckins = { enabled: false, checked: 0, sent: 0 };
        try {
          const { runChatCheckinSweep } = await import("@/lib/chat-checkin.server");
          chatCheckins = await runChatCheckinSweep(supabaseAdmin);
        } catch (checkinError) {
          console.error("chat check-in sweep failed", checkinError);
        }

        // --- 2. Drain the deferred job queue (thread summaries + their
        // session-drift crisis sweep). Give it a slice of the remaining budget. ---
        let jobs = { claimed: 0, completed: 0, failed: 0, timedOut: false };
        try {
          const { drainJobs } = await import("@/jobs");
          jobs = await drainJobs(supabaseAdmin, {
            budgetMs: Math.max(0, Math.floor(timeLeft() * 0.4)),
            max: JOB_BATCH,
          });
        } catch (jobError) {
          console.error("job drain failed", jobError);
        }

        // --- 2b. Deliver proactive email (nudges + weekly digests generated on
        // earlier sweeps). Content-free "there's something for you in Kalm"
        // only; respects profiles.email_opt_out; stamps emailed_at so nothing
        // sends twice. Small budget slice — never starves the coaching pass. ---
        let emails = { nudgeEmails: 0, digestEmails: 0, skippedOptOut: 0, failed: 0 };
        try {
          const { deliverProactiveEmails } = await import("@/lib/proactive-email.server");
          emails = await deliverProactiveEmails(supabaseAdmin, {
            budgetMs: Math.max(0, Math.floor(timeLeft() * 0.15)),
            maxNudges: num("PROACTIVE_EMAIL_NUDGE_BATCH", 20),
            maxDigests: num("PROACTIVE_EMAIL_DIGEST_BATCH", 20),
          });
        } catch (emailError) {
          console.error("proactive email delivery failed", emailError);
        }

        // --- 2c. Post-crisis follow-up: one gentle IN-APP check-in ~24h after a
        // crisis event, once per event, skipped if the person was already
        // active since. Off unless POST_CRISIS_FOLLOWUP_ENABLED is set. ---
        let crisisFollowups = {
          enabled: false,
          sent: 0,
          skippedActive: 0,
          deferredBusy: 0,
          failed: 0,
        };
        try {
          const { deliverPostCrisisFollowups } = await import("@/lib/post-crisis-followup.server");
          crisisFollowups = await deliverPostCrisisFollowups(supabaseAdmin, {
            max: num("POST_CRISIS_FOLLOWUP_BATCH", 20),
          });
        } catch (followupError) {
          console.error("post-crisis follow-up failed", followupError);
        }

        // --- 3. Per-user coaching pass, cursor + budget bounded. ---
        const kv = supabaseAdmin;
        const since = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 86_400_000).toISOString();

        let cursor: string | null = null;
        try {
          const { data } = await kv
            .from("sweep_state")
            .select("cursor_value")
            .eq("name", SWEEP_NAME)
            .maybeSingle();
          cursor = data?.cursor_value ?? null;
        } catch (cursorError) {
          console.warn(
            "sweep_state unavailable (migration not applied?); starting from the top",
            cursorError instanceof Error ? cursorError.message : cursorError,
          );
        }

        let processed = 0;
        let created = 0;
        let digests = 0;
        let recomputed = 0;
        let lastId: string | null = cursor;
        let passComplete = false;
        let timedOut = false;

        while (true) {
          if (timeLeft() <= 0) {
            timedOut = true;
            break;
          }

          let query = supabaseAdmin
            .from("profiles")
            .select("id")
            .eq("onboarding_completed", true)
            .gte("updated_at", since);
          if (lastId) query = query.gt("id", lastId);

          const { data: rows, error } = await query
            .order("id", { ascending: true })
            .limit(USER_BATCH);
          if (error) {
            console.error("nudge sweep query failed", error);
            return new Response(JSON.stringify({ error: error.message }), { status: 500 });
          }
          if (!rows || rows.length === 0) {
            passComplete = true;
            break;
          }

          for (const row of rows) {
            if (timeLeft() <= 0) {
              timedOut = true;
              break;
            }

            try {
              if (await hasNewActivitySince(supabaseAdmin, row.id)) {
                const result = await computeEffectivenessFor(supabaseAdmin, row.id);
                if (result.written) recomputed += 1;
              }
            } catch (e) {
              console.error("effectiveness computation failed for user", row.id, e);
            }

            try {
              const result = await evaluateNudgesFor(supabaseAdmin, row.id);
              created += result.created;
            } catch (e) {
              console.error("nudge sweep failed for user", row.id, e);
            }

            try {
              const digest = await generateWeeklyDigestFor(supabaseAdmin, row.id);
              if (digest.created) digests += 1;
            } catch (e) {
              console.error("weekly digest failed for user", row.id, e);
            }

            lastId = row.id;
            processed += 1;
          }

          if (timedOut) break;
          if (rows.length < USER_BATCH) {
            passComplete = true;
            break;
          }
        }

        // Advance (or reset) the cursor. A completed full pass clears it so the
        // next sweep starts over from the beginning.
        const nextCursor = passComplete ? null : lastId;
        try {
          await kv
            .from("sweep_state")
            .upsert(
              { name: SWEEP_NAME, cursor_value: nextCursor, updated_at: new Date().toISOString() },
              { onConflict: "name" },
            );
        } catch (cursorError) {
          console.warn(
            "could not persist sweep cursor",
            cursorError instanceof Error ? cursorError.message : cursorError,
          );
        }

        return new Response(
          JSON.stringify({
            ok: true,
            done: passComplete,
            timedOut,
            processed,
            resumeFrom: nextCursor,
            created,
            digests,
            recomputed,
            escalated,
            chatCheckins,
            jobs,
            emails,
            crisisFollowups,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
