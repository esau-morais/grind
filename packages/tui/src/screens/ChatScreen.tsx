import type { Conversation, PermissionReply, TokenUsage } from "@grindxp/core";
import { RenderableEvents, SyntaxStyle, parseColor } from "@opentui/core";
import type { PasteEvent, TextareaRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEffectEvent } from "../lib/use-effect-event";
import {
  type CommandOption,
  type SlashCommand,
  findCommand,
  getGhostCompletion,
  matchCommands,
} from "../lib/commands";
import { levelTitle } from "../lib/format";
import { readClipboard, readImageFile } from "../lib/clipboard";
import { useStore } from "../lib/store";
import { useTheme } from "../theme/context";

const IMAGE_EXTS: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

const IMAGE_LABEL_RE = /\[Image \d+\] ?/g;
const IMAGE_LABEL_SPLIT = /(\[Image \d+\])/;

function guessFiletype(diffStr: string): string | undefined {
  const m = /^\+\+\+ b\/(.+)$/m.exec(diffStr);
  if (!m) return undefined;
  const ext = m[1]?.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    rs: "rust",
    go: "go",
    md: "markdown",
    json: "json",
    sh: "bash",
    css: "css",
    html: "html",
    toml: "toml",
    yaml: "yaml",
    yml: "yaml",
  };
  return ext ? map[ext] : undefined;
}

const COLLAPSED_LINES = 8;
const PROMPT_HISTORY_MAX = 100;

export interface ImageAttachment {
  id: string;
  filename: string;
  mime: string;
  base64: string;
  label: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolName?: string;
  toolArgs?: string;
  timestamp: number;
  queued?: boolean;
  interrupted?: boolean;
  diff?: string;
  code?: string;
  codeLang?: string;
}

export interface PermissionPrompt {
  toolName: string;
  detail: string;
}

interface ChatScreenProps {
  onSend: (text: string) => void;
  onCommand: (name: string, arg?: string) => void;
  onExit: () => void;
  onAbort: () => void;
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingText: string;
  activeToolCall: string | null;
  thinkingEnabled: boolean;
  thinkLevel: string;
  modelId: string;
  sessionUsage: TokenUsage;
  lastUsage: TokenUsage;
  autoCompact: boolean;
  permissionPrompt: PermissionPrompt | null;
  onPermissionReply: (reply: PermissionReply) => void;
  modelOptions: CommandOption[];
  sessionList: Conversation[] | null;
  onSessionSelect: (id: string) => void;
  onSessionDismiss: () => void;
  onSessionDelete: (id: string) => void;
  attachments: ImageAttachment[];
  onAttach: (a: ImageAttachment) => void;
  onRemoveAttachment: (id: string) => void;
  companionName?: string;
  initialPromptHistory?: string[];
}

function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function UserContent({ content }: { content: string }) {
  const {
    theme: { colors },
  } = useTheme();
  const parts = content.split(IMAGE_LABEL_SPLIT);
  return (
    <>
      {parts.map((part, i) =>
        IMAGE_LABEL_SPLIT.test(part) ? (
          <span key={i} fg={colors.streak}>
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

function parseToolArgs(msg: ChatMessage): Record<string, unknown> | null {
  if (!msg.toolArgs) return null;
  try {
    return JSON.parse(msg.toolArgs) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const TOOL_ICONS: Record<string, string> = {
  bash: "$",
  edit_file: "\u2190",
  write_file: "\u2190",
  read_file: "\u2192",
  glob: "\u2731",
  grep: "\u2731",
  fetch_url: "%",
  web_search: "\u25c8",
  create_quest: "+",
  complete_quest: "\u2713",
  abandon_quest: "\u00d7",
  start_timer: "\u25b6",
  stop_timer: "\u25a0",
  get_status: "\u25cf",
  list_quests: "\u2261",
  analyze_patterns: "\u223f",
  suggest_quest: "\u003f",
  list_forge_rules: "\u2699",
  list_forge_runs: "\u2237",
  create_forge_rule: "+",
  update_forge_rule: "\u2190",
  run_forge_rule: "\u25b6",
  delete_forge_rule: "\u00d7",
  get_integrations_status: "\u2299",
  send_telegram_message: "\u2192",
  send_whatsapp_message: "\u2192",
};

const BLOCK_TOOLS = new Set(["bash", "edit_file", "write_file"]);

function toolTitle(name: string, args: Record<string, unknown> | null): string {
  switch (name) {
    case "bash": {
      const desc = typeof args?.["description"] === "string" ? args["description"] : "Shell";
      return `# ${desc}`;
    }
    case "edit_file":
      return `\u2190 Edit ${typeof args?.["filePath"] === "string" ? normalizePath(args["filePath"] as string) : ""}`;
    case "write_file":
      return `\u2190 Wrote ${typeof args?.["filePath"] === "string" ? normalizePath(args["filePath"] as string) : ""}`;
    default:
      return name;
  }
}

function inlineLabel(name: string, args: Record<string, unknown> | null, content: string): string {
  const icon = TOOL_ICONS[name] ?? "\u2022";
  switch (name) {
    case "read_file":
      return `${icon} Read ${typeof args?.["filePath"] === "string" ? normalizePath(args["filePath"] as string) : content}`;
    case "glob":
      return `${icon} Glob "${typeof args?.["pattern"] === "string" ? args["pattern"] : ""}"  ${content}`;
    case "grep":
      return `${icon} Grep "${typeof args?.["pattern"] === "string" ? args["pattern"] : ""}"  ${content}`;
    case "fetch_url":
      return `${icon} Fetch ${typeof args?.["url"] === "string" ? args["url"] : content}`;
    case "web_search":
      return `${icon} Search "${typeof args?.["query"] === "string" ? args["query"] : ""}"  ${content}`;
    default: {
      const human = name.replace(/_/g, " ");
      const selfDescribing =
        content && content !== "ok" && content !== "done" && !content.startsWith("{");
      return selfDescribing
        ? `${icon} ${content}`
        : `${icon} ${human}${content ? `  ${content}` : ""}`;
    }
  }
}

function normalizePath(p: string): string {
  const cwd = process.cwd();
  if (p.startsWith(cwd)) return p.slice(cwd.length + 1);
  const home = process.env["HOME"];
  if (home && p.startsWith(home)) return "~" + p.slice(home.length);
  return p;
}

function BlockTool({ msg, onInteract }: { msg: ChatMessage; onInteract: () => void }) {
  const {
    theme: { colors, syntax },
  } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const args = parseToolArgs(msg);
  const title = toolTitle(msg.toolName ?? "unknown", args);

  const diffFiletype = msg.diff ? guessFiletype(msg.diff) : undefined;
  const diffFiletypeProps = diffFiletype !== undefined ? { filetype: diffFiletype } : {};
  const codeFiletypeProps = msg.codeLang !== undefined ? { filetype: msg.codeLang } : {};

  const totalDiffLines = msg.diff ? msg.diff.split("\n").length : 0;
  const diffOverflow = totalDiffLines > COLLAPSED_LINES;
  const displayHeight = expanded || !diffOverflow ? totalDiffLines : COLLAPSED_LINES;

  const totalCodeLines = msg.code ? msg.code.split("\n").length : 0;
  const codeOverflow = totalCodeLines > COLLAPSED_LINES;
  const codeHeight = expanded || !codeOverflow ? totalCodeLines : COLLAPSED_LINES;

  const hasOverflow = diffOverflow || codeOverflow;

  const bashCommand =
    msg.toolName === "bash" && typeof args?.["command"] === "string"
      ? (args["command"] as string)
      : null;

  return (
    <box
      style={{
        width: "100%",
        paddingLeft: 2,
        paddingRight: 1,
        marginTop: 1,
        marginBottom: 1,
        paddingTop: 1,
        paddingBottom: 1,
        border: ["left"],
        borderColor: colors.border,
        backgroundColor: colors.bgPanel,
        gap: 1,
      }}
      onMouseUp={() => {
        if (hasOverflow) setExpanded((prev) => !prev);
        onInteract?.();
      }}
    >
      <text fg={colors.muted}>
        <b>{title}</b>
      </text>
      {bashCommand && <text fg={colors.text}>$ {bashCommand}</text>}
      {msg.code && (
        <code
          content={msg.code}
          {...codeFiletypeProps}
          syntaxStyle={syntax}
          wrapMode="none"
          style={{ width: "100%", height: codeHeight, flexShrink: 0 }}
        />
      )}
      {msg.diff && (
        <diff
          diff={msg.diff}
          view="unified"
          {...diffFiletypeProps}
          syntaxStyle={syntax}
          showLineNumbers={true}
          wrapMode="none"
          addedBg={colors.diffAddedBg}
          removedBg={colors.diffRemovedBg}
          addedSignColor={colors.diffAddedSign}
          removedSignColor={colors.diffRemovedSign}
          lineNumberFg={colors.diffLineNumberFg}
          lineNumberBg="transparent"
          style={{ width: "100%", height: displayHeight, flexShrink: 0 }}
        />
      )}
      {hasOverflow && (
        <text fg={colors.muted}>
          {expanded
            ? "\u25b2 click to collapse"
            : `\u25bc ${(diffOverflow ? totalDiffLines : totalCodeLines) - COLLAPSED_LINES} more lines`}
        </text>
      )}
    </box>
  );
}

function InlineTool({ msg }: { msg: ChatMessage }) {
  const {
    theme: { colors },
  } = useTheme();
  const args = parseToolArgs(msg);
  const label = inlineLabel(msg.toolName ?? "unknown", args, msg.content);
  return (
    <box style={{ width: "100%", paddingLeft: 4 }}>
      <text fg={colors.muted}>{label}</text>
    </box>
  );
}

function ToolMessage({ msg, onInteract }: { msg: ChatMessage; onInteract: () => void }) {
  if (BLOCK_TOOLS.has(msg.toolName ?? "") || msg.diff || msg.code) {
    return <BlockTool msg={msg} onInteract={onInteract} />;
  }
  return <InlineTool msg={msg} />;
}

function MessageBubble({ msg, onInteract }: { msg: ChatMessage; onInteract: () => void }) {
  const {
    theme: { colors, syntax },
  } = useTheme();
  if (msg.role === "user") {
    return (
      <box
        style={{
          width: "100%",
          paddingLeft: 2,
          paddingRight: 1,
          marginBottom: 1,
        }}
      >
        <text fg={colors.accent}>
          <b>You:</b> <UserContent content={msg.content} />
          {msg.queued && <span fg={colors.streak}> QUEUED</span>}
        </text>
      </box>
    );
  }

  if (msg.role === "tool") {
    return <ToolMessage msg={msg} onInteract={onInteract} />;
  }

  if (msg.role === "system") {
    return (
      <box
        style={{
          width: "100%",
          paddingLeft: 2,
          paddingRight: 1,
          marginBottom: 1,
        }}
      >
        <text fg={colors.muted}>
          <i>{msg.content}</i>
        </text>
      </box>
    );
  }

  return (
    <box
      style={{
        width: "100%",
        paddingLeft: 2,
        paddingRight: 1,
        marginBottom: 1,
      }}
    >
      <markdown content={msg.content} syntaxStyle={syntax} conceal style={{ width: "100%" }} />
      {msg.interrupted && <text fg={colors.muted}> [interrupted]</text>}
    </box>
  );
}

const CMD_NAME_COL = 14;

function SuggestionPanel({
  suggestions,
  selectedIndex,
}: {
  suggestions: SlashCommand[];
  selectedIndex: number;
}) {
  const {
    theme: { colors },
  } = useTheme();
  return (
    <box
      style={{
        flexDirection: "column",
        width: "100%",
        backgroundColor: colors.bgPanel,
        borderStyle: "single",
        borderColor: colors.border,
        paddingX: 1,
      }}
    >
      {suggestions.map((cmd, i) => {
        const sel = i === selectedIndex;
        return (
          <box
            key={cmd.name}
            flexDirection="row"
            width="100%"
            backgroundColor={sel ? colors.bgHighlight : colors.bgPanel}
          >
            <box width={CMD_NAME_COL} flexShrink={0}>
              <text fg={sel ? colors.accent : colors.text}>/{cmd.name}</text>
            </box>
            <text fg={colors.muted}>{cmd.description}</text>
          </box>
        );
      })}
    </box>
  );
}

// Internal state tracks only the user-driven modes; permission/sessions are derived from props.
type CommandMode = "idle" | "suggesting" | "picking";
type EffectiveMode = CommandMode | "permission" | "sessions";

export function ChatScreen(props: ChatScreenProps) {
  const {
    onSend,
    onCommand,
    onExit,
    onAbort,
    messages,
    isStreaming,
    streamingText,
    activeToolCall,
    thinkingEnabled,
    thinkLevel,
    modelId,
    permissionPrompt,
    onPermissionReply,
    modelOptions,
    sessionList,
    onSessionSelect,
    onSessionDismiss,
    onSessionDelete,
    attachments,
    onAttach,
    onRemoveAttachment,
    companionName,
  } = props;
  const { user } = useStore();
  const {
    theme: { colors, syntax },
  } = useTheme();
  const textareaRef = useRef<TextareaRenderable>(null);
  const textareaSyntax = useMemo(
    () =>
      SyntaxStyle.fromStyles({
        "extmark.image": { fg: parseColor(colors.streak), bold: true },
      }),
    [colors.streak],
  );

  const [commandMode, setCommandMode] = useState<CommandMode>("idle");
  const [cmdBuffer, setCmdBuffer] = useState("");
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [pickerCommand, setPickerCommand] = useState<SlashCommand | null>(null);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerSelectedIndex, setPickerSelectedIndex] = useState(0);
  const [deletePendingId, setDeletePendingId] = useState<string | null>(null);
  const [sessionHoveredIndex, setSessionHoveredIndex] = useState(0);
  const [zenMode, setZenMode] = useState(false);
  const [pasteBuffers, setPasteBuffers] = useState<{ label: string; content: string }[]>([]);
  const pasteCountRef = useRef(0);
  const [pastePreviewOpen, setPastePreviewOpen] = useState(false);
  const [hasPromptText, setHasPromptText] = useState(false);

  const historyRef = useRef<string[]>(props.initialPromptHistory ?? []);
  const historyDraftRef = useRef("");
  const [historyNavPos, setHistoryNavPos] = useState<{ i: number; n: number } | null>(null);

  const suggestions = useMemo(() => matchCommands(cmdBuffer), [cmdBuffer]);
  const ghostText = useMemo(() => getGhostCompletion(cmdBuffer), [cmdBuffer]);

  // Derive effective mode: permission and sessions are driven by props, not internal state.
  const effectiveMode: EffectiveMode = permissionPrompt
    ? "permission"
    : sessionList && sessionList.length > 0
      ? "sessions"
      : commandMode;

  // Sync ref updated during render so BLURRED handler can check the current mode
  // before React's async effect cleanup has run.
  const effectiveModeRef = useRef<EffectiveMode>(effectiveMode);
  effectiveModeRef.current = effectiveMode;

  // Re-focus textarea whenever it blurs while in idle mode, regardless of cause.
  useEffect(() => {
    if (effectiveMode !== "idle") return;
    const el = textareaRef.current;
    if (!el) return;
    // Guard: don't call focus() if the mode has already changed (e.g. BLURRED fires
    // during unmount before React runs the effect cleanup).
    const handler = () => {
      if (effectiveModeRef.current === "idle") el.focus();
    };
    el.on(RenderableEvents.BLURRED, handler);
    return () => {
      el.off(RenderableEvents.BLURRED, handler);
    };
  }, [effectiveMode]);

  // Restore textarea focus when returning from any non-idle mode.
  const prevModeRef = useRef<EffectiveMode>(effectiveMode);
  useEffect(() => {
    const prev = prevModeRef.current;
    prevModeRef.current = effectiveMode;
    if (effectiveMode === "idle" && prev !== "idle") {
      textareaRef.current?.focus();
    }
  }, [effectiveMode]);

  // Reset selection to 0 every time the suggestion panel opens.
  useEffect(() => {
    if (commandMode === "suggesting") setSuggestionIndex(0);
  }, [commandMode]);

  const refocusTextarea = useCallback(() => {
    textareaRef.current?.focus();
  }, []);

  const exitCommandMode = useCallback(() => {
    setCommandMode("idle");
    setCmdBuffer("");
    setSuggestionIndex(0);
    setPickerCommand(null);
    setPickerSearch("");
    setPickerSelectedIndex(0);
  }, []);

  const clearPromptAll = useCallback(() => {
    textareaRef.current?.clear();
    textareaRef.current?.extmarks?.clear();
    for (const att of attachments) onRemoveAttachment(att.id);
    setPasteBuffers([]);
    setPastePreviewOpen(false);
    setHasPromptText(false);
    historyDraftRef.current = "";
    setHistoryNavPos(null);
  }, [attachments, onRemoveAttachment]);

  function navigateHistory(direction: "up" | "down") {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const history = historyRef.current;

    if (direction === "up") {
      if (history.length === 0) return;
      const curIdx = historyNavPos !== null ? historyNavPos.i - 1 : -1;
      const nextIdx = curIdx === -1 ? history.length - 1 : Math.max(0, curIdx - 1);
      if (nextIdx === curIdx) return;
      if (curIdx === -1) historyDraftRef.current = textarea.plainText;
      setHistoryNavPos({ i: nextIdx + 1, n: history.length });
      textarea.setText(history[nextIdx]!);
      textarea.cursorOffset = 0;
      setHasPromptText(true);
    } else {
      if (historyNavPos === null) return;
      const nextIdx = historyNavPos.i;
      if (nextIdx >= history.length) {
        setHistoryNavPos(null);
        const draft = historyDraftRef.current;
        textarea.setText(draft);
        textarea.cursorOffset = draft.length;
        setHasPromptText(draft.length > 0);
      } else {
        setHistoryNavPos({ i: nextIdx + 1, n: history.length });
        textarea.setText(history[nextIdx]!);
        textarea.cursorOffset = history[nextIdx]!.length;
        setHasPromptText(true);
      }
    }
  }

  const imageTypeIdRef = useRef<number | null>(null);

  const handleContentChange = useEffectEvent(() => {
    if (commandMode !== "idle") return;
    const value = textareaRef.current?.plainText ?? "";
    setHasPromptText(value.length > 0);
    if (value === "/") {
      textareaRef.current?.clear();
      setCommandMode("suggesting");
      setCmdBuffer("");
      return;
    }
    const extmarks = textareaRef.current?.extmarks;
    const typeId = imageTypeIdRef.current;
    if (!extmarks || typeId === null || attachments.length === 0) return;
    const surviving = new Set(extmarks.getAllForTypeId(typeId).map((e) => e.data as string));
    for (const att of attachments) {
      if (!surviving.has(att.id)) onRemoveAttachment(att.id);
    }
  });

  const insertImageLabel = useCallback((attachment: ImageAttachment) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const extmarks = textarea.extmarks;
    if (!extmarks) return;
    if (imageTypeIdRef.current === null) {
      imageTypeIdRef.current = extmarks.registerType("image");
    }
    const styleId = textareaSyntax.getStyleId("extmark.image");
    const offset = textarea.cursorOffset;
    const label = attachment.label;
    textarea.insertText(label + " ");
    extmarks.create({
      start: offset,
      end: offset + label.length,
      virtual: true,
      ...(styleId !== null ? { styleId } : {}),
      typeId: imageTypeIdRef.current,
      data: attachment.id,
    });
    textarea.focus();
  }, []);

  const handleSubmit = useCallback(() => {
    const raw = textareaRef.current?.plainText ?? "";
    const hasImages = raw.includes("[Image ");
    let text = raw.replace(IMAGE_LABEL_RE, "").trim();
    for (const entry of pasteBuffers) {
      text = text.replace(entry.label, entry.content);
    }
    text = text.trim();
    if (pasteBuffers.length > 0) {
      setPasteBuffers([]);
      setPastePreviewOpen(false);
    }
    if (!text && !hasImages) return;
    if (text) {
      const h = historyRef.current;
      if (h[h.length - 1] !== text) {
        historyRef.current = [...h, text].slice(-PROMPT_HISTORY_MAX);
      }
    }
    historyDraftRef.current = "";
    setHistoryNavPos(null);
    onSend(text);
    textareaRef.current?.extmarks?.clear();
    textareaRef.current?.clear();
  }, [onSend, pasteBuffers]);

  const handlePaste = useCallback(
    (event: PasteEvent) => {
      if (historyNavPos !== null) {
        historyDraftRef.current = "";
        setHistoryNavPos(null);
      }
      const normalized = event.text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const pasted = normalized.trim();
      if (!pasted) return;
      const filepath = pasted.replace(/^'+|'+$/g, "").replace(/\\ /g, " ");
      const ext = filepath.split(".").pop()?.toLowerCase() ?? "";
      const mime = IMAGE_EXTS[ext];
      if (mime) {
        event.preventDefault();
        readImageFile(filepath).then((content) => {
          if (!content) return;
          const filename = filepath.split("/").pop() ?? filepath;
          const att: ImageAttachment = {
            id: crypto.randomUUID(),
            filename,
            mime: content.mime,
            base64: content.data,
            label: `[Image ${attachments.length + 1}]`,
          };
          onAttach(att);
          insertImageLabel(att);
        });
        return;
      }
      const lines = normalized.split("\n");
      if (lines.length >= 5) {
        event.preventDefault();
        pasteCountRef.current += 1;
        const label = `[~${lines.length} lines pasted #${pasteCountRef.current}]`;
        setPasteBuffers((prev) => [...prev, { label, content: normalized }]);
        textareaRef.current?.insertText(label + " ");
      }
    },
    [onAttach, attachments],
  );

  const handlePickerSelect = useCallback(
    (_index: number, option: { name: string; value?: unknown } | null) => {
      if (!pickerCommand || !option) return;
      const val = typeof option.value === "string" ? option.value : option.name.toLowerCase();
      onCommand(pickerCommand.name, val);
      exitCommandMode();
    },
    [pickerCommand, onCommand, exitCommandMode],
  );

  const handleSessionPickerSelect = useCallback(
    (_index: number, option: { name: string; value?: unknown } | null) => {
      if (!option) return;
      const id = typeof option.value === "string" ? option.value : "";
      if (id) onSessionSelect(id);
      setCommandMode("idle");
      // focus() is handled by the prevModeRef useEffect after re-render
    },
    [onSessionSelect],
  );

  // useKeyboard wraps the handler in useEffectEvent internally — always reads latest state/props.
  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      if (effectiveMode === "idle") {
        const text = textareaRef.current?.plainText ?? "";
        if (text || attachments.length > 0 || pasteBuffers.length > 0) {
          clearPromptAll();
          return;
        }
      }
      onExit();
      return;
    }

    if (key.meta && key.name === "z") {
      key.preventDefault();
      setZenMode((prev) => !prev);
      return;
    }

    const mode = effectiveMode;

    if (mode === "permission") {
      key.preventDefault();
      if (key.sequence === "y") {
        onPermissionReply("once");
      } else if (key.sequence === "a") {
        onPermissionReply("always");
      } else if (key.sequence === "n" || key.name === "escape") {
        onPermissionReply("deny");
      }
      return;
    }

    if (mode === "picking") {
      if (key.name === "escape") {
        key.preventDefault();
        exitCommandMode();
        return;
      }
      if (key.name === "return") {
        key.preventDefault();
        const opt = filteredPickerOptions[pickerSelectedIndex] ?? null;
        handlePickerSelect(pickerSelectedIndex, opt);
        return;
      }
      if (key.name === "down" || key.sequence === "j") {
        key.preventDefault();
        setPickerSelectedIndex((prev) =>
          filteredPickerOptions.length === 0 ? 0 : (prev + 1) % filteredPickerOptions.length,
        );
        return;
      }
      if (key.name === "up" || key.sequence === "k") {
        key.preventDefault();
        setPickerSelectedIndex((prev) =>
          filteredPickerOptions.length === 0
            ? 0
            : prev <= 0
              ? filteredPickerOptions.length - 1
              : prev - 1,
        );
        return;
      }
      return;
    }

    if (mode === "sessions") {
      if (key.ctrl && key.name === "d") {
        key.preventDefault();
        const hovered = sessionOptions[sessionHoveredIndex];
        const hoveredId = typeof hovered?.value === "string" ? hovered.value : null;
        if (hoveredId && deletePendingId === hoveredId) {
          onSessionDelete(hoveredId);
          setDeletePendingId(null);
          setSessionHoveredIndex(0);
        } else if (hoveredId) {
          setDeletePendingId(hoveredId);
        }
        return;
      }
      if (key.name === "escape") {
        key.preventDefault();
        setDeletePendingId(null);
        onSessionDismiss();
      }
      return;
    }

    if (mode === "suggesting") {
      if (key.name === "escape") {
        key.preventDefault();
        exitCommandMode();
        return;
      }
      if (key.name === "backspace") {
        key.preventDefault();
        if (cmdBuffer.length === 0) {
          exitCommandMode();
        } else {
          setCmdBuffer((prev) => prev.slice(0, -1));
          setSuggestionIndex(0);
        }
        return;
      }
      if (key.name === "tab") {
        key.preventDefault();
        const idx = suggestionIndex;
        const match = suggestions[idx] ?? suggestions[0];
        if (match) {
          setCmdBuffer(match.name);
          setSuggestionIndex(suggestions.indexOf(match));
        }
        return;
      }
      if (key.name === "return") {
        key.preventDefault();
        const cmd = suggestions[suggestionIndex] ?? findCommand(cmdBuffer) ?? suggestions[0];
        if (!cmd) return;
        const hasOptions =
          cmd.arg?.required &&
          (cmd.arg.options.length > 0 || (cmd.name === "model" && modelOptions.length > 0));
        if (hasOptions) {
          setPickerCommand(cmd);
          setCommandMode("picking");
        } else {
          onCommand(cmd.name);
          exitCommandMode();
        }
        return;
      }
      if (key.name === "up") {
        key.preventDefault();
        const len = suggestions.length;
        setSuggestionIndex((prev) => (prev <= 0 ? len - 1 : prev - 1));
        return;
      }
      if (key.name === "down") {
        key.preventDefault();
        const len = suggestions.length;
        setSuggestionIndex((prev) => (prev + 1) % len);
        return;
      }
      if (
        !key.ctrl &&
        !key.meta &&
        key.sequence &&
        key.sequence.length === 1 &&
        key.sequence.charCodeAt(0) >= 32
      ) {
        key.preventDefault();
        setCmdBuffer((prev) => prev + key.sequence);
        setSuggestionIndex(0);
        return;
      }
      key.preventDefault();
      return;
    }

    if (
      mode === "idle" &&
      attachments.length > 0 &&
      ((key.meta && key.name === "backspace") ||
        (key.ctrl && key.name === "backspace") ||
        (key.ctrl && key.name === "w") ||
        (key.meta && key.name === "delete"))
    ) {
      const textarea = textareaRef.current;
      const extmarks = textarea?.extmarks;
      const typeId = imageTypeIdRef.current;
      if (textarea && extmarks && typeId !== null) {
        const offset = textarea.cursorOffset;
        const hit = extmarks
          .getAllForTypeId(typeId)
          .find((e) => offset > e.start && offset <= e.end + 1);
        if (hit) {
          key.preventDefault();
          if (textarea.cursorOffset > hit.end) textarea.deleteCharBackward();
          textarea.deleteCharBackward();
          onRemoveAttachment(hit.data as string);
          return;
        }
      }
    }

    if (mode === "idle" && key.ctrl && key.name === "v") {
      key.preventDefault();
      readClipboard().then((content) => {
        if (!content) return;
        if (content.mime.startsWith("image/")) {
          const att: ImageAttachment = {
            id: crypto.randomUUID(),
            filename: "clipboard",
            mime: content.mime,
            base64: content.data,
            label: `[Image ${attachments.length + 1}]`,
          };
          onAttach(att);
          insertImageLabel(att);
        } else if (content.mime === "text/plain") {
          textareaRef.current?.insertText(content.data);
        }
      });
      return;
    }

    if (mode === "idle" && key.ctrl && key.name === "p" && pasteBuffers.length > 0) {
      key.preventDefault();
      setPastePreviewOpen((open) => !open);
      return;
    }

    if (mode === "idle" && historyNavPos !== null) {
      const isChar =
        !key.ctrl &&
        !key.meta &&
        key.sequence &&
        key.sequence.length === 1 &&
        key.sequence.charCodeAt(0) >= 32;
      if (isChar || key.name === "backspace" || key.name === "delete") {
        historyDraftRef.current = "";
        setHistoryNavPos(null);
      }
    }

    if (mode === "idle" && key.name === "up" && !key.ctrl && !key.meta) {
      const offset = textareaRef.current?.cursorOffset ?? 0;
      if (offset === 0 && historyRef.current.length > 0) {
        key.preventDefault();
        navigateHistory("up");
        return;
      }
    }

    if (
      mode === "idle" &&
      key.name === "down" &&
      !key.ctrl &&
      !key.meta &&
      historyNavPos !== null
    ) {
      key.preventDefault();
      navigateHistory("down");
      return;
    }

    if (key.name === "escape") {
      if (isStreaming) {
        onAbort();
      } else {
        // effectiveMode is "idle" here — other modes return early above
        const text = textareaRef.current?.plainText ?? "";
        if (text || attachments.length > 0 || pasteBuffers.length > 0) {
          clearPromptAll();
        }
      }
    }
  });

  const title = levelTitle(user.level);
  const textareaFocused = effectiveMode === "idle";
  const pickerOptions =
    pickerCommand?.name === "model" ? modelOptions : (pickerCommand?.arg?.options ?? []);
  const pickerShowDescription = pickerCommand?.arg?.showDescription ?? false;
  const filteredPickerOptions = useMemo(() => {
    if (!pickerSearch) return pickerOptions;
    const q = pickerSearch.toLowerCase();
    return pickerOptions.filter(
      (o) => o.name.toLowerCase().includes(q) || o.description.toLowerCase().includes(q),
    );
  }, [pickerOptions, pickerSearch]);

  useEffect(() => {
    setPickerSelectedIndex(0);
  }, [filteredPickerOptions]);

  const sessionOptions = useMemo(
    () =>
      (sessionList ?? []).map((c) => ({
        name: c.id === deletePendingId ? "ctrl+d again to confirm delete" : (c.title ?? "Untitled"),
        description: formatRelativeTime(c.updatedAt),
        value: c.id,
      })),
    [sessionList, deletePendingId],
  );

  return (
    <box
      style={{
        flexDirection: "column",
        width: "100%",
        height: "100%",
        backgroundColor: colors.bg,
      }}
    >
      {/* Header */}
      {!zenMode && (
        <box
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            width: "100%",
            height: 1,
            paddingLeft: 1,
            paddingRight: 1,
            backgroundColor: colors.bgPanel,
          }}
        >
          <text fg={colors.xp}>
            <b>{companionName ?? "GRIND AGENT"}</b>
            {thinkingEnabled && <span fg={colors.muted}> think:{thinkLevel}</span>}
          </text>
          <text fg={colors.level}>
            Lv.{user.level} {title}
          </text>
        </box>
      )}

      {/* Messages area */}
      <scrollbox
        style={{
          flexGrow: 1,
          width: "100%",
          backgroundColor: colors.bg,
        }}
        stickyScroll
        stickyStart="bottom"
        viewportCulling
      >
        {messages.length === 0 && (
          <box style={{ paddingLeft: 2, paddingTop: 1, paddingBottom: 1 }}>
            <text fg={colors.muted}>
              What's on your mind? Type <span fg={colors.accent}>/</span> for commands.
            </text>
          </box>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} onInteract={refocusTextarea} />
        ))}

        {isStreaming && streamingText && (
          <box
            style={{
              width: "100%",
              paddingLeft: 2,
              paddingRight: 1,
              marginBottom: 1,
            }}
          >
            <markdown
              content={streamingText}
              syntaxStyle={syntax}
              conceal
              streaming
              style={{ width: "100%" }}
            />
          </box>
        )}

        {isStreaming && activeToolCall && (
          <box
            style={{
              width: "100%",
              paddingLeft: 4,
              backgroundColor: colors.bgPanel,
            }}
          >
            <text fg={colors.streak}>
              {"  "}
              {activeToolCall}...
            </text>
          </box>
        )}

        {isStreaming && !streamingText && !activeToolCall && (
          <box style={{ paddingLeft: 2 }}>
            <text fg={colors.muted}>{thinkingEnabled ? "thinking..." : "..."}</text>
          </box>
        )}
      </scrollbox>

      {/* Overlay panels — absolute so they don't push scrollbox content */}
      {effectiveMode === "suggesting" && suggestions.length > 0 && (
        <box position="absolute" bottom={4} left={0} width="100%">
          <SuggestionPanel suggestions={suggestions} selectedIndex={suggestionIndex} />
        </box>
      )}

      {effectiveMode === "picking" && pickerOptions.length > 0 && (
        <box
          position="absolute"
          bottom={4}
          left={0}
          width="100%"
          style={{
            flexDirection: "column",
            borderStyle: "single",
            borderColor: colors.borderFocus,
            backgroundColor: colors.bgPanel,
          }}
          title={`/${pickerCommand?.name ?? ""}`}
        >
          <input
            key={pickerCommand?.name ?? ""}
            placeholder="search..."
            placeholderColor={colors.muted}
            textColor={colors.text}
            backgroundColor={colors.bgPanel}
            focusedBackgroundColor={colors.bgPanel}
            cursorColor={colors.accent}
            focused={effectiveMode === "picking"}
            onInput={(val) => setPickerSearch(val)}
            width="100%"
          />
          <select
            options={filteredPickerOptions}
            focused={false}
            selectedIndex={pickerSelectedIndex}
            width="100%"
            height={
              pickerShowDescription
                ? Math.min(filteredPickerOptions.length * 2, 20)
                : Math.min(filteredPickerOptions.length, 12)
            }
            showScrollIndicator={
              pickerShowDescription
                ? filteredPickerOptions.length * 2 > 20
                : filteredPickerOptions.length > 12
            }
            showDescription={pickerShowDescription}
            backgroundColor={colors.bgPanel}
            textColor={colors.textDim}
            selectedBackgroundColor={colors.bgHighlight}
            selectedTextColor={colors.accent}
            descriptionColor={colors.muted}
            selectedDescriptionColor={colors.accent}
          />
        </box>
      )}

      {effectiveMode === "sessions" && sessionOptions.length > 0 && (
        <box
          position="absolute"
          bottom={4}
          left={0}
          width="100%"
          style={{
            borderStyle: "single",
            borderColor: colors.borderFocus,
            backgroundColor: colors.bgPanel,
          }}
          title="Sessions"
        >
          <select
            options={sessionOptions}
            focused={effectiveMode === "sessions"}
            onSelect={handleSessionPickerSelect}
            onChange={(index, option) => {
              setSessionHoveredIndex(index);
              const id = typeof option?.value === "string" ? option.value : null;
              if (deletePendingId && id !== deletePendingId) setDeletePendingId(null);
            }}
            width="100%"
            height={Math.min(sessionOptions.length, 10)}
            wrapSelection
            showScrollIndicator={sessionOptions.length > 10}
            backgroundColor={colors.bgPanel}
            textColor={colors.textDim}
            selectedBackgroundColor={deletePendingId ? colors.danger : colors.bgHighlight}
            selectedTextColor={deletePendingId ? colors.bg : colors.accent}
            descriptionColor={colors.muted}
            selectedDescriptionColor={colors.muted}
          />
        </box>
      )}

      {pasteBuffers.length > 0 && pastePreviewOpen && (
        <box
          position="absolute"
          bottom={4}
          left={0}
          width="100%"
          style={{
            borderStyle: "single",
            borderColor: colors.accent,
            backgroundColor: colors.bgPanel,
          }}
          title={`Paste preview (${pasteBuffers.length})`}
        >
          <scrollbox
            style={{
              width: "100%",
              height: Math.min(
                pasteBuffers.reduce((sum, e) => sum + e.content.split("\n").length + 1, 0),
                12,
              ),
            }}
          >
            {pasteBuffers.map((entry, i) => (
              <box key={i} style={{ width: "100%", flexDirection: "column" }}>
                {i > 0 && <text fg={colors.borderFocus}>{"─".repeat(40)}</text>}
                <text fg={colors.accent}>
                  #{i + 1} · {entry.content.split("\n").length} lines
                </text>
                <text fg={colors.text}>{entry.content}</text>
              </box>
            ))}
          </scrollbox>
        </box>
      )}

      {/* Input area */}
      <box
        style={{
          width: "100%",
          minHeight: 3,
          border: ["left"],
          borderColor:
            effectiveMode === "permission"
              ? colors.streak
              : effectiveMode !== "idle"
                ? colors.accent
                : colors.borderFocus,
          backgroundColor: colors.bgPanel,
          paddingLeft: 1,
          paddingRight: 1,
          paddingY: 1,
        }}
      >
        {effectiveMode === "permission" && permissionPrompt ? (
          <text>
            <span fg={colors.streak}>{permissionPrompt.toolName}</span>
            <span fg={colors.muted}>{" \u2192 "}</span>
            <span fg={colors.text}>{permissionPrompt.detail}</span>
          </text>
        ) : effectiveMode === "suggesting" ? (
          <text>
            <span fg={colors.accent}>/{cmdBuffer}</span>
            <span fg={colors.ghost}>{ghostText}</span>
          </text>
        ) : effectiveMode === "picking" ? (
          <text fg={colors.accent}>/{pickerCommand?.name ?? ""}</text>
        ) : (
          <>
            <textarea
              ref={textareaRef}
              placeholder="Type a message... (/ for commands)"
              placeholderColor={colors.muted}
              textColor={colors.text}
              focusedTextColor={colors.text}
              backgroundColor={colors.bgPanel}
              focusedBackgroundColor={colors.bgPanel}
              cursorColor={colors.accent}
              syntaxStyle={textareaSyntax}
              onContentChange={handleContentChange}
              onSubmit={handleSubmit}
              onPaste={handlePaste}
              focused={textareaFocused}
              minHeight={1}
              maxHeight={6}
              flexShrink={0}
              keyBindings={[
                { name: "return", action: "submit" as const },
                { name: "return", meta: true, action: "newline" as const },
                { name: "return", ctrl: true, action: "newline" as const },
                { name: "return", shift: true, action: "newline" as const },
                { name: "j", ctrl: true, action: "newline" as const },
              ]}
            />
          </>
        )}
      </box>

      {/* Status bar */}
      <box
        style={{
          flexDirection: "row",
          width: "100%",
          height: 1,
          paddingLeft: 1,
          gap: 2,
          backgroundColor: colors.bgPanel,
        }}
      >
        {effectiveMode === "permission" && (
          <>
            <text fg={colors.textDim}>
              [<span fg={colors.streak}>y</span>] allow
            </text>
            <text fg={colors.textDim}>
              [<span fg={colors.streak}>a</span>] always allow
            </text>
            <text fg={colors.textDim}>
              [<span fg={colors.streak}>n</span>/<span fg={colors.streak}>Esc</span>] deny
            </text>
          </>
        )}
        {effectiveMode === "suggesting" && (
          <>
            <text fg={colors.textDim}>
              [<span fg={colors.accent}>Tab</span>] complete
            </text>
            <text fg={colors.textDim}>
              [<span fg={colors.accent}>Enter</span>] run
            </text>
            <text fg={colors.textDim}>
              [<span fg={colors.accent}>Esc</span>] cancel
            </text>
          </>
        )}
        {effectiveMode === "picking" && (
          <>
            <text fg={colors.textDim}>
              [<span fg={colors.accent}>j/k</span>] select
            </text>
            <text fg={colors.textDim}>
              [<span fg={colors.accent}>Enter</span>] confirm
            </text>
            <text fg={colors.textDim}>
              [<span fg={colors.accent}>Esc</span>] cancel
            </text>
          </>
        )}
        {effectiveMode === "sessions" && !deletePendingId && (
          <>
            <text fg={colors.textDim}>
              [<span fg={colors.accent}>j/k</span>] select
            </text>
            <text fg={colors.textDim}>
              [<span fg={colors.accent}>Enter</span>] open
            </text>
            <text fg={colors.textDim}>
              [<span fg={colors.accent}>ctrl+d</span>] delete
            </text>
            <text fg={colors.textDim}>
              [<span fg={colors.accent}>Esc</span>] cancel
            </text>
          </>
        )}
        {effectiveMode === "sessions" && deletePendingId && (
          <>
            <text fg={colors.danger}>
              [<span fg={colors.danger}>ctrl+d</span>] confirm delete
            </text>
            <text fg={colors.textDim}>
              [<span fg={colors.accent}>Esc</span>] cancel
            </text>
          </>
        )}
        {effectiveMode === "idle" && !isStreaming && historyNavPos !== null && (
          <>
            <text fg={colors.muted}>
              {"\u2191\u2193"} history {historyNavPos.i}/{historyNavPos.n}
            </text>
            <text fg={colors.textDim}>{"\u00b7"}</text>
            <text fg={colors.textDim}>{"\u2193"} newer</text>
            <text fg={colors.textDim}>
              [<span fg={colors.accent}>Esc</span>] cancel
            </text>
          </>
        )}
        {effectiveMode === "idle" && !isStreaming && historyNavPos === null && (
          <>
            <text fg={colors.muted}>{modelId}</text>
            <text fg={colors.textDim}>{"\u00b7"}</text>
            <text fg={thinkingEnabled ? colors.xp : colors.textDim}>
              {thinkingEnabled ? thinkLevel : "off"}
            </text>
            {pasteBuffers.length > 0 && (
              <text fg={colors.textDim}>
                [<span fg={colors.accent}>ctrl+p</span>] {pastePreviewOpen ? "hide" : "preview"}{" "}
                paste
                {pasteBuffers.length > 1 ? ` (${pasteBuffers.length})` : ""}
              </text>
            )}
            {props.sessionUsage.totalTokens > 0 && (
              <text fg={colors.muted}>
                {"| "}
                {fmtTok(props.lastUsage.inputTokens)} in / {fmtTok(props.lastUsage.outputTokens)}{" "}
                out
                {props.lastUsage.cacheReadTokens > 0 && (
                  <span fg={colors.streak}> cache: {fmtTok(props.lastUsage.cacheReadTokens)}</span>
                )}
                {" | "}
                {fmtTok(props.sessionUsage.totalTokens)} total
              </text>
            )}
            {!zenMode && (
              <>
                {historyRef.current.length > 0 && (
                  <text fg={colors.textDim}>
                    [<span fg={colors.accent}>{"\u2191"}</span>] history
                  </text>
                )}
                <text fg={colors.textDim}>
                  [<span fg={colors.accent}>/</span>] cmds
                </text>
                {hasPromptText || attachments.length > 0 || pasteBuffers.length > 0 ? (
                  <text fg={colors.textDim}>
                    [<span fg={colors.accent}>Esc</span>/<span fg={colors.accent}>^C</span>] clear
                  </text>
                ) : (
                  <text fg={colors.textDim}>
                    [<span fg={colors.accent}>^C</span>] exit
                  </text>
                )}
              </>
            )}
          </>
        )}
        {effectiveMode === "idle" && isStreaming && (
          <>
            <spinner
              frames={["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]}
              interval={80}
              color={colors.accent}
            />
            <text fg={colors.muted}>{modelId}</text>
            <text fg={colors.textDim}>·</text>
            <text fg={thinkingEnabled ? colors.xp : colors.textDim}>
              {thinkingEnabled ? thinkLevel : "off"}
            </text>
            <text fg={colors.textDim}>
              [<span fg={colors.accent}>Esc</span>] cancel
            </text>
          </>
        )}
      </box>
    </box>
  );
}
