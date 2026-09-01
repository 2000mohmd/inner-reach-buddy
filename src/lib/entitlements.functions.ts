import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getEntitlementsFor, type Entitlements } from "./entitlements.server";

/** The signed-in user's current allowances (tier, chat credits, feature flags). */
export const getEntitlements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Entitlements> => {
    return getEntitlementsFor(context.supabase, context.userId);
  });
