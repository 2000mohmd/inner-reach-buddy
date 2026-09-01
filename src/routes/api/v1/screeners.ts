import { createFileRoute } from "@tanstack/react-router";
import { getScreenerState, submitScreener } from "@/lib/screeners.functions";
import { handle, json } from "./-shared";

export const Route = createFileRoute("/api/v1/screeners")({
  server: {
    handlers: {
      GET: async () => handle(async () => json(await getScreenerState())),
      POST: async ({ request }) =>
        handle(async () => json(await submitScreener({ data: await request.json() }))),
    },
  },
});
