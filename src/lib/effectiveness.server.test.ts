import { describe, expect, it } from "vitest";
import { computeEffectivenessFor } from "./effectiveness.server";

// Fake client: exercise_completions returns a fixed set; habits/logs/moods empty;
// effectiveness_insights.upsert captures the rows written.
function fakeClient(completions: unknown[]) {
  const upserted: Record<string, unknown>[][] = [];
  const chainFor = (table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- self-referential stub
    const c: any = {
      select: () => c,
      eq: () => c,
      gte: () => c,
      not: () => c,
      order: () => c,
      limit: () => c,
      maybeSingle: async () => ({ data: null, error: null }),
      upsert: async (rows: Record<string, unknown>[]) => {
        upserted.push(rows);
        return { error: null };
      },
      then: (resolve: (v: unknown) => unknown) => {
        const data = table === "exercise_completions" ? completions : table === "habits" ? [] : [];
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return c;
  };
  return { upserted, from: (t: string) => chainFor(t) };
}

const completion = (slug: string, category: string, before: number, after: number) => ({
  mood_before: before,
  mood_after: after,
  exercises: { slug, title: slug.replace(/-/g, " "), category },
});

describe("computeEffectivenessFor — exercise insights at two grains", () => {
  it("writes both per-slug and per-category rows once there are >= 3 samples", async () => {
    const sb = fakeClient([
      completion("box-breathing", "breathing", 2, 4),
      completion("box-breathing", "breathing", 3, 4),
      completion("box-breathing", "breathing", 2, 3),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test stub
    const res = await computeEffectivenessFor(sb as any, "u1");

    expect(res.written).toBeGreaterThan(0);
    const rows = sb.upserted[0]!;
    const bySubjectType = new Map(rows.map((r) => [r["subject_type"], r]));
    expect(bySubjectType.has("exercise")).toBe(true); // per-slug (launch_exercise needs this)
    expect(bySubjectType.has("exercise_category")).toBe(true);
    expect(bySubjectType.get("exercise")!["subject_key"]).toBe("box-breathing");
    expect(bySubjectType.get("exercise")!["avg_mood_delta"]).toBeCloseTo(1.33, 1);
  });

  it("ignores an exercise with fewer than 3 usable completions", async () => {
    const sb = fakeClient([
      completion("worry-time", "worry", 2, 3),
      completion("worry-time", "worry", 2, 4),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test stub
    const res = await computeEffectivenessFor(sb as any, "u1");
    expect(res.written).toBe(0);
    expect(sb.upserted).toHaveLength(0);
  });
});
