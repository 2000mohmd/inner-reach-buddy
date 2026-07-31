import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { HeartHandshake, X } from "lucide-react";
import { getNudges, updateNudge } from "@/lib/nudges.functions";
import { Button } from "@/components/ui/button";

/** Proactive coaching surface: trend-based nudges and the step-up pathway. */
export function NudgeFeed() {
  const queryClient = useQueryClient();
  const fetchNudges = useServerFn(getNudges);
  const patch = useServerFn(updateNudge);

  const { data } = useQuery({
    queryKey: ["nudges"],
    queryFn: () => fetchNudges({ data: { evaluate: true } }),
    staleTime: 5 * 60 * 1000,
  });

  const mutate = useMutation({
    mutationFn: (input: { id: string; dismiss?: boolean; acted_on?: boolean }) =>
      patch({ data: { id: input.id, dismiss: input.dismiss ?? false, ...(input.acted_on === undefined ? {} : { acted_on: input.acted_on }) } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["nudges"] }),
  });

  const nudges = data?.nudges ?? [];
  if (nudges.length === 0) return null;

  return (
    <div className="space-y-4">
      {nudges.map((nudge) => (
        <section
          key={nudge.id}
          className="rounded-3xl border border-primary/30 bg-secondary/40 p-6"
          aria-label="A note from Kalm"
        >
          <div className="flex items-start justify-between gap-4">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <HeartHandshake className="size-4 text-primary" aria-hidden /> A note from Kalm
            </p>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Dismiss"
              onClick={() => mutate.mutate({ id: nudge.id, dismiss: true })}
            >
              <X className="size-4" aria-hidden />
            </Button>
          </div>

          <p className="mt-3 whitespace-pre-line text-sm">{nudge.message}</p>

          {nudge.resources.length > 0 && (
            <ul className="mt-4 space-y-3 text-sm">
              {nudge.resources.map((resource) => (
                <li key={resource.id}>
                  <span className="font-medium">{resource.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {resource.description}
                  </span>
                  {resource.contact_or_url.startsWith("http") ? (
                    <a
                      href={resource.contact_or_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-semibold text-primary underline underline-offset-4"
                      onClick={() => mutate.mutate({ id: nudge.id, acted_on: true })}
                    >
                      {resource.contact_or_url.replace(/^https?:\/\//, "")}
                    </a>
                  ) : (
                    <span className="text-xs font-semibold text-primary">
                      {resource.contact_or_url}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 flex flex-wrap gap-3">
            {nudge.suggested_exercise_slug && (
              <Button
                asChild
                variant="outline"
                className="rounded-full"
                onClick={() => mutate.mutate({ id: nudge.id, acted_on: true })}
              >
                <Link to="/exercises">Try the exercise</Link>
              </Button>
            )}
            {nudge.trigger_type === "screener_step_up" && (
              <Button asChild variant="outline" className="rounded-full">
                <Link to="/care">See more support options</Link>
              </Button>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
