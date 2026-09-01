import { createFileRoute } from "@tanstack/react-router";
import { handleChatThreadMessages } from "../../../-handlers";

// GET /api/v1/chat/threads/:id/messages?limit=&before=  — see
// handleChatThreadMessages (keyset-paginated, newest first).
export const Route = createFileRoute("/api/v1/chat/threads/$id/messages")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleChatThreadMessages(request, params.id),
    },
  },
});
