// Implementation for the versioned mobile API routes. Kept in a `-` file so the
// TanStack route generator ignores it, which also lets each handler be a plain
// `(request: Request) => Promise<Response>` function that can be unit-tested
// without a running server. The route files under this folder are thin bindings.

import { sendMessageCore } from "@/lib/chat.functions";
import { CRISIS_DISCLAIMER, crisisCopy } from "@/lib/crisis";
import { normalizeLanguage } from "@/lib/i18n/languages";
import { authenticateBearer } from "@/lib/api-auth.server";
import { ApiError, handle, json, requireAuth } from "./-shared";

/**
 * POST /api/v1/chat/messages
 *
 * Thin wrapper over `sendMessage` (chat.functions.ts). The crisis gate runs
 * first inside `sendMessage`, before the per-user rate limiter — this handler
 * adds NOTHING before that call (no rate/entitlement pre-check), so the ordering
 * guarantee tested in crisis-gate.test.ts holds through this entry point too.
 *
 * Request:  { thread_id?: uuid, content: string, quick_action?: string }
 * Response: { thread_id, userMessage, reply }
 *   - normal reply:  reply = { type: "message", id, content, created_at, actions }
 *   - crisis reply:  reply = { type: "crisis", severity, message, matched,
 *                              resources, disclaimer, id, created_at }
 *     i.e. the full structured crisis object — never raw text to parse.
 */
export function handleChatMessages(request: Request): Promise<Response> {
  return handle(async () => {
    const { supabase, userId } = await requireAuth(request);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "Invalid JSON body");
    }
    // sendMessageCore validates the shape (thread_id/content/quick_action) and
    // runs the crisis gate before the rate limiter. We add nothing before it.
    const result = await sendMessageCore(supabase, userId, body);
    return json(result);
  });
}

/**
 * GET /api/v1/crisis-resources?lang=xx
 *
 * The localized list `crisisCopy()` already produces. NEVER gated: no auth is
 * required and every failure degrades to English rather than erroring — this
 * endpoint must never itself be the reason someone can't reach help.
 *
 * Language resolution order: explicit `?lang=` → the authenticated user's
 * `profiles.language` (if a valid token is present) → English.
 */
export function handleCrisisResources(request: Request): Promise<Response> {
  return handle(async () => {
    let language = "en";

    try {
      const requested = new URL(request.url).searchParams.get("lang");
      if (requested) {
        language = normalizeLanguage(requested);
      } else if (request.headers.get("authorization")) {
        const auth = await authenticateBearer(request);
        if (auth.ok) {
          const { data } = await auth.supabase
            .from("profiles")
            .select("language")
            .eq("id", auth.userId)
            .maybeSingle();
          if (data?.language) language = normalizeLanguage(data.language);
        }
      }
    } catch {
      // Any problem determining the language falls through to English.
      language = "en";
    }

    const copy = crisisCopy(language);
    return json({
      language,
      resources: copy.resources,
      disclaimer: copy.disclaimer ?? CRISIS_DISCLAIMER,
    });
  });
}
