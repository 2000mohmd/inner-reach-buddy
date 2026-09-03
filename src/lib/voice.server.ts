// Voice notes → text. Runs speech-to-text server-side, then the normal chat
// path (crisis gate included) handles the transcript.
//
// Primary: Lovable AI Gateway transcription endpoint.
// Fallback: OpenRouter multimodal chat with an inline audio part (wav/mp3 only,
// which is why the client sends WAV). Either path can be short on credits, so
// the error surfaced to the user says which top-up is needed.
const TRANSCRIBE_URL = "https://ai.gateway.lovable.dev/v1/audio/transcriptions";
const TRANSCRIBE_MODEL = "openai/gpt-4o-mini-transcribe";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_AUDIO_MODEL = "google/gemini-2.5-flash";

const EXTENSIONS: Record<string, string> = {
  "audio/wav": "wav",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
};

class VoiceError extends Error {}

async function transcribeViaGateway(input: { audio_base64: string; mime_type: string }) {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new VoiceError("Voice messages aren't configured yet.");

  const binary = Uint8Array.from(atob(input.audio_base64), (char) => char.charCodeAt(0));
  const mime = EXTENSIONS[input.mime_type] ? input.mime_type : "audio/webm";
  const extension = EXTENSIONS[mime] ?? "webm";

  const form = new FormData();
  form.append("file", new Blob([binary], { type: mime }), `voice.${extension}`);
  form.append("model", TRANSCRIBE_MODEL);

  const response = await fetch(TRANSCRIBE_URL, {
    method: "POST",
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "fetch" },
    body: form,
  });

  if (!response.ok) {
    const body = await response.text();
    console.error("gateway transcription failed", response.status, body.slice(0, 300));
    throw new VoiceError(
      response.status === 429
        ? "Too many voice notes right now — try again soon."
        : "gateway-unavailable",
    );
  }

  const payload = (await response.json()) as { text?: string };
  return (payload.text ?? "").trim();
}

async function transcribeViaOpenRouter(input: { audio_base64: string; mime_type: string }) {
  const apiKey = process.env["OPENROUTER_API_KEY"];
  if (!apiKey) throw new VoiceError("no-openrouter");

  const format = input.mime_type === "audio/mpeg" ? "mp3" : "wav";

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "Kalm",
    },
    body: JSON.stringify({
      model: OPENROUTER_AUDIO_MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Transcribe this voice note verbatim in its original language. Output only the transcript, no commentary.",
            },
            { type: "input_audio", input_audio: { data: input.audio_base64, format } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error("openrouter transcription failed", response.status, body.slice(0, 300));
    throw new VoiceError(
      response.status === 402
        ? "Voice notes need AI credits — top up Lovable AI (or the OpenRouter balance) to enable them."
        : "Couldn't understand that recording. Try again or type instead.",
    );
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string | null } }[];
  };
  return (payload.choices?.[0]?.message?.content ?? "").trim();
}

export async function transcribeAudioCore(input: { audio_base64: string; mime_type: string }) {
  let text = "";
  try {
    text = await transcribeViaGateway(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message && message !== "gateway-unavailable" && message !== "no-openrouter") {
      // A user-meaningful gateway error (e.g. rate limit) — still try the fallback.
      console.error("voice gateway error", message);
    }
    try {
      text = await transcribeViaOpenRouter(input);
    } catch (fallbackError) {
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : "";
      if (fallbackMessage === "no-openrouter") {
        throw new Error(
          message && message !== "gateway-unavailable"
            ? message
            : "Voice notes need AI credits — top up Lovable AI to enable them.",
        );
      }
      throw new Error(fallbackMessage || "Couldn't understand that recording. Try typing instead.");
    }
  }

  if (!text) throw new Error("That recording came through silent. Try again.");
  return { text };
}
