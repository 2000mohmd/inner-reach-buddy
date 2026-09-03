import { createFileRoute } from "@tanstack/react-router";
import { handleChatMessagesStream } from "../../-handlers";

// POST /api/v1/chat/messages/stream — see handleChatMessagesStream for the contract.
export const Route = createFileRoute("/api/v1/chat/messages/stream")({
  server: {
    handlers: {
      POST: ({ request }) => handleChatMessagesStream(request),
    },
  },
});
