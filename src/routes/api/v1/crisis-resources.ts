import { createFileRoute } from "@tanstack/react-router";
import { CRISIS_DISCLAIMER, crisisCopy } from "@/lib/crisis";
import { normalizeLanguage } from "@/lib/i18n/languages";
import { handle, json } from "./-shared";

// Crisis resources are NEVER gated — no auth required.
export const Route = createFileRoute("/api/v1/crisis-resources")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        handle(async () => {
          const lang = normalizeLanguage(new URL(request.url).searchParams.get("lang"));
          const copy = crisisCopy(lang);
          return json({
            language: lang,
            resources: copy.resources,
            disclaimer: copy.disclaimer ?? CRISIS_DISCLAIMER,
          });
        }),
    },
  },
});
