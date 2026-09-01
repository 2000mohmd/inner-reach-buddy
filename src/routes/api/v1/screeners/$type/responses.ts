import { createFileRoute } from "@tanstack/react-router";
import { handleScreenerResponses } from "../../-handlers";

// POST /api/v1/screeners/:type/responses  (:type = phq9 | gad7)
// Wraps submitScreenerCore as-is, including the PHQ-9 item-9 crisis escalation.
export const Route = createFileRoute("/api/v1/screeners/$type/responses")({
  server: {
    handlers: {
      POST: ({ request, params }) => handleScreenerResponses(request, params.type),
    },
  },
});
