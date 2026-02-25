import {
  useRef,
  useEffect,
  useState,
  useCallback,
  type KeyboardEvent,
  type FormEvent,
  type ClipboardEvent,
} from "react";
import {
  PaperPlaneTiltIcon,
  StopIcon,
  XIcon,
  TrashSimpleIcon,
  CaretDownIcon,
  NoteIcon,
  PaperclipIcon,
  FileIcon,
} from "@phosphor-icons/react";
import { cn } from "#/lib/utils";
import {
  ImageViewer,
  TextFileViewer,
  downloadAttachment,
  getAttachmentInteraction,
} from "./attachment-viewer";

const PROMPT_HISTORY_MAX = 100;
const PASTE_LINE_THRESHOLD = 5;

interface PasteBlob {
  id: string;
  content: string;
  lineCount: number;
}

export interface Attachment {
  id: string;
  filename: string;
  mime: string;
  base64: string;
}

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (fullText: string, attachments: Attachment[]) => void;
  onStop?: () => void;
  onCancelQueue?: () => void;
  isStreaming: boolean;
  hasPendingMessage?: boolean;
  pendingMessagePreview?: string;
  disabled?: boolean;
  placeholder?: string;
  initialHistory?: string[];
}

export function ChatInput({
  value,
  onChange,
  onSubmit,
  onStop,
  onCancelQueue,
  isStreaming,
  hasPendingMessage = false,
  pendingMessagePreview,
  disabled,
  placeholder = "Message the Companion…",
  initialHistory,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pasteBlobs, setPasteBlobs] = useState<PasteBlob[]>([]);
  const [expandedBlobId, setExpandedBlobId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const historyRef = useRef<string[]>(initialHistory ?? []);
  const historyDraftRef = useRef("");
  const [historyNavPos, setHistoryNavPos] = useState<{ i: number; n: number } | null>(null);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 144)}px`;
  }, [value]);

  const hasContent = value.trim().length > 0 || pasteBlobs.length > 0 || attachments.length > 0;
  const canQueue = isStreaming && !hasPendingMessage && hasContent;
  const isDisabled = (disabled ?? false) || (isStreaming && hasPendingMessage);
  const canSend = !isStreaming && hasContent && !isDisabled;
  const showStop = isStreaming && !canQueue;

  function navigateHistory(direction: "up" | "down") {
    const history = historyRef.current;
    if (direction === "up") {
      if (history.length === 0) return;
      const curIdx = historyNavPos !== null ? historyNavPos.i - 1 : -1;
      const nextIdx = curIdx === -1 ? history.length - 1 : Math.max(0, curIdx - 1);
      if (nextIdx === curIdx) return;
      if (curIdx === -1) historyDraftRef.current = value;
      setHistoryNavPos({ i: nextIdx + 1, n: history.length });
      onChange(history[nextIdx]!);
    } else {
      if (historyNavPos === null) return;
      const nextIdx = historyNavPos.i;
      if (nextIdx >= history.length) {
        setHistoryNavPos(null);
        onChange(historyDraftRef.current);
      } else {
        setHistoryNavPos({ i: nextIdx + 1, n: history.length });
        onChange(history[nextIdx]!);
      }
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (canSend || canQueue) handleSubmit();
      return;
    }

    if (e.key === "ArrowUp") {
      const ta = textareaRef.current;
      if (!ta) return;
      const onFirstLine = !value.slice(0, ta.selectionStart).includes("\n");
      if (onFirstLine && historyRef.current.length > 0) {
        e.preventDefault();
        navigateHistory("up");
      }
      return;
    }

    if (e.key === "ArrowDown" && historyNavPos !== null) {
      e.preventDefault();
      navigateHistory("down");
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    if (historyNavPos !== null) {
      historyDraftRef.current = "";
      setHistoryNavPos(null);
    }
    onChange(e.target.value);
  }

  function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed && pasteBlobs.length === 0 && attachments.length === 0) return;
    const parts = [...pasteBlobs.map((b) => b.content), ...(trimmed ? [trimmed] : [])];
    const combined = parts.join("\n\n");
    if (trimmed) {
      const h = historyRef.current;
      if (h[h.length - 1] !== trimmed) {
        historyRef.current = [...h, trimmed].slice(-PROMPT_HISTORY_MAX);
      }
    }
    historyDraftRef.current = "";
    setHistoryNavPos(null);
    setPasteBlobs([]);
    setExpandedBlobId(null);
    const submittedAttachments = attachments;
    setAttachments([]);
    onChange("");
    onSubmit(combined, submittedAttachments);
  }

  const handlePaste = useCallback(async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find((item) => item.type.startsWith("image/"));
    if (imageItem) {
      e.preventDefault();
      const file = imageItem.getAsFile();
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const commaIdx = dataUrl.indexOf(",");
        const base64 = commaIdx !== -1 ? dataUrl.slice(commaIdx + 1) : dataUrl;
        setAttachments((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            filename: file.name || "clipboard",
            mime: file.type,
            base64,
          },
        ]);
      };
      reader.readAsDataURL(file);
      return;
    }

    const text = e.clipboardData.getData("text");
    if (!text) return;
    const lines = text.split("\n");
    if (lines.length < PASTE_LINE_THRESHOLD) return;
    e.preventDefault();
    setPasteBlobs((prev) => [
      ...prev,
      { id: crypto.randomUUID(), content: text, lineCount: lines.length },
    ]);
  }, []);

  const processFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const commaIdx = dataUrl.indexOf(",");
        const base64 = commaIdx !== -1 ? dataUrl.slice(commaIdx + 1) : dataUrl;
        setAttachments((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            filename: file.name,
            mime: file.type || "application/octet-stream",
            base64,
          },
        ]);
      };
      reader.readAsDataURL(file);
    });
  }, []);

  function handleFormSubmit(e: FormEvent) {
    e.preventDefault();
    if (showStop) {
      onStop?.();
    } else {
      handleSubmit();
    }
  }

  const hintText = historyNavPos
    ? `↑↓ history ${historyNavPos.i}/${historyNavPos.n} · ↓ newer · ⌘ Return to send`
    : historyRef.current.length > 0
      ? "↑ history · ⌘ Return to send · Enter for newline"
      : "⌘ Return to send · Enter for newline";

  const hasAttachmentRow = pasteBlobs.length > 0 || attachments.length > 0;

  return (
    <div className="flex flex-col gap-1.5">
      {hasPendingMessage && pendingMessagePreview && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5">
          <span className="text-[10px] text-muted-foreground shrink-0">queued</span>
          <span className="flex-1 min-w-0 truncate text-xs text-foreground/70">
            {pendingMessagePreview}
          </span>
          <button
            type="button"
            onClick={onCancelQueue}
            aria-label="Cancel queued message"
            className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <XIcon size={12} aria-hidden="true" />
          </button>
        </div>
      )}

      <form
        onSubmit={handleFormSubmit}
        className="flex flex-col rounded-xl border border-border bg-card has-[textarea:focus-visible]:border-ring"
      >
        {hasAttachmentRow && (
          <div className="px-3 pt-4 pb-1 flex flex-col gap-1.5">
            <div className="flex flex-wrap gap-4 overflow-visible">
              {attachments.map((att) => {
                const interaction = getAttachmentInteraction(att.mime);
                const src = `data:${att.mime};base64,${att.base64}`;
                const removeBtn = (
                  <button
                    type="button"
                    aria-label={`Remove attachment ${att.filename}`}
                    onClick={() => setAttachments((prev) => prev.filter((a) => a.id !== att.id))}
                    className="absolute -top-2 -right-2 flex items-center justify-center w-7 h-7 rounded-md bg-background border border-border text-foreground/70 hover:text-foreground transition-colors [touch-action:manipulation] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <TrashSimpleIcon size={13} aria-hidden="true" />
                  </button>
                );

                if (interaction === "image") {
                  return (
                    <div key={att.id} className="relative flex-shrink-0 overflow-visible">
                      <ImageViewer
                        src={src}
                        alt={att.filename}
                        triggerClassName="block w-14 h-14 rounded-lg border border-border overflow-hidden"
                      >
                        <img src={src} alt={att.filename} className="w-full h-full object-cover" />
                      </ImageViewer>
                      {removeBtn}
                    </div>
                  );
                }

                const chipBase =
                  "w-14 h-14 flex flex-col items-center justify-center gap-1 px-1 rounded-lg border border-border bg-secondary/60";

                if (interaction === "text") {
                  return (
                    <div key={att.id} className="relative flex-shrink-0 overflow-visible">
                      <TextFileViewer
                        base64={att.base64}
                        filename={att.filename}
                        triggerClassName={cn(
                          chipBase,
                          "transition-colors hover:bg-secondary cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        )}
                      >
                        <FileIcon size={20} className="text-muted-foreground" aria-hidden="true" />
                        <span className="text-[9px] text-muted-foreground text-center leading-tight line-clamp-2 break-all">
                          {att.filename}
                        </span>
                      </TextFileViewer>
                      {removeBtn}
                    </div>
                  );
                }

                return (
                  <div key={att.id} className="relative flex-shrink-0 overflow-visible">
                    <button
                      type="button"
                      aria-label={`Download ${att.filename}`}
                      onClick={() => downloadAttachment(att)}
                      className={cn(
                        chipBase,
                        "transition-colors hover:bg-secondary cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      )}
                    >
                      <FileIcon size={20} className="text-muted-foreground" aria-hidden="true" />
                      <span className="text-[9px] text-muted-foreground text-center leading-tight line-clamp-2 break-all">
                        {att.filename}
                      </span>
                    </button>
                    {removeBtn}
                  </div>
                );
              })}

              {pasteBlobs.map((blob) => {
                const isExpanded = expandedBlobId === blob.id;
                const previewLine = blob.content.split("\n").find((l) => l.trim()) ?? "";
                return (
                  <div
                    key={blob.id}
                    className="relative flex-shrink-0 self-start min-w-[120px] max-w-[200px] overflow-visible"
                  >
                    <button
                      type="button"
                      aria-label={isExpanded ? "Collapse preview" : "Expand preview"}
                      aria-expanded={isExpanded}
                      onClick={() => setExpandedBlobId(isExpanded ? null : blob.id)}
                      className="flex w-full flex-col gap-0.5 rounded-lg border border-border bg-secondary/60 py-1.5 pl-2 pr-5 text-left transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="flex w-full items-center gap-1 text-xs text-muted-foreground">
                        <NoteIcon size={11} aria-hidden="true" className="shrink-0" />
                        <span className="shrink-0">{blob.lineCount} lines</span>
                        <CaretDownIcon
                          size={10}
                          aria-hidden="true"
                          className={cn(
                            "shrink-0 transition-transform duration-150",
                            isExpanded && "rotate-180",
                          )}
                        />
                      </div>
                      {previewLine && (
                        <span className="truncate text-[10px] leading-tight text-muted-foreground/70">
                          {previewLine}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      aria-label="Remove pasted text"
                      onClick={() => {
                        if (expandedBlobId === blob.id) setExpandedBlobId(null);
                        setPasteBlobs((prev) => prev.filter((b) => b.id !== blob.id));
                      }}
                      className="absolute -top-2 -right-2 flex h-7 w-7 items-center justify-center rounded-md bg-background border border-border text-foreground/70 hover:text-foreground transition-colors [touch-action:manipulation] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <TrashSimpleIcon size={13} aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>

            {expandedBlobId &&
              (() => {
                const blob = pasteBlobs.find((b) => b.id === expandedBlobId);
                return blob ? (
                  <pre className="max-h-48 overflow-y-auto rounded-md border border-border bg-background/60 px-3 py-2 font-mono text-xs text-foreground whitespace-pre-wrap break-words">
                    {blob.content}
                  </pre>
                ) : null;
              })()}
          </div>
        )}

        <div className="flex items-center gap-1 p-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              processFiles(e.target.files);
              e.target.value = "";
            }}
          />

          <button
            type="button"
            aria-label="Attach files"
            disabled={isDisabled}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-[background-color,color] duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "text-muted-foreground hover:bg-secondary hover:text-foreground",
              "disabled:cursor-not-allowed disabled:opacity-40",
            )}
          >
            <PaperclipIcon size={15} aria-hidden="true" />
          </button>

          <label htmlFor="chat-message-input" className="sr-only">
            Message the Companion
          </label>
          <textarea
            id="chat-message-input"
            ref={textareaRef}
            name="message"
            rows={1}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={isDisabled}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck
            aria-label="Message the Companion"
            aria-multiline="true"
            className={cn(
              "min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground",
              "focus-visible:outline-none",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
            style={{ maxHeight: "144px", overflowY: "auto" }}
          />

          <button
            type="submit"
            aria-label={showStop ? "Stop generating" : canQueue ? "Queue message" : "Send message"}
            disabled={!showStop && !canSend && !canQueue}
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-[background-color,transform] duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              showStop
                ? "bg-destructive/80 text-white hover:bg-destructive"
                : canSend || canQueue
                  ? "bg-grind-orange text-white hover:bg-grind-orange/90 active:scale-95"
                  : "cursor-not-allowed bg-secondary text-muted-foreground",
            )}
          >
            {showStop ? (
              <StopIcon size={14} weight="fill" aria-hidden="true" />
            ) : (
              <PaperPlaneTiltIcon size={14} weight="fill" aria-hidden="true" />
            )}
          </button>
        </div>
      </form>

      <p aria-hidden="true" className="text-center text-[10px] text-muted-foreground">
        {hintText}
      </p>

      {historyNavPos !== null && (
        <span className="sr-only" aria-live="polite" aria-atomic="true">
          History entry {historyNavPos.i} of {historyNavPos.n}
        </span>
      )}
    </div>
  );
}
