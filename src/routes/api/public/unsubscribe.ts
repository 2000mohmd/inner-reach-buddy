import { createFileRoute } from "@tanstack/react-router";
import { verifyUnsubscribeToken } from "@/lib/email.server";

// GET (link click) and POST (RFC 8058 one-click) both unsubscribe. No login:
// the token is an HMAC of the user id, so it can't be forged for anyone else.

function page(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — Kalm</title>` +
      `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:34rem;margin:4rem auto;` +
      `padding:0 1.5rem;line-height:1.65;color:#1f2421">` +
      `<h1 style="font-size:1.35rem;margin-bottom:.5rem">${title}</h1>` +
      `<p style="color:#4a524d">${body}</p></div>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

async function unsubscribe(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const userId = url.searchParams.get("u") ?? "";
  const token = url.searchParams.get("t") ?? "";

  if (!(await verifyUnsubscribeToken(userId, token))) {
    return page(
      "This link isn't valid",
      "The unsubscribe link is invalid or has expired. You can turn off check-in emails any time in the Kalm app, under Settings.",
      400,
    );
  }

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (
      supabaseAdmin.from("profiles") as unknown as {
        update: (v: Record<string, unknown>) => {
          eq: (col: string, val: string) => Promise<{ error: unknown }>;
        };
      }
    )
      .update({ email_opt_out: true })
      .eq("id", userId);
    if (error) {
      console.error("[unsubscribe] update failed", error);
      return page(
        "Something went wrong",
        "We couldn't update your settings just now. Please try the link again, or turn off emails in the Kalm app under Settings.",
        500,
      );
    }
  } catch (err) {
    console.error("[unsubscribe] threw", err);
    return page(
      "Something went wrong",
      "We couldn't update your settings just now. Please try again, or turn off emails in the Kalm app under Settings.",
      500,
    );
  }

  return page(
    "You're unsubscribed",
    "You won't get check-in or weekly-reflection emails from Kalm anymore. " +
      "You can turn them back on any time in the app, under Settings. " +
      "Crisis-safety and account emails aren't affected by this.",
  );
}

export const Route = createFileRoute("/api/public/unsubscribe")({
  server: {
    handlers: {
      GET: ({ request }) => unsubscribe(request),
      POST: ({ request }) => unsubscribe(request),
    },
  },
});
