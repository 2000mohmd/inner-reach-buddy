import { createFileRoute } from "@tanstack/react-router";
import { handleListCallSessions, handleStartCallSession } from "../-call-handlers";

// POST = start a live voice session, GET = call history.
export const Route = createFileRoute("/api/v1/calls/sessions")({
  server: {
    handlers: {
      POST: ({ request }) => handleStartCallSession(request),
      GET: ({ request }) => handleListCallSessions(request),
    },
  },
});
