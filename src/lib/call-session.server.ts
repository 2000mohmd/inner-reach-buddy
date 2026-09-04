// Live voice "call" sessions with the companion.
//
// WHY THIS SHAPE: a continuous voice call cannot be routed through our normal
// request/response chat path — the audio has to stream straight from the device
// to a realtime voice provider or the latency makes it unusable. So the backend
// owns everything EXCEPT the audio stream itself:
//
//   1. POST /api/v1/call/sessions      — entitlement check, thread, session row,
//                                        companion instructions, and a SHORT-LIVED
//                                        ephemeral credential for the provider.
//                                        The provider API key never leaves here.
//   2. POST /api/v1/call/sessions/:id/turns — the client posts each transcript
//                                        turn as it is finalized. Every user turn
//                                        goes through the SAME crisis gate as a
//                                        typed message, and lands in the same
//                                        chat thread, so a spoken disclosure is
//                                        treated exactly like a written one.
//   3. POST /api/v1/call/sessions/:id/end  — duration, transcript, summary.
//
// Provider: OpenAI Realtime (speech-to-speech). OPENROUTER_API_KEY cannot serve
// realtime audio, which is why this one path needs OPENAI_API_KEY. Chat and
// voice-note transcription remain OpenRouter-only.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { buildSystemPrompt, type CompanionContext } from "./ai-companion.server";
import { runCrisisGate } from "./crisis-gate.server";
import { getEntitlementsFor } from "./entitlements.server";
import { callCompanionModel } from "./llm-provider.server";

type Client = SupabaseClient<Database>;

const REALTIME_SECRET_URL = "https://api.openai.com/v1/realtime/client_secrets";
const REALTIME_WEBRTC_URL = "https://api.openai.com/v1/realtime/calls";
const REALTIME_MODEL = "gpt-realtime";
const DEFAULT_VOICE = "marin";
const ALLOWED_VOICES = ["marin", "cedar", "alloy", "shimmer", "verse"] as const;
/** Belt-and-braces cap so a stuck client can't hold a paid stream open forever. */
export const MAX_CALL_MINUTES = 30;
/** Sessions a person may start per rolling 24h — cost + anti-dependency guard. */
const MAX_SESSIONS_PER_DAY = 6;

export class CallSessionError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export type CallTurnRole = "user" | "assistant";

export type StartCallSessionResult = {
  session_id: string;
  thread_id: string;
  expires_in_seconds: number;
  max_duration_seconds: number;
  realtime: {
    provider: "openai_realtime";
    model: string;
    voice: string;
    /** Ephemeral, single-session credential. Safe to hold in the client. */
    client_secret: string;
    expires_at: number | null;
    /** POST an SDP offer here with `Authorization: Bearer <client_secret>`. */
    webrtc_url: string;
  };
  /** The companion persona/safety instructions the session was minted with. */
  instructions: string;
};

/**
 * Voice-specific addendum to the shared companion prompt. The written prompt
 * already owns tone, pacing and anti-dependency rules; this only adapts them to
 * being spoken aloud and to the fact that no UI affordances exist mid-call.
 */
function voiceInstructions(base: string): string {
  return [
    base,
    "",
    "YOU ARE ON A LIVE VOICE CALL. Everything you say is spoken aloud, so:",
    "- Speak in short, natural spoken sentences. No markdown, no lists, no headings, no emoji, no bullet characters.",
    "- Keep each turn to a couple of sentences and then stop talking so they can respond. Silence is fine; do not fill it.",
    "- Match their pace and volume. If they are quiet or upset, slow down and soften.",
    "- If they interrupt you, stop immediately and listen.",
    "- Never read out URLs, phone numbers or long instructions unless they explicitly ask; offer to send it in the chat instead.",
    "- You cannot see the screen and cannot launch anything. Guide practices verbally, one step at a time.",
    "",
    "SAFETY ON A CALL: if they express intent to harm themselves or someone else, stay calm and warm, say plainly that you want them to be safe and that you're not able to keep them safe on your own, encourage them to contact local emergency services or a crisis line right now, and tell them the app is putting crisis resources on their screen. Do not continue coaching or exercises after that point.",
  ].join("\n");
}

/** Assembles the same personalization the typed companion uses, minus history. */
async function buildCallContext(
  supabase: Client,
  userId: string,
  threadId: string,
): Promise<CompanionContext> {
  const { fetchRecentSummaries } = await import("./thread-summary.server");

  const [profile, intro, moods, history, pastSummaries, openCommitments] = await Promise.all([
    supabase
      .from("profiles")
      .select("preferred_name, account_type, ai_context_consent")
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("user_profiles")
      .select(
        "intro_text, goals, stressors, communication_preference, topics_to_avoid, in_professional_care",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("mood_logs")
      .select("score, note, tags, logged_at")
      .eq("user_id", userId)
      .order("logged_at", { ascending: false })
      .limit(5),
    supabase
      .from("chat_messages")
      .select("sender, content, created_at")
      .eq("thread_id", threadId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(12),
    fetchRecentSummaries(supabase, userId, threadId).catch(() => []),
    supabase
      .from("commitments")
      .select("description, created_at")
      .eq("user_id", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const consented = profile.data?.ai_context_consent !== false;

  return {
    preferredName: profile.data?.preferred_name ?? null,
    accountType: profile.data?.account_type ?? null,
    introText: consented ? (intro.data?.intro_text ?? null) : null,
    goals: consented ? (intro.data?.goals ?? []) : [],
    stressors: consented ? (intro.data?.stressors ?? []) : [],
    communicationPreference: intro.data?.communication_preference ?? null,
    topicsToAvoid: intro.data?.topics_to_avoid ?? null,
    inProfessionalCare: intro.data?.in_professional_care ?? false,
    recentMoods: consented ? (moods.data ?? []) : [],
    history: (history.data ?? [])
      .filter((entry) => entry.sender !== "system")
      .reverse()
      .map((entry) => ({ sender: entry.sender, content: entry.content })),
    quickAction: null,
    pastSummaries: consented ? pastSummaries : [],
    openCommitments: consented
      ? (openCommitments.data ?? []).map((row) => ({
          description: row.description,
          ageDays: (Date.now() - new Date(row.created_at).getTime()) / 86_400_000,
        }))
      : [],
  };
}

async function mintRealtimeCredential(input: { instructions: string; voice: string }) {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    throw new CallSessionError("Live voice calls aren't configured yet.", 503);
  }

  const response = await fetch(REALTIME_SECRET_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: 120 },
      session: {
        type: "realtime",
        model: REALTIME_MODEL,
        instructions: input.instructions,
        audio: {
          input: { transcription: { model: "gpt-4o-mini-transcribe" } },
          output: { voice: input.voice },
        },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error("realtime session mint failed", response.status, body.slice(0, 400));
    throw new CallSessionError(
      response.status === 429
        ? "Too many calls right now — try again in a moment."
        : "Couldn't start the call just now. Please try again.",
      response.status === 429 ? 429 : 502,
    );
  }

  const payload = (await response.json()) as {
    value?: string;
    expires_at?: number;
    client_secret?: { value?: string; expires_at?: number };
  };
  const secret = payload.value ?? payload.client_secret?.value;
  if (!secret) throw new CallSessionError("Couldn't start the call just now.", 502);
  return { secret, expiresAt: payload.expires_at ?? payload.client_secret?.expires_at ?? null };
}

export async function startCallSessionCore(
  supabase: Client,
  userId: string,
  input: { thread_id?: string | null; voice?: string | null } = {},
): Promise<StartCallSessionResult> {
  // Live sessions are a paid feature — the same entitlement the client reads
  // from /api/v1/entitlements is the one enforced here.
  const entitlements = await getEntitlementsFor(supabase, userId);
  if (!entitlements.features.liveSessions) {
    throw new CallSessionError("Live voice sessions are available on Kalm Premium.", 402);
  }

  const since = new Date(Date.now() - 86_400_000).toISOString();
  const recent = await supabase
    .from("call_sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("started_at", since);
  if ((recent.count ?? 0) >= MAX_SESSIONS_PER_DAY) {
    throw new CallSessionError(
      "That's a lot of calls today. Let's pick this up tomorrow — the chat is still here in the meantime.",
      429,
    );
  }

  // Resolve or create the thread the call transcript will live in.
  let threadId = input.thread_id ?? null;
  if (threadId) {
    const owned = await supabase
      .from("chat_threads")
      .select("id")
      .eq("id", threadId)
      .eq("user_id", userId)
      .maybeSingle();
    if (owned.error) throw owned.error;
    if (!owned.data) throw new CallSessionError("Thread not found", 404);
  } else {
    const created = await supabase
      .from("chat_threads")
      .insert({ user_id: userId, title: "Voice session" })
      .select("id")
      .single();
    if (created.error) throw created.error;
    threadId = created.data.id;
  }

  const voice =
    input.voice && (ALLOWED_VOICES as readonly string[]).includes(input.voice)
      ? input.voice
      : DEFAULT_VOICE;

  const context = await buildCallContext(supabase, userId, threadId);
  const instructions = voiceInstructions(buildSystemPrompt(context));
  const credential = await mintRealtimeCredential({ instructions, voice });

  const session = await supabase
    .from("call_sessions")
    .insert({
      user_id: userId,
      thread_id: threadId,
      status: "active",
      provider: "openai_realtime",
      model: REALTIME_MODEL,
      voice,
    })
    .select("id")
    .single();
  if (session.error) throw session.error;

  return {
    session_id: session.data.id,
    thread_id: threadId,
    expires_in_seconds: 120,
    max_duration_seconds: MAX_CALL_MINUTES * 60,
    realtime: {
      provider: "openai_realtime",
      model: REALTIME_MODEL,
      voice,
      client_secret: credential.secret,
      expires_at: credential.expiresAt,
      webrtc_url: `${REALTIME_WEBRTC_URL}?model=${encodeURIComponent(REALTIME_MODEL)}`,
    },
    instructions,
  };
}

type SessionRow = {
  id: string;
  thread_id: string;
  status: string;
  started_at: string;
  turn_count: number;
  transcript: unknown;
};

async function loadOwnSession(
  supabase: Client,
  userId: string,
  sessionId: string,
): Promise<SessionRow> {
  const { data, error } = await supabase
    .from("call_sessions")
    .select("id, thread_id, status, started_at, turn_count, transcript")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new CallSessionError("Call session not found", 404);
  return data as SessionRow;
}

export type AppendCallTurnResult = {
  message_id: string;
  turn_count: number;
  /**
   * Non-null when the crisis gate flagged this spoken turn. The client MUST
   * end the call, speak/show the crisis copy and surface the resources.
   */
  crisis: { severity: string; message: string; matched: string[]; resources: unknown } | null;
};

/**
 * Records one finalized transcript turn. User turns run the FULL crisis gate
 * (regex tier then semantic backstop) before anything else, identically to a
 * typed message — a spoken disclosure must never be a weaker signal than a
 * written one.
 */
export async function appendCallTurnCore(
  supabase: Client,
  userId: string,
  sessionId: string,
  input: { role: CallTurnRole; text: string },
): Promise<AppendCallTurnResult> {
  const text = input.text.trim();
  if (!text) throw new CallSessionError("Empty transcript turn");
  if (text.length > 8000) throw new CallSessionError("Transcript turn too long");

  const session = await loadOwnSession(supabase, userId, sessionId);
  if (session.status !== "active") throw new CallSessionError("Call session already ended", 409);

  const saved = await supabase
    .from("chat_messages")
    .insert({
      thread_id: session.thread_id,
      user_id: userId,
      sender: input.role === "user" ? "user" : "assistant",
      content: text,
      content_type: "voice",
    })
    .select("id, created_at")
    .single();
  if (saved.error) throw saved.error;

  let crisis: AppendCallTurnResult["crisis"] = null;
  if (input.role === "user") {
    const recentTurns = await supabase
      .from("chat_messages")
      .select("sender, content")
      .eq("thread_id", session.thread_id)
      .eq("user_id", userId)
      .neq("id", saved.data.id)
      .order("created_at", { ascending: false })
      .limit(8);

    const language = await supabase
      .from("user_profiles")
      .select("language")
      .eq("user_id", userId)
      .maybeSingle();

    const gate = await runCrisisGate(supabase, {
      userId,
      threadId: session.thread_id,
      messageId: saved.data.id,
      content: text,
      recentTurns: (recentTurns.data ?? []).reverse(),
      language: language.data?.language ?? null,
    });

    if (gate) {
      crisis = {
        severity: gate.crisis.severity,
        message: gate.crisis.message,
        matched: gate.crisis.matched,
        resources: gate.crisis.resources,
      };
      await supabase
        .from("call_sessions")
        .update({ crisis_triggered: true, crisis_severity: gate.crisis.severity })
        .eq("id", sessionId);
    }
  }

  const transcript = Array.isArray(session.transcript) ? session.transcript : [];
  const turnCount = session.turn_count + 1;
  await supabase
    .from("call_sessions")
    .update({
      turn_count: turnCount,
      transcript: [...transcript, { role: input.role, text, at: saved.data.created_at }],
    })
    .eq("id", sessionId);

  return { message_id: saved.data.id, turn_count: turnCount, crisis };
}

export type EndCallSessionResult = {
  session_id: string;
  duration_seconds: number;
  turn_count: number;
  summary: string | null;
};

/** Short spoken-session recap. Failure here never fails ending the call. */
async function summarizeCall(transcript: { role: string; text: string }[]): Promise<string | null> {
  if (transcript.length < 4) return null;
  try {
    const response = await callCompanionModel({
      model: "claude-haiku-4-5",
      maxTokens: 220,
      system:
        "Summarize this spoken wellness check-in in 2-3 warm, factual sentences, addressed to the person as 'you'. Note what they talked about, how they seemed, and anything they said they'd try. No advice, no diagnosis, no invented detail.",
      messages: [
        {
          role: "user",
          content: transcript
            .map((turn) => `${turn.role === "user" ? "Them" : "Kalm"}: ${turn.text}`)
            .join("\n"),
        },
      ],
    });
    const text = response.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join(" ")
      .trim();
    return text || null;
  } catch (error) {
    console.error("call summary failed", error);
    return null;
  }
}

export async function endCallSessionCore(
  supabase: Client,
  userId: string,
  sessionId: string,
  input: { reason?: string | null } = {},
): Promise<EndCallSessionResult> {
  const session = await loadOwnSession(supabase, userId, sessionId);

  const transcript = (Array.isArray(session.transcript) ? session.transcript : []) as {
    role: string;
    text: string;
  }[];
  const durationSeconds = Math.max(
    0,
    Math.min(
      MAX_CALL_MINUTES * 60,
      Math.round((Date.now() - new Date(session.started_at).getTime()) / 1000),
    ),
  );

  const summary = session.status === "active" ? await summarizeCall(transcript) : null;

  const updated = await supabase
    .from("call_sessions")
    .update({
      status: "ended",
      ended_at: new Date().toISOString(),
      duration_seconds: durationSeconds,
      end_reason: input.reason?.slice(0, 120) ?? null,
      ...(summary ? { summary } : {}),
    })
    .eq("id", sessionId)
    .eq("user_id", userId)
    .select("id, duration_seconds, turn_count, summary")
    .single();
  if (updated.error) throw updated.error;

  if (summary) {
    // Leave a marker in the thread so the typed companion knows a call happened
    // and can pick the conversation up where the voice session left off.
    await supabase.from("chat_messages").insert({
      thread_id: session.thread_id,
      user_id: userId,
      sender: "system",
      content: `Voice session recap: ${summary}`,
      content_type: "call_recap",
    });
    await supabase
      .from("chat_threads")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", session.thread_id);
  }

  return {
    session_id: updated.data.id,
    duration_seconds: updated.data.duration_seconds,
    turn_count: updated.data.turn_count,
    summary: updated.data.summary ?? null,
  };
}

export async function listCallSessionsCore(supabase: Client, userId: string, limit = 20) {
  const { data, error } = await supabase
    .from("call_sessions")
    .select(
      "id, thread_id, status, started_at, ended_at, duration_seconds, turn_count, summary, crisis_triggered, voice",
    )
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(Math.min(50, Math.max(1, limit)));
  if (error) throw error;
  return { sessions: data ?? [] };
}
