import { createFileRoute } from "@tanstack/react-router";
import { handleAppendCallTurn } from "../../../-call-handlers";

// POST /api/v1/calls/sessions/:id/turns — record one spoken turn (crisis-gated).
export const Route = createFileRoute("/api/v1/calls/sessions/$id/turns")({
  server: {
    handlers: {
      POST: ({ request, params }) => handleAppendCallTurn(request, params.id),
    },
  },
});
