import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deliverPostCrisisFollowups, followUpMessage } from "./post-crisis-followup.server";

const HOURS = 60 * 60 * 1000;

type State = {
  events: { id: string; user_id: string; created_at: string }[];
  userMsgSinceEvent: boolean;
  anyMsgRecent: boolean;
  thread: { id: string } | null;
  preferredName: string | null;
  inserts: { table: string; row: Record<string, unknown> }[];
  updates: { table: string; row: Record<string, unknown> }[];
};

function fakeAdmin(state: State) {
  const build = (table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- self-referential stub
    const b: any = {
      _mode: "select" as "select" | "insert" | "update",
      _sinceEvent: false,
      _activeNow: false,
      select: () => b,
      is: () => b,
      eq: () => b,
      gte: () => {
        b._activeNow = true;
        return b;
      },
      gt: () => {
        b._sinceEvent = true;
        return b;
      },
      lte: () => b,
      order: () => b,
      limit: () => b,
      insert: (row: Record<string, unknown>) => {
        b._mode = "insert";
        state.inserts.push({ table, row });
        return b;
      },
      update: (row: Record<string, unknown>) => {
        b._mode = "update";
        state.updates.push({ table, row });
        return b;
      },
      single: async () => ({ data: { id: "new-thread" }, error: null }),
      maybeSingle: async () => {
        if (table === "chat_threads") return { data: state.thread, error: null };
        if (table === "profiles")
          return { data: { preferred_name: state.preferredName }, error: null };
        return { data: null, error: null };
      },
      then: (resolve: (v: unknown) => unknown) => {
        if (b._mode !== "select") return Promise.resolve({ error: null }).then(resolve);
        let rows: unknown[] = [];
        if (table === "crisis_events") rows = state.events;
        else if (table === "chat_messages") {
          if (b._sinceEvent) rows = state.userMsgSinceEvent ? [{ id: "m" }] : [];
          else if (b._activeNow) rows = state.anyMsgRecent ? [{ id: "m" }] : [];
        }
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    return b;
  };
  return { from: build };
}

const freshState = (): State => ({
  events: [
    { id: "e1", user_id: "u1", created_at: new Date(Date.now() - 30 * HOURS).toISOString() },
  ],
  userMsgSinceEvent: false,
  anyMsgRecent: false,
  thread: { id: "t1" },
  preferredName: "Sam",
  inserts: [],
  updates: [],
});

beforeEach(() => {
  process.env["POST_CRISIS_FOLLOWUP_ENABLED"] = "true";
});
afterEach(() => {
  delete process.env["POST_CRISIS_FOLLOWUP_ENABLED"];
});

describe("followUpMessage copy", () => {
  it("greets by name when known and is non-clinical", () => {
    const withName = followUpMessage("Sam");
    expect(withName).toContain("Sam");
    expect(withName.toLowerCase()).toContain("check in");
    for (const banned of ["crisis", "suicid", "self-harm", "mood", "score", "phq", "risk"]) {
      expect(withName.toLowerCase()).not.toContain(banned);
    }
  });
  it("still works with no name", () => {
    expect(followUpMessage(null).startsWith("I wanted to check in")).toBe(true);
  });
});

describe("deliverPostCrisisFollowups", () => {
  it("is a no-op when the feature flag is off", async () => {
    delete process.env["POST_CRISIS_FOLLOWUP_ENABLED"];
    const s = freshState();
    const res = await deliverPostCrisisFollowups(fakeAdmin(s));
    expect(res).toEqual({
      enabled: false,
      sent: 0,
      skippedActive: 0,
      deferredBusy: 0,
      failed: 0,
    });
    expect(s.inserts).toHaveLength(0);
    expect(s.updates).toHaveLength(0);
  });

  it("sends one in-app follow-up and stamps follow_up_sent_at", async () => {
    const s = freshState();
    const res = await deliverPostCrisisFollowups(fakeAdmin(s));

    expect(res.sent).toBe(1);
    const msg = s.inserts.find((i) => i.table === "chat_messages");
    expect(msg?.row).toMatchObject({ sender: "system", flagged_crisis: true, user_id: "u1" });
    expect(String(msg?.row["content"])).toContain("Sam");
    expect(s.updates).toContainEqual(
      expect.objectContaining({
        table: "crisis_events",
        row: expect.objectContaining({ follow_up_sent_at: expect.any(String) }),
      }),
    );
  });

  it("skips (permanently) if the person was active since the event", async () => {
    const s = freshState();
    s.userMsgSinceEvent = true;
    const res = await deliverPostCrisisFollowups(fakeAdmin(s));

    expect(res.skippedActive).toBe(1);
    expect(res.sent).toBe(0);
    expect(s.inserts).toHaveLength(0);
    expect(s.updates).toContainEqual(
      expect.objectContaining({
        table: "crisis_events",
        row: expect.objectContaining({ follow_up_skipped_at: expect.any(String) }),
      }),
    );
  });

  it("defers (no stamp) if the person is mid-conversation right now", async () => {
    const s = freshState();
    s.anyMsgRecent = true;
    const res = await deliverPostCrisisFollowups(fakeAdmin(s));

    expect(res.deferredBusy).toBe(1);
    expect(res.sent).toBe(0);
    expect(s.inserts).toHaveLength(0);
    expect(s.updates).toHaveLength(0); // will be retried next sweep
  });

  it("creates a thread when the person has none", async () => {
    const s = freshState();
    s.thread = null;
    const res = await deliverPostCrisisFollowups(fakeAdmin(s));
    expect(res.sent).toBe(1);
    expect(s.inserts.some((i) => i.table === "chat_threads")).toBe(true);
  });

  it("returns zeros when there are no pending events", async () => {
    const s = freshState();
    s.events = [];
    const res = await deliverPostCrisisFollowups(fakeAdmin(s));
    expect(res).toEqual({
      enabled: true,
      sent: 0,
      skippedActive: 0,
      deferredBusy: 0,
      failed: 0,
    });
  });
});
