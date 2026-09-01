import { describe, expect, it } from "vitest";
import { PostgresRateLimiter } from "./postgres";

const TODAY = new Date().toISOString().slice(0, 10);
const NOW_ISO = new Date().toISOString();

type Row = {
  window_start: string;
  count: number;
  day_start?: string | null;
  day_count?: number | null;
};

function fakeClient(row: Row | null) {
  const writes: Record<string, unknown>[] = [];
  return {
    writes,
    from(table: string) {
      if (table !== "chat_rate_limits") throw new Error(`unexpected table: ${table}`);
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
        }),
        upsert: async (value: Record<string, unknown>) => {
          writes.push(value);
          return { error: null };
        },
      };
    },
  };
}

const FREE = { tier: "free", dailyCap: 8 };
const PREMIUM = { tier: "premium", dailyCap: 200 };

describe("PostgresRateLimiter.checkAndConsume — tier-aware daily cap", () => {
  it("blocks a free user who has hit the free daily cap", async () => {
    const client = fakeClient({
      window_start: NOW_ISO,
      count: 1,
      day_start: TODAY,
      day_count: 8,
    });
    const decision = await new PostgresRateLimiter(client).checkAndConsume("u1", FREE);

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("daily");
    expect(decision.limit).toEqual({
      tier: "free",
      dailyLimit: 8,
      resetsAt: expect.any(String),
    });
    // A blocked attempt is not consumed.
    expect(client.writes).toHaveLength(0);
  });

  it("does NOT block a premium user at the same message count", async () => {
    const client = fakeClient({
      window_start: NOW_ISO,
      count: 1,
      day_start: TODAY,
      day_count: 8,
    });
    const decision = await new PostgresRateLimiter(client).checkAndConsume("u1", PREMIUM);

    expect(decision.allowed).toBe(true);
    expect(client.writes).toHaveLength(1);
    expect(client.writes[0]!["day_count"]).toBe(9);
  });

  it("allows a free user's 8th message, then the 9th is blocked", async () => {
    const seventh = await new PostgresRateLimiter(
      fakeClient({ window_start: NOW_ISO, count: 1, day_start: TODAY, day_count: 7 }),
    ).checkAndConsume("u1", FREE);
    expect(seventh.allowed).toBe(true);
    expect(seventh.remaining?.day).toBe(0); // just consumed the 8th

    const ninth = await new PostgresRateLimiter(
      fakeClient({ window_start: NOW_ISO, count: 1, day_start: TODAY, day_count: 8 }),
    ).checkAndConsume("u1", FREE);
    expect(ninth.allowed).toBe(false);
    expect(ninth.reason).toBe("daily");
  });

  it("resets for a free user on a new UTC day", async () => {
    const decision = await new PostgresRateLimiter(
      fakeClient({ window_start: NOW_ISO, count: 1, day_start: "2000-01-01", day_count: 999 }),
    ).checkAndConsume("u1", FREE);
    expect(decision.allowed).toBe(true);
  });

  it("fails OPEN on the paywall when the caller resolves no tier (no plan)", async () => {
    const decision = await new PostgresRateLimiter(
      fakeClient({ window_start: NOW_ISO, count: 1, day_start: TODAY, day_count: 50 }),
    ).checkAndConsume("u1");
    // 50 is over the free cap but under the default high cap → allowed.
    expect(decision.allowed).toBe(true);
  });

  it("still enforces the sliding window regardless of tier", async () => {
    const decision = await new PostgresRateLimiter(
      fakeClient({ window_start: NOW_ISO, count: 20, day_start: TODAY, day_count: 1 }),
    ).checkAndConsume("u1", PREMIUM);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("window");
  });
});
