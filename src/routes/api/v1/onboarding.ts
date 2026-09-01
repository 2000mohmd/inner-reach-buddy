import { createFileRoute } from "@tanstack/react-router";
import { handleOnboarding } from "./-handlers";

// POST /api/v1/onboarding — see handleOnboarding. Profile *reads* are done
// directly via the Supabase SDK (or GET /api/v1/profile), not here.
export const Route = createFileRoute("/api/v1/onboarding")({
  server: {
    handlers: {
      POST: ({ request }) => handleOnboarding(request),
    },
  },
});
