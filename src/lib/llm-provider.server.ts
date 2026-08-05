// Model provider with automatic fallback.
//
// Primary: Anthropic Messages API (native tool use).
// Fallback: Lovable AI Gateway (OpenAI-compatible chat completions), used
// automatically whenever the Anthropic key is missing or Anthropic rejects the
// request (auth, identity verification, billing, overload, network).
//
// The rest of the app talks in Anthropic block shapes; this module translates
// them for the gateway so tool-calling behavior is identical on both paths.
// Nothing here touches crisis handling — detectCrisis() runs before any call.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const GATEWAY_MODEL = "google/gemini-3.6-flash";

export type LlmContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

export type LlmMessage = { role: "user" | "assistant"; content: string | LlmContentBlock[] };

export type LlmTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type LlmResponse = {
  content: LlmContentBlock[];
  stop_reason: string | null;
  /** Which provider actually answered — useful for logs. */
  provider: "anthropic" | "lovable";
};

export class LlmError extends Error {}

function anthropicKey() {
  return process.env["ANTHROPIC_API_KEY"] ?? process.env["claude"] ?? null;
}

/** Non-retryable, user-meaningful Anthropic failures still get a friendly text. */
function anthropicFailureMessage(status: number, body: string): string {
  if (status === 429 || status === 529) return "Anthropic is busy or throttling.";
  if (status === 402 || (status === 400 && /credit balance|billing/i.test(body)))
    return "Anthropic credits exhausted.";
  if (status === 401 || status === 403) return "Anthropic key rejected.";
  if (/identity verification/i.test(body)) return "Anthropic requires identity verification.";
  return `Anthropic error ${status}.`;
}

async function callAnthropic(
  apiKey: string,
  model: string,
  maxTokens: number,
  system: string,
  messages: LlmMessage[],
  tools: LlmTool[],
): Promise<LlmResponse> {
  const response = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages,
      ...(tools.length ? { tools } : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new LlmError(anthropicFailureMessage(response.status, body));
  }

  const payload = (await response.json()) as {
    content?: LlmContentBlock[];
    stop_reason?: string;
  };
  return {
    content: payload.content ?? [],
    stop_reason: payload.stop_reason ?? null,
    provider: "anthropic",
  };
}

// --- Gateway (OpenAI-compatible) translation -------------------------------

type GatewayMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls: {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

function toGatewayMessages(system: string, messages: LlmMessage[]): GatewayMessage[] {
  const out: GatewayMessage[] = [{ role: "system", content: system }];

  for (const message of messages) {
    if (typeof message.content === "string") {
      out.push({ role: message.role, content: message.content });
      continue;
    }

    const text = message.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    const toolUses = message.content.filter(
      (
        block,
      ): block is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } =>
        block.type === "tool_use",
    );
    const toolResults = message.content.filter(
      (block): block is { type: "tool_result"; tool_use_id: string; content: string } =>
        block.type === "tool_result",
    );

    if (message.role === "assistant") {
      if (toolUses.length) {
        out.push({
          role: "assistant",
          content: text || null,
          tool_calls: toolUses.map((call) => ({
            id: call.id,
            type: "function" as const,
            function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) },
          })),
        });
      } else {
        out.push({ role: "assistant", content: text });
      }
      continue;
    }

    // user role: tool results become dedicated tool messages
    if (toolResults.length) {
      for (const result of toolResults) {
        out.push({ role: "tool", tool_call_id: result.tool_use_id, content: result.content });
      }
      if (text) out.push({ role: "user", content: text });
      continue;
    }
    out.push({ role: "user", content: text });
  }

  return out;
}

async function callGateway(
  model: string,
  maxTokens: number,
  system: string,
  messages: LlmMessage[],
  tools: LlmTool[],
): Promise<LlmResponse> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new LlmError("The AI companion isn't configured yet.");

  const response = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: toGatewayMessages(system, messages),
      ...(tools.length
        ? {
            tools: tools.map((tool) => ({
              type: "function",
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.input_schema,
              },
            })),
          }
        : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error("Lovable AI gateway error", response.status, body);
    if (response.status === 429)
      throw new LlmError("Kalm is a little busy right now. Please try again in a moment.");
    if (response.status === 402)
      throw new LlmError("The AI companion is out of credits. Please top up to keep chatting.");
    throw new LlmError("The companion couldn't reply just now. Please try again.");
  }

  const payload = (await response.json()) as {
    choices?: {
      finish_reason?: string;
      message?: {
        content?: string | null;
        tool_calls?: { id: string; function?: { name?: string; arguments?: string } }[];
      };
    }[];
  };

  const choice = payload.choices?.[0];
  const blocks: LlmContentBlock[] = [];
  const text = choice?.message?.content;
  if (text) blocks.push({ type: "text", text });
  for (const call of choice?.message?.tool_calls ?? []) {
    let input: Record<string, unknown> = {};
    try {
      input = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
    } catch {
      input = {};
    }
    blocks.push({ type: "tool_use", id: call.id, name: call.function?.name ?? "", input });
  }

  const hasToolUse = blocks.some((block) => block.type === "tool_use");
  return {
    content: blocks,
    stop_reason: hasToolUse ? "tool_use" : (choice?.finish_reason ?? null),
    provider: "lovable",
  };
}

/**
 * Try Anthropic, then automatically fall back to Lovable AI.
 * Callers keep a single Anthropic-shaped contract.
 */
export async function callCompanionModel(options: {
  model: string;
  maxTokens: number;
  system: string;
  messages: LlmMessage[];
  tools?: LlmTool[];
}): Promise<LlmResponse> {
  const { model, maxTokens, system, messages } = options;
  const tools = options.tools ?? [];
  const key = anthropicKey();

  if (key) {
    try {
      return await callAnthropic(key, model, maxTokens, system, messages, tools);
    } catch (error) {
      console.error(
        "Anthropic unavailable, falling back to Lovable AI:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  return callGateway(GATEWAY_MODEL, maxTokens, system, messages, tools);
}
