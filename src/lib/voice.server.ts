// Voice notes → text. Runs speech-to-text server-side, then the normal chat
// path (crisis gate included) handles the transcript.
//
// Provider: OpenRouter only (OPENROUTER_API_KEY), using a multimodal chat model
// with an inline audio part. Only wav/mp3 are accepted on that wire format,
// which is why the client converts recordings to 16 kHz mono WAV first.
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_AUDIO_MODEL = "google/gemini-2.5-flash";

class VoiceError extends Error {}

export async function transcribeAudioCore(input: { audio_base64: string; mime_type: string }) {
  const apiKey = process.env["OPENROUTER_API_KEY"];
  if (!apiKey) throw new VoiceError("Voice messages aren't configured yet.");

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
        ? "Voice notes need AI credits — top up the OpenRouter balance to enable them."
        : response.status === 429
          ? "Too many voice notes right now — try again soon."
          : "Couldn't understand that recording. Try again or type instead.",
    );
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string | null } }[];
  };
  const text = (payload.choices?.[0]?.message?.content ?? "").trim();

  if (!text) throw new VoiceError("That recording came through silent. Try again.");
  return { text };
}
