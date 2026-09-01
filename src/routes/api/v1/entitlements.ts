import { createFileRoute } from "@tanstack/react-router";
import { handleEntitlements } from "./-handlers";

// GET /api/v1/entitlements — see handleEntitlements.
export const Route = createFileRoute("/api/v1/entitlements")({
  server: {
    handlers: {
      GET: ({ request }) => handleEntitlements(request),
    },
  },
});
