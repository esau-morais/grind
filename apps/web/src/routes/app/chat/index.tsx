import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useEffectEvent, useRef, useCallback } from "react";
import {
  LightningIcon,
  CopyIcon,
  CheckIcon,
  ScrollIcon,
  TimerIcon,
  CrosshairIcon,
  PlusCircleIcon,
} from "@phosphor-icons/react";
import { cn } from "#/lib/utils";
import {
  getConversations,
  loadConversationMessages,
  getCompanionInfo,
  getPromptHistoryEntries,
  appendPromptHistoryEntry,
} from "#/server/data.functions";
import { streamMessage } from "#/server/agent.functions";
import type { ConversationItem, CompanionInfo } from "#/server/data.functions";
import type { ChatMessage, ToolCallItem, ToolMessage } from "#/components/chat/message-bubble";
import { MessageBubble } from "#/components/chat/message-bubble";
import { ChatInput } from "#/components/chat/chat-input";
import type { Attachment } from "#/components/chat/chat-input";
import { ConversationSidebar } from "#/components/chat/conversation-sidebar";

function CopyCommandBlock({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [command]);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card pl-4 pr-3 py-3">
      <code className="flex-1 min-w-0 break-all font-mono text-sm text-grind-orange">
        {command}
      </code>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? "Copied" : `Copy command: ${command}`}
        className="flex shrink-0 items-center justify-center rounded-md p-1 text-muted-foreground [touch-action:manipulation] transition-[transform,background-color,color] duration-150 active:scale-[0.97] hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="relative flex size-4 items-center justify-center">
          <CopyIcon
            size={14}
            aria-hidden="true"
            className={cn(
              "absolute motion-safe:transition-opacity duration-200",
              copied ? "opacity-0" : "opacity-100",
            )}
          />
          <CheckIcon
            size={14}
            aria-hidden="true"
            className={cn(
              "absolute text-grind-xp motion-safe:transition-opacity duration-200",
              copied ? "opacity-100" : "opacity-0",
            )}
          />
        </span>
      </button>
    </div>
  );
}

function ChatMessagesSkeleton() {
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <div className="h-10 w-2/5 rounded-2xl rounded-tr-sm bg-muted animate-pulse" />
      </div>
      <div className="flex justify-start">
        <div className="w-4/5 rounded-2xl rounded-tl-sm border border-border/50 bg-card px-4 py-3 space-y-2">
          <div className="h-3 w-full rounded bg-muted animate-pulse" />
          <div className="h-3 w-5/6 rounded bg-muted animate-pulse" />
          <div className="h-3 w-3/4 rounded bg-muted animate-pulse" />
        </div>
      </div>
      <div className="flex justify-end">
        <div className="h-10 w-1/3 rounded-2xl rounded-tr-sm bg-muted animate-pulse" />
      </div>
      <div className="flex justify-start">
        <div className="w-3/5 rounded-2xl rounded-tl-sm border border-border/50 bg-card px-4 py-3 space-y-2">
          <div className="h-3 w-full rounded bg-muted animate-pulse" />
          <div className="h-3 w-4/5 rounded bg-muted animate-pulse" />
        </div>
      </div>
      <div className="flex justify-end">
        <div className="h-10 w-1/2 rounded-2xl rounded-tr-sm bg-muted animate-pulse" />
      </div>
    </div>
  );
}

function ChatPageSkeleton() {
  return (
    <div className="flex h-full overflow-hidden">
      <div className="hidden md:flex">
        <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-sidebar">
          <div className="flex h-14 items-center justify-end px-3">
            <div className="h-8 w-24 rounded-md bg-muted animate-pulse" />
          </div>
          <div className="flex-1 px-2 pt-2 pb-3 space-y-0.5">
            {[75, 60, 80, 55].map((w, i) => (
              <div key={i} className="flex flex-col gap-1 rounded-md px-3 py-2">
                <div className="h-3 rounded bg-muted animate-pulse" style={{ width: `${w}%` }} />
                <div className="h-2.5 w-10 rounded bg-muted animate-pulse" />
              </div>
            ))}
          </div>
        </aside>
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
          <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />
          <div className="flex flex-col gap-1.5">
            <div className="h-3.5 w-20 rounded bg-muted animate-pulse" />
            <div className="h-2.5 w-28 rounded bg-muted animate-pulse" />
          </div>
        </header>
        <div className="flex-1 overflow-hidden px-4 py-4">
          <ChatMessagesSkeleton />
        </div>
        <div className="shrink-0 border-t border-border p-3">
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-2">
            <div className="flex-1 h-9" />
            <div className="h-8 w-8 rounded-lg bg-muted animate-pulse" />
          </div>
          <p aria-hidden="true" className="mt-1.5 text-center text-[10px] text-muted-foreground">
            ⌘&nbsp;Return to send · Enter for newline
          </p>
        </div>
      </div>
    </div>
  );
}

function ChatError({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : "Something went wrong";
  const isNotInit = msg.includes("not initialized");

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full border border-border bg-card">
        <LightningIcon size={28} className="text-muted-foreground" aria-hidden="true" />
      </div>
      <div>
        <h1 className="text-lg font-semibold text-foreground">
          {isNotInit ? "Grind Not Initialized" : "Failed to Load Chat"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isNotInit ? "Run the command below in your terminal to get started." : msg}
        </p>
      </div>
      {isNotInit && <CopyCommandBlock command="grindxp init" />}
    </div>
  );
}

export const Route = createFileRoute("/app/chat/")({
  validateSearch: (search: Record<string, unknown>) => ({
    c: typeof search["c"] === "string" ? search["c"] : undefined,
  }),
  loader: () =>
    Promise.all([getConversations(), getCompanionInfo(), getPromptHistoryEntries()]).then(
      ([conversations, companion, promptHistory]) => ({
        conversations,
        companion,
        promptHistory,
      }),
    ),
  staleTime: Infinity,
  pendingComponent: ChatPageSkeleton,
  pendingMs: 0,
  pendingMinMs: 0,
  component: ChatPage,
  errorComponent: ChatError,
});

const SUGGESTED_PROMPTS = [
  {
    text: "What quests do I have active right now?",
    icon: (
      <ScrollIcon size={14} weight="duotone" className="text-grind-orange" aria-hidden="true" />
    ),
  },
  {
    text: "Log a 45-minute chest workout",
    icon: <TimerIcon size={14} weight="duotone" className="text-grind-orange" aria-hidden="true" />,
  },
  {
    text: "What should I focus on today?",
    icon: (
      <CrosshairIcon size={14} weight="duotone" className="text-grind-orange" aria-hidden="true" />
    ),
  },
  {
    text: "Create a new daily quest for morning reading",
    icon: (
      <PlusCircleIcon size={14} weight="duotone" className="text-grind-orange" aria-hidden="true" />
    ),
  },
];

function EmptyState({
  onPrompt,
  companion,
}: {
  onPrompt: (text: string) => void;
  companion: CompanionInfo;
}) {
  const name = companion.name ?? "Companion";
  const emoji = companion.emoji ?? "⚡";
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full border border-grind-orange/20 bg-grind-orange/10">
        <span aria-hidden="true" className="text-2xl">
          {emoji}
        </span>
      </div>
      <div>
        <h2 className="text-lg font-semibold text-foreground">{name}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your AI grind partner. Ask anything about your quests, skills, or goals.
        </p>
      </div>
      <div
        className="grid w-full max-w-lg grid-cols-1 gap-2 sm:grid-cols-2"
        role="list"
        aria-label="Suggested prompts"
      >
        {SUGGESTED_PROMPTS.map((prompt) => (
          <button
            key={prompt.text}
            type="button"
            role="listitem"
            onClick={() => onPrompt(prompt.text)}
            className="flex items-start gap-2.5 rounded-lg border border-border bg-card px-3.5 py-3 text-left text-sm text-foreground/80 [touch-action:manipulation] transition-colors duration-150 hover:border-ring/40 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="mt-0.5 shrink-0">{prompt.icon}</span>
            <span>{prompt.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ChatPage() {
  const { conversations: initialConversations, companion, promptHistory } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/app/chat/" });

  const [conversations, setConversations] = useState<ConversationItem[]>(initialConversations);
  const [activeConvId, setActiveConvId] = useState<string | undefined>(search.c);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(() => !!search.c);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const stoppedRef = useRef(false);
  const pendingFiredRef = useRef(false);

  const scrollToBottom = useCallback((behavior?: ScrollBehavior) => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const resolved =
      behavior ??
      (window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth");
    el.scrollTo({ top: el.scrollHeight, behavior: resolved });
  }, []);

  const onConversationChanged = useEffectEvent((convId: string | undefined) => {
    if (!convId) {
      setMessages([]);
      setActiveConvId(undefined);
      return;
    }
    if (isStreaming) return;
    setActiveConvId(convId);
    setIsLoadingHistory(true);
    setMessages([]);

    loadConversationMessages({ data: { conversationId: convId } })
      .then((stored) => {
        const loaded: ChatMessage[] = stored.map((m) => {
          if (m.role === "user") {
            return {
              role: "user" as const,
              id: m.id,
              content: m.content,
              ...(m.attachments && m.attachments.length > 0 ? { attachments: m.attachments } : {}),
            };
          }
          if (m.role === "tool") {
            let toolName = "unknown";
            if (m.toolResultsJson) {
              try {
                const parsed = JSON.parse(m.toolResultsJson) as Array<{ toolName?: string }>;
                toolName = parsed[0]?.toolName ?? "unknown";
              } catch {
                /* ignore */
              }
            }
            const msg: ToolMessage = { role: "tool", id: m.id, toolName, content: m.content };
            return msg;
          }
          return {
            role: "assistant" as const,
            id: m.id,
            content: m.content,
            toolCalls: [] as ToolCallItem[],
            isStreaming: false,
          };
        });
        setMessages(loaded);
        requestAnimationFrame(() => scrollToBottom("instant"));
      })
      .catch(() => {
        setMessages([]);
      })
      .finally(() => {
        setIsLoadingHistory(false);
      });
  });

  useEffect(() => {
    onConversationChanged(search.c);
  }, [search.c]);

  const handleSelectConversation = useCallback(
    (id: string) => {
      navigate({ search: { c: id } });
    },
    [navigate],
  );

  const handleNewConversation = useCallback(() => {
    navigate({ search: { c: undefined } });
  }, [navigate]);

  const executeSend = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-shadow
    async (msg: string, attachments: Attachment[] = []) => {
      stoppedRef.current = false;

      const userMsgId = crypto.randomUUID();
      const assistantMsgId = crypto.randomUUID();

      const userAttachments =
        attachments.length > 0
          ? attachments.map((a) => ({ mime: a.mime, base64: a.base64, filename: a.filename }))
          : undefined;

      setMessages((prev) => [
        ...prev,
        {
          role: "user" as const,
          id: userMsgId,
          content: msg,
          ...(userAttachments ? { attachments: userAttachments } : {}),
        },
        {
          role: "assistant" as const,
          id: assistantMsgId,
          content: "",
          toolCalls: [] as ToolCallItem[],
          isStreaming: true,
        },
      ]);
      requestAnimationFrame(() => scrollToBottom());
      setIsStreaming(true);

      try {
        const sendData: {
          message: string;
          conversationId?: string;
          attachments?: Array<{ mime: string; base64: string }>;
        } = { message: msg };
        if (activeConvId) sendData.conversationId = activeConvId;
        if (attachments.length > 0) {
          sendData.attachments = attachments.map((a) => ({ mime: a.mime, base64: a.base64 }));
        }

        const stream = await streamMessage({ data: sendData });

        for await (const event of stream) {
          if (stoppedRef.current) break;

          if (event.type === "conversation-id") {
            setActiveConvId(event.conversationId);
            navigate({ search: { c: event.conversationId }, replace: true });
          } else if (event.type === "text-delta") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId && m.role === "assistant"
                  ? { ...m, content: m.content + event.text }
                  : m,
              ),
            );
          } else if (event.type === "tool-call") {
            const newTc: ToolCallItem = {
              id: crypto.randomUUID(),
              toolName: event.toolName,
              toolArgsJson: event.toolArgsJson,
              status: "pending",
            };
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId && m.role === "assistant"
                  ? { ...m, toolCalls: [...m.toolCalls, newTc] }
                  : m,
              ),
            );
          } else if (event.type === "tool-result") {
            const resultToolName = event.toolName;
            const resultJson = event.toolResultJson;
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantMsgId || m.role !== "assistant") return m;
                let lastPendingIdx = -1;
                for (let i = m.toolCalls.length - 1; i >= 0; i--) {
                  const tc = m.toolCalls[i];
                  if (tc && tc.toolName === resultToolName && tc.status === "pending") {
                    lastPendingIdx = i;
                    break;
                  }
                }
                if (lastPendingIdx === -1) return m;
                const existingTc = m.toolCalls[lastPendingIdx];
                if (!existingTc) return m;
                const updatedTcs = [...m.toolCalls];
                updatedTcs[lastPendingIdx] = {
                  ...existingTc,
                  toolResultJson: resultJson,
                  status: "complete" as const,
                };
                return { ...m, toolCalls: updatedTcs };
              }),
            );
          } else if (event.type === "error") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId && m.role === "assistant"
                  ? { ...m, content: `⚠️ ${event.error}`, isStreaming: false }
                  : m,
              ),
            );
            setIsStreaming(false);
            return;
          } else if (event.type === "done") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId && m.role === "assistant"
                  ? { ...m, isStreaming: false }
                  : m,
              ),
            );
            setIsStreaming(false);
          }
        }
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) =>
            m.role === "assistant" && m.isStreaming
              ? { ...m, content: `⚠️ ${String(err)}`, isStreaming: false }
              : m,
          ),
        );
        setIsStreaming(false);
      }

      try {
        const updated = await getConversations();
        setConversations(updated);
      } catch {
        // ignore
      }
    },
    [activeConvId, navigate, scrollToBottom],
  );

  const triggerExecuteSend = useEffectEvent((msg: string) => {
    void executeSend(msg, []);
  });

  useEffect(() => {
    if (!isStreaming && pendingMessage) {
      if (pendingFiredRef.current) {
        pendingFiredRef.current = false;
        return;
      }
      pendingFiredRef.current = true;
      setPendingMessage(null);
      setMessages((prev) => prev.filter((m) => !(m.role === "user" && m.queued)));
      triggerExecuteSend(pendingMessage);
    }
  }, [isStreaming, pendingMessage]);

  const queueOrSend = useCallback(
    (msg: string, attachments: Attachment[] = []) => {
      if (!msg.trim() && attachments.length === 0) return;
      if (isStreaming) {
        if (pendingMessage !== null) return;
        setPendingMessage(msg);
        const queuedAttachments =
          attachments.length > 0
            ? attachments.map((a) => ({ mime: a.mime, base64: a.base64, filename: a.filename }))
            : undefined;
        setMessages((prev) => [
          ...prev,
          {
            role: "user" as const,
            id: crypto.randomUUID(),
            content: msg,
            queued: true,
            ...(queuedAttachments ? { attachments: queuedAttachments } : {}),
          },
        ]);
        requestAnimationFrame(() => scrollToBottom());
        return;
      }
      void executeSend(msg, attachments);
    },
    [isStreaming, pendingMessage, executeSend, scrollToBottom],
  );

  const handleSend = useCallback(
    (text: string, attachments: Attachment[] = []) => {
      const msg = text.trim();
      if (!msg && attachments.length === 0) return;
      if (msg) void appendPromptHistoryEntry({ data: { content: msg } }).catch(() => {});
      queueOrSend(msg, attachments);
    },
    [queueOrSend],
  );

  const handleStop = useCallback(() => {
    stoppedRef.current = true;
    setIsStreaming(false);
    setPendingMessage(null);
    pendingFiredRef.current = false;
    setMessages((prev) =>
      prev
        .map((m) => (m.role === "assistant" && m.isStreaming ? { ...m, isStreaming: false } : m))
        .filter((m) => !(m.role === "user" && m.queued)),
    );
  }, []);

  const handleCancelQueue = useCallback(() => {
    setPendingMessage(null);
    pendingFiredRef.current = false;
    setMessages((prev) => prev.filter((m) => !(m.role === "user" && m.queued)));
  }, []);

  const handlePromptClick = useCallback(
    (prompt: string) => {
      queueOrSend(prompt);
    },
    [queueOrSend],
  );

  const showEmptyState = messages.length === 0 && !isLoadingHistory;

  return (
    <div className="flex h-full overflow-hidden">
      <div className="hidden md:flex">
        <ConversationSidebar
          conversations={conversations}
          activeId={activeConvId}
          onSelect={handleSelectConversation}
          onNew={handleNewConversation}
        />
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header
          aria-label="Chat header"
          className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-grind-orange/10 border border-grind-orange/20">
            <span aria-hidden="true" className="text-base">
              {companion.emoji ?? "⚡"}
            </span>
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium text-foreground">
              {companion.name ?? "Companion"}
            </span>
            <span className="text-[10px] text-muted-foreground">AI-powered grind partner</span>
          </div>
        </header>

        <div
          ref={messagesContainerRef}
          className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
          role="log"
          aria-label="Chat messages"
          aria-live="polite"
          aria-atomic="false"
        >
          {isLoadingHistory && <ChatMessagesSkeleton />}

          {showEmptyState && !isLoadingHistory && (
            <EmptyState onPrompt={handlePromptClick} companion={companion} />
          )}

          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              companionEmoji={companion.emoji ?? "⚡"}
            />
          ))}

          <div aria-hidden="true" />
        </div>

        <div className="shrink-0 border-t border-border p-3">
          <ChatInput
            value={inputValue}
            onChange={setInputValue}
            onSubmit={handleSend}
            onStop={handleStop}
            onCancelQueue={handleCancelQueue}
            isStreaming={isStreaming}
            hasPendingMessage={pendingMessage !== null}
            initialHistory={promptHistory}
            {...(pendingMessage ? { pendingMessagePreview: pendingMessage } : {})}
          />
        </div>
      </div>
    </div>
  );
}
