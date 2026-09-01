// Crisis-gate-before-rate-limiter guarantee, verified THROUGH the mobile entry
// point: POST /api/v1/chat/messages -> handleChatMessages -> the real
// sendMessageCore (chat.functions.ts). Not the web path.
//
// Same technique as crisis-gate.test.ts: a fake Supabase client that throws the
// moment anything reads `chat_rate_limits`. If the HTTP wrapper — or any
// refactor of sendMessageCore — consulted the rate limiter before the crisis
// gate, this test fails.

import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const touched: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- self-referential test stub
  const chain: any = {
    insert: () => chain,
    update: () => chain,
    select: () => chain,
    eq: () => chain,
    neq: () => chain,
    order: () => chain,
    limit: () => chain,
    // chat_threads ownership check + profiles.language lookup both land here.
    maybeSingle: async () => ({ data: { id: "thread-1", language: null }, error: null }),
    single: async () => ({
      data: {
        id: "msg-1",
        content: "…",
        flagged_crisis: true,
        created_at: "2026-01-01T00:00:00Z",
      },
      error: null,
    }),
    then: undefined,
  };
  const fake = {
    touched,
    from(table: string) {
      touched.push(table);
      if (table === "chat_rate_limits") {
        throw new Error("rate limiter must not run before the crisis gate");
      }
      return chain;
    },
  };
  return { touched, fake };
});

// The mobile handler's explicit bearer check — resolve it to a fixed user and
// hand back the fake client that sendMessageCore then runs against.
vi.mock("@/lib/api-auth.server", () => ({
  authenticateBearer: async () => ({ ok: true, userId: "user-1", supabase: h.fake }),
}));

vi.mock("./crisis-alert.server", () => ({
  logCrisisEvent: vi.fn(async () => "event-id"),
}));

vi.mock("./crisis-classifier.server", () => ({
  classifyCrisisRisk: vi.fn(async () => ({ flagged: false, severity: null, reason: null })),
}));

import { handleChatMessages } from "@/routes/api/v1/-handlers";

const THREAD_ID = "11111111-1111-1111-1111-111111111111";

const post = (body: unknown) =>
  new Request("https://api.test/api/v1/chat/messages", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: "Bearer x.y.z" },
    body: JSON.stringify(body),
  });

describe("POST /api/v1/chat/messages — crisis gate runs before the rate limiter", () => {
  it("returns the structured crisis reply and never touches chat_rate_limits", async () => {
    const res = await handleChatMessages(
      post({ thread_id: THREAD_ID, content: "I want to kill myself" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reply.type).toBe("crisis");
    expect(body.reply.severity).toBe("high");
    expect(body.reply.resources.length).toBeGreaterThan(0);
    expect(body.reply.disclaimer).toBeTruthy();

    // The rate-limit table would have thrown if it were read; it must not be.
    expect(h.touched).toContain("chat_messages");
    expect(h.touched).not.toContain("chat_rate_limits");
  });

  it("handles a moderate-tier crisis the same way (still no rate-limit read)", async () => {
    h.touched.length = 0;
    const res = await handleChatMessages(
      post({ thread_id: THREAD_ID, content: "I wish I could just disappear forever" }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).reply.type).toBe("crisis");
    expect(h.touched).not.toContain("chat_rate_limits");
  });
});
