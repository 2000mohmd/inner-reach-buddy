import { createFileRoute } from "@tanstack/react-router";
import { sendMessage } from "@/lib/chat.functions";
import { handle, json } from "../-shared";

export const Route = createFileRoute("/api/v1/chat/send")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        handle(async () => json(await sendMessage({ data: await request.json() }))),
    },
  },
});
