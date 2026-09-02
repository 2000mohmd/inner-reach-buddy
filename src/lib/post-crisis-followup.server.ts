// Post-crisis follow-up. A crisis flag surfaces resources + an admin alert and
// then nothing follows up. This posts ONE gentle, IN-APP check-in ~24h later.
//
// Runs in the pg_cron sweep (evaluate-nudges.ts). Rules, per the audit:
//   - IN-APP only. Never email / push — a message referencing a crisis in a
//     shared inbox is a real privacy risk.
//   - Fire once per crisis_events row (follow_up_sent_at stamp).
//   - Skip (permanently) if the person has been active since the event — the
//     follow-up would be pointless. Recorded as follow_up_skipped_at.
//   - Defer (retry next sweep) if they're mid-conversation right now.
//   - The message is a `sender: "system"` chat row, which the chat UI renders
//     with the localized crisis-resources card directly beneath it, so help is
//     one tap away.
//   - Off by default (POST_CRISIS_FOLLOWUP_ENABLED) so the copy can't ship
//     before sign-off; also a runtime kill-switch for the most delicate message
//     in the product.

// `follow_up_sent_at` / `follow_up_skipped_at` aren't in the generated Database
// types until Lovable regenerates; this module only chains the query builder, so
// a loose client mirrors rate-limit/postgres.ts.
type AdminClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose query builder
  from: (table: string) => any;
};

export type PostCrisisFollowupResult = {
  enabled: boolean;
  sent: number;
  skippedActive: number;
  deferredBusy: number;
  failed: number;
};

// Only follow up on events in this age window. The lower bound is the "~24h
// later" ask; the upper bound stops us reaching back to ancient events if the
// sweep was paused.
const MIN_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_AGE_MS = 72 * 60 * 60 * 1000;
// "In an active conversation at that moment".
const ACTIVE_NOW_MS = 10 * 60 * 1000;

export function followUpMessage(preferredName: string | null): string {
  const opener = preferredName
    ? `Hi ${preferredName} — I wanted to check in.`
    : "I wanted to check in.";
  return [
    opener,
    "Things felt really heavy when we were last in touch, and I've been keeping you in mind since.",
    "There's nothing you need to reply to here. I just want you to know I'm glad you're here, the conversation is open whenever you want it, and the support options below are available any time — day or night.",
  ].join(" ");
}

function isEnabled(): boolean {
  const raw = (process.env["POST_CRISIS_FOLLOWUP_ENABLED"] ?? "").toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export async function deliverPostCrisisFollowups(
  admin: AdminClient,
  opts: { max?: number } = {},
): Promise<PostCrisisFollowupResult> {
  const result: PostCrisisFollowupResult = {
    enabled: isEnabled(),
    sent: 0,
    skippedActive: 0,
    deferredBusy: 0,
    failed: 0,
  };
  if (!result.enabled) return result;

  const now = Date.now();
  const oldest = new Date(now - MAX_AGE_MS).toISOString();
  const newest = new Date(now - MIN_AGE_MS).toISOString();

  const events = await admin
    .from("crisis_events")
    .select("id, user_id, created_at")
    .is("follow_up_sent_at", null)
    .is("follow_up_skipped_at", null)
    .gte("created_at", oldest)
    .lte("created_at", newest)
    .order("created_at", { ascending: true })
    .limit(opts.max ?? 20);

  for (const event of (events.data ?? []) as {
    id: string;
    user_id: string;
    created_at: string;
  }[]) {
    try {
      // 1. Active since the event? The follow-up is unnecessary — close it out.
      const sinceEvent = await admin
        .from("chat_messages")
        .select("id")
        .eq("user_id", event.user_id)
        .eq("sender", "user")
        .gt("created_at", event.created_at)
        .limit(1);
      if ((sinceEvent.data ?? []).length > 0) {
        await admin
          .from("crisis_events")
          .update({ follow_up_skipped_at: new Date().toISOString() })
          .eq("id", event.id);
        result.skippedActive += 1;
        continue;
      }

      // 2. Mid-conversation right now? Don't interrupt — try again next sweep.
      const activeNow = await admin
        .from("chat_messages")
        .select("id")
        .eq("user_id", event.user_id)
        .gte("created_at", new Date(now - ACTIVE_NOW_MS).toISOString())
        .limit(1);
      if ((activeNow.data ?? []).length > 0) {
        result.deferredBusy += 1;
        continue;
      }

      // 3. Resolve a thread to land in (most recent, else create one).
      const [thread, profile] = await Promise.all([
        admin
          .from("chat_threads")
          .select("id")
          .eq("user_id", event.user_id)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        admin.from("profiles").select("preferred_name").eq("id", event.user_id).maybeSingle(),
      ]);

      let threadId: string | null = thread.data?.id ?? null;
      if (!threadId) {
        const created = await admin
          .from("chat_threads")
          .insert({ user_id: event.user_id, title: "Checking in" })
          .select("id")
          .single();
        if (created.error) {
          result.failed += 1;
          continue;
        }
        threadId = created.data.id;
      }

      const inserted = await admin.from("chat_messages").insert({
        thread_id: threadId,
        user_id: event.user_id,
        sender: "system",
        content_type: "text",
        content: followUpMessage(profile.data?.preferred_name ?? null),
        flagged_crisis: true,
      });
      if (inserted.error) {
        result.failed += 1;
        continue;
      }

      await admin
        .from("chat_threads")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", threadId);

      await admin
        .from("crisis_events")
        .update({ follow_up_sent_at: new Date().toISOString() })
        .eq("id", event.id);
      result.sent += 1;
    } catch (err) {
      console.error("post-crisis follow-up failed for event", event.id, err);
      result.failed += 1;
    }
  }

  return result;
}
