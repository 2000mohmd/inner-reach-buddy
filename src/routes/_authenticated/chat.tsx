import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { LifeBuoy, Plus, Send, Trash2 } from "lucide-react";
import {
  createThread,
  deleteThread,
  getThreadHistory,
  listThreads,
  sendMessage,
} from "@/lib/chat.functions";
import { CRISIS_RESOURCES, CRISIS_DISCLAIMER } from "@/lib/crisis";
import { QUICK_ACTIONS } from "@/lib/quick-actions";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/chat")({
  head: () => ({
    meta: [
      { title: "Talk it through — Kalm companion" },
      {
        name: "description",
        content:
          "A warm AI companion that remembers your introduction, goals and recent check-ins — with crisis support built in.",
      },
      { property: "og:title", content: "Talk it through — Kalm companion" },
      {
        property: "og:description",
        content:
          "A warm AI companion that remembers your introduction, goals and recent check-ins — with crisis support built in.",
      },
    ],
  }),
  component: ChatPage,
});

function CrisisCard() {
  return (
    <div className="rounded-3xl border border-destructive/40 bg-destructive/5 p-5">
      <p className="flex items-center gap-2 font-semibold">
        <LifeBuoy className="size-4" aria-hidden /> Immediate support
      </p>
      <ul className="mt-3 space-y-2 text-sm">
        {CRISIS_RESOURCES.map((resource) => (
          <li key={resource.name}>
            <span className="font-medium">{resource.name}</span> — {resource.contact}
            <span className="block text-xs text-muted-foreground">{resource.detail}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">{CRISIS_DISCLAIMER}</p>
    </div>
  );
}

function ChatPage() {
  const queryClient = useQueryClient();
  const fetchThreads = useServerFn(listThreads);
  const fetchHistory = useServerFn(getThreadHistory);
  const newThread = useServerFn(createThread);
  const removeThread = useServerFn(deleteThread);
  const send = useServerFn(sendMessage);

  const [threadId, setThreadId] = useState<string | null>(null);
  const [quickAction, setQuickAction] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: threads } = useQuery({ queryKey: ["chat-threads"], queryFn: () => fetchThreads() });

  const { data: history } = useQuery({
    queryKey: ["chat-thread", threadId],
    queryFn: () => fetchHistory({ data: { thread_id: threadId as string } }),
    enabled: Boolean(threadId),
  });

  useEffect(() => {
    const first = threads?.[0];
    if (!threadId && first) setThreadId(first.id);
  }, [threadId, threads]);

  const messages = history?.messages ?? [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const mutation = useMutation({
    mutationFn: (text: string) =>
      send({
        data: {
          ...(threadId ? { thread_id: threadId } : {}),
          content: text,
          quick_action: quickAction,
        },
      }),
    onSuccess: async (result) => {
      setInput("");
      setQuickAction(null);
      setThreadId(result.thread_id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["chat-threads"] }),
        queryClient.invalidateQueries({ queryKey: ["chat-thread", result.thread_id] }),
      ]);
    },
    onError: (error: Error) =>
      toast.error(error.message || "The companion couldn't reply. Please try again."),
  });

  const start = useMutation({
    mutationFn: () => newThread(),
    onSuccess: async (thread) => {
      setThreadId(thread.id);
      await queryClient.invalidateQueries({ queryKey: ["chat-threads"] });
    },
  });

  const drop = useMutation({
    mutationFn: (id: string) => removeThread({ data: { thread_id: id } }),
    onSuccess: async () => {
      setThreadId(null);
      await queryClient.invalidateQueries({ queryKey: ["chat-threads"] });
      toast.success("Conversation deleted.");
    },
  });

  function submit(text: string, action?: string | null) {
    const value = text.trim();
    if (!value || mutation.isPending) return;
    if (action !== undefined) setQuickAction(action);
    mutation.mutate(value);
  }

  return (
    <AppShell>
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <aside className="space-y-3">
          <Button
            variant="outline"
            className="w-full rounded-full"
            onClick={() => start.mutate()}
            disabled={start.isPending}
          >
            <Plus className="size-4" aria-hidden /> New conversation
          </Button>
          <ul className="space-y-1">
            {(threads ?? []).map((thread) => (
              <li key={thread.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setThreadId(thread.id)}
                  className={`flex-1 truncate rounded-2xl px-3 py-2 text-left text-sm ${
                    threadId === thread.id ? "bg-secondary" : "hover:bg-muted"
                  }`}
                >
                  {thread.title}
                </button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Delete conversation"
                  onClick={() => drop.mutate(thread.id)}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="space-y-4">
          <header>
            <h1 className="text-2xl sm:text-3xl">Talk it through</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Kalm remembers your introduction and recent check-ins. It's support, not therapy.
            </p>
          </header>

          <div className="surface-soft min-h-[320px] space-y-4 p-5">
            {messages.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Whenever you're ready. You can start with a quick action below.
              </p>
            )}
            {messages.map((message) =>
              message.sender === "system" ? (
                <div key={message.id} className="space-y-3">
                  <p className="rounded-3xl bg-card p-4 text-sm">{message.content}</p>
                  <CrisisCard />
                </div>
              ) : (
                <div
                  key={message.id}
                  className={`max-w-[85%] rounded-3xl px-4 py-3 text-sm ${
                    message.sender === "user"
                      ? "ml-auto bg-primary/10"
                      : "bg-card whitespace-pre-line"
                  }`}
                >
                  {message.content}
                </div>
              ),
            )}
            {mutation.isPending && (
              <p className="text-sm text-muted-foreground">Kalm is thinking…</p>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="flex flex-wrap gap-2">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.id}
                type="button"
                disabled={mutation.isPending}
                onClick={() => {
                  setQuickAction(action.id);
                  mutation.mutate(action.prompt);
                }}
                className="rounded-full border border-border bg-card px-3 py-2 text-xs hover:bg-muted disabled:opacity-50"
              >
                {action.label}
              </button>
            ))}
          </div>

          <div className="flex items-end gap-2">
            <Textarea
              rows={2}
              maxLength={4000}
              value={input}
              placeholder="What's on your mind?"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit(input, null);
                }
              }}
            />
            <Button
              className="rounded-full"
              disabled={!input.trim() || mutation.isPending}
              onClick={() => submit(input, null)}
            >
              <Send className="size-4" aria-hidden />
              <span className="sr-only">Send</span>
            </Button>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
