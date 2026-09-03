import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createBillingPortalSession } from "@/lib/billing/stripe.server";
import { ApiError, handle, json, readJson, requireAuth } from "../-shared";

const Body = z.object({ returnUrl: z.string().url().optional() });

/**
 * POST /api/v1/billing/portal — hosted Stripe page where an already-subscribed
 * user can update their card or cancel. Requires the user to already have a
 * stripe_customer_id (i.e. they've been through checkout at least once).
 */
export const Route = createFileRoute("/api/v1/billing/portal")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        handle(async () => {
          const { supabase, userId } = await requireAuth(request);
          const body = await readJson(request, Body);

          const profile = await supabase
            .from("profiles")
            .select("stripe_customer_id")
            .eq("id", userId)
            .maybeSingle();
          const customerId = (profile.data as Record<string, unknown> | null)?.[
            "stripe_customer_id"
          ] as string | null | undefined;
          if (!customerId) {
            throw new ApiError(400, "No billing account yet — subscribe first.");
          }

          const origin = request.headers.get("origin") ?? process.env["APP_BASE_URL"];
          const returnUrl = body.returnUrl ?? (origin ? `${origin}/settings` : undefined);
          if (!returnUrl) throw new ApiError(400, "Could not determine a return URL.");

          const session = await createBillingPortalSession({ customerId, returnUrl });
          return json({ portalUrl: session.url });
        }),
    },
  },
});
