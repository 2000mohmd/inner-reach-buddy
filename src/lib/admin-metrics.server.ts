// Aggregate admin analytics. Everything here reads across all users, so it is
// only ever reachable after the caller's admin role has been verified with the
// user-scoped client in admin.functions.ts.

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function emptyDays(count: number): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) out.push(dayKey(daysAgo(i)));
  return out;
}

export type OverviewMetrics = {
  users: { total: number; new7: number; new30: number; active7: number };
  messages: { last7: number; last30: number; byDay: { day: string; count: number }[] };
  exercises: { last7: number; last30: number };
  screeners: { last7: number; last30: number };
  mood: { byDay: { day: string; average: number | null; entries: number }[] };
  crisis: {
    bySeverity: { severity: string; count: number }[];
    byDay: { day: string; critical: number; high: number; moderate: number }[];
    unreviewed: number;
    last7: number;
  };
};

export async function fetchOverviewMetrics(): Promise<OverviewMetrics> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const since30 = daysAgo(30);
  const since7 = daysAgo(7);

  const [profiles, messages, exercises, screeners, moods, crisis, habitLogs] = await Promise.all([
    supabaseAdmin.from("profiles").select("id, created_at"),
    supabaseAdmin.from("chat_messages").select("user_id, created_at").gte("created_at", since30),
    supabaseAdmin
      .from("exercise_completions")
      .select("user_id, completed_at")
      .gte("completed_at", since30),
    supabaseAdmin.from("screener_responses").select("user_id, taken_at").gte("taken_at", since30),
    supabaseAdmin.from("mood_logs").select("user_id, score, logged_at").gte("logged_at", since30),
    supabaseAdmin.from("crisis_events").select("severity, reviewed, created_at").gte("created_at", since30),
    supabaseAdmin.from("habit_logs").select("user_id, logged_at").gte("logged_at", since30),
  ]);

  const profileRows = profiles.data ?? [];
  const messageRows = messages.data ?? [];
  const exerciseRows = exercises.data ?? [];
  const screenerRows = screeners.data ?? [];
  const moodRows = moods.data ?? [];
  const crisisRows = crisis.data ?? [];
  const habitRows = habitLogs.data ?? [];

  const active = new Set<string>();
  for (const row of messageRows) if (row.created_at >= since7) active.add(row.user_id);
  for (const row of exerciseRows) if (row.completed_at >= since7) active.add(row.user_id);
  for (const row of screenerRows) if (row.taken_at >= since7) active.add(row.user_id);
  for (const row of moodRows) if (row.logged_at >= since7) active.add(row.user_id);
  for (const row of habitRows) if (row.logged_at >= since7) active.add(row.user_id);

  const days = emptyDays(30);

  const messagesByDay = new Map(days.map((day) => [day, 0]));
  for (const row of messageRows) {
    const key = dayKey(row.created_at);
    if (messagesByDay.has(key)) messagesByDay.set(key, (messagesByDay.get(key) ?? 0) + 1);
  }

  const moodByDay = new Map(days.map((day) => [day, { sum: 0, count: 0 }]));
  for (const row of moodRows) {
    const bucket = moodByDay.get(dayKey(row.logged_at));
    if (bucket) {
      bucket.sum += row.score;
      bucket.count += 1;
    }
  }

  const crisisByDay = new Map<string, { critical: number; high: number; moderate: number }>(
    days.map((day) => [day, { critical: 0, high: 0, moderate: 0 }]),
  );
  const bySeverity = new Map<string, number>([
    ["critical", 0],
    ["high", 0],
    ["moderate", 0],
  ]);
  for (const row of crisisRows) {
    bySeverity.set(row.severity, (bySeverity.get(row.severity) ?? 0) + 1);
    const bucket = crisisByDay.get(dayKey(row.created_at));
    if (bucket && (row.severity === "critical" || row.severity === "high" || row.severity === "moderate")) {
      bucket[row.severity] += 1;
    }
  }

  const { count: unreviewed } = await supabaseAdmin
    .from("crisis_events")
    .select("id", { count: "exact", head: true })
    .eq("reviewed", false);

  return {
    users: {
      total: profileRows.length,
      new7: profileRows.filter((row) => row.created_at >= since7).length,
      new30: profileRows.filter((row) => row.created_at >= since30).length,
      active7: active.size,
    },
    messages: {
      last7: messageRows.filter((row) => row.created_at >= since7).length,
      last30: messageRows.length,
      byDay: days.map((day) => ({ day, count: messagesByDay.get(day) ?? 0 })),
    },
    exercises: {
      last7: exerciseRows.filter((row) => row.completed_at >= since7).length,
      last30: exerciseRows.length,
    },
    screeners: {
      last7: screenerRows.filter((row) => row.taken_at >= since7).length,
      last30: screenerRows.length,
    },
    mood: {
      byDay: days.map((day) => {
        const bucket = moodByDay.get(day) ?? { sum: 0, count: 0 };
        return {
          day,
          entries: bucket.count,
          average: bucket.count ? Math.round((bucket.sum / bucket.count) * 100) / 100 : null,
        };
      }),
    },
    crisis: {
      bySeverity: [...bySeverity.entries()].map(([severity, count]) => ({ severity, count })),
      byDay: days.map((day) => ({ day, ...(crisisByDay.get(day) ?? { critical: 0, high: 0, moderate: 0 }) })),
      unreviewed: unreviewed ?? 0,
      last7: crisisRows.filter((row) => row.created_at >= since7).length,
    },
  };
}

export type AdminUserRow = {
  id: string;
  preferred_name: string | null;
  account_type: string;
  created_at: string;
  last_active_at: string | null;
  engagement: "active_week" | "quiet_2w" | "quiet_month" | "never";
  crisis_count: number;
};

function engagementFor(lastActive: string | null): AdminUserRow["engagement"] {
  if (!lastActive) return "never";
  const ageDays = (Date.now() - new Date(lastActive).getTime()) / 86_400_000;
  if (ageDays <= 7) return "active_week";
  if (ageDays <= 28) return "quiet_2w";
  return "quiet_month";
}

export async function fetchAdminUsers(): Promise<AdminUserRow[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const [profiles, messages, moods, exercises, habits, screeners, crisis] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("id, preferred_name, account_type, created_at")
      .order("created_at", { ascending: false })
      .limit(1000),
    supabaseAdmin.from("chat_messages").select("user_id, created_at"),
    supabaseAdmin.from("mood_logs").select("user_id, logged_at"),
    supabaseAdmin.from("exercise_completions").select("user_id, completed_at"),
    supabaseAdmin.from("habit_logs").select("user_id, logged_at"),
    supabaseAdmin.from("screener_responses").select("user_id, taken_at"),
    supabaseAdmin.from("crisis_events").select("user_id"),
  ]);

  const lastActive = new Map<string, string>();
  const touch = (userId: string, at: string) => {
    const current = lastActive.get(userId);
    if (!current || at > current) lastActive.set(userId, at);
  };
  for (const row of messages.data ?? []) touch(row.user_id, row.created_at);
  for (const row of moods.data ?? []) touch(row.user_id, row.logged_at);
  for (const row of exercises.data ?? []) touch(row.user_id, row.completed_at);
  for (const row of habits.data ?? []) touch(row.user_id, row.logged_at);
  for (const row of screeners.data ?? []) touch(row.user_id, row.taken_at);

  const crisisCounts = new Map<string, number>();
  for (const row of crisis.data ?? []) {
    crisisCounts.set(row.user_id, (crisisCounts.get(row.user_id) ?? 0) + 1);
  }

  return (profiles.data ?? []).map((profile) => {
    const active = lastActive.get(profile.id) ?? null;
    return {
      id: profile.id,
      preferred_name: profile.preferred_name,
      account_type: profile.account_type,
      created_at: profile.created_at,
      last_active_at: active,
      engagement: engagementFor(active),
      crisis_count: crisisCounts.get(profile.id) ?? 0,
    };
  });
}

export type AdminUserDetail = {
  profile: {
    id: string;
    preferred_name: string | null;
    account_type: string;
    subscription_tier: string;
    created_at: string;
    timezone: string | null;
    onboarding_completed: boolean;
  } | null;
  selfIntro: {
    intro_text: string | null;
    goals: string[];
    stressors: string[];
    existing_diagnosis: string | null;
    communication_preference: string | null;
    topics_to_avoid: string | null;
    in_professional_care: boolean;
  } | null;
  mood: { day: string; score: number }[];
  activity: {
    messages: number;
    exercises: number;
    habits: number;
    habitLogs: number;
    screeners: number;
    lastActive: string | null;
  };
  screeners: { screener_type: string; total_score: number; severity: string; taken_at: string }[];
  crisisEvents: {
    id: string;
    created_at: string;
    source: string;
    severity: string;
    matched_terms: string[];
    reviewed: boolean;
    notes: string | null;
  }[];
};

export async function fetchAdminUserDetail(userId: string): Promise<AdminUserDetail> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const [profile, userProfile, moods, messages, exercises, habits, habitLogs, screeners, crisis] =
    await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select(
          "id, preferred_name, account_type, subscription_tier, created_at, timezone, onboarding_completed",
        )
        .eq("id", userId)
        .maybeSingle(),
      supabaseAdmin
        .from("user_profiles")
        .select(
          "intro_text, goals, stressors, existing_diagnosis, communication_preference, topics_to_avoid, in_professional_care",
        )
        .eq("user_id", userId)
        .maybeSingle(),
      supabaseAdmin
        .from("mood_logs")
        .select("score, logged_at")
        .eq("user_id", userId)
        .gte("logged_at", daysAgo(60))
        .order("logged_at", { ascending: true }),
      supabaseAdmin.from("chat_messages").select("id", { count: "exact", head: true }).eq("user_id", userId),
      supabaseAdmin
        .from("exercise_completions")
        .select("completed_at")
        .eq("user_id", userId),
      supabaseAdmin.from("habits").select("id", { count: "exact", head: true }).eq("user_id", userId),
      supabaseAdmin.from("habit_logs").select("logged_at").eq("user_id", userId),
      supabaseAdmin
        .from("screener_responses")
        .select("screener_type, total_score, severity, taken_at")
        .eq("user_id", userId)
        .order("taken_at", { ascending: false })
        .limit(20),
      supabaseAdmin
        .from("crisis_events")
        .select("id, created_at, source, severity, matched_terms, reviewed, notes")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

  const timestamps = [
    ...(exercises.data ?? []).map((row) => row.completed_at),
    ...(habitLogs.data ?? []).map((row) => row.logged_at),
    ...(moods.data ?? []).map((row) => row.logged_at),
    ...(screeners.data ?? []).map((row) => row.taken_at),
  ].sort();

  return {
    profile: profile.data ?? null,
    selfIntro: userProfile.data
      ? {
          ...userProfile.data,
          goals: userProfile.data.goals ?? [],
          stressors: userProfile.data.stressors ?? [],
        }
      : null,
    mood: (moods.data ?? []).map((row) => ({ day: dayKey(row.logged_at), score: row.score })),
    activity: {
      messages: messages.count ?? 0,
      exercises: (exercises.data ?? []).length,
      habits: habits.count ?? 0,
      habitLogs: (habitLogs.data ?? []).length,
      screeners: (screeners.data ?? []).length,
      lastActive: timestamps.length ? (timestamps[timestamps.length - 1] ?? null) : null,
    },
    screeners: screeners.data ?? [],
    crisisEvents: (crisis.data ?? []).map((row) => ({
      ...row,
      matched_terms: row.matched_terms ?? [],
      notes: row.notes ?? null,
    })),
  };
}
