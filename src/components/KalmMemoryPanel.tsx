import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { forgetMemory, getMyMemories } from "@/lib/memory.functions";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/**
 * Trust feature: shows the plain-language notes Kalm keeps about the person
 * (thread_summaries) and lets them remove any of them. View + delete only.
 */
export function KalmMemoryPanel() {
  const queryClient = useQueryClient();
  const fetchMemories = useServerFn(getMyMemories);
  const forget = useServerFn(forgetMemory);

  const { data, isPending } = useQuery({
    queryKey: ["kalm-memories"],
    queryFn: () => fetchMemories(),
  });

  const remove = useMutation({
    mutationFn: (id: string) => forget({ data: { id } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["kalm-memories"] });
      toast.success("Forgotten. Kalm won't use that in future conversations.");
    },
    onError: () => toast.error("We couldn't remove that just now. Please try again."),
  });

  const memories = data ?? [];

  return (
    <section className="surface-soft p-6">
      <h2 className="text-lg">What Kalm remembers about you</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        So it can pick up where you left off, Kalm writes itself a short private note at the end of
        each conversation — the gist of what you talked about. That's how it sounds like it
        remembers you. Here is every note it has kept. Remove anything you'd rather it forgot; it
        takes effect on your next conversation.
      </p>

      {isPending ? (
        <div className="mt-4 space-y-3">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
        </div>
      ) : memories.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Nothing yet — Kalm writes its first note after you've had a conversation or two.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {memories.map((memory) => (
            <li key={memory.id} className="rounded-2xl border border-border p-4">
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{memory.summary_text}</p>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">
                  {new Date(memory.created_at).toLocaleDateString()}
                </span>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                    >
                      Forget this
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Forget this note?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Kalm will stop using this in future conversations. This can't be undone,
                        though Kalm may write a fresh note after a later chat.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep it</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => remove.mutate(memory.id)}
                        disabled={remove.isPending}
                      >
                        Forget it
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
