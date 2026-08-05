import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const TranscribeInput = z.object({
  audio_base64: z.string().min(1),
  mime_type: z.string().min(1).max(64),
});

export const transcribeVoiceNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TranscribeInput.parse(input))
  .handler(async ({ data }) => {
    const { transcribeAudioCore } = await import("./voice.server");
    return transcribeAudioCore(data);
  });
