import { createFileRoute } from "@tanstack/react-router";

/**
 * Proactive-coaching sweep. Callable by pg_cron / an external scheduler with
 * the dedicated NUDGE_SWEEP_SECRET in an `x-sweep-secret` header.
 *
 * NOTE: this previously checked SUPABASE_PUBLISHABLE_KEY, which is NOT a secret
 * — the publishable/anon key ships in the client bundle, so anyone could have
 * triggered the sweep. It is now a dedicated server-only secret.
 */
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


        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { evaluateNudgesFor } = await import("@/lib/nudges.server");
        const { generateWeeklyDigestFor } = await import("@/lib/weekly-digest.server");

        const since = new Date(Date.now() - 30 * 86400000).toISOString();
        const { data, error } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("onboarding_completed", true)
          .gte("updated_at", since)
          .limit(500);
        if (error) {
          console.error("nudge sweep query failed", error);
          return new Response(JSON.stringify({ error: error.message }), { status: 500 });
        }

        let created = 0;
        let digests = 0;
        for (const row of data ?? []) {
          try {
            const result = await evaluateNudgesFor(supabaseAdmin, row.id);
            created += result.created;
          } catch (sweepError) {
            console.error("nudge sweep failed for user", row.id, sweepError);
          }
          // Weekly Progress digest piggybacks on the same cadence; it no-ops
          // unless 7+ days have passed and the week had some activity.
          try {
            const digest = await generateWeeklyDigestFor(supabaseAdmin, row.id);
            if (digest.created) digests += 1;
          } catch (digestError) {
            console.error("weekly digest failed for user", row.id, digestError);
          }
        }

        return new Response(JSON.stringify({ ok: true, users: data?.length ?? 0, created, digests }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
