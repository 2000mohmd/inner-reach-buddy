import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { handle, json, readJson, requireAuth } from "../-shared";

const Body = z.object({
  platform: z.enum(["ios", "android"]),
  token: z.string().trim().min(1).max(4096),
});

// device_push_tokens is added by the billing_and_checkin migration and isn't
// in the generated Database types yet (same situation date_of_birth was in —
// see onboarding.functions.ts). A loosely-typed view of the client keeps this
// typechecking until Lovable regenerates types against the live schema.
function pushTokensTable(supabase: SupabaseClient) {
  return (
    supabase as unknown as {
      from: (table: "device_push_tokens") => {
        upsert: (
          row: { user_id: string; platform: string; token: string },
          opts: { onConflict: string },
        ) => Promise<{ error: unknown }>;
        delete: () => {
          eq: (
            col: string,
            value: string,
          ) => { eq: (col: string, value: string) => Promise<{ error: unknown }> };
        };
      };
    }
  ).from("device_push_tokens");
}

/**
 * POST /api/v1/push/register-token — the mobile app's entire responsibility
 * for push: after the OS grants notification permission and Firebase hands
 * back a token, call this once (and again whenever the token refreshes —
 * FCM tokens rotate). Everything past this point (actually sending) is
 * src/lib/push.server.ts.
 *
 * DELETE with the same body removes a token, e.g. on sign-out, so a signed-out
 * device stops receiving another user's notifications.
 */
export const Route = createFileRoute("/api/v1/push/register-token")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        handle(async () => {
          const { supabase, userId } = await requireAuth(request);
          const body = await readJson(request, Body);
          const { error } = await pushTokensTable(supabase).upsert(
            { user_id: userId, platform: body.platform, token: body.token },
            { onConflict: "user_id,token" },
          );
          if (error) throw error;
          return json({ ok: true });
        }),
      DELETE: async ({ request }) =>
        handle(async () => {
          const { supabase, userId } = await requireAuth(request);
          const body = await readJson(request, Body.pick({ token: true }));
          const { error } = await pushTokensTable(supabase)
            .delete()
            .eq("user_id", userId)
            .eq("token", body.token);
          if (error) throw error;
          return json({ ok: true });
        }),
    },
  },
});
