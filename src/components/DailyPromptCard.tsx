import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Sun } from "lucide-react";
import { answerDailyPrompt, getTodayPrompt } from "@/lib/daily-prompts.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/lib/i18n";

const TYPE_KEYS: Record<string, string> = {
  gratitude: "dailyPrompt.typeReflection",
  intention: "dailyPrompt.typeIntention",
  reflection: "dailyPrompt.typeReflection",
};

/**
 * A light daily ritual — optional, never scored, and deliberately separate
 * from mood check-ins and screeners.
 */
export function DailyPromptCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const fetchPrompt = useServerFn(getTodayPrompt);
  const answer = useServerFn(answerDailyPrompt);
  const [text, setText] = useState("");

  const { data } = useQuery({ queryKey: ["daily-prompt"], queryFn: () => fetchPrompt() });

  const save = useMutation({
    mutationFn: () =>
      answer({ data: { prompt_id: data?.prompt?.id as string, response_text: text.trim() } }),
    onSuccess: async () => {
      setText("");
      await queryClient.invalidateQueries({ queryKey: ["daily-prompt"] });
      toast.success(t("dailyPrompt.saved"));
    },
    onError: () => toast.error(t("dailyPrompt.saveFailed")),
  });

  const prompt = data?.prompt;
  if (!prompt) return null;

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-primary">
        <Sun className="size-3.5" aria-hidden />{" "}
        {t(TYPE_KEYS[prompt.prompt_type] ?? "dailyPrompt.typeToday")}
      </p>
      <p className="mt-2 text-sm leading-relaxed">{prompt.prompt_text}</p>

      {data.response ? (
        <p className="mt-3 whitespace-pre-line rounded-xl bg-secondary px-3 py-2 text-sm text-secondary-foreground">
          {data.response.response_text}
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          <Textarea
            rows={2}
            maxLength={2000}
            value={text}
            placeholder={t("dailyPrompt.placeholder")}
            onChange={(event) => setText(event.target.value)}
          />
          <Button
            size="sm"
            className="rounded-full px-4"
            disabled={!text.trim() || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      )}
    </section>
  );
}
