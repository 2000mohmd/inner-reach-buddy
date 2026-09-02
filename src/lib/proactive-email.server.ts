// Delivery worker for the proactive engine. Runs inside the pg_cron sweep
// (src/routes/api/public/hooks/evaluate-nudges.ts). For each nudge / weekly
// digest that hasn't been emailed yet, it sends ONE content-free "there's
// something for you in Kalm" email and stamps `emailed_at` so it never repeats.
//
// PRIVACY: the email body and subject NEVER contain the nudge text, the digest
// narrative, mood scores, or screener results — those land in shared inboxes.
// The email only points the person back into the app.
//
// Respects `profiles.email_opt_out`: an opted-out user's items are stamped
// (skipped) so the queue drains, but no email is sent.

import { appBaseUrl, sendProactiveEmail } from "./email.server";

// `emailed_at` / `email_opt_out` aren't in the generated Database types until
// Lovable regenerates them; this module only chains .from().select/.update, so a
// loose client mirrors the pattern already used in rate-limit/postgres.ts.
type AdminClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose query builder
  from: (table: string) => any;
  auth: {
    admin: {
      getUserById: (id: string) => Promise<{ data: { user: { email?: string | null } | null } }>;
    };
  };
};

export type ProactiveEmailResult = {
  nudgeEmails: number;
  digestEmails: number;
  skippedOptOut: number;
  failed: number;
};

// Only email items generated recently — an older one is stale and the person
// will see it in-app next time they open Kalm anyway.
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

type ResolvedUser = { email: string; optedOut: boolean; preferredName: string | null } | null;

function greeting(name: string | null): string {
  return name ? `Hi ${name},` : "Hi,";
}

export async function deliverProactiveEmails(
  admin: AdminClient,
  opts: { budgetMs?: number; maxNudges?: number; maxDigests?: number } = {},
): Promise<ProactiveEmailResult> {
  const deadline = Date.now() + (opts.budgetMs ?? 15_000);
  const cutoff = new Date(Date.now() - MAX_AGE_MS).toISOString();
  const result: ProactiveEmailResult = {
    nudgeEmails: 0,
    digestEmails: 0,
    skippedOptOut: 0,
    failed: 0,
  };

  const cache = new Map<string, ResolvedUser>();
  const resolveUser = async (userId: string): Promise<ResolvedUser> => {
    const hit = cache.get(userId);
    if (hit !== undefined) return hit;
    const [account, profile] = await Promise.all([
      admin.auth.admin.getUserById(userId),
      admin.from("profiles").select("email_opt_out, preferred_name").eq("id", userId).maybeSingle(),
    ]);
    const email = account.data.user?.email ?? null;
    const row = (profile.data ?? {}) as { email_opt_out?: boolean; preferred_name?: string | null };
    const resolved: ResolvedUser = email
      ? { email, optedOut: row.email_opt_out === true, preferredName: row.preferred_name ?? null }
      : null;
    cache.set(userId, resolved);
    return resolved;
  };

  const stamp = (table: string, id: string) =>
    admin.from(table).update({ emailed_at: new Date().toISOString() }).eq("id", id);

  // --- Nudges ---------------------------------------------------------------
  const nudges = await admin
    .from("nudges")
    .select("id, user_id, created_at")
    .is("emailed_at", null)
    .is("dismissed_at", null)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(opts.maxNudges ?? 20);

  for (const row of nudges.data ?? []) {
    if (Date.now() > deadline) break;
    const user = await resolveUser(row.user_id);
    if (!user) {
      await stamp("nudges", row.id); // no address — don't retry forever
      continue;
    }
    if (user.optedOut) {
      await stamp("nudges", row.id);
      result.skippedOptOut += 1;
      continue;
    }
    const ok = await sendProactiveEmail({
      to: user.email,
      userId: row.user_id,
      subject: "A note from Kalm",
      bodyText: [
        greeting(user.preferredName),
        "",
        "Kalm has a short note for you — a gentle check-in based on how things have been going lately.",
        "It's waiting in the app. Nothing here needs a reply.",
        "",
        `Open Kalm: ${appBaseUrl()}/insights`,
      ].join("\n"),
    });
    if (ok) {
      await stamp("nudges", row.id);
      result.nudgeEmails += 1;
    } else {
      result.failed += 1;
    }
  }

  // --- Weekly digests -----------------------------------------------------
  const digests = await admin
    .from("weekly_digests")
    .select("id, user_id, created_at")
    .is("emailed_at", null)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(opts.maxDigests ?? 20);

  for (const row of digests.data ?? []) {
    if (Date.now() > deadline) break;
    const user = await resolveUser(row.user_id);
    if (!user) {
      await stamp("weekly_digests", row.id);
      continue;
    }
    if (user.optedOut) {
      await stamp("weekly_digests", row.id);
      result.skippedOptOut += 1;
      continue;
    }
    const ok = await sendProactiveEmail({
      to: user.email,
      userId: row.user_id,
      subject: "Your week in Kalm is ready",
      bodyText: [
        greeting(user.preferredName),
        "",
        "Your weekly reflection is ready — a short, private look back at how the week went, written for you.",
        "",
        `Read it in Kalm: ${appBaseUrl()}/insights`,
      ].join("\n"),
    });
    if (ok) {
      await stamp("weekly_digests", row.id);
      result.digestEmails += 1;
    } else {
      result.failed += 1;
    }
  }

  return result;
}
