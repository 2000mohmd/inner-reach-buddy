import { beforeEach, describe, expect, it, vi } from "vitest";

// --- mocks -------------------------------------------------------------------

const sendMessageMock = vi.fn();
vi.mock("@/lib/chat.functions", () => ({
  sendMessageCore: (...args: unknown[]) => sendMessageMock(...args),
}));

let authImpl: (request: Request) => Promise<unknown>;
vi.mock("@/lib/api-auth.server", () => ({
  authenticateBearer: (request: Request) => authImpl(request),
}));

import { handleChatMessages, handleCrisisResources } from "./-handlers";

const AUTHED = { ok: true as const, userId: "user-1", supabase: fakeProfiles("en") };

function fakeProfiles(language: string) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: { language }, error: null }),
  };
  return { from: () => chain } as never;
}

const post = (body: unknown, headers: Record<string, string> = { Authorization: "Bearer x.y.z" }) =>
  new Request("https://api.test/api/v1/chat/messages", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  sendMessageMock.mockReset();
  authImpl = async () => AUTHED;
});

// --- POST /api/v1/chat/messages -------------------------------------------------

describe("handleChatMessages", () => {
  it("passes the body straight to sendMessageCore and returns its result verbatim", async () => {
    const normal = {
      thread_id: "t-1",
      userMessage: {
        id: "m-1",
        sender: "user",
        content: "hi",
        flagged_crisis: false,
        created_at: "",
      },
      reply: { type: "message", id: "r-1", content: "hello", created_at: "", actions: [] },
    };
    sendMessageMock.mockResolvedValue(normal);

    const res = await handleChatMessages(post({ thread_id: "t-1", content: "hi" }));
    expect(res.status).toBe(200);
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    // (authedClient, userId, rawBody) — no reshaping of the body.
    expect(sendMessageMock).toHaveBeenCalledWith(expect.anything(), "user-1", {
      thread_id: "t-1",
      content: "hi",
    });
    expect(await res.json()).toEqual(normal);
  });

  it("returns the full structured crisis object when flagged — no reshaping, no raw text", async () => {
    const crisisResult = {
      thread_id: "t-1",
      userMessage: {
        id: "m-1",
        sender: "user",
        content: "…",
        flagged_crisis: true,
        created_at: "",
      },
      reply: {
        type: "crisis",
        severity: "high",
        message: "Thank you for telling me.",
        matched: ["kill myself"],
        resources: [{ name: "988", contact: "Call or text 988", detail: "24/7" }],
        disclaimer: "Kalm is a wellbeing companion, not an emergency service.",
        id: "sys-1",
        created_at: "2026-01-01T00:00:00Z",
      },
    };
    sendMessageMock.mockResolvedValue(crisisResult);

    const res = await handleChatMessages(post({ content: "i want to kill myself" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reply.type).toBe("crisis");
    expect(body.reply.severity).toBe("high");
    expect(body.reply.resources).toHaveLength(1);
    expect(body.reply.disclaimer).toContain("not an emergency service");
    expect(body).toEqual(crisisResult);
  });

  it("rejects an unauthenticated request with 401 and never calls sendMessage (auth is first)", async () => {
    authImpl = async () => ({ ok: false, status: 401, error: "Invalid or expired token" });
    const res = await handleChatMessages(post({ content: "hi" }, {}));
    expect(res.status).toBe(401);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("does not interpose a rate-limit / entitlement check before sendMessage", async () => {
    // The crisis-gate-before-rate-limiter guarantee lives inside sendMessage and
    // is enforced by crisis-gate.test.ts. This asserts the HTTP wrapper adds
    // nothing ahead of it: sendMessage is the first and only domain call.
    sendMessageMock.mockResolvedValue({
      thread_id: "t",
      userMessage: {},
      reply: { type: "message" },
    });
    await handleChatMessages(post({ content: "hi" }));
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
  });

  it("400s on an invalid JSON body", async () => {
    const req = new Request("https://api.test/api/v1/chat/messages", {
      method: "POST",
      headers: { Authorization: "Bearer x.y.z", "content-type": "application/json" },
      body: "{not json",
    });
    const res = await handleChatMessages(req);
    expect(res.status).toBe(400);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });
});

// --- GET /api/v1/crisis-resources --------------------------------------------

const get = (qs = "", headers: Record<string, string> = {}) =>
  new Request(`https://api.test/api/v1/crisis-resources${qs}`, { headers });

describe("handleCrisisResources", () => {
  it("returns English resources with no auth and no lang param", async () => {
    const res = await handleCrisisResources(get());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.language).toBe("en");
    expect(Array.isArray(body.resources)).toBe(true);
    expect(body.resources.length).toBeGreaterThan(0);
    expect(body.disclaimer).toBeTruthy();
  });

  it("honours ?lang=fr", async () => {
    const body = await (await handleCrisisResources(get("?lang=fr"))).json();
    expect(body.language).toBe("fr");
    expect(body.resources.some((r: { contact: string }) => r.contact.includes("3114"))).toBe(true);
  });

  it("falls back to English for an unknown ?lang", async () => {
    const body = await (await handleCrisisResources(get("?lang=de"))).json();
    expect(body.language).toBe("en");
    expect(body.resources.length).toBeGreaterThan(0);
  });

  it("uses the authenticated user's profile language when no lang param is given", async () => {
    authImpl = async () => ({ ok: true, userId: "u", supabase: fakeProfiles("ar") });
    const body = await (
      await handleCrisisResources(get("", { Authorization: "Bearer x.y.z" }))
    ).json();
    expect(body.language).toBe("ar");
    expect(body.resources.length).toBeGreaterThan(0);
  });

  it("degrades to English (still 200) when the bearer token is invalid", async () => {
    authImpl = async () => ({ ok: false, status: 401, error: "bad token" });
    const res = await handleCrisisResources(get("", { Authorization: "Bearer bad" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.language).toBe("en");
    expect(body.resources.length).toBeGreaterThan(0);
  });

  it("never throws / never returns non-200 even if auth resolution blows up", async () => {
    authImpl = async () => {
      throw new Error("supabase exploded");
    };
    const res = await handleCrisisResources(get("", { Authorization: "Bearer x.y.z" }));
    expect(res.status).toBe(200);
    expect((await res.json()).resources.length).toBeGreaterThan(0);
  });
});
