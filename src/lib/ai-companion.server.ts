// Server-only AI companion logic: prompt assembly + Anthropic Messages API call
// with native Claude tool use. The deterministic crisis gate (detectCrisis in
// crisis.ts) runs BEFORE any of this and is never delegated to the model.
import { CRISIS_DISCLAIMER } from "./crisis";
import {
  CHAT_TOOLS,
  NUDGE_TOOLS,
  runCompanionTool,
  type AnthropicTool,
  type CompanionAction,
  type ToolContext,
} from "./companion-tools.server";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-4-5";
const MAX_TOKENS = 1024;
const MAX_TOOL_ITERATIONS = 3;


export type CompanionContext = {
  preferredName: string | null;
  accountType: string | null;
  introText: string | null;
  goals: string[];
  stressors: string[];
  communicationPreference: string | null;
  topicsToAvoid: string | null;
  inProfessionalCare: boolean;
  recentMoods: { score: number; note: string | null; tags: string[]; logged_at: string }[];
  history: { sender: string; content: string }[];
  quickAction: string | null;
};

const QUICK_ACTION_GUIDANCE: Record<string, string> = {
  anxious:
    "The person selected 'I'm feeling anxious'. Start by slowing the pace: validate the anxiety, then offer one small, concrete regulating step (breath, body, or naming what's happening) before any exploration.",
  reframe:
    "The person selected 'Help me reframe a thought'. Gently invite the specific thought, reflect it back, and explore kinder or more balanced alternatives together — as curiosity, never as correction.",
  grounding:
    "The person selected 'I need a grounding exercise'. Guide one short grounding practice step by step (e.g. 5-4-3-2-1 senses or feet-on-floor), one instruction per line, and check in at the end.",
  sleep:
    "The person selected 'I can't sleep'. Keep the reply short, low-stimulation and soothing. Offer one wind-down practice and avoid problem-solving spirals.",
  vent:
    "The person selected 'I just want to vent'. Mostly listen and reflect. Do not offer exercises or advice unless they ask.",
};

export function buildSystemPrompt(ctx: CompanionContext): string {
  const lines: string[] = [
    "You are Kalm, a warm, steady mental wellness companion inside the Kalm app.",
    "",
    "TONE: warm, validating, human and unhurried. Short paragraphs. Plain language. Reflect feelings before offering anything. Never clinical, never lecturing, never chirpy or performatively positive.",
    "",
    "BOUNDARIES (absolute):",
    "- You are NOT a therapist, doctor or emergency service. Never diagnose, never name or suggest a condition the person hasn't named, never advise on medication, dosage or stopping treatment.",
    "- Do not interpret symptoms clinically. Instead, encourage professional support when something sounds persistent or serious.",
    "- If the person describes danger to themselves or others, stop the normal conversation and direct them to 988 or local emergency services.",
    `- Every reply must be consistent with this standing disclaimer: "${CRISIS_DISCLAIMER}"`,
    "- Keep replies under about 180 words unless guiding a step-by-step exercise.",
    "",
    "HUMAN SUPPORT (anti-dependency): you are a companion, not the person's only support. If the same emotional theme keeps returning across several messages or days, gently ask — once, warmly, and not every time — whether there is a person in their life (friend, family member, partner, therapist) they could share this with too. Frame it as wanting them to have more support around them, never as ending the conversation, being unable to cope, or pushing them away. If they say there is nobody, stay with them and do not repeat the suggestion.",
    "",
    "PERSONALIZATION: you have context about this person below. Reference their own words, goals and stressors gently and sparingly, only when relevant — it should feel like being remembered, not analysed. Never recite the context back at them.",
    "",
    "--- PERSON CONTEXT ---",
  ];


  if (ctx.preferredName) lines.push(`Preferred name: ${ctx.preferredName}`);
  if (ctx.accountType === "teen") {
    lines.push(
      "Account mode: TEEN. Use age-appropriate language, extra care, no adult-oriented content, and encourage a trusted adult where it fits naturally.",
    );
  }
  if (ctx.introText) lines.push(`How they introduced themselves: ${ctx.introText}`);
  if (ctx.goals.length) lines.push(`Their stated goals: ${ctx.goals.join(", ")}`);
  if (ctx.stressors.length) lines.push(`Current stressors: ${ctx.stressors.join(", ")}`);
  if (ctx.communicationPreference)
    lines.push(`How they like to be spoken to: ${ctx.communicationPreference}`);
  if (ctx.topicsToAvoid)
    lines.push(`NEVER bring up these topics unprompted: ${ctx.topicsToAvoid}`);
  if (ctx.inProfessionalCare)
    lines.push(
      "They are already working with a professional — support that relationship, never contradict or replace it.",
    );

  if (ctx.recentMoods.length) {
    const summary = ctx.recentMoods
      .map((mood) => {
        const day = new Date(mood.logged_at).toISOString().slice(0, 10);
        const extras = [mood.tags.join("/"), mood.note].filter(Boolean).join(" — ");
        return `${day}: ${mood.score}/5${extras ? ` (${extras})` : ""}`;
      })
      .join("; ");
    lines.push(`Recent mood check-ins (newest first): ${summary}`);
  } else {
    lines.push("No mood check-ins logged yet.");
  }

  lines.push("--- END PERSON CONTEXT ---");

  if (ctx.quickAction && QUICK_ACTION_GUIDANCE[ctx.quickAction]) {
    lines.push("", `QUICK ACTION: ${QUICK_ACTION_GUIDANCE[ctx.quickAction]}`);
  }

  return lines.join("\n");
}

export async function generateCompanionReply(ctx: CompanionContext, userMessage: string) {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("AI companion is not configured");

  const messages = [
    { role: "system" as const, content: buildSystemPrompt(ctx) },
    ...ctx.history.map((entry) => ({
      role: entry.sender === "assistant" ? ("assistant" as const) : ("user" as const),
      content: entry.content,
    })),
    { role: "user" as const, content: userMessage },
  ];

  const response = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
    },
    body: JSON.stringify({ model: MODEL, messages }),
  });

  if (response.status === 429) {
    throw new Error("Kalm is a little busy right now. Please try again in a moment.");
  }
  if (response.status === 402) {
    throw new Error("The AI companion is out of credits. Please top up to keep chatting.");
  }
  if (!response.ok) {
    console.error("AI gateway error", response.status, await response.text());
    throw new Error("The companion couldn't reply just now. Please try again.");
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("The companion couldn't reply just now. Please try again.");
  return content;
}

/**
 * Proactive coaching: uses the SAME prompt-assembly pattern as chat so nudges
 * reference the person's own context instead of generic copy.
 */
export async function generateNudgeMessage(
  ctx: CompanionContext,
  instruction: string,
): Promise<string> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("AI companion is not configured");

  const messages = [
    { role: "system" as const, content: buildSystemPrompt(ctx) },
    {
      role: "user" as const,
      content: [
        "You are writing a short proactive message that will appear in the app as a gentle nudge — the person did not ask a question.",
        "Rules: 2-4 sentences maximum. Warm, unhurried, never guilt-inducing, never alarming, no bullet points, no headings, no sign-off.",
        "Do not diagnose, do not imply failure, and do not mention that this was triggered by data analysis.",
        "",
        `Situation: ${instruction}`,
      ].join("\n"),
    },
  ];

  const response = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
    body: JSON.stringify({ model: MODEL, messages }),
  });

  if (!response.ok) {
    console.error("AI gateway nudge error", response.status, await response.text());
    throw new Error("Could not generate a nudge right now.");
  }

  const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("Could not generate a nudge right now.");
  return content;
}
