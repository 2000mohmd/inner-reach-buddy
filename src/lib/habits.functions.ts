import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const SUGGESTED_HABITS = [
  { name: "Sleep 7+ hours", category: "sleep", frequency_target: 7 },
  { name: "Move my body", category: "exercise", frequency_target: 4 },
  { name: "Drink enough water", category: "water", frequency_target: 7 },
  { name: "Take medication", category: "medication", frequency_target: 7 },
] as const;

const HabitInput = z.object({
  name: z.string().trim().min(1).max(80),
  category: z.string().trim().max(40).optional().default(""),
  frequency_target: z.number().int().min(1).max(7).default(7),
});

const HabitUpdateInput = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80).optional(),
  category: z.string().trim().max(40).optional(),
  frequency_target: z.number().int().min(1).max(7).optional(),
  is_active: z.boolean().optional(),
});

const LogInput = z.object({
  habit_id: z.string().uuid(),
  log_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  completed: z.boolean().default(true),
  note: z.string().trim().max(300).optional().default(""),
});

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

export const listHabits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const since = new Date();
    since.setDate(since.getDate() - 29);

    const [habits, logs] = await Promise.all([
      supabase
        .from("habits")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: true }),
      supabase
        .from("habit_logs")
        .select("id, habit_id, log_date, completed, note")
        .eq("user_id", userId)
        .gte("log_date", isoDay(since))
        .order("log_date", { ascending: false }),
    ]);

    if (habits.error) throw habits.error;
    if (logs.error) throw logs.error;

    return { habits: habits.data ?? [], logs: logs.data ?? [], today: isoDay(new Date()) };
  });

export const createHabit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => HabitInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: habit, error } = await supabase
      .from("habits")
      .insert({
        user_id: userId,
        name: data.name,
        category: data.category || null,
        frequency_target: data.frequency_target,
      })
      .select()
      .single();
    if (error) throw error;
    return habit;
  });

export const updateHabit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => HabitUpdateInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { id, ...patch } = data;
    const { error } = await supabase
      .from("habits")
      .update({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.category !== undefined ? { category: patch.category || null } : {}),
        ...(patch.frequency_target !== undefined
          ? { frequency_target: patch.frequency_target }
          : {}),
        ...(patch.is_active !== undefined ? { is_active: patch.is_active } : {}),
      })
      .eq("id", id)
      .eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

export const deleteHabit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("habits")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

export const logHabit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => LogInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const day = data.log_date ?? isoDay(new Date());

    const owned = await supabase
      .from("habits")
      .select("id, name, category")
      .eq("id", data.habit_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (owned.error) throw owned.error;
    if (!owned.data) throw new Error("Habit not found");

    if (!data.completed) {
      const { error } = await supabase
        .from("habit_logs")
        .delete()
        .eq("habit_id", data.habit_id)
        .eq("log_date", day)
        .eq("user_id", userId);
      if (error) throw error;
      return { ok: true, completed: false };
    }

    const { error } = await supabase.from("habit_logs").upsert(
      {
        habit_id: data.habit_id,
        user_id: userId,
        log_date: day,
        completed: true,
        note: data.note || null,
      },
      { onConflict: "habit_id,log_date" },
    );
    if (error) throw error;
    return { ok: true, completed: true };
  });

export const addSuggestedHabits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const existing = await supabase.from("habits").select("name").eq("user_id", userId);
    if (existing.error) throw existing.error;
    const taken = new Set((existing.data ?? []).map((row) => row.name));
    const rows = SUGGESTED_HABITS.filter((habit) => !taken.has(habit.name)).map((habit) => ({
      user_id: userId,
      name: habit.name,
      category: habit.category,
      frequency_target: habit.frequency_target,
    }));
    if (rows.length === 0) return { added: 0 };
    const { error } = await supabase.from("habits").insert(rows);
    if (error) throw error;
    return { added: rows.length };
  });

export type HabitMoodInsight = {
  habit_id: string;
  habit_name: string;
  daysWithHabit: number;
  daysWithoutHabit: number;
  avgMoodWithHabit: number | null;
  avgMoodWithoutHabit: number | null;
  delta: number | null;
  headline: string;
};

/** Correlates habit completion with mood scores over the last 30 days. */
export const getHabitMoodInsights = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const since = new Date();
    since.setDate(since.getDate() - 29);
    const sinceDay = isoDay(since);

    const [habits, logs, moods] = await Promise.all([
      supabase.from("habits").select("id, name").eq("user_id", userId).eq("is_active", true),
      supabase
        .from("habit_logs")
        .select("habit_id, log_date")
        .eq("user_id", userId)
        .eq("completed", true)
        .gte("log_date", sinceDay),
      supabase
        .from("mood_logs")
        .select("score, logged_at")
        .eq("user_id", userId)
        .gte("logged_at", `${sinceDay}T00:00:00Z`),
    ]);

    if (habits.error) throw habits.error;
    if (logs.error) throw logs.error;
    if (moods.error) throw moods.error;

    // Average mood per calendar day.
    const perDay = new Map<string, { total: number; count: number }>();
    for (const mood of moods.data ?? []) {
      const day = new Date(mood.logged_at).toISOString().slice(0, 10);
      const bucket = perDay.get(day) ?? { total: 0, count: 0 };
      bucket.total += mood.score;
      bucket.count += 1;
      perDay.set(day, bucket);
    }
    const moodDays = [...perDay.entries()].map(([day, bucket]) => ({
      day,
      score: bucket.total / bucket.count,
    }));

    const insights: HabitMoodInsight[] = [];

    for (const habit of habits.data ?? []) {
      const doneDays = new Set(
        (logs.data ?? []).filter((log) => log.habit_id === habit.id).map((log) => log.log_date),
      );
      const withHabit = moodDays.filter((entry) => doneDays.has(entry.day));
      const withoutHabit = moodDays.filter((entry) => !doneDays.has(entry.day));

      const avg = (rows: typeof moodDays) =>
        rows.length ? rows.reduce((total, row) => total + row.score, 0) / rows.length : null;

      const avgWith = avg(withHabit);
      const avgWithout = avg(withoutHabit);
      const enough = withHabit.length >= 3 && withoutHabit.length >= 3;
      const delta = enough && avgWith !== null && avgWithout !== null ? avgWith - avgWithout : null;

      let headline: string;
      if (!enough) {
        headline = `Keep logging — a few more days of data and we can look at how "${habit.name}" lines up with your mood.`;
      } else if (delta !== null && delta >= 0.4) {
        headline = `Your mood averages ${delta.toFixed(1)} points higher on days you log "${habit.name}".`;
      } else if (delta !== null && delta <= -0.4) {
        headline = `Your mood averages ${Math.abs(delta).toFixed(1)} points lower on days you log "${habit.name}" — worth a gentle look at what else is going on.`;
      } else {
        headline = `No clear mood difference yet between days with and without "${habit.name}".`;
      }

      insights.push({
        habit_id: habit.id,
        habit_name: habit.name,
        daysWithHabit: withHabit.length,
        daysWithoutHabit: withoutHabit.length,
        avgMoodWithHabit: avgWith,
        avgMoodWithoutHabit: avgWithout,
        delta,
        headline,
      });
    }

    insights.sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0));

    return {
      insights,
      moodDaysTracked: moodDays.length,
      note: "These are gentle observations, not clinical findings — correlation is not causation.",
    };
  });
