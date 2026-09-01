import { createFileRoute } from "@tanstack/react-router";
import { createThread, listThreads } from "@/lib/chat.functions";
import { handle, json } from "../-shared";

export const Route = createFileRoute("/api/v1/chat/threads")({
  server: {
    handlers: {
      GET: async () => handle(async () => json(await listThreads())),
      POST: async () => handle(async () => json(await createThread())),
    },
  },
});
