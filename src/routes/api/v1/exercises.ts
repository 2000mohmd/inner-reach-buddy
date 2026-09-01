import { createFileRoute } from "@tanstack/react-router";
import { completeExercise, listExercises } from "@/lib/exercises.functions";
import { handle, json } from "./-shared";

export const Route = createFileRoute("/api/v1/exercises")({
  server: {
    handlers: {
      GET: async () => handle(async () => json(await listExercises())),
      POST: async ({ request }) =>
        handle(async () => json(await completeExercise({ data: await request.json() }))),
    },
  },
});
