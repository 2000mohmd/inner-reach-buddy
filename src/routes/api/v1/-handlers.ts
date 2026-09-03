// Implementation for the versioned mobile API routes. Kept in a `-` file so the
// TanStack route generator ignores it, which also lets each handler be a plain
// `(request: Request) => Promise<Response>` function that can be unit-tested
// without a running server. The route files under this folder are thin bindings.

import { z } from "zod";
import {
  getThreadMessagesPageCore,
  listThreadsCore,
  sendMessageCore,
  sendMessageStreamCore,
} from "@/lib/chat.functions";
import { CRISIS_DISCLAIMER, crisisCopy } from "@/lib/crisis";
import { getEntitlementsFor } from "@/lib/entitlements.server";
import { completeOnboardingCore } from "@/lib/onboarding.functions";
import { SCREENERS, type ScreenerType } from "@/lib/screeners";
import { submitScreenerCore } from "@/lib/screeners.server";
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
 * POST /api/v1/chat/messages/stream
 *
 * Same request shape and same pipeline as handleChatMessages (they share
 * prepareChatTurn inside chat.functions.ts, so the crisis gate / rate limiter
 * ordering guarantee holds here too) — the difference is the response: an
 * `text/event-stream` of `delta` events carrying the companion's reply text as
 * the model generates it, followed by exactly one `done` event carrying the
 * same JSON shape handleChatMessages returns in one shot (so a client can use
 * either endpoint against the same response type), or one `error` event if
 * generation fails after the stream has already started (too late to send a
 * normal HTTP error status at that point).
 *
 * A crisis or rate-limit reply is never split into deltas — sendMessageStreamCore
 * only calls onDelta for a normal generated reply — so those still arrive
 * whole and immediately, as a single `done` event with nothing preceding it.
 */
export function handleChatMessagesStream(request: Request): Promise<Response> {
  return (async () => {
    let auth;
    try {
      auth = await requireAuth(request);
    } catch (err) {
      if (err instanceof ApiError) return json({ error: err.message }, err.status);
      return json({ error: "Unauthorized" }, 401);
    }
    const { supabase, userId } = auth;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };
        try {
          const result = await sendMessageStreamCore(supabase, userId, body, (text) => {
            send("delta", { text });
          });
          send("done", result);
        } catch (err) {
          console.error("chat stream failed", err);
          const message =
            err instanceof Error ? err.message : "The companion couldn't reply just now.";
          send("error", { error: message });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // Disables response buffering on proxies (e.g. nginx) that would
        // otherwise wait for the stream to end before forwarding any of it.
        "X-Accel-Buffering": "no",
      },
    });
  })();
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

/**
 * GET /api/v1/entitlements — the caller's current tier, chat-credit state
 * (used/remaining today, reset time) and feature flags. Wraps getEntitlementsFor.
 */
export function handleEntitlements(request: Request): Promise<Response> {
  return handle(async () => {
    const { supabase, userId } = await requireAuth(request);
    return json(await getEntitlementsFor(supabase, userId));
  });
}

/** GET /api/v1/chat/threads — the caller's threads, newest activity first. */
export function handleChatThreads(request: Request): Promise<Response> {
  return handle(async () => {
    const { supabase, userId } = await requireAuth(request);
    return json(await listThreadsCore(supabase, userId));
  });
}

/**
 * GET /api/v1/chat/threads/:id/messages?limit=&before=
 *
 * Keyset-paginated, newest-first page (returned ascending for display).
 * `before` is an ISO cursor from the previous page's `nextBefore`. 404 if the
 * thread isn't owned by the caller.
 */
export function handleChatThreadMessages(request: Request, threadId: string): Promise<Response> {
  return handle(async () => {
    const { supabase, userId } = await requireAuth(request);
    const parsed = z.string().uuid().safeParse(threadId);
    if (!parsed.success) throw new ApiError(400, "Invalid thread id");

    const url = new URL(request.url);
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw === null ? undefined : Number(limitRaw);
    if (limit !== undefined && !Number.isFinite(limit)) {
      throw new ApiError(400, "limit must be a number");
    }
    const before = url.searchParams.get("before");

    return json(
      await getThreadMessagesPageCore(supabase, userId, {
        thread_id: parsed.data,
        ...(limit !== undefined ? { limit } : {}),
        before,
      }),
    );
  });
}

/**
 * POST /api/v1/onboarding
 *
 * Wraps completeOnboardingCore as-is. The client sends a real `date_of_birth`
 * (YYYY-MM-DD) and NO `age_confirmed_13_plus` — the server computes age, rejects
 * under-13, and forces `account_type: "teen"` for anyone under 18. Returns
 * `{ ok: true }`.
 */
export function handleOnboarding(request: Request): Promise<Response> {
  return handle(async () => {
    const { supabase, userId } = await requireAuth(request);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "Invalid JSON body");
    }
    try {
      return json(await completeOnboardingCore(supabase, userId, body));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Age business-rule rejections are the caller's input problem, not a 500.
      if (/aged \d+ and over|invalid date of birth/i.test(message)) {
        throw new ApiError(400, message);
      }
      throw err;
    }
  });
}

/**
 * POST /api/v1/screeners/:type/responses  (:type = phq9 | gad7)
 *
 * Wraps submitScreenerCore as-is, INCLUDING the PHQ-9 item-9 escalation: an
 * item-9 answer >= 1 sets `crisisTriggered: true` and returns the structured
 * `crisis` object regardless of total score. Body: { responses: number[] }.
 */
export function handleScreenerResponses(request: Request, type: string): Promise<Response> {
  return handle(async () => {
    const { supabase, userId } = await requireAuth(request);

    if (type !== "phq9" && type !== "gad7") {
      throw new ApiError(400, "Unknown screener type");
    }
    const screenerType = type as ScreenerType;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "Invalid JSON body");
    }
    const parsed = z
      .object({ responses: z.array(z.number().int().min(0).max(3)).min(7).max(9) })
      .safeParse(body);
    if (!parsed.success) {
      throw new ApiError(400, "Validation failed", parsed.error.flatten());
    }
    if (parsed.data.responses.length !== SCREENERS[screenerType].items.length) {
      throw new ApiError(
        400,
        `${screenerType} expects ${SCREENERS[screenerType].items.length} responses`,
      );
    }

    return json(
      await submitScreenerCore(supabase, userId, {
        screener_type: screenerType,
        responses: parsed.data.responses,
      }),
    );
  });
}
