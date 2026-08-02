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
    "HOW YOU TALK: You are running a conversation, not answering a question. Most replies should do ONE of these, not several at once: reflect what they said, ask one specific follow-up question, or guide one small step of something — then stop and wait for them. Do not deliver multi-point advice lists or fully resolve something in a single reply unless they've explicitly asked for a direct answer or summary. Default to ending your reply with a genuine, specific question that responds to what they actually just said — not a generic 'how does that feel?'. Exception: if they're clearly winding down (thanking you, saying goodbye, topic resolved), let it close naturally instead of forcing another question.",
    "",
    "Mirror first, then ask before you advise. Only introduce a technique or exercise once you understand enough of the specific situation to make it relevant — not as a first response to a vague 'I feel anxious.'",
    "",
    "AVOID: numbered lists of tips, multiple questions stacked in one reply, long restatements of what they said before responding, generic reassurance used as a substitute for a real question, offering an exercise before you understand the situation.",
    "",
    "BOUNDARIES (absolute):",
    "- You are NOT a therapist, doctor or emergency service. Never diagnose, never name or suggest a condition the person hasn't named, never advise on medication, dosage or stopping treatment.",
    "- Do not interpret symptoms clinically. Instead, encourage professional support when something sounds persistent or serious.",
    "- If the person describes danger to themselves or others, stop the normal conversation and direct them to 988 or local emergency services.",
    `- Every reply must be consistent with this standing disclaimer: "${CRISIS_DISCLAIMER}"`,
    "- Most replies should be 2-5 sentences. Only go longer when actively guiding a multi-step exercise inline, or when they've clearly asked for something more thorough.",
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

  lines.push(
    "",
    "TOOLS: you have a few tools that let you act inside the app rather than only talk.",
    "- Prefer get_effectiveness_insights before suggesting a practice, so suggestions come from what has actually helped this person, not a guess.",
    "- Use launch_exercise instead of typing out the steps of a structured exercise.",
    "- Use log_mood only when they have clearly told you how they're feeling and it makes sense to save it, and create_commitment only when they have named one small concrete thing themselves.",
    "- suggest_stepup is for the 'this has been heavy for a while' zone, not acute risk — acute risk is handled elsewhere before you see the message.",
    "- Never announce that you are using a tool. Just do it, then mention plainly what you saved or opened.",
  );

  if (ctx.quickAction && QUICK_ACTION_GUIDANCE[ctx.quickAction]) {
    lines.push("", `QUICK ACTION: ${QUICK_ACTION_GUIDANCE[ctx.quickAction]}`);
  }

  return lines.join("\n");
}

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

type AnthropicMessage = { role: "user" | "assistant"; content: string | AnthropicContentBlock[] };

type AnthropicResponse = {
  content?: AnthropicContentBlock[];
  stop_reason?: string;
  error?: { type?: string; message?: string };
};

function requireApiKey() {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) throw new Error("The AI companion isn't configured yet (missing Anthropic key).");
  return apiKey;
}

async function callAnthropic(
  apiKey: string,
  system: string,
  messages: AnthropicMessage[],
  tools: AnthropicTool[],
): Promise<AnthropicResponse> {
  const response = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages,
      ...(tools.length ? { tools } : {}),
    }),
  });

  if (response.ok) return (await response.json()) as AnthropicResponse;

  const body = await response.text();
  console.error("Anthropic API error", response.status, body);

  // Anthropic signals throttling with 429 and overload with 529.
  if (response.status === 429 || response.status === 529) {
    throw new Error("Kalm is a little busy right now. Please try again in a moment.");
  }
  // Anthropic reports exhausted balance as a 400 billing error rather than 402.
  if (
    response.status === 402 ||
    (response.status === 400 && /credit balance|billing/i.test(body))
  ) {
    throw new Error("The AI companion is out of credits. Please top up to keep chatting.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error("The AI companion isn't configured yet (invalid Anthropic key).");
  }
  throw new Error("The companion couldn't reply just now. Please try again.");
}

function collectText(blocks: AnthropicContentBlock[] | undefined) {
  return (blocks ?? [])
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export type CompanionReply = { text: string; actions: CompanionAction[] };

/**
 * Runs the standard Anthropic tool-use loop: send with tools, execute any
 * tool_use blocks server-side, feed tool_result blocks back, repeat up to
 * MAX_TOOL_ITERATIONS, then fall back to whatever text we have.
 */
export async function generateCompanionReply(
  ctx: CompanionContext,
  userMessage: string,
  toolContext: ToolContext,
): Promise<CompanionReply> {
  const apiKey = requireApiKey();
  const system = buildSystemPrompt(ctx);

  const messages: AnthropicMessage[] = [
    ...ctx.history.map((entry) => ({
      role: entry.sender === "assistant" ? ("assistant" as const) : ("user" as const),
      content: entry.content,
    })),
    { role: "user" as const, content: userMessage },
  ];

  const actions: CompanionAction[] = [];
  let lastText = "";

  for (let iteration = 0; iteration <= MAX_TOOL_ITERATIONS; iteration += 1) {
    const payload = await callAnthropic(apiKey, system, messages, CHAT_TOOLS);
    const blocks = payload.content ?? [];
    const text = collectText(blocks);
    if (text) lastText = text;

    const toolUses = blocks.filter(
      (block): block is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } =>
        block.type === "tool_use",
    );

    if (payload.stop_reason !== "tool_use" || toolUses.length === 0 || iteration === MAX_TOOL_ITERATIONS) {
      if (lastText) return { text: lastText, actions };
      break;
    }

    messages.push({ role: "assistant", content: blocks });

    const results: AnthropicContentBlock[] = [];
    for (const call of toolUses) {
      let outcome;
      try {
        outcome = await runCompanionTool(call.name, call.input ?? {}, toolContext);
      } catch (error) {
        console.error("companion tool failed", call.name, error);
        outcome = { result: "That action failed. Continue the conversation without it." };
      }
      if (outcome.action) actions.push(outcome.action);
      results.push({ type: "tool_result", tool_use_id: call.id, content: outcome.result });
    }
    messages.push({ role: "user", content: results });
  }

  if (lastText) return { text: lastText, actions };
  throw new Error("The companion couldn't reply just now. Please try again.");
}

/**
 * Proactive coaching: same prompt-assembly and model as chat, but read-only
 * tools — nudges are one-shot generations, not a back-and-forth.
 */
export async function generateNudgeMessage(
  ctx: CompanionContext,
  instruction: string,
  toolContext?: ToolContext,
): Promise<string> {
  const apiKey = requireApiKey();
  const system = buildSystemPrompt(ctx);

  const messages: AnthropicMessage[] = [
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

  const tools = toolContext ? NUDGE_TOOLS : [];
  let lastText = "";

  for (let iteration = 0; iteration <= MAX_TOOL_ITERATIONS; iteration += 1) {
    const payload = await callAnthropic(apiKey, system, messages, tools);
    const blocks = payload.content ?? [];
    const text = collectText(blocks);
    if (text) lastText = text;

    const toolUses = blocks.filter(
      (block): block is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } =>
        block.type === "tool_use",
    );

    if (
      !toolContext ||
      payload.stop_reason !== "tool_use" ||
      toolUses.length === 0 ||
      iteration === MAX_TOOL_ITERATIONS
    ) {
      break;
    }

    messages.push({ role: "assistant", content: blocks });
    const results: AnthropicContentBlock[] = [];
    for (const call of toolUses) {
      let outcome;
      try {
        outcome = await runCompanionTool(call.name, call.input ?? {}, toolContext);
      } catch (error) {
        console.error("nudge tool failed", call.name, error);
        outcome = { result: "That lookup failed. Write the nudge without it." };
      }
      results.push({ type: "tool_result", tool_use_id: call.id, content: outcome.result });
    }
    messages.push({ role: "user", content: results });
  }

  if (!lastText) throw new Error("Could not generate a nudge right now.");
  return lastText;
}

