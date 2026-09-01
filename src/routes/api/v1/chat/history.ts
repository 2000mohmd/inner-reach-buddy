import { createFileRoute } from "@tanstack/react-router";
import { getThreadHistory } from "@/lib/chat.functions";
import { ApiError, handle, json } from "../-shared";

export const Route = createFileRoute("/api/v1/chat/history")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        handle(async () => {
          const threadId = new URL(request.url).searchParams.get("thread_id");
          if (!threadId) throw new ApiError(400, "thread_id query param is required");
          return json(await getThreadHistory({ data: { thread_id: threadId } }));
        }),
    },
  },
});
