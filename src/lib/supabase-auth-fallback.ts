import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";

// The generated attacher reads the cached session only. Right after a hard
// reload the session can still be rehydrating, so serverFns fire without a
// bearer token and the protected middleware throws "No authorization header".
// This fallback forces a refresh once and attaches the token when available.
export const attachSupabaseAuthFallback = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    let token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) {
      token = (await supabase.auth.refreshSession()).data.session?.access_token;
    }
    return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
  },
);
