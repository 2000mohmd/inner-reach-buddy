import { describe, expect, it } from "vitest";
import { runCompanionTool } from "./companion-tools.server";

type Commit = { id: string; description: string };

function fakeSupabase(pending: Commit[]) {
  const updates: Record<string, unknown>[] = [];
  const chainFor = (rows: unknown[]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- self-referential stub
    const c: any = {
      _update: null as unknown,
      select: () => c,
      eq: () => c,
      order: () => c,
      limit: () => c,
      update: (v: Record<string, unknown>) => {
        c._update = v;
        return c;
      },
      then: (resolve: (v: unknown) => unknown) => {
        if (c._update) {
          updates.push(c._update);
          return Promise.resolve({ error: null }).then(resolve);
        }
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    return c;
  };
  return {
    updates,
    from: (table: string) => chainFor(table === "commitments" ? pending : []),
  };
}

const ctx = (supabase: unknown) => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test stub
  supabase: supabase as any,
  userId: "u1",
  threadId: "t1",
});

describe("complete_commitment tool", () => {
  it("marks the most recent open commitment done", async () => {
    const sb = fakeSupabase([{ id: "c1", description: "call mum this week" }]);
    const out = await runCompanionTool("complete_commitment", { status: "done" }, ctx(sb));

    expect(out.action).toMatchObject({
      type: "commitment_completed",
      id: "c1",
      status: "done",
    });
    expect(out.result.toLowerCase()).toContain("call mum");
    expect(sb.updates[0]).toMatchObject({ status: "done" });
    expect(sb.updates[0]!["completed_at"]).toEqual(expect.any(String));
  });

  it("marks it skipped without a completed_at, and frames it as fine", async () => {
    const sb = fakeSupabase([{ id: "c1", description: "go for a walk" }]);
    const out = await runCompanionTool("complete_commitment", { status: "skipped" }, ctx(sb));

    expect(out.action).toMatchObject({ type: "commitment_completed", status: "skipped" });
    expect(sb.updates[0]).toMatchObject({ status: "skipped", completed_at: null });
    expect(out.result.toLowerCase()).toContain("not a failure");
  });

  it("matches by description words when several are open", async () => {
    const sb = fakeSupabase([
      { id: "c2", description: "tidy the desk" },
      { id: "c1", description: "text Sam back" },
    ]);
    const out = await runCompanionTool(
      "complete_commitment",
      { status: "done", description: "sam" },
      ctx(sb),
    );
    expect(out.action).toMatchObject({ id: "c1" });
  });

  it("does nothing and says so when there is nothing open", async () => {
    const sb = fakeSupabase([]);
    const out = await runCompanionTool("complete_commitment", { status: "done" }, ctx(sb));
    expect(out.action).toBeUndefined();
    expect(sb.updates).toHaveLength(0);
    expect(out.result.toLowerCase()).toContain("nothing open");
  });
});
