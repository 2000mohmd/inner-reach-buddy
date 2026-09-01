import { createFileRoute } from "@tanstack/react-router";
import { listCompanionPersonas } from "@/lib/preferences.functions";
import { handle, json } from "./-shared";

export const Route = createFileRoute("/api/v1/personas")({
  server: {
    handlers: { GET: async () => handle(async () => json(await listCompanionPersonas())) },
  },
});
