import { createFileRoute } from "@tanstack/react-router";
import { logMood } from "@/lib/mood.functions";
import { handle, json } from "./-shared";

export const Route = createFileRoute("/api/v1/mood")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        handle(async () => json(await logMood({ data: await request.json() }))),
    },
  },
});
