import { createFileRoute } from "@tanstack/react-router";
import { handleCrisisResources } from "./-handlers";

// GET /api/v1/crisis-resources — NEVER gated. See handleCrisisResources.
export const Route = createFileRoute("/api/v1/crisis-resources")({
  server: {
    handlers: {
      GET: ({ request }) => handleCrisisResources(request),
    },
  },
});
