import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sent: [] as { to: string; userId: string; subject: string; bodyText: string }[],
  sendResult: true,
  state: {
    nudges: [] as { id: string; user_id: string; created_at: string }[],
    digests: [] as { id: string; user_id: string; created_at: string }[],
    profiles: {} as Record<string, { email_opt_out?: boolean; preferred_name?: string | null }>,
    users: {} as Record<string, { email?: string | null } | null>,
    updates: [] as { table: string; id: string }[],
  },
}));

vi.mock("./email.server", () => ({
  appBaseUrl: () => "https://app.test",
  sendProactiveEmail: async (args: {
    to: string;
    userId: string;
    subject: string;
    bodyText: string;
  }) => {
    h.sent.push(args);
    return h.sendResult;
  },
}));

import { deliverProactiveEmails } from "./proactive-email.server";

function fakeAdmin() {
  const build = (table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- self-referential stub
    const b: any = {
      _eqId: "",
      _update: null as unknown,
      select: () => b,
      is: () => b,
      gte: () => b,
      order: () => b,
      limit: () => b,
      eq: (_col: string, val: string) => {
        b._eqId = val;
        return b;
      },
      update: (v: unknown) => {
        b._update = v;
        return b;
      },
      maybeSingle: async () => ({ data: h.state.profiles[b._eqId] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => {
        if (b._update) {
          h.state.updates.push({ table, id: b._eqId });
          return Promise.resolve({ error: null }).then(resolve);
        }
        const rows =
          table === "nudges" ? h.state.nudges : table === "weekly_digests" ? h.state.digests : [];
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    return b;
  };
  return {
    from: build,
    auth: {
      admin: {
        getUserById: async (id: string) => ({ data: { user: h.state.users[id] ?? null } }),
      },
    },
  };
}

beforeEach(() => {
  h.sent = [];
  h.sendResult = true;
  h.state.nudges = [];
  h.state.digests = [];
  h.state.profiles = {};
  h.state.users = {};
  h.state.updates = [];
});

describe("deliverProactiveEmails", () => {
  it("emails a pending nudge to an opted-in user and stamps it", async () => {
    h.state.nudges = [{ id: "n1", user_id: "u1", created_at: new Date().toISOString() }];
    h.state.users["u1"] = { email: "u1@example.com" };
    h.state.profiles["u1"] = { email_opt_out: false, preferred_name: "Sam" };

    const res = await deliverProactiveEmails(fakeAdmin());

    expect(res.nudgeEmails).toBe(1);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.to).toBe("u1@example.com");
    expect(h.sent[0]!.subject).toBe("A note from Kalm");
    expect(h.state.updates).toContainEqual({ table: "nudges", id: "n1" });
  });

  it("never puts anything clinically sensitive in the subject or body", async () => {
    h.state.nudges = [{ id: "n1", user_id: "u1", created_at: new Date().toISOString() }];
    h.state.users["u1"] = { email: "u1@example.com" };
    h.state.profiles["u1"] = { email_opt_out: false, preferred_name: null };
    await deliverProactiveEmails(fakeAdmin());

    const blob = `${h.sent[0]!.subject}\n${h.sent[0]!.bodyText}`.toLowerCase();
    for (const banned of ["mood", "score", "phq", "gad", "depress", "anx", "streak"]) {
      expect(blob).not.toContain(banned);
    }
  });

  it("does NOT email an opted-out user, but still stamps so the queue drains", async () => {
    h.state.nudges = [{ id: "n1", user_id: "u1", created_at: new Date().toISOString() }];
    h.state.users["u1"] = { email: "u1@example.com" };
    h.state.profiles["u1"] = { email_opt_out: true, preferred_name: "Sam" };

    const res = await deliverProactiveEmails(fakeAdmin());

    expect(h.sent).toHaveLength(0);
    expect(res.skippedOptOut).toBe(1);
    expect(res.nudgeEmails).toBe(0);
    expect(h.state.updates).toContainEqual({ table: "nudges", id: "n1" });
  });

  it("stamps and skips when the account has no email address", async () => {
    h.state.nudges = [{ id: "n1", user_id: "u1", created_at: new Date().toISOString() }];
    h.state.users["u1"] = null;

    const res = await deliverProactiveEmails(fakeAdmin());

    expect(h.sent).toHaveLength(0);
    expect(res.nudgeEmails).toBe(0);
    expect(h.state.updates).toContainEqual({ table: "nudges", id: "n1" });
  });

  it("does NOT stamp when the send itself fails (so it retries next sweep)", async () => {
    h.sendResult = false;
    h.state.nudges = [{ id: "n1", user_id: "u1", created_at: new Date().toISOString() }];
    h.state.users["u1"] = { email: "u1@example.com" };
    h.state.profiles["u1"] = { email_opt_out: false, preferred_name: "Sam" };

    const res = await deliverProactiveEmails(fakeAdmin());

    expect(res.failed).toBe(1);
    expect(res.nudgeEmails).toBe(0);
    expect(h.state.updates).toHaveLength(0);
  });

  it("delivers weekly digests with their own non-revealing subject", async () => {
    h.state.digests = [{ id: "d1", user_id: "u1", created_at: new Date().toISOString() }];
    h.state.users["u1"] = { email: "u1@example.com" };
    h.state.profiles["u1"] = { email_opt_out: false, preferred_name: "Sam" };

    const res = await deliverProactiveEmails(fakeAdmin());

    expect(res.digestEmails).toBe(1);
    expect(h.sent[0]!.subject).toBe("Your week in Kalm is ready");
    expect(h.state.updates).toContainEqual({ table: "weekly_digests", id: "d1" });
  });

  it("returns zeros and never throws when there is nothing pending", async () => {
    await expect(deliverProactiveEmails(fakeAdmin())).resolves.toEqual({
      nudgeEmails: 0,
      digestEmails: 0,
      skippedOptOut: 0,
      failed: 0,
    });
  });
});
