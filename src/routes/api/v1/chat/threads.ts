import { createFileRoute } from "@tanstack/react-router";
import { handleChatThreads } from "../-handlers";

// GET /api/v1/chat/threads — the caller's threads, newest activity first.
// Threads are created implicitly by POST /api/v1/chat/messages without a
// thread_id, so there is no create endpoint here.
export const Route = createFileRoute("/api/v1/chat/threads")({
  server: {
    handlers: {
      GET: ({ request }) => handleChatThreads(request),
    },
  },
});
