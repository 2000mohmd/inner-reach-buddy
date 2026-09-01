import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getReceiptValidator } from "@/lib/billing/receipt-validation";
import { handle, json, readJson } from "../-shared";

const Body = z.object({
  platform: z.enum(["ios", "android"]),
  receipt: z.string().min(1),
  productId: z.string().min(1),
});

// Stub: every validator throws until store integration lands — handle() maps it
// to a 500 with the "not implemented" message.
export const Route = createFileRoute("/api/v1/billing/verify-receipt")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        handle(async () => {
          const body = await readJson(request, Body);
          return json(await getReceiptValidator(body.platform).validate(body));
        }),
    },
  },
});
