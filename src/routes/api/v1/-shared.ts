// Shared helpers for the versioned mobile API (src/routes/api/v1/*).
//
// These routes are a thin, Bearer-JWT-authenticated JSON surface for the
// separate mobile app. They do NOT re-implement business logic: each handler
// forwards to the same createServerFn used by the web app. Auth flows through
// automatically — the server fn's requireSupabaseAuth middleware reads the
// Authorization header off the current request.
import { z } from "zod";

export function json(body: unknown, init: number | ResponseInit = 200): Response {
  const responseInit: ResponseInit = typeof init === "number" ? { status: init } : init;
  return new Response(JSON.stringify(body), {
    ...responseInit,
    headers: { "Content-Type": "application/json", ...(responseInit.headers ?? {}) },
  });
}

export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiError(400, "Invalid JSON body");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(400, "Validation failed", parsed.error.flatten());
  }
  return parsed.data;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/**
 * Runs a handler and maps thrown errors to JSON responses. Unauthorized errors
 * from requireSupabaseAuth become 401; zod/validation become 400; anything else
 * is a 500 with a generic message (details are logged, not returned).
 */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError) {
      return json({ error: err.message, details: err.details ?? undefined }, err.status);
    }
    const message = err instanceof Error ? err.message : String(err);
    if (/^unauthorized/i.test(message)) {
      return json({ error: "Unauthorized" }, 401);
    }
    if (/not implemented/i.test(message)) {
      return json({ error: message }, 501);
    }
    if (err instanceof z.ZodError) {
      return json({ error: "Validation failed", details: err.flatten() }, 400);
    }
    console.error("[api/v1] unhandled error:", message);
    return json({ error: "Internal error" }, 500);
  }
}
