// Real crisis alerting. Every crisis_events row — regardless of source (regex
// gate, PHQ-9 item 9, semantic backstop, session drift sweep) — is written
// through logCrisisEvent() so an admin email always goes out immediately
// instead of relying on someone remembering to open /admin/crisis.
//
// Email failures NEVER block the user-facing crisis response: the in-app
// resources and the admin queue row are the guaranteed paths; email is an
// additional delivery channel.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { CrisisSeverity } from "./crisis";

type Client = SupabaseClient<Database>;

const RESEND_URL = "https://api.resend.com/emails";
const FROM = "Kalm Safety <onboarding@resend.dev>";

function appBaseUrl(): string {
  return (
    process.env["APP_BASE_URL"] ??
    process.env["VITE_APP_BASE_URL"] ??
    "https://inner-reach-buddy.lovable.app"
  );
}

const SOURCE_LABELS: Record<string, string> = {
  chat: "Chat (regex gate)",
  phq9_item9: "PHQ-9 item 9",
  semantic_classifier: "Semantic backstop",
  session_drift_sweep: "Session drift sweep",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

async function sendEmail(subject: string, text: string): Promise<boolean> {
  const apiKey = process.env["RESEND_API_KEY"];
  const to = process.env["ADMIN_ALERT_EMAIL"];
  if (!apiKey || !to) {
    console.error("crisis alert email skipped: RESEND_API_KEY or ADMIN_ALERT_EMAIL missing");
    return false;
  }

  try {
    const response = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ from: FROM, to: [to], subject, text }),
    });
    if (!response.ok) {
      const body = await response.text();
      console.error(`crisis alert email failed [${response.status}]: ${body}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error("crisis alert email threw", error);
    return false;
  }
}

/** Minimal "go look now" alert — no conversation content, ever. */
export async function sendCrisisAlertEmail(input: {
  eventId: string;
  severity: string;
  source: string;
  createdAt: string;
  escalation?: number;
}): Promise<boolean> {
  const link = `${appBaseUrl()}/admin/crisis`;
  const escalating = (input.escalation ?? 0) > 0;
  const subject = escalating
    ? `URGENT (reminder #${input.escalation}) — unreviewed ${input.severity} crisis event`
    : `Kalm crisis alert — ${input.severity} (${sourceLabel(input.source)})`;

  const text = [
    escalating
      ? "A crisis event is STILL UNREVIEWED more than 30 minutes after it was flagged."
      : "A crisis event was flagged and needs human review now.",
    "",
    `Severity: ${input.severity}`,
    `Source: ${sourceLabel(input.source)}`,
    `Flagged at: ${new Date(input.createdAt).toISOString()}`,
    `Event ID: ${input.eventId}`,
    "",
    `Review it here: ${link}`,
    "",
    "This alert intentionally contains no conversation content — review in the app.",
  ].join("\n");

  return sendEmail(subject, text);
}

/**
 * Single write path for crisis events. Inserts the row, then fires the admin
 * alert email. Returns the row id (or null when the insert failed).
 */
export async function logCrisisEvent(
  supabase: Client,
  input: {
    userId: string;
    source: string;
    severity: CrisisSeverity;
    matchedTerms?: string[];
    messageId?: string | null;
    notes?: string | null;
  },
): Promise<string | null> {
  const { data, error } = await supabase
    .from("crisis_events")
    .insert({
      user_id: input.userId,
      source: input.source,
      severity: input.severity,
      matched_terms: input.matchedTerms ?? [],
      message_id: input.messageId ?? null,
      notes: input.notes ?? null,
    })
    .select("id, created_at")
    .single();

  if (error || !data) {
    console.error("crisis_events insert failed", error);
    return null;
  }

  const sent = await sendCrisisAlertEmail({
    eventId: data.id,
    severity: input.severity,
    source: input.source,
    createdAt: data.created_at,
  });
  if (sent) {
    const update = await supabase
      .from("crisis_events")
      .update({ alert_sent_at: new Date().toISOString() })
      .eq("id", data.id);
    if (update.error) console.error("crisis alert stamp failed", update.error);
  }

  return data.id;
}

const ESCALATE_AFTER_MS = 30 * 60 * 1000;

/**
 * Escalation sweep: any crisis event still unreviewed 30+ minutes after it was
 * flagged gets a more urgent email, repeated on every sweep until reviewed.
 */
export async function escalateUnreviewedCrisisEvents(
  supabase: Client,
): Promise<{ escalated: number }> {
  const cutoff = new Date(Date.now() - ESCALATE_AFTER_MS).toISOString();

  const { data, error } = await supabase
    .from("crisis_events")
    .select("id, created_at, severity, source, escalation_count, escalation_sent_at")
    .eq("reviewed", false)
    .lte("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) {
    console.error("crisis escalation query failed", error);
    return { escalated: 0 };
  }

  let escalated = 0;
  for (const row of data ?? []) {
    // Repeat, but no more than once per escalation window per event.
    const last = row.escalation_sent_at ? new Date(row.escalation_sent_at).getTime() : 0;
    if (last && Date.now() - last < ESCALATE_AFTER_MS) continue;

    const nextCount = (row.escalation_count ?? 0) + 1;
    const sent = await sendCrisisAlertEmail({
      eventId: row.id,
      severity: row.severity,
      source: row.source,
      createdAt: row.created_at,
      escalation: nextCount,
    });
    if (!sent) continue;

    const update = await supabase
      .from("crisis_events")
      .update({ escalation_sent_at: new Date().toISOString(), escalation_count: nextCount })
      .eq("id", row.id);
    if (update.error) {
      console.error("crisis escalation stamp failed", update.error);
      continue;
    }
    escalated += 1;
  }

  return { escalated };
}
