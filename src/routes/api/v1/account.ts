import { createFileRoute } from "@tanstack/react-router";
import { deleteAccountCore } from "@/lib/account-deletion.server";
import { handle, json, requireAuth } from "./-shared";

/**
 * DELETE /api/v1/account — full, irreversible account deletion, callable from
 * the mobile app. Previously this only existed on the web settings page
 * (deleteMyAccount in onboarding.functions.ts); Apple App Store Review
 * Guideline 5.1.1(v) requires that an app supporting account creation also
 * let a person delete their account from inside the app, so a native-only
 * settings page wasn't enough.
 *
 * Shares deleteAccountCore with the web path, so both do the exact same
 * thing: best-effort cancel any Stripe subscription on file, erase wellness
 * data, anonymize crisis_events, then delete the auth user (which cascades
 * everything else).
 *
 * No confirmation step lives here — this is the point of no return, so the
 * mobile client must get explicit, unambiguous confirmation from the person
 * (the web app does this with a type-to-confirm dialog) before calling it.
 */
export const Route = createFileRoute("/api/v1/account")({
  server: {
    handlers: {
      DELETE: async ({ request }) =>
        handle(async () => {
          const { userId } = await requireAuth(request);
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await deleteAccountCore(supabaseAdmin, userId);
          return json({ ok: true });
        }),
    },
  },
});
