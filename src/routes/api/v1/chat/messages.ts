import { createFileRoute } from "@tanstack/react-router";
import { handleChatMessages } from "../-handlers";

// POST /api/v1/chat/messages — see handleChatMessages for the contract.
export const Route = createFileRoute("/api/v1/chat/messages")({
  server: {
    handlers: {
      POST: ({ request }) => handleChatMessages(request),
    },
  },
});
