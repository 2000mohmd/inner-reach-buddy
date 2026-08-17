import { describe, expect, it, vi } from "vitest";
import { triageCrisis, severityRank } from "./crisis";
import { runCrisisGate } from "./crisis-gate.server";

vi.mock("./crisis-alert.server", () => ({
  logCrisisEvent: vi.fn(async () => "event-id"),
}));

vi.mock("./crisis-classifier.server", () => ({
  classifyCrisisRisk: vi.fn(async () => ({ flagged: false, severity: null, reason: null })),
}));

/**
 * Fake client that throws if anything touches the rate-limit table, so the
 * ordering guarantee is enforced by the test rather than by convention.
 */
function fakeSupabase() {
  const touched: string[] = [];
  const chain: any = {
    insert: () => chain,
    update: () => chain,
    select: () => chain,
    eq: () => chain,
    neq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: { id: "sys-1", created_at: "2026-01-01T00:00:00Z" }, error: null }),
    then: undefined,
  };
  return {
    touched,
    from(table: string) {
      touched.push(table);
      if (table === "chat_rate_limits") {
        throw new Error("rate limiter must not run before the crisis gate");
      }
      return chain;
    },
  };
}

describe("triageCrisis severity tiers", () => {
  it("returns critical for imminent-plan language", () => {
    const result = triageCrisis("I have the pills ready for tonight");
    expect(result.severity).toBe("critical");
    expect(result.matched.length).toBeGreaterThan(0);
  });

  it("returns high for explicit self-harm intent", () => {
    expect(triageCrisis("I want to kill myself").severity).toBe("high");
  });

  it("returns moderate for passive ideation", () => {
    expect(triageCrisis("I wish I could just disappear forever").severity).toBe("moderate");
  });

  it("returns no severity for ordinary distress", () => {
    const result = triageCrisis("work has been really stressful and I slept badly");
    expect(result.severity).toBeNull();
    expect(result.matched).toEqual([]);
  });

  it("ranks critical above high above moderate", () => {
    expect(severityRank("critical")).toBeLessThan(severityRank("high"));
    expect(severityRank("high")).toBeLessThan(severityRank("moderate"));
  });
});

describe("crisis gate ordering guarantee", () => {
  const input = {
    userId: "user-1",
    threadId: "thread-1",
    messageId: "msg-1",
    recentTurns: [],
  };

  it("returns the crisis response without ever consulting the rate limiter", async () => {
    const supabase = fakeSupabase();
    const result = await runCrisisGate(supabase, {
      ...input,
      content: "I want to kill myself",
    });
    expect(result?.crisis.type).toBe("crisis");
    expect(result?.crisis.severity).toBe("high");
    expect(supabase.touched).not.toContain("chat_rate_limits");
  });

  it("passes ordinary messages through without touching the rate limiter", async () => {
    const supabase = fakeSupabase();
    const result = await runCrisisGate(supabase, {
      ...input,
      content: "I had a decent day, just tired",
    });
    expect(result).toBeNull();
    expect(supabase.touched).not.toContain("chat_rate_limits");
  });

  it("escalates when the semantic backstop flags a clear-regex message", async () => {
    const { classifyCrisisRisk } = await import("./crisis-classifier.server");
    vi.mocked(classifyCrisisRisk).mockResolvedValueOnce({
      flagged: true,
      severity: "critical",
      reason: "implicit plan",
    } as never);

    const supabase = fakeSupabase();
    const result = await runCrisisGate(supabase, {
      ...input,
      content: "everyone will be fine after friday, I've sorted it all out",
    });
    expect(result?.crisis.severity).toBe("critical");
    expect(result?.updatedUserMessage).toBe(true);
    expect(supabase.touched).not.toContain("chat_rate_limits");
  });
});
