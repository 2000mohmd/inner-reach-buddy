import { createFileRoute } from "@tanstack/react-router";
import { handleEndCallSession } from "../../../-call-handlers";

// POST /api/v1/calls/sessions/:id/end — finalize the session and write a summary.
export const Route = createFileRoute("/api/v1/calls/sessions/$id/end")({
  server: {
    handlers: {
      POST: ({ request, params }) => handleEndCallSession(request, params.id),
    },
  },
});
