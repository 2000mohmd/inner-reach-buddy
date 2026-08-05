import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getMyProfile } from "@/lib/onboarding.functions";

import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowUp,
  Leaf,
  LifeBuoy,
  Loader2,
  Mic,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Square,
  Trash2,
} from "lucide-react";
import {
  createThread,
  deleteThread,
  getThreadHistory,
  listThreads,
  sendMessage,
} from "@/lib/chat.functions";
import { transcribeVoiceNote } from "@/lib/voice.functions";
import type { CompanionAction } from "@/lib/companion-tools.server";
import { CRISIS_RESOURCES, CRISIS_DISCLAIMER } from "@/lib/crisis";
import { QUICK_ACTIONS } from "@/lib/quick-actions";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";

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
    <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-5">
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

/** Microphone capture → base64, so the server can transcribe the note. */
function useVoiceRecorder(onReady: (audio: string, mime: string) => void) {
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
    setRecording(false);
  }, []);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        if (blob.size === 0) return;
        const buffer = await blob.arrayBuffer();
        let binary = "";
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
        onReady(btoa(binary), recorder.mimeType.split(";")[0] ?? "audio/webm");
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      toast.error("Microphone access is blocked. Allow it in your browser settings.");
    }
  }, [onReady]);

  return { recording, start, stop };
}

function ChatPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fetchProfile = useServerFn(getMyProfile);
  const fetchThreads = useServerFn(listThreads);
  const fetchHistory = useServerFn(getThreadHistory);
  const newThread = useServerFn(createThread);
  const removeThread = useServerFn(deleteThread);
  const send = useServerFn(sendMessage);
  const transcribe = useServerFn(transcribeVoiceNote);

  const [threadId, setThreadId] = useState<string | null>(null);
  const [quickAction, setQuickAction] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [actions, setActions] = useState<CompanionAction[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Chat is the default authenticated landing page, so it also carries the
  // onboarding guard the old dashboard landing had.
  const { data: profileData } = useQuery({
    queryKey: ["my-profile"],
    queryFn: () => fetchProfile(),
  });

  useEffect(() => {
    if (profileData && !profileData.profile?.onboarding_completed) {
      navigate({ to: "/onboarding", replace: true });
    }
  }, [profileData, navigate]);

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
      setActions(result.reply.type === "message" ? result.reply.actions : []);
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

  const voice = useMutation({
    mutationFn: (payload: { audio: string; mime: string }) =>
      transcribe({ data: { audio_base64: payload.audio, mime_type: payload.mime } }),
    onSuccess: (result) => {
      mutation.mutate(result.text);
    },
    onError: (error: Error) => toast.error(error.message || "Couldn't transcribe that recording."),
  });

  const recorder = useVoiceRecorder((audio, mime) => voice.mutate({ audio, mime }));

  const start = useMutation({
    mutationFn: () => newThread(),
    onSuccess: async (thread) => {
      setThreadId(thread.id);
      setActions([]);
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

  function submit(text: string) {
    const value = text.trim();
    if (!value || mutation.isPending) return;
    setQuickAction(null);
    mutation.mutate(value);
  }

  const busy = mutation.isPending || voice.isPending;
  const empty = messages.length === 0;

  return (
    <AppShell>
      <div className="flex min-h-[calc(100vh-14rem)] gap-6">
        {/* Conversation rail — quiet, collapsible, like Claude's sidebar. */}
        {sidebarOpen && (
          <aside className="hidden w-56 shrink-0 flex-col gap-2 md:flex">
            <Button
              variant="outline"
              className="w-full justify-start rounded-xl"
              onClick={() => start.mutate()}
              disabled={start.isPending}
            >
              <Plus className="size-4" aria-hidden /> New chat
            </Button>
            <p className="px-2 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Recents
            </p>
            <ul className="space-y-0.5">
              {(threads ?? []).map((thread) => (
                <li key={thread.id} className="group flex items-center">
                  <button
                    type="button"
                    onClick={() => setThreadId(thread.id)}
                    className={`flex-1 truncate rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                      threadId === thread.id
                        ? "bg-secondary text-secondary-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    {thread.title}
                  </button>
                  <button
                    type="button"
                    aria-label="Delete conversation"
                    onClick={() => drop.mutate(thread.id)}
                    className="rounded-lg p-1.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        )}

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="mb-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSidebarOpen((open) => !open)}
              aria-label={sidebarOpen ? "Hide conversations" : "Show conversations"}
              className="hidden rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground md:block"
            >
              {sidebarOpen ? (
                <PanelLeftClose className="size-4" aria-hidden />
              ) : (
                <PanelLeftOpen className="size-4" aria-hidden />
              )}
            </button>
            <span className="text-xs text-muted-foreground">
              Support, not therapy — Kalm remembers your check-ins.
            </span>
          </div>

          {/* Transcript: assistant text sits plain on the page, user text in a soft bubble. */}
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-2xl space-y-7 pb-6">
              {empty && (
                <div className="flex flex-col items-center gap-4 py-16 text-center">
                  <span className="flex size-12 items-center justify-center rounded-2xl bg-secondary">
                    <Leaf className="size-6 text-primary" aria-hidden />
                  </span>
                  <h1 className="font-display text-3xl">
                    {profileData?.profile?.preferred_name
                      ? `Hi ${profileData.profile.preferred_name}.`
                      : "Hi there."}
                  </h1>
                  <p className="max-w-sm text-sm text-muted-foreground">
                    What's on your mind right now? Type it, or hold the mic and just talk.
                  </p>
                </div>
              )}

              {messages.map((message) =>
                message.sender === "system" ? (
                  <div key={message.id} className="space-y-3">
                    <p className="text-sm leading-relaxed">{message.content}</p>
                    <CrisisCard />
                  </div>
                ) : message.sender === "user" ? (
                  <div key={message.id} className="flex justify-end">
                    <p className="max-w-[85%] whitespace-pre-line rounded-2xl bg-secondary px-4 py-2.5 text-sm leading-relaxed text-secondary-foreground">
                      {message.content}
                    </p>
                  </div>
                ) : (
                  <div key={message.id} className="flex gap-3">
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/12">
                      <Leaf className="size-3.5 text-primary" aria-hidden />
                    </span>
                    <p className="min-w-0 flex-1 whitespace-pre-line text-[0.95rem] leading-7">
                      {message.content}
                    </p>
                  </div>
                ),
              )}

              {actions.length > 0 && (
                <div className="ml-10 space-y-2 rounded-2xl border border-primary/20 bg-primary/5 p-4">
                  {actions.map((action, index) => (
                    <div key={`${action.type}-${index}`} className="text-sm">
                      <p>{action.summary}</p>
                      {action.type === "exercise_launch" && (
                        <Link
                          to="/exercises"
                          className="mt-1 inline-block rounded-full bg-primary px-3 py-1.5 text-xs text-primary-foreground"
                        >
                          Open {action.title}
                        </Link>
                      )}
                      {action.type === "stepup_suggested" && (
                        <Link
                          to="/care"
                          className="mt-1 inline-block rounded-full border border-border bg-card px-3 py-1.5 text-xs"
                        >
                          See support options
                        </Link>
                      )}
                      {action.type === "screener_completed" && (
                        <>
                          <Link
                            to="/insights"
                            className="mt-1 inline-block rounded-full border border-border bg-card px-3 py-1.5 text-xs"
                          >
                            See your check-in history
                          </Link>
                          {action.crisis && (
                            <div className="mt-3">
                              <CrisisCard />
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {busy && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  {voice.isPending ? "Listening to your note…" : "Kalm is thinking…"}
                </p>
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          {/* Composer: single rounded card with mic + send inside, Claude-style. */}
          <div className="sticky bottom-0 mx-auto w-full max-w-2xl bg-background pt-2">
            <div className="rounded-3xl border border-border bg-card p-2 shadow-sm focus-within:border-primary/40">
              <textarea
                ref={inputRef}
                rows={2}
                maxLength={4000}
                value={input}
                placeholder="Message Kalm…"
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submit(input);
                  }
                }}
                className="max-h-40 w-full resize-none bg-transparent px-3 py-2 text-sm leading-6 outline-none placeholder:text-muted-foreground"
              />
              <div className="flex items-center justify-between gap-2 px-1 pb-0.5">
                <span className="pl-2 text-[0.7rem] text-muted-foreground">
                  {recorder.recording ? "Recording… tap stop when you're done" : "Enter to send"}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    aria-label={recorder.recording ? "Stop recording" : "Record a voice message"}
                    onClick={() => (recorder.recording ? recorder.stop() : recorder.start())}
                    disabled={busy}
                    className={`flex size-9 items-center justify-center rounded-full transition-colors disabled:opacity-40 ${
                      recorder.recording
                        ? "bg-destructive text-destructive-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    {recorder.recording ? (
                      <Square className="size-4" aria-hidden />
                    ) : (
                      <Mic className="size-4" aria-hidden />
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label="Send message"
                    disabled={!input.trim() || busy}
                    onClick={() => submit(input)}
                    className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
                  >
                    <ArrowUp className="size-4" aria-hidden />
                  </button>
                </div>
              </div>
            </div>

            {empty && (
              <div className="mt-3 flex flex-wrap justify-center gap-2 pb-1">
                {QUICK_ACTIONS.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setQuickAction(action.id);
                      mutation.mutate(action.prompt);
                    }}
                    className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
