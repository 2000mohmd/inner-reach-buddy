// Voice notes → text. Runs the gateway speech-to-text model server-side, then
// the normal chat path (crisis gate included) handles the transcript.
const TRANSCRIBE_URL = "https://ai.gateway.lovable.dev/v1/audio/transcriptions";
const TRANSCRIBE_MODEL = "openai/gpt-4o-mini-transcribe";

const EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
};

export async function transcribeAudioCore(input: { audio_base64: string; mime_type: string }) {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("Voice messages aren't configured yet.");

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
    console.error("transcription failed", response.status, body);
    if (response.status === 429)
      throw new Error("Too many voice notes right now — try again soon.");
    if (response.status === 402)
      throw new Error("Voice transcription is out of credits. Please top up.");
    throw new Error("Couldn't understand that recording. Try again or type instead.");
  }

  const payload = (await response.json()) as { text?: string };
  const text = (payload.text ?? "").trim();
  if (!text) throw new Error("That recording came through silent. Try again.");
  return { text };
}
