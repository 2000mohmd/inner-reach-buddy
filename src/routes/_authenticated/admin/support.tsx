import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { LifeBuoy, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getSupportThreadForAdmin,
  listSupportThreads,
  replyToSupportThread,
  setSupportThreadStatus,
} from "@/lib/admin-support.functions";
import { SUPPORT_STATUS_LABELS } from "@/lib/support.functions";

export const Route = createFileRoute("/_authenticated/admin/support")({
  head: () => ({
    meta: [
      { title: "Support inbox — Kalm admin" },
      {
        name: "description",
        content:
          "Internal inbox for account and product support threads from Kalm members, with replies and status tracking.",
      },
      { property: "og:title", content: "Support inbox — Kalm admin" },
      {
        property: "og:description",
        content: "Reply to member support threads and track their status.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminSupportPage,
});

function statusTone(status: string) {
  if (status === "open") return "bg-primary/10 text-primary";
  if (status === "in_progress") return "bg-accent/20 text-accent-foreground";
  return "bg-muted text-muted-foreground";
}

function AdminSupportPage() {
  const queryClient = useQueryClient();
  const fetchThreads = useServerFn(listSupportThreads);
  const fetchThread = useServerFn(getSupportThreadForAdmin);
  const reply = useServerFn(replyToSupportThread);
  const setStatus = useServerFn(setSupportThreadStatus);

  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const list = useQuery({
    queryKey: ["admin-support"],
    queryFn: () => fetchThreads(),
    retry: false,
  });

  const detail = useQuery({
    queryKey: ["admin-support-thread", selected],
    queryFn: () => fetchThread({ data: { thread_id: selected! } }),
    enabled: Boolean(selected),
    retry: false,
  });

  const sendReply = useMutation({
    mutationFn: (message: string) => reply({ data: { thread_id: selected!, message } }),
    onSuccess: async (result) => {
      setDraft("");
      toast.success(result.emailed ? "Reply sent and member emailed" : "Reply sent");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-support"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-support-thread", selected] }),
      ]);
    },
    onError: () => toast.error("Couldn't send that reply."),
  });

  const changeStatus = useMutation({
    mutationFn: (status: "open" | "in_progress" | "resolved") =>
      setStatus({ data: { thread_id: selected!, status } }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-support"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-support-thread", selected] }),
      ]);
    },
    onError: () => toast.error("Couldn't update the status."),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_1fr]">
      <section className="space-y-2">
        <header className="flex items-center gap-2 px-1">
          <LifeBuoy className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-display text-lg">Support inbox</h2>
          {list.data ? (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
              {list.data.openCount} active
            </span>
          ) : null}
        </header>

        {list.isLoading ? (
          <Skeleton className="h-40 w-full rounded-2xl" />
        ) : !list.data?.threads.length ? (
          <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
            No support threads yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {list.data.threads.map((thread) => (
              <li key={thread.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(thread.id);
                    setDraft("");
                  }}
                  className={`w-full rounded-2xl border p-3 text-left transition-colors ${
                    selected === thread.id
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:bg-muted/60"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">
                      {thread.preferred_name ?? "Member"}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] ${statusTone(thread.status)}`}
                    >
                      {SUPPORT_STATUS_LABELS[thread.status]}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-sm">{thread.subject}</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {thread.last_sender === "admin" ? "You: " : ""}
                    {thread.last_message ?? "No messages"}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground/80">
                    {new Date(thread.updated_at).toLocaleString()}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        {!selected ? (
          <p className="text-sm text-muted-foreground">
            Pick a thread to read the history and reply. Members are emailed a short excerpt with a
            link back into the app.
          </p>
        ) : detail.isLoading ? (
          <Skeleton className="h-64 w-full rounded-xl" />
        ) : detail.data ? (
          <div className="space-y-4">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
              <div>
                <h3 className="font-display text-lg">{detail.data.thread.subject}</h3>
                <p className="text-xs text-muted-foreground">
                  {detail.data.thread.preferred_name ?? "Member"} ·{" "}
                  {new Date(detail.data.thread.created_at).toLocaleDateString()}
                </p>
              </div>
              <Select
                value={detail.data.thread.status}
                onValueChange={(value) =>
                  changeStatus.mutate(value as "open" | "in_progress" | "resolved")
                }
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="in_progress">In progress</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                </SelectContent>
              </Select>
            </header>

            <ul className="space-y-3">
              {detail.data.messages.map((message) => (
                <li
                  key={message.id}
                  className={`rounded-2xl p-3 text-sm ${
                    message.sender === "admin"
                      ? "ml-8 bg-primary/10"
                      : "mr-8 border border-border bg-background"
                  }`}
                >
                  <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                    {message.sender === "admin"
                      ? "Kalm support"
                      : (detail.data.thread.preferred_name ?? "Member")}{" "}
                    · {new Date(message.created_at).toLocaleString()}
                  </p>
                  <p className="whitespace-pre-wrap">{message.content}</p>
                </li>
              ))}
            </ul>

            <div className="space-y-2 border-t border-border pt-3">
              <Textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Write a reply…"
                rows={4}
              />
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => sendReply.mutate(draft.trim())}
                  disabled={draft.trim().length < 2 || sendReply.isPending}
                >
                  {sendReply.isPending ? "Sending…" : "Send reply"}
                </Button>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Mail className="h-3 w-3" /> Member gets an excerpt by email
                </span>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">That thread isn't available.</p>
        )}
      </section>
    </div>
  );
}
