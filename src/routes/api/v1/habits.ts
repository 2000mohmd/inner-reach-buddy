import { createFileRoute } from "@tanstack/react-router";
import { createHabit, listHabits, logHabit } from "@/lib/habits.functions";
import { handle, json } from "./-shared";

export const Route = createFileRoute("/api/v1/habits")({
  server: {
    handlers: {
      GET: async () => handle(async () => json(await listHabits())),
      POST: async ({ request }) =>
        handle(async () => json(await createHabit({ data: await request.json() }))),
      PATCH: async ({ request }) =>
        handle(async () => json(await logHabit({ data: await request.json() }))),
    },
  },
});
