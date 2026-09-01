// Bearer-token authentication for the versioned mobile HTTP API
// (src/routes/api/v1/*). Additive — it does NOT change how the web app
// authenticates.
//
// The web app's createServerFn RPCs authenticate through `requireSupabaseAuth`
// (src/integrations/supabase/auth-middleware.ts). That module is generated
// ("do not edit it directly") and is a TanStack function middleware coupled to
// `getRequest()` ambient context, so it can't be imported and called as a plain
// function or unit-tested in isolation.
//
// `authenticateBearer` is the transport-agnostic equivalent for the mobile
// client, which has no cookie and simply sends `Authorization: Bearer <jwt>`:
//   - reads the Authorization header off a plain `Request`
//   - verifies the JWT with `supabase.auth.getUser(token)` — a real round trip
//     to Supabase Auth, so revoked/expired tokens are rejected, not only
//     badly-signed ones (the web path uses the cheaper local `getClaims`)
//   - resolves the same `{ supabase, userId }` shape the RPC middleware produces
//
// It NEVER resolves an unauthenticated request as a session: every failure path
// returns `{ ok: false }`, and `userId` is only ever set on the success branch.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type ApiAuthSuccess = {
  ok: true;
  supabase: SupabaseClient<Database>;
  userId: string;
};

export type ApiAuthFailure = {
  ok: false;
  status: 401;
  error: string;
};

export type ApiAuthResult = ApiAuthSuccess | ApiAuthFailure;

const fail = (error: string): ApiAuthFailure => ({ ok: false, status: 401, error });

/** A JWT is three non-empty dot-separated segments. Cheap reject before any I/O. */
function looksLikeJwt(token: string): boolean {
  const parts = token.split(".");
  return parts.length === 3 && parts.every((part) => part.length > 0);
}

function isOpaqueApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

/**
 * Mirrors the generated middleware's fetch shim: forces the `apikey` header and
 * strips an Authorization header that is just the (opaque) publishable key, so
 * the user's bearer JWT is the only thing in that slot.
 */
function createSupabaseFetch(apiKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
    if (isOpaqueApiKey(apiKey) && headers.get("Authorization") === `Bearer ${apiKey}`) {
      headers.delete("Authorization");
    }
    headers.set("apikey", apiKey);
    return fetch(input, { ...init, headers });
  };
}

export async function authenticateBearer(request: Request): Promise<ApiAuthResult> {
  const header =
    request.headers.get("authorization") ?? request.headers.get("Authorization") ?? null;
  if (!header) return fail("Missing Authorization header");

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return fail("Authorization header must be 'Bearer <token>'");

  const token = (match[1] ?? "").trim();
  if (!token) return fail("Empty bearer token");
  if (!looksLikeJwt(token)) return fail("Malformed bearer token");

  const url = process.env["SUPABASE_URL"];
  const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !publishableKey) {
    // A server misconfiguration, not the caller's fault — but we still must not
    // resolve a session. Report as 401 so no endpoint proceeds unauthenticated.
    console.error("[api-auth] SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY not set");
    return fail("Authentication is unavailable");
  }

  const supabase = createClient<Database>(url, publishableKey, {
    global: {
      fetch: createSupabaseFetch(publishableKey),
      headers: { Authorization: `Bearer ${token}` },
    },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user?.id) return fail("Invalid or expired token");
    return { ok: true, supabase, userId: data.user.id };
  } catch (err) {
    console.error("[api-auth] getUser threw:", err instanceof Error ? err.message : err);
    return fail("Invalid or expired token");
  }
}
