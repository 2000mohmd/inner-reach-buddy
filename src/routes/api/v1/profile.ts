import { createFileRoute } from "@tanstack/react-router";
import { getMyProfile } from "@/lib/onboarding.functions";
import { handle, json } from "./-shared";

export const Route = createFileRoute("/api/v1/profile")({
  server: { handlers: { GET: async () => handle(async () => json(await getMyProfile())) } },
});
