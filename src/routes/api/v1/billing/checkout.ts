import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createCheckoutSession, ensureStripeCustomer } from "@/lib/billing/stripe.server";
import { ApiError, handle, json, readJson, requireAuth } from "../-shared";

const Body = z.object({
  // Where Stripe sends the browser back after checkout. Optional — falls back
  // to the request's Origin header, then APP_BASE_URL, so this also works from
  // a plain `curl` test against the deployed app with no body at all.
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

function defaultBaseUrl(request: Request): string {
  const origin = request.headers.get("origin");
  if (origin) return origin;
  const base = process.env["APP_BASE_URL"];
  if (base) return base;
  throw new ApiError(
    400,
    "Could not determine a redirect URL — pass successUrl/cancelUrl or set APP_BASE_URL.",
  );
}

/**
 * POST /api/v1/billing/checkout — creates a Stripe Checkout Session for the
 * premium subscription and returns its hosted URL for the client to open.
 *
 * Requires two env vars to actually work (both throw a clear error if unset):
 *   STRIPE_SECRET_KEY       sk_test_... now, sk_live_... after verification —
 *                           swapping this is the ONLY step to go live.
 *   STRIPE_PREMIUM_PRICE_ID the Stripe Price id for the premium plan (test
 *                           mode and live mode have separate ids; a
 *                           live-key swap needs the matching live price id too).
 */
export const Route = createFileRoute("/api/v1/billing/checkout")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        handle(async () => {
          const { supabase, userId } = await requireAuth(request);
          const body = await readJson(request, Body);

          const priceId = process.env["STRIPE_PREMIUM_PRICE_ID"];
          if (!priceId) {
            throw new ApiError(
              500,
              "Billing isn't configured yet (STRIPE_PREMIUM_PRICE_ID unset).",
            );
          }

          const { data: authUser } = await supabase.auth.getUser();
          const customerId = await ensureStripeCustomer(
            supabase,
            userId,
            authUser?.user?.email ?? null,
          );

          const base = defaultBaseUrl(request);
          const session = await createCheckoutSession({
            customerId,
            priceId,
            userId,
            successUrl: body.successUrl ?? `${base}/settings?checkout=success`,
            cancelUrl: body.cancelUrl ?? `${base}/settings?checkout=cancelled`,
          });

          if (!session.url) throw new ApiError(500, "Stripe did not return a checkout URL.");
          return json({ checkoutUrl: session.url, sessionId: session.id });
        }),
    },
  },
});
