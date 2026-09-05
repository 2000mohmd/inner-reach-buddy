// Handlers for the live voice-call session API (src/routes/api/v1/calls/*).
// Kept in a `-` file so the route generator ignores it and each handler stays a
// plain testable (request) => Response function. Business logic lives in
// src/lib/call-session.server.ts.
import { z } from "zod";
import {
  appendCallTurnCore,
  CallSessionError,
  endCallSessionCore,
  listCallSessionsCore,
  startCallSessionCore,
} from "@/lib/call-session.server";
import { ApiError, handle, json, readJson, requireAuth } from "./-shared";

function mapError(err: unknown): never {
  if (err instanceof CallSessionError) throw new ApiError(err.status, err.message);
  throw err;
}

const startSchema = z.object({
  thread_id: z.string().uuid().optional(),
  voice: z.string().min(1).max(40).optional(),
});

/**
 * POST /api/v1/calls/sessions
 * Body: { thread_id?, voice? }
 * Response: { session, realtime: { client_secret, model, voice, webrtc_url, expires_at } }
 * The client_secret is short-lived and safe to use from the device to open the
 * WebRTC connection directly. Premium/org only (402 otherwise).
 */
export function handleStartCallSession(request: Request): Promise<Response> {
  return handle(async () => {
    const { supabase, userId } = await requireAuth(request);
    const body = await readJson(request, startSchema).catch((err) => {
      if (err instanceof ApiError && err.status === 400) return {} as z.infer<typeof startSchema>;
      throw err;
    });
    try {
      return json(await startCallSessionCore(supabase, userId, body), 201);
    } catch (err) {
      mapError(err);
    }
  });
}

/** GET /api/v1/calls/sessions — recent call history for the caller. */
export function handleListCallSessions(request: Request): Promise<Response> {
  return handle(async () => {
    const { supabase, userId } = await requireAuth(request);
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 20);
    return json(await listCallSessionsCore(supabase, userId, Number.isFinite(limit) ? limit : 20));
  });
}

const turnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().min(1).max(4000),
});

/**
 * POST /api/v1/calls/sessions/:id/turns
 * Body: { role, text }
 * Response: { turn_count, crisis }  — `crisis` non-null means STOP the call and
 * show the crisis response; the safety record and admin alert are already done.
 */
export function handleAppendCallTurn(request: Request, sessionId: string): Promise<Response> {
  return handle(async () => {
    const { supabase, userId } = await requireAuth(request);
    const body = await readJson(request, turnSchema);
    try {
      return json(await appendCallTurnCore(supabase, userId, { session_id: sessionId, ...body }));
    } catch (err) {
      mapError(err);
    }
  });
}

const endSchema = z.object({ end_reason: z.string().max(60).optional() });

/**
 * POST /api/v1/calls/sessions/:id/end
 * Response: the finalized session row (duration, turn_count, summary).
 */
export function handleEndCallSession(request: Request, sessionId: string): Promise<Response> {
  return handle(async () => {
    const { supabase, userId } = await requireAuth(request);
    const body = await readJson(request, endSchema).catch((err) => {
      if (err instanceof ApiError && err.status === 400) return {} as z.infer<typeof endSchema>;
      throw err;
    });
    try {
      return json(
        await endCallSessionCore(supabase, userId, {
          session_id: sessionId,
          end_reason: body.end_reason ?? null,
        }),
      );
    } catch (err) {
      mapError(err);
    }
  });
}
