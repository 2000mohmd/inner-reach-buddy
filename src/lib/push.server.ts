// Push notification sending — Firebase Cloud Messaging (FCM) HTTP v1 API.
//
// FCM is the right single integration for a Flutter app: `firebase_messaging`
// gives one token format that covers both iOS (via APNs under the hood) and
// Android, so the mobile side only needs one SDK, and this file only needs to
// talk to one API.
//
// THE SPLIT WITH THE MOBILE (FLUTTER) APP:
//   - Mobile app: asks the OS for notification permission, retrieves the FCM
//     token (`FirebaseMessaging.instance.getToken()`), and calls
//     POST /api/v1/push/register-token with it. That's the entire mobile-side
//     job — everything else is this file plus the device_push_tokens table.
//   - Backend (here): stores the token, and calls FCM's HTTP v1 endpoint to
//     actually deliver a notification, e.g. from the 12h chat check-in sweep.
//
// Needs FCM_SERVICE_ACCOUNT_JSON (the full JSON key for a service account with
// the "Firebase Cloud Messaging API" role, from the Firebase console -> Project
// Settings -> Service Accounts -> Generate new private key) as an env var
// holding that JSON verbatim. Until it's set, sendPushToUser logs and no-ops
// rather than throwing — the chat check-in and every other caller must keep
// working even before push is configured.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Client = SupabaseClient<Database>;

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

function loadServiceAccount(): ServiceAccount | null {
  const raw = process.env["FCM_SERVICE_ACCOUNT_JSON"];
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ServiceAccount;
  } catch {
    console.error("FCM_SERVICE_ACCOUNT_JSON is set but is not valid JSON");
    return null;
  }
}

function base64Url(input: ArrayBuffer | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Signs a Google service-account JWT and exchanges it for an OAuth2 access token. */
async function getAccessToken(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && cachedAccessToken.expiresAt > now + 60) {
    return cachedAccessToken.token;
  }

  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(
    JSON.stringify({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${claims}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const jwt = `${unsigned}.${base64Url(signature)}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!response.ok) {
    throw new Error(`FCM token exchange failed: ${response.status} ${await response.text()}`);
  }
  const payload = (await response.json()) as { access_token: string; expires_in: number };
  cachedAccessToken = { token: payload.access_token, expiresAt: now + payload.expires_in };
  return payload.access_token;
}

async function sendToToken(
  account: ServiceAccount,
  token: string,
  notification: { title: string; body: string },
): Promise<{ ok: boolean; shouldRemoveToken: boolean }> {
  const accessToken = await getAccessToken(account);
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { token, notification } }),
    },
  );
  if (response.ok) return { ok: true, shouldRemoveToken: false };

  const body = await response.text();
  // UNREGISTERED / invalid-argument on a bad token means the app was
  // uninstalled or the token rotated — clean it up so we stop trying.
  const shouldRemoveToken = response.status === 404 || /UNREGISTERED|invalid.*token/i.test(body);
  console.error("FCM send failed", response.status, body);
  return { ok: false, shouldRemoveToken };
}

/**
 * Sends a push notification to every device a user has registered. Never
 * throws — a push failure (or push not being configured yet) must never break
 * the caller (e.g. the chat check-in that also wrote an in-app message).
 */
// device_push_tokens is added by this migration and isn't in the generated
// Database types yet (same situation date_of_birth was in — see
// onboarding.functions.ts) — a loosely-typed view of the client keeps this
// typechecking until Lovable regenerates types against the live schema.
type DevicePushTokensTable = {
  from: (table: "device_push_tokens") => {
    select: (cols: string) => {
      eq: (
        col: string,
        value: string,
      ) => Promise<{
        data: { id: string; token: string }[] | null;
        error: unknown;
      }>;
    };
    delete: () => { in: (col: string, values: string[]) => Promise<{ error: unknown }> };
  };
};

export async function sendPushToUser(
  supabase: Client,
  userId: string,
  notification: { title: string; body: string },
): Promise<{ sent: number }> {
  const account = loadServiceAccount();
  if (!account) return { sent: 0 }; // not configured yet — silent no-op by design

  const table = (supabase as unknown as DevicePushTokensTable).from("device_push_tokens");
  const { data: tokens, error } = await table.select("id, token").eq("user_id", userId);
  if (error) {
    console.error("could not load push tokens", error);
    return { sent: 0 };
  }
  if (!tokens?.length) return { sent: 0 };

  let sent = 0;
  const staleIds: string[] = [];
  for (const row of tokens) {
    try {
      const result = await sendToToken(account, row.token, notification);
      if (result.ok) sent += 1;
      else if (result.shouldRemoveToken) staleIds.push(row.id);
    } catch (err) {
      console.error("push send threw", err);
    }
  }

  if (staleIds.length) {
    await table.delete().in("id", staleIds);
  }

  return { sent };
}
