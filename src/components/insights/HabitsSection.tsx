import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Check, Plus, Sparkles, Trash2 } from "lucide-react";
import {
  addSuggestedHabits,
  createHabit,
  deleteHabit,
  getHabitMoodInsights,
  listHabits,
  logHabit,
} from "@/lib/habits.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/lib/i18n";

function lastDays(count: number) {
  const days: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    days.push(date.toISOString().slice(0, 10));
  }
  return days;
}

/** Habit grid and habit/mood insights. Shared by /habits and /insights. */
export function HabitsSection({ showHeader = true }: { showHeader?: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const fetchHabits = useServerFn(listHabits);
  const fetchInsights = useServerFn(getHabitMoodInsights);
  const addHabit = useServerFn(createHabit);
  const removeHabit = useServerFn(deleteHabit);
  const toggleLog = useServerFn(logHabit);
  const seedHabits = useServerFn(addSuggestedHabits);

  const [name, setName] = useState("");
  const days = lastDays(7);

  const { data, isPending } = useQuery({ queryKey: ["habits"], queryFn: () => fetchHabits() });
  const { data: insightData } = useQuery({
    queryKey: ["habit-insights"],
    queryFn: () => fetchInsights(),
  });

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["habits"] }),
      queryClient.invalidateQueries({ queryKey: ["habit-insights"] }),
    ]);
  }

  const create = useMutation({
    mutationFn: () => addHabit({ data: { name, category: "", frequency_target: 7 } }),
    onSuccess: async () => {
      setName("");
      await refresh();
      toast.success(t("habits.added"));
    },
    onError: () => toast.error(t("habits.addFailed")),
  });

  const seed = useMutation({
    mutationFn: () => seedHabits(),
    onSuccess: async (result) => {
      await refresh();
      toast.success(
        result.added > 0
          ? t("habits.suggestedAdded", { count: result.added })
          : t("habits.suggestedAllPresent"),
      );
    },
  });

  const toggle = useMutation({
    mutationFn: (input: { habit_id: string; log_date: string; completed: boolean }) =>
      toggleLog({ data: input }),
    onSuccess: refresh,
    onError: () => toast.error(t("habits.saveFailed")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => removeHabit({ data: { id } }),
    onSuccess: async () => {
      await refresh();
      toast.success(t("habits.removed"));
    },
  });

  const habits = (data?.habits ?? []).filter((habit) => habit.is_active);
  const logs = data?.logs ?? [];
  const isDone = (habitId: string, day: string) =>
    logs.some((log) => log.habit_id === habitId && log.log_date === day && log.completed);

  return (
    <div className="space-y-8">
      {showHeader && (
        <header>
          <h1 className="text-3xl sm:text-4xl">{t("habits.title")}</h1>
          <p className="mt-2 text-muted-foreground">{t("habits.subtitle")}</p>
        </header>
      )}

      <section className="surface-soft p-6">
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            value={name}
            maxLength={80}
            placeholder={t("habits.addPlaceholder")}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && name.trim()) create.mutate();
            }}
          />
          <Button
            className="rounded-full px-5"
            disabled={!name.trim() || create.isPending}
            onClick={() => create.mutate()}
          >
            <Plus className="size-4" aria-hidden /> {t("habits.add")}
          </Button>
          <Button
            variant="outline"
            className="rounded-full px-5"
            disabled={seed.isPending}
            onClick={() => seed.mutate()}
          >
            <Sparkles className="size-4" aria-hidden /> {t("habits.suggested")}
          </Button>
        </div>
      </section>

      {isPending ? (
        <Skeleton className="h-56 w-full rounded-3xl" />
      ) : habits.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("habits.empty")}</p>
      ) : (
        <section className="surface-soft overflow-x-auto p-6">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-muted-foreground">
                <th className="pb-3 text-left font-normal">{t("habits.habitColumn")}</th>
                {days.map((day) => (
                  <th key={day} className="pb-3 text-center text-xs font-normal">
                    {new Date(`${day}T00:00:00`).toLocaleDateString(undefined, {
                      weekday: "narrow",
                    })}
                  </th>
                ))}
                <th className="pb-3" />
              </tr>
            </thead>
            <tbody>
              {habits.map((habit) => (
                <tr key={habit.id} className="border-t border-border/60">
                  <td className="py-3 pr-4">
                    <span className="font-medium">{habit.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {t("habits.perWeek", { count: habit.frequency_target })}
                    </span>
                  </td>
                  {days.map((day) => {
                    const done = isDone(habit.id, day);
                    return (
                      <td key={day} className="py-2 text-center">
                        <button
                          type="button"
                          aria-label={`${habit.name} — ${day}`}
                          aria-pressed={done}
                          onClick={() =>
                            toggle.mutate({
                              habit_id: habit.id,
                              log_date: day,
                              completed: !done,
                            })
                          }
                          className={`mx-auto flex size-8 items-center justify-center rounded-full border ${
                            done
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-card hover:bg-muted"
                          }`}
                        >
                          {done ? <Check className="size-4" aria-hidden /> : null}
                        </button>
                      </td>
                    );
                  })}
                  <td className="py-2 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t("habits.deleteHabit", { name: habit.name })}
                      onClick={() => remove.mutate(habit.id)}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="surface-soft p-6">
        <h2 className="text-xl">{t("habits.habitsAndMood")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{insightData?.note}</p>
        <ul className="mt-4 space-y-3 text-sm">
          {(insightData?.insights ?? []).map((insight) => (
            <li key={insight.habit_id} className="rounded-2xl bg-card p-4">
              {insight.headline}
              <span className="mt-1 block text-xs text-muted-foreground">
                {t("habits.daysLine", {
                  withCount: insight.daysWithHabit,
                  withoutCount: insight.daysWithoutHabit,
                })}
              </span>
            </li>
          ))}
          {(insightData?.insights ?? []).length === 0 && (
            <li className="text-muted-foreground">{t("habits.insightsEmpty")}</li>
          )}
        </ul>
      </section>
    </div>
  );
}
