import { createFileRoute } from "@tanstack/react-router";
import { buildMyReport } from "@/lib/data-export.functions";
import { deleteMyData } from "@/lib/onboarding.functions";
import { handle, json } from "./-shared";

export const Route = createFileRoute("/api/v1/export")({
  server: {
    handlers: {
      GET: async () => handle(async () => json(await buildMyReport())),
      DELETE: async () => handle(async () => json(await deleteMyData())),
    },
  },
});
