// Shared sender for PROACTIVE (non-transactional) member email — the nudge and
// weekly-digest check-ins. Crisis alerts (crisis-alert.server.ts) and support
// replies (support.server.ts) keep their own senders: those audiences are
// admin/support and must not be gated by an opt-out or carry an unsubscribe
// link.
//
// Every proactive email carries BOTH a visible unsubscribe line and the
// List-Unsubscribe / List-Unsubscribe-Post headers (RFC 8058 one-click). The
// token is an HMAC of the user id, verified by /api/public/unsubscribe, so the
// link needs no login and can't be forged for another user.

const RESEND_URL = "https://api.resend.com/emails";

export function appBaseUrl(): string {
  return (
    process.env["APP_BASE_URL"] ??
    process.env["VITE_APP_BASE_URL"] ??
    "https://inner-reach-buddy.lovable.app"
  );
}

function unsubscribeSecret(): string {
  // A dedicated secret if provided, else derive from the service-role key (which
  // is always present server-side) so this works with no extra configuration.
  return (
    process.env["EMAIL_UNSUBSCRIBE_SECRET"] ??
    process.env["SUPABASE_SERVICE_ROLE_KEY"] ??
    "kalm-dev-unsubscribe-secret"
  );
}

async function hmacHex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function unsubscribeToken(userId: string): Promise<string> {
  return hmacHex(unsubscribeSecret(), `unsub:${userId}`);
}

export async function verifyUnsubscribeToken(userId: string, token: string): Promise<boolean> {
  if (!userId || !token) return false;
  const expected = await unsubscribeToken(userId);
  if (token.length !== expected.length) return false;
  // constant-time compare
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function unsubscribeUrl(userId: string): Promise<string> {
  const token = await unsubscribeToken(userId);
  return `${appBaseUrl()}/api/public/unsubscribe?u=${encodeURIComponent(userId)}&t=${token}`;
}

type SendArgs = {
  to: string;
  userId: string;
  subject: string;
  /** Plain-text body WITHOUT the unsubscribe line — this function appends it. */
  bodyText: string;
};

/**
 * Send one proactive email. Never throws; returns false on any failure. The
 * caller MUST have already checked `profiles.email_opt_out` — this function does
 * not re-check it, it only guarantees the unsubscribe affordances are present.
 */
export async function sendProactiveEmail(args: SendArgs): Promise<boolean> {
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) {
    console.error("[email] proactive send skipped: RESEND_API_KEY missing");
    return false;
  }
  const from = process.env["EMAIL_FROM"] ?? "Kalm <onboarding@resend.dev>";
  const unsub = await unsubscribeUrl(args.userId);
  const text =
    `${args.bodyText}\n\n` +
    `—\nYou're getting this because you have a Kalm account. ` +
    `To stop these check-in emails, unsubscribe here: ${unsub}`;

  try {
    const response = await fetch(RESEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from,
        to: [args.to],
        subject: args.subject,
        text,
        headers: {
          "List-Unsubscribe": `<${unsub}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
    });
    if (!response.ok) {
      console.error(`[email] proactive send failed [${response.status}]: ${await response.text()}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[email] proactive send threw", error);
    return false;
  }
}
