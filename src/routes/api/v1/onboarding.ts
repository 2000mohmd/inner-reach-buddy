import { createFileRoute } from "@tanstack/react-router";
import { completeOnboarding, getMyProfile } from "@/lib/onboarding.functions";
import { handle, json } from "./-shared";

export const Route = createFileRoute("/api/v1/onboarding")({
  server: {
    handlers: {
      GET: async () => handle(async () => json(await getMyProfile())),
      POST: async ({ request }) =>
        handle(async () => json(await completeOnboarding({ data: await request.json() }))),
    },
  },
});
