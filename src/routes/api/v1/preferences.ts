import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getMyPreferences, setMyPreferences } from "@/lib/preferences.functions";
import { handle, json, readJson } from "./-shared";

const Patch = z.object({
  companionPersona: z.enum(["warm", "direct", "reflective"]).optional(),
  theme: z.enum(["system", "light", "dark"]).optional(),
});

export const Route = createFileRoute("/api/v1/preferences")({
  server: {
    handlers: {
      GET: async () => handle(async () => json(await getMyPreferences())),
      PATCH: async ({ request }) =>
        handle(async () => json(await setMyPreferences({ data: await readJson(request, Patch) }))),
    },
  },
});
