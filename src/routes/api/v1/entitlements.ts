import { createFileRoute } from "@tanstack/react-router";
import { getEntitlements } from "@/lib/entitlements.functions";
import { handle, json } from "./-shared";

export const Route = createFileRoute("/api/v1/entitlements")({
  server: {
    handlers: {
      GET: async () => handle(async () => json(await getEntitlements())),
    },
  },
});
