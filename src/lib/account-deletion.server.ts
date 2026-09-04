// Full account deletion (item 5) — shared by every place a person can delete
// their account, so they behave identically. Currently: the web settings page
// (deleteMyAccount in onboarding.functions.ts) and the mobile
// DELETE /api/v1/account route. Distinct from deleteMyData, which only wipes
// wellness data and keeps the account.
//
// Steps, in order:
//   0. If the profile has a Stripe subscription on file, cancel it
//      immediately via the Stripe API. Best-effort: deletion still proceeds
//      even if Stripe is unreachable or unconfigured (STRIPE_SECRET_KEY
//      unset throws immediately, caught and logged below) — but we never
//      want to erase the account and leave a subscription silently billing
//      someone who no longer has anywhere to cancel it from.
//   1. delete_account(uuid) RPC — explicit erasure of the tables with no FK
//      to auth.users, and anonymizes crisis_events (user_id -> null; the row
//      survives, per docs/DATA_RETENTION.md).
//   2. auth.admin.deleteUser — deletes the auth user, cascading every
//      FK-linked table (see migration 20260902000300_delete_account.sql).
//
// Both callers pass the service-role (admin) client — RLS would block a user
// from either the RPC or auth.admin.deleteUser.
import type { SupabaseClient } from "@supabase/supabase-js";
import { cancelStripeSubscription } from "./billing/stripe.server";

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ error: { message: string } | null }>;
};

export async function deleteAccountCore(
  // Untyped SupabaseClient (generic defaults to `any`) rather than
  // SupabaseClient<Database>: stripe_subscription_id and delete_account are
  // both added by migrations not yet in the generated Database types — same
  // situation as stripe_customer_id in stripe.server.ts.
  supabaseAdmin: SupabaseClient,
  userId: string,
): Promise<void> {
  const profile = await supabaseAdmin
    .from("profiles")
    .select("stripe_subscription_id")
    .eq("id", userId)
    .maybeSingle();
  const subscriptionId = (profile.data as { stripe_subscription_id?: string | null } | null)
    ?.stripe_subscription_id;
  if (subscriptionId) {
    try {
      await cancelStripeSubscription(subscriptionId);
    } catch (err) {
      console.error("account deletion: failed to cancel Stripe subscription for", userId, err);
    }
  }

  const rpcClient = supabaseAdmin as unknown as RpcClient;
  const { error: rpcError } = await rpcClient.rpc("delete_account", { p_user_id: userId });
  if (rpcError) throw new Error(rpcError.message);

  const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (authError) throw authError;
}
