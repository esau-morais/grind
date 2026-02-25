import type {
  AiConfig,
  CalendarEvent,
  Conversation,
  PermissionReply,
  StoredMessage,
  SystemPromptContext,
  ThinkingConfig,
  TokenUsage,
  ToolContext,
} from "@grindxp/core";
import {
  createGrindTools,
  formatCalendarEventsText,
  getContextLimit,
  readGrindConfig,
  resolveModel,
  runAgent,
  writeGrindConfig,
} from "@grindxp/core";
import type { VaultDb } from "@grindxp/core";
import {
  appendMessage,
  appendPromptHistory,
  compactMessages,
  createConversation,
  deleteConversation,
  flushCompanionMemory,
  getConversationById,
  getConversationMessages,
  grantToolPermission,
  listConversations,
  storedToModelMessages,
  summarizeConversation,
} from "@grindxp/core/agent";
import { useRenderer } from "@opentui/react";
import type { LanguageModel, ModelMessage } from "ai";
import { useCallback, useEffect, useRef, useReducer, useState } from "react";
import { type CommandOption, SLASH_COMMANDS, THINK_LEVELS, type ThinkLevel } from "./lib/commands";
import {
  type ChatMessage,
  type ImageAttachment,
  type PermissionPrompt,
  ChatScreen,
} from "./screens/ChatScreen";
import { useTheme } from "./theme/context";

interface ChatAppProps {
  model: LanguageModel;
  aiConfig: AiConfig;
  toolCtx: ToolContext;
  promptCtx: SystemPromptContext;
  db: VaultDb;
  userId: string;
  provider?: string;
  autoCompact?: boolean;
  initialConversationId?: string;
  initialStoredMessages?: StoredMessage[];
  initialToolPermissions?: string[];
  initialPromptHistory?: string[];
}

const MAX_MODEL_MESSAGES = 40;
const COMPACT_KEEP = 6;
const COMPACT_RESERVE = 20_000;

type StreamingState = {
  isStreaming: boolean;
  streamingText: string;
  activeToolCall: string | null;
};
type StreamingAction =
  | { type: "start" }
  | { type: "text"; text: string }
  | { type: "tool-start"; name: string | null }
  | { type: "tool-done" }
  | { type: "finish" }
  | { type: "abort" };

const STREAMING_IDLE: StreamingState = {
  isStreaming: false,
  streamingText: "",
  activeToolCall: null,
};

function streamingReducer(_state: StreamingState, action: StreamingAction): StreamingState {
  switch (action.type) {
    case "start":
      return { isStreaming: true, streamingText: "", activeToolCall: null };
    case "text":
      return ((s) => ({ ...s, streamingText: action.text }))(_state);
    case "tool-start":
      return ((s) => ({ ...s, streamingText: "", activeToolCall: action.name }))(_state);
    case "tool-done":
      return ((s) => ({ ...s, activeToolCall: null }))(_state);
    case "finish":
      return STREAMING_IDLE;
    case "abort":
      return STREAMING_IDLE;
  }
}

const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
};

let msgCounter = 0;
function nextMsgId(): string {
  return `msg-${++msgCounter}`;
}

function sysMsg(content: string): ChatMessage {
  return { id: nextMsgId(), role: "system", content, timestamp: Date.now() };
}

function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function storedToChatMessages(stored: StoredMessage[]): ChatMessage[] {
  const sorted = [...stored].sort((a, b) => a.createdAt - b.createdAt);
  return sorted
    .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "tool")
    .map((m) => {
      if (m.role === "tool") {
        const tr =
          Array.isArray(m.toolResults) && m.toolResults.length > 0
            ? (m.toolResults[0] as Record<string, unknown>)
            : null;
        return {
          id: m.id,
          role: "tool" as const,
          content: m.content,
          timestamp: m.createdAt,
          ...(tr && typeof tr["toolName"] === "string"
            ? { toolName: tr["toolName"] as string }
            : {}),
          ...(tr && typeof tr["toolArgs"] === "string"
            ? { toolArgs: tr["toolArgs"] as string }
            : {}),
          ...(tr && typeof tr["diff"] === "string" ? { diff: tr["diff"] as string } : {}),
          ...(tr && typeof tr["code"] === "string" ? { code: tr["code"] as string } : {}),
          ...(tr && typeof tr["codeLang"] === "string"
            ? { codeLang: tr["codeLang"] as string }
            : {}),
        };
      }
      const labelPrefix = m.attachments?.length
        ? m.attachments.map((_, i) => `[Image ${i + 1}]`).join(" ") + " "
        : "";
      return {
        id: m.id,
        role: m.role as "user" | "assistant",
        content: labelPrefix + m.content,
        timestamp: m.createdAt,
      };
    });
}

export function ChatApp(props: ChatAppProps) {
  const { toolCtx, promptCtx, db, userId, provider, autoCompact: autoCompactProp } = props;
  const renderer = useRenderer();
  const { setTheme, themeName } = useTheme();

  const [model, setModel] = useState<LanguageModel>(props.model);
  const [aiConfig, setAiConfig] = useState<AiConfig>(props.aiConfig);
  const [modelOptions, setModelOptions] = useState<CommandOption[]>([]);

  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    props.initialStoredMessages ? storedToChatMessages(props.initialStoredMessages) : [],
  );
  const [streaming, dispatchStreaming] = useReducer(streamingReducer, STREAMING_IDLE);
  const { isStreaming, streamingText, activeToolCall } = streaming;
  const [conversationId, setConversationId] = useState<string | null>(
    () => props.initialConversationId ?? null,
  );
  const [modelMessages, setModelMessages] = useState<ModelMessage[]>(() =>
    props.initialStoredMessages ? storedToModelMessages(props.initialStoredMessages) : [],
  );
  const [sessionList, setSessionList] = useState<Conversation[] | null>(null);

  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [thinkLevel, setThinkLevel] = useState<ThinkLevel>("medium");

  const [sessionUsage, setSessionUsage] = useState<TokenUsage>({ ...EMPTY_USAGE });
  const [lastUsage, setLastUsage] = useState<TokenUsage>({ ...EMPTY_USAGE });
  const [autoCompactEnabled, setAutoCompactEnabled] = useState(autoCompactProp !== false);
  const [permissionPrompt, setPermissionPrompt] = useState<PermissionPrompt | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);

  const abortControllerRef = useRef<AbortController | null>(null);
  const attachmentsRef = useRef<ImageAttachment[]>([]);

  const modelId = typeof model === "string" ? model : model.modelId;
  const contextLimit = getContextLimit(model);

  const modelMessagesRef = useRef(modelMessages);
  const conversationIdRef = useRef(conversationId);
  const sessionUsageRef = useRef(sessionUsage);
  const permissionPromptRef = useRef(permissionPrompt);
  const isStreamingRef = useRef(isStreaming);

  useEffect(() => {
    modelMessagesRef.current = modelMessages;
    conversationIdRef.current = conversationId;
    sessionUsageRef.current = sessionUsage;
    permissionPromptRef.current = permissionPrompt;
    attachmentsRef.current = attachments;
    isStreamingRef.current = isStreaming;
  });

  useEffect(() => {
    if (props.initialConversationId && props.initialStoredMessages?.length) {
      setMessages((prev) => [...prev, sysMsg("Resumed previous session")]);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("https://models.dev/api.json");
        if (!res.ok) return;
        const data = (await res.json()) as Record<string, unknown>;
        const opts: CommandOption[] = [];
        for (const [providerKey, providerData] of Object.entries(data)) {
          if (!["anthropic", "openai", "google"].includes(providerKey)) continue;
          const pd = providerData as Record<string, unknown>;
          const models = pd.models as Record<string, unknown> | undefined;
          if (!models) continue;
          for (const [modelKey, modelData] of Object.entries(models)) {
            const md = modelData as Record<string, unknown>;
            if (!md.tool_call) continue;
            const modalities = md.modalities as Record<string, unknown> | undefined;
            const outputs = modalities?.output as string[] | undefined;
            if (!outputs?.includes("text")) continue;
            const name = typeof md.name === "string" ? md.name : modelKey;
            const limit = md.limit as Record<string, unknown> | undefined;
            const ctx =
              typeof limit?.context === "number" ? `${Math.round(limit.context / 1000)}K ctx` : "";
            const cost = md.cost as Record<string, unknown> | undefined;
            const inputCost = typeof cost?.input === "number" ? `$${cost.input}/M` : "";
            const descParts = [providerKey, ctx, inputCost].filter(Boolean);
            opts.push({
              name,
              description: descParts.join(" · "),
              value: `${providerKey}/${modelKey}`,
            });
          }
        }
        // Hardcoded ollama options (models.dev doesn't include ollama)
        opts.push(
          { name: "llama3.1", description: "ollama · local", value: "ollama/llama3.1" },
          { name: "llama3.2", description: "ollama · local", value: "ollama/llama3.2" },
          { name: "qwen2.5-coder", description: "ollama · local", value: "ollama/qwen2.5-coder" },
        );
        setModelOptions(opts);
      } catch {
        // silently ignore — model picker will just be empty
      }
    })();
  }, []);

  const pendingPermissionRef = useRef<{ resolve: (reply: PermissionReply) => void } | null>(null);
  const sessionPermissionsRef = useRef<Set<string>>(new Set(props.initialToolPermissions ?? []));

  const requestPermission = useCallback(
    async (toolName: string, detail: string): Promise<PermissionReply> => {
      if (process.env.GRIND_ALLOW_ALL_TOOLS === "1") return "once";
      if (sessionPermissionsRef.current.has(toolName)) return "once";
      return new Promise<PermissionReply>((resolve) => {
        pendingPermissionRef.current = { resolve };
        setPermissionPrompt({ toolName, detail });
      });
    },
    [],
  );

  const handlePermissionReply = useCallback(
    (reply: PermissionReply) => {
      const pending = pendingPermissionRef.current;
      const prompt = permissionPromptRef.current;
      if (!pending) return;
      if (reply === "always" && prompt) {
        sessionPermissionsRef.current.add(prompt.toolName);
        void grantToolPermission(db, userId, prompt.toolName);
      }
      pending.resolve(reply);
      pendingPermissionRef.current = null;
      setPermissionPrompt(null);
    },
    [db, userId],
  );

  const handleAbort = useCallback(() => {
    const controller = abortControllerRef.current;
    if (!controller) return;
    controller.abort();
    abortControllerRef.current = null;
    dispatchStreaming({ type: "abort" });
    setPendingMessage(null);
    setMessages((prev) => prev.filter((m) => !m.queued));
  }, []);

  const handleAttach = useCallback((a: ImageAttachment) => {
    setAttachments((prev) => [...prev, a]);
  }, []);

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const handleSessionSelect = useCallback(
    async (selectedId: string) => {
      const [conv, stored] = await Promise.all([
        getConversationById(db, selectedId),
        getConversationMessages(db, selectedId, 200),
      ]);
      const newModelMsgs = storedToModelMessages(stored);
      setMessages([
        ...storedToChatMessages(stored),
        sysMsg(`Resumed: ${conv?.title ?? "session"}`),
      ]);
      setModelMessages(newModelMsgs);
      modelMessagesRef.current = newModelMsgs;
      setConversationId(selectedId);
      conversationIdRef.current = selectedId;
      setSessionUsage({ ...EMPTY_USAGE });
      setLastUsage({ ...EMPTY_USAGE });
      setSessionList(null);
    },
    [db],
  );

  const handleSessionDismiss = useCallback(() => {
    setSessionList(null);
  }, []);

  const handleSessionDelete = useCallback(
    async (sessionId: string) => {
      await deleteConversation(db, sessionId);
      setSessionList((prev) => {
        const next = prev?.filter((c) => c.id !== sessionId) ?? null;
        return next && next.length > 0 ? next : null;
      });
      if (sessionId === conversationIdRef.current) {
        conversationIdRef.current = null;
        setConversationId(null);
        setMessages([sysMsg("Session deleted. Starting fresh.")]);
        setModelMessages([]);
        modelMessagesRef.current = [];
        setSessionUsage({ ...EMPTY_USAGE });
        setLastUsage({ ...EMPTY_USAGE });
      }
    },
    [db],
  );

  const handleExit = useCallback(() => {
    if (conversationIdRef.current) {
      process.stderr.write("\nSession saved. Use /save to flush memory to companion.\n");
    }
    renderer.destroy();
    process.exit(0);
  }, [renderer]);

  const runCompaction = useCallback(
    async (msgs: ModelMessage[], auto: boolean): Promise<ModelMessage[]> => {
      if (msgs.length <= COMPACT_KEEP) return msgs;

      try {
        setMessages((prev) => [
          ...prev,
          sysMsg(auto ? "Auto-compacting context..." : "Compacting context..."),
        ]);

        try {
          const flushResult = await flushCompanionMemory({
            model,
            messages: msgs,
            tools: createGrindTools(toolCtx),
          });
          if (flushResult.toolResultCount > 0) {
            setMessages((prev) => [
              ...prev,
              sysMsg(
                `Memory flush: stored ${flushResult.toolResultCount} update(s) before compaction.`,
              ),
            ]);
          }
        } catch {
          setMessages((prev) => [...prev, sysMsg("Memory flush failed, continuing compaction")]);
        }

        const summary = await summarizeConversation({
          model,
          messages: msgs,
        });

        const result = compactMessages({
          messages: msgs,
          keepCount: COMPACT_KEEP,
          summary,
        });

        setModelMessages(result.messages);
        modelMessagesRef.current = result.messages;
        setMessages((prev) => [
          ...prev,
          sysMsg(`Compacted: ${result.dropped} messages summarized. Context preserved.`),
        ]);

        return result.messages;
      } catch {
        const kept = msgs.slice(-COMPACT_KEEP);
        const removed = msgs.length - COMPACT_KEEP;
        setModelMessages(kept);
        modelMessagesRef.current = kept;
        setMessages((prev) => [
          ...prev,
          sysMsg(`Compacted: dropped ${removed} older messages (summarization unavailable)`),
        ]);
        return kept;
      }
    },
    [model, toolCtx],
  );

  const handleSend = useCallback(
    async (text: string) => {
      const imgs = attachmentsRef.current;
      setAttachments([]);

      if (text) void appendPromptHistory(db, userId, text).catch(() => {});

      if (isStreamingRef.current) {
        setPendingMessage(text);
        setMessages((prev) => [
          ...prev,
          { id: nextMsgId(), role: "user", content: text, timestamp: Date.now(), queued: true },
        ]);
        return;
      }

      let convId = conversationIdRef.current;
      if (!convId) {
        const conv = await createConversation(db, userId, text.slice(0, 50));
        convId = conv.id;
        setConversationId(convId);
        conversationIdRef.current = convId;
      }

      const labelPrefix = imgs.length > 0 ? imgs.map((a) => a.label).join(" ") + " " : "";
      const userMsg: ChatMessage = {
        id: nextMsgId(),
        role: "user",
        content: labelPrefix + text,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);

      await appendMessage(db, convId, {
        role: "user",
        content: text,
        ...(imgs.length > 0
          ? { attachments: imgs.map(({ mime, base64 }) => ({ mime, base64 })) }
          : {}),
      });

      const allModelMessages: ModelMessage[] = [
        ...modelMessagesRef.current,
        imgs.length > 0
          ? {
              role: "user" as const,
              content: [
                ...imgs.map((a) => ({
                  type: "image" as const,
                  image: a.base64,
                  mediaType: a.mime,
                })),
                { type: "text" as const, text },
              ],
            }
          : { role: "user" as const, content: text },
      ];
      const newModelMessages =
        allModelMessages.length > MAX_MODEL_MESSAGES
          ? allModelMessages.slice(-MAX_MODEL_MESSAGES)
          : allModelMessages;
      setModelMessages(newModelMessages);
      modelMessagesRef.current = newModelMessages;

      const controller = new AbortController();
      abortControllerRef.current = controller;

      dispatchStreaming({ type: "start" });

      let assistantText = "";
      const assistantParts: string[] = [];
      let wasAborted = false;
      const toolMsgs: ChatMessage[] = [];
      let stepUsage: TokenUsage = { ...EMPTY_USAGE };
      let pendingToolArgs: Record<string, unknown> | null = null;

      const thinking: ThinkingConfig | undefined = thinkingEnabled
        ? { enabled: true, budgetTokens: THINK_LEVELS[thinkLevel] }
        : undefined;

      try {
        const stream = runAgent({
          model,
          toolCtx,
          promptCtx,
          messages: newModelMessages,
          requestPermission,
          abortSignal: controller.signal,
          ...(provider ? { provider } : {}),
          ...(thinking ? { thinking } : {}),
        });

        const onAbortDuringStream = () => {
          stream.return(undefined as never);
        };
        controller.signal.addEventListener("abort", onAbortDuringStream, { once: true });

        try {
          for await (const event of stream) {
            if (controller.signal.aborted) break;
            switch (event.type) {
              case "text-delta":
                assistantText += event.text ?? "";
                dispatchStreaming({ type: "text", text: assistantText });
                break;

              case "tool-call":
                if (assistantText.trim()) {
                  const flushed = assistantText.trim();
                  assistantParts.push(flushed);
                  setMessages((prev) => [
                    ...prev,
                    {
                      id: nextMsgId(),
                      role: "assistant" as const,
                      content: flushed,
                      timestamp: Date.now(),
                    },
                  ]);
                  assistantText = "";
                }
                pendingToolArgs =
                  event.toolArgs != null && typeof event.toolArgs === "object"
                    ? (event.toolArgs as Record<string, unknown>)
                    : null;
                dispatchStreaming({ type: "tool-start", name: event.toolName ?? null });
                break;

              case "tool-result": {
                dispatchStreaming({ type: "tool-done" });
                const toolName = event.toolName ?? "unknown";
                const summary = formatToolResult(toolName, event.toolResult);
                const result =
                  event.toolResult !== null &&
                  event.toolResult !== undefined &&
                  typeof event.toolResult === "object"
                    ? (event.toolResult as Record<string, unknown>)
                    : null;
                const diff =
                  result && typeof result["diff"] === "string" ? result["diff"] : undefined;
                const codeAndLang = (() => {
                  if (!result) return undefined;
                  if (toolName === "bash") {
                    const stdout =
                      typeof result["stdout"] === "string" ? result["stdout"].trim() : "";
                    const stderr =
                      typeof result["stderr"] === "string" ? result["stderr"].trim() : "";
                    const combined = [stdout, stderr ? `[stderr]\n${stderr}` : ""]
                      .filter(Boolean)
                      .join("\n");
                    return combined ? { code: combined } : undefined;
                  }
                  if (toolName === "grep") {
                    const matches = result["matches"];
                    if (Array.isArray(matches) && matches.length > 0) {
                      const lines = (matches as Array<{ file: string; line: number; text: string }>)
                        .map((m) => `${m.file}:${m.line}: ${m.text}`)
                        .join("\n");
                      return { code: lines };
                    }
                    return undefined;
                  }
                  if (toolName === "glob") {
                    const files = result["files"];
                    if (Array.isArray(files) && files.length > 0) {
                      return { code: (files as string[]).join("\n") };
                    }
                    return undefined;
                  }
                  if (toolName === "get_calendar_events") {
                    const events = result["events"];
                    if (Array.isArray(events)) {
                      return {
                        code: formatCalendarEventsText(
                          events as CalendarEvent[],
                          promptCtx.timezone,
                        ),
                      };
                    }
                    return undefined;
                  }
                  return undefined;
                })();
                const argsStr = pendingToolArgs ? JSON.stringify(pendingToolArgs) : undefined;
                const toolMsg: ChatMessage = {
                  id: nextMsgId(),
                  role: "tool",
                  content: summary,
                  toolName,
                  timestamp: Date.now(),
                  ...(argsStr !== undefined ? { toolArgs: argsStr } : {}),
                  ...(diff !== undefined ? { diff } : {}),
                  ...(codeAndLang ?? {}),
                };
                toolMsgs.push(toolMsg);
                pendingToolArgs = null;
                setMessages((prev) => [...prev, ...toolMsgs.splice(0)]);
                void appendMessage(db, convId, {
                  role: "tool",
                  content: summary,
                  toolResults: [
                    {
                      toolName,
                      ...(argsStr !== undefined ? { toolArgs: argsStr } : {}),
                      ...(diff !== undefined ? { diff } : {}),
                      ...(codeAndLang !== undefined ? codeAndLang : {}),
                    },
                  ],
                });
                break;
              }

              case "step-finish": {
                const u = event.usage;
                if (u) {
                  stepUsage = addUsage(stepUsage, u);
                  setLastUsage(u);
                  setSessionUsage((prev) => addUsage(prev, u));
                }
                break;
              }

              case "reasoning":
                break;

              case "error":
                assistantText += `\n[Error: ${event.error}]`;
                dispatchStreaming({ type: "text", text: assistantText });
                break;

              case "done":
                break;
            }
          }
        } finally {
          controller.signal.removeEventListener("abort", onAbortDuringStream);
        }

        if (controller.signal.aborted) wasAborted = true;
      } catch (err) {
        if (controller.signal.aborted) {
          wasAborted = true;
        } else {
          assistantText += `\n[Error: ${err instanceof Error ? err.message : String(err)}]`;
        }
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }

      if (assistantText.trim()) {
        assistantParts.push(assistantText.trim());
        const assistantMsg: ChatMessage = {
          id: nextMsgId(),
          role: "assistant",
          content: assistantText.trim(),
          timestamp: Date.now(),
          ...(wasAborted ? { interrupted: true } : {}),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      }

      const fullAssistantText = assistantParts.join("\n\n");
      if (fullAssistantText) {
        await appendMessage(db, convId, { role: "assistant", content: fullAssistantText });

        const updated = [
          ...modelMessagesRef.current,
          { role: "assistant" as const, content: fullAssistantText },
        ];
        setModelMessages(updated);
        modelMessagesRef.current = updated;
      }

      // Only clear streaming state if no new stream has started (e.g. from pendingMessage).
      // handleAbort sets isStreaming=false synchronously, which can trigger pendingMessage
      // to start a new handleSend before this finally block runs. Guard against clobbering.
      if (abortControllerRef.current === null) {
        dispatchStreaming({ type: "finish" });
      }

      if (stepUsage.totalTokens > 0) {
        const usable = contextLimit - COMPACT_RESERVE;
        if (stepUsage.totalTokens >= usable) {
          if (autoCompactEnabled) {
            await runCompaction(modelMessagesRef.current, true);
          } else {
            const pct = Math.round((stepUsage.totalTokens / contextLimit) * 100);
            setMessages((prev) => [
              ...prev,
              sysMsg(`Context ${pct}% full. Use /compact to free space.`),
            ]);
          }
        }
      }
    },
    [
      model,
      toolCtx,
      promptCtx,
      db,
      userId,
      thinkingEnabled,
      thinkLevel,
      provider,
      contextLimit,
      autoCompactEnabled,
      runCompaction,
      requestPermission,
    ],
  );

  useEffect(() => {
    if (!isStreaming && pendingMessage) {
      const msg = pendingMessage;
      setPendingMessage(null);
      setMessages((prev) => prev.map((m) => (m.queued ? { ...m, queued: false } : m)));
      handleSend(msg);
    }
  }, [isStreaming, pendingMessage, handleSend]);

  const handleCommand = useCallback(
    (name: string, arg?: string) => {
      switch (name) {
        case "thinking": {
          const next = !thinkingEnabled;
          setThinkingEnabled(next);
          setMessages((prev) => [
            ...prev,
            sysMsg(
              next ? `Extended thinking enabled (${thinkLevel})` : "Extended thinking disabled",
            ),
          ]);
          break;
        }
        case "think": {
          if (arg && arg in THINK_LEVELS) {
            const level = arg as ThinkLevel;
            setThinkLevel(level);
            setThinkingEnabled(true);
            setMessages((prev) => [
              ...prev,
              sysMsg(`Thinking: ${level} (~${THINK_LEVELS[level].toLocaleString()} tokens)`),
            ]);
          }
          break;
        }
        case "new": {
          const snapshot = [...modelMessagesRef.current];
          setMessages([sysMsg("New conversation started")]);
          setModelMessages([]);
          modelMessagesRef.current = [];
          setConversationId(null);
          conversationIdRef.current = null;
          setSessionUsage({ ...EMPTY_USAGE });
          setLastUsage({ ...EMPTY_USAGE });
          if (snapshot.length > 0) {
            void flushCompanionMemory({
              model,
              messages: snapshot,
              tools: createGrindTools(toolCtx),
            })
              .then((flush) => {
                if (flush.toolResultCount > 0) {
                  setMessages((prev) => [
                    ...prev,
                    sysMsg(`Previous session: ${flush.toolResultCount} insight(s) saved to memory`),
                  ]);
                }
              })
              .catch(() => {});
          }
          break;
        }
        case "sessions": {
          void (async () => {
            const convos = await listConversations(db, userId, 20);
            if (convos.length === 0) {
              setMessages((prev) => [...prev, sysMsg("No past sessions found")]);
              return;
            }
            setSessionList(convos);
          })();
          break;
        }
        case "clear": {
          setMessages([sysMsg("Conversation cleared")]);
          setModelMessages([]);
          modelMessagesRef.current = [];
          setConversationId(null);
          conversationIdRef.current = null;
          setSessionUsage({ ...EMPTY_USAGE });
          setLastUsage({ ...EMPTY_USAGE });
          break;
        }
        case "save": {
          void (async () => {
            const msgs = modelMessagesRef.current;
            if (msgs.length === 0) {
              setMessages((prev) => [...prev, sysMsg("Nothing to save")]);
              return;
            }
            setMessages((prev) => [...prev, sysMsg("Saving memory...")]);
            try {
              const flush = await flushCompanionMemory({
                model,
                messages: msgs,
                tools: createGrindTools(toolCtx),
              });
              if (flush.toolResultCount > 0) {
                setMessages((prev) => [
                  ...prev,
                  sysMsg(`Memory flush: ${flush.toolResultCount} update(s) saved`),
                ]);
              } else {
                setMessages((prev) => [...prev, sysMsg("Memory flush: nothing new to save")]);
              }
            } catch {
              setMessages((prev) => [...prev, sysMsg("Memory flush failed")]);
            }
          })();
          break;
        }
        case "compact": {
          const cur = modelMessagesRef.current;
          if (cur.length <= COMPACT_KEEP) {
            setMessages((prev) => [...prev, sysMsg("Nothing to compact")]);
            return;
          }
          void runCompaction(cur, false);
          break;
        }
        case "autocompact": {
          const next = !autoCompactEnabled;
          setAutoCompactEnabled(next);
          setMessages((prev) => [...prev, sysMsg(`Auto-compact ${next ? "enabled" : "disabled"}`)]);
          break;
        }
        case "usage": {
          const s = sessionUsageRef.current;
          const l = lastUsage;
          const lines = [
            `Session tokens: ${formatTokenCount(s.totalTokens)}`,
            `  Input:     ${formatTokenCount(s.inputTokens)}`,
            `  Output:    ${formatTokenCount(s.outputTokens)}`,
            ...(s.reasoningTokens > 0
              ? [`  Reasoning: ${formatTokenCount(s.reasoningTokens)}`]
              : []),
            ...(s.cacheReadTokens > 0 || s.cacheWriteTokens > 0
              ? [
                  `  Cache R:   ${formatTokenCount(s.cacheReadTokens)}`,
                  `  Cache W:   ${formatTokenCount(s.cacheWriteTokens)}`,
                ]
              : []),
            "",
            `Last turn: ${formatTokenCount(l.inputTokens)} in / ${formatTokenCount(l.outputTokens)} out`,
            `Context limit: ${formatTokenCount(contextLimit)} | Auto-compact: ${autoCompactEnabled ? "on" : "off"}`,
          ];
          setMessages((prev) => [...prev, sysMsg(lines.join("\n"))]);
          break;
        }
        case "model": {
          if (arg) {
            const slashIdx = arg.indexOf("/");
            const newProvider = slashIdx !== -1 ? arg.slice(0, slashIdx) : aiConfig.provider;
            const newModelId = slashIdx !== -1 ? arg.slice(slashIdx + 1) : arg;
            const newAiConfig: AiConfig = {
              ...aiConfig,
              ...(newProvider ? { provider: newProvider as AiConfig["provider"] } : {}),
              model: newModelId,
            };
            void resolveModel(newAiConfig)
              .then((resolved) => {
                setModel(resolved);
                setAiConfig(newAiConfig);
                const cfg = readGrindConfig();
                if (cfg) writeGrindConfig({ ...cfg, ai: newAiConfig });
                setMessages((prev) => [...prev, sysMsg(`Model: ${arg}`)]);
              })
              .catch((err: unknown) => {
                setMessages((prev) => [
                  ...prev,
                  sysMsg(
                    `Failed to switch model: ${err instanceof Error ? err.message : String(err)}`,
                  ),
                ]);
              });
          } else {
            setMessages((prev) => [...prev, sysMsg(`Model: ${modelId}`)]);
          }
          break;
        }
        case "theme": {
          if (arg) {
            setTheme(arg);
            const cfg = readGrindConfig();
            if (cfg) {
              writeGrindConfig({ ...cfg, theme: arg });
            }
            setMessages((prev) => [...prev, sysMsg(`Theme: ${arg}`)]);
          }
          break;
        }
        case "help": {
          const lines = SLASH_COMMANDS.map((c) => `  /${c.name}  ${c.description}`).join("\n");
          setMessages((prev) => [...prev, sysMsg(`Commands:\n${lines}`)]);
          break;
        }
      }
    },
    [
      thinkingEnabled,
      thinkLevel,
      modelId,
      aiConfig,
      autoCompactEnabled,
      contextLimit,
      lastUsage,
      runCompaction,
    ],
  );

  const companionName = promptCtx.companion?.name?.trim() || undefined;

  return (
    <ChatScreen
      messages={messages}
      isStreaming={isStreaming}
      streamingText={streamingText}
      activeToolCall={activeToolCall}
      onSend={handleSend}
      onCommand={handleCommand}
      onExit={handleExit}
      thinkingEnabled={thinkingEnabled}
      thinkLevel={thinkLevel}
      modelId={modelId}
      sessionUsage={sessionUsage}
      lastUsage={lastUsage}
      autoCompact={autoCompactEnabled}
      permissionPrompt={permissionPrompt}
      onPermissionReply={handlePermissionReply}
      onAbort={handleAbort}
      sessionList={sessionList}
      onSessionSelect={handleSessionSelect}
      onSessionDismiss={handleSessionDismiss}
      onSessionDelete={handleSessionDelete}
      attachments={attachments}
      onAttach={handleAttach}
      onRemoveAttachment={handleRemoveAttachment}
      modelOptions={modelOptions}
      {...(companionName ? { companionName } : {})}
      {...(props.initialPromptHistory ? { initialPromptHistory: props.initialPromptHistory } : {})}
    />
  );
}

export function formatToolResult(name: string, result: unknown): string {
  if (result === null || result === undefined) return "done";

  const obj = result as Record<string, unknown>;

  if (obj.error) return String(obj.error);

  switch (name) {
    case "create_quest":
      return `Created "${obj.title}" (${obj.type}, ${obj.difficulty}, ${obj.baseXp} XP)`;
    case "complete_quest": {
      const parts = [`Completed "${obj.quest}" +${obj.xpEarned} XP`];
      if (obj.leveledUp) parts.push(`LEVEL UP -> ${obj.newLevel}!`);
      if (Array.isArray(obj.skillGains)) {
        for (const g of obj.skillGains as Array<Record<string, unknown>>) {
          const dots =
            "●".repeat(Math.min(Number(g.level) || 0, 5)) +
            "○".repeat(5 - Math.min(Number(g.level) || 0, 5));
          const lvl = g.leveledUp ? ` (-> Lv.${g.level}!)` : "";
          parts.push(`  ${g.name} ${dots} +${g.xpGained} XP${lvl}`);
        }
      }
      return parts.join("\n");
    }
    case "abandon_quest":
      return `Abandoned "${obj.quest}" — streak of ${obj.streakLost} days lost`;
    case "start_timer":
      return `Timer started for "${obj.quest}"`;
    case "stop_timer": {
      if (!obj.completed) return `Timer stopped for "${obj.quest}" — ${obj.elapsed}`;
      const parts = [
        `Timer stopped. "${obj.quest}" completed — ${obj.elapsed}, +${obj.xpEarned} XP`,
      ];
      if (Array.isArray(obj.skillGains)) {
        for (const g of obj.skillGains as Array<Record<string, unknown>>) {
          const dots =
            "●".repeat(Math.min(Number(g.level) || 0, 5)) +
            "○".repeat(5 - Math.min(Number(g.level) || 0, 5));
          const lvl = g.leveledUp ? ` (-> Lv.${g.level}!)` : "";
          parts.push(`  ${g.name} ${dots} +${g.xpGained} XP${lvl}`);
        }
      }
      return parts.join("\n");
    }
    case "get_calendar_events": {
      const n = typeof obj.count === "number" ? obj.count : 0;
      return `${n} event${n === 1 ? "" : "s"}`;
    }
    case "get_emails": {
      const n = typeof obj.count === "number" ? obj.count : 0;
      return `${n} email${n === 1 ? "" : "s"}`;
    }
    case "get_status":
      return `Lv.${obj.level} | ${obj.totalXp} XP | ${obj.activeQuests}/${obj.maxActiveQuests} active | streak: ${obj.bestStreak}d ${obj.streakTier}`;
    case "list_quests":
      if (Array.isArray(result))
        return `${result.length} quest${result.length === 1 ? "" : "s"} found`;
      return "quests listed";
    case "analyze_patterns":
      return `${obj.totalCompleted} completed, ${obj.completionRate} rate, best streak: ${obj.bestStreak}d`;
    case "suggest_quest":
      return `${obj.slotsAvailable} slots open, suggested difficulty: ${obj.suggestedDifficulty}`;
    case "list_forge_rules":
      return `${obj.count} forge rule${obj.count === 1 ? "" : "s"}`;
    case "list_forge_runs":
      return `${obj.count} forge run${obj.count === 1 ? "" : "s"}`;
    case "create_forge_rule": {
      const rule = obj.rule as Record<string, unknown> | undefined;
      if (rule?.name) {
        return `created forge rule "${rule.name}"`;
      }
      return "forge rule created";
    }
    case "update_forge_rule": {
      const rule = obj.rule as Record<string, unknown> | undefined;
      if (rule?.name) {
        return `updated forge rule "${rule.name}"`;
      }
      return "forge rule updated";
    }
    case "run_forge_rule": {
      const run = obj.run as Record<string, unknown> | undefined;
      const status = typeof run?.status === "string" ? run.status : "completed";
      return `forge run ${status}`;
    }
    case "delete_forge_rule": {
      const rule = obj.rule as Record<string, unknown> | undefined;
      if (rule?.name) {
        return `deleted forge rule "${rule.name}"`;
      }
      return "forge rule deleted";
    }
    case "list_insights":
      if (Array.isArray(result))
        return `${result.length} insight${result.length === 1 ? "" : "s"} listed`;
      return "insights listed";
    case "store_insight":
      return `${obj.created ? "stored" : "updated"} insight (${obj.category})`;
    case "update_insight":
      return `updated insight (${obj.category})`;
    case "update_user_context":
      return `context ${obj.updated ? "updated" : "unchanged"}`;
    case "fetch_url":
      return `fetched ${obj.url} (${String(obj.content).length} chars)`;
    case "web_search": {
      const results = obj.results as Array<Record<string, unknown>> | undefined;
      return `${results?.length ?? 0} results for "${obj.query}"`;
    }
    case "read_file":
      if (obj.type === "directory") return `${obj.total} entries in ${obj.path}`;
      return `${obj.totalLines} lines from ${obj.path} (${obj.showing})`;
    case "write_file":
      return `Wrote ${obj.lines} line${obj.lines === 1 ? "" : "s"} to ${obj.path}`;
    case "edit_file":
      return `Edited ${obj.path} (${obj.replacements} replacement${obj.replacements === 1 ? "" : "s"}, ${obj.matchType})`;
    case "glob":
      return `${obj.count} file${obj.count === 1 ? "" : "s"} matching ${obj.pattern}${obj.truncated ? " (truncated)" : ""}`;
    case "grep":
      return `${obj.totalMatches} match${obj.totalMatches === 1 ? "" : "es"} for "${obj.pattern}"${obj.truncated ? " (truncated)" : ""}`;
    case "bash": {
      const stderr = obj.stderr ? String(obj.stderr).replace(/\n/g, " ").trim() : "";
      const suffix = stderr ? ` | ${stderr.slice(0, 60)}${stderr.length > 60 ? "..." : ""}` : "";
      if (obj.error) return `${obj.error}${suffix}`;
      return `exit ${obj.exitCode}${suffix}`;
    }
    case "get_integrations_status": {
      const channels = obj.channels as Record<string, unknown> | undefined;
      const services = obj.services as Record<string, unknown> | undefined;
      const google = services?.google as Record<string, unknown> | undefined;
      const parts: string[] = [];
      if (google?.connected) {
        const calMark = google.calendarEnabled ? " cal ✓" : "";
        const gmailMark = google.gmailEnabled ? " gmail ✓" : "";
        const emailStr = typeof google.email === "string" ? ` (${google.email})` : "";
        parts.push(`google${emailStr}${calMark}${gmailMark}`);
      } else {
        parts.push("google: not connected");
      }
      if (channels?.gatewayConfigured) {
        const status = channels.gatewayEnabled ? "enabled" : "disabled";
        const tg = channels.telegram as Record<string, unknown> | undefined;
        const tgMark = tg?.connected ? " · telegram ✓" : "";
        parts.push(`gateway ${status}${tgMark}`);
      } else {
        parts.push("gateway: not configured");
      }
      return parts.join(" | ");
    }
    case "send_telegram_message":
      return `sent → telegram`;
    case "send_whatsapp_message":
      return `sent → whatsapp`;
    default: {
      if (typeof result !== "object" || result === null)
        return String(result ?? "done").slice(0, 80);
      const o = obj;
      if (o.ok === true) return typeof o.channel === "string" ? `sent → ${o.channel}` : "ok";
      if (o.ok === false)
        return `failed${typeof o.message === "string" ? `: ${String(o.message).slice(0, 60)}` : ""}`;
      if (o.success === true) return "ok";
      if (o.success === false)
        return `failed${typeof o.message === "string" ? `: ${String(o.message).slice(0, 60)}` : ""}`;
      if (typeof o.message === "string") return o.message.slice(0, 80);
      if (typeof o.status === "string") return o.status.slice(0, 80);
      const keys = Object.keys(o);
      if (keys.length === 0) return "done";
      return `{${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ", …" : ""}}`;
    }
  }
}
