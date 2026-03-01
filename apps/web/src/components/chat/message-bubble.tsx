import { cn } from "#/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  HourglassIcon,
  LightningIcon,
  FileIcon,
  FilePdfIcon,
  FileTextIcon,
  FileCodeIcon,
  FileArchiveIcon,
} from "@phosphor-icons/react";
import { ToolCallCard, TOOL_LABELS } from "./tool-call-card";
import {
  ImageViewer,
  TextFileViewer,
  downloadAttachment,
  getAttachmentInteraction,
} from "./attachment-viewer";

export interface ToolCallItem {
  id: string;
  toolName: string;
  toolArgsJson: string;
  toolResultJson?: string;
  status: "pending" | "complete";
}

export interface MessageAttachment {
  mime: string;
  base64: string;
  filename?: string;
}

export interface UserMessage {
  role: "user";
  id: string;
  content: string;
  queued?: boolean;
  attachments?: MessageAttachment[];
}

export interface AssistantMessage {
  role: "assistant";
  id: string;
  content: string;
  toolCalls: ToolCallItem[];
  isStreaming: boolean;
}

export interface ToolMessage {
  role: "tool";
  id: string;
  toolName: string;
  content: string;
}

export type ChatMessage = UserMessage | AssistantMessage | ToolMessage;

function FileTypeIcon({ mime, size = 14 }: { mime: string; size?: number }) {
  if (mime === "application/pdf") return <FilePdfIcon size={size} aria-hidden="true" />;
  if (
    mime.startsWith("text/") ||
    mime.includes("json") ||
    mime.includes("xml") ||
    mime.includes("javascript")
  )
    return <FileCodeIcon size={size} aria-hidden="true" />;
  if (
    mime.includes("zip") ||
    mime.includes("tar") ||
    mime.includes("archive") ||
    mime.includes("compressed")
  )
    return <FileArchiveIcon size={size} aria-hidden="true" />;
  if (mime.startsWith("text/")) return <FileTextIcon size={size} aria-hidden="true" />;
  return <FileIcon size={size} aria-hidden="true" />;
}

function AttachmentChip({ attachment }: { attachment: MessageAttachment }) {
  const filename = attachment.filename ?? "attachment";
  const interaction = getAttachmentInteraction(attachment.mime);
  const src = `data:${attachment.mime};base64,${attachment.base64}`;

  if (interaction === "image") {
    return (
      <ImageViewer
        src={src}
        alt={filename}
        triggerClassName="h-16 w-16 flex-shrink-0 rounded-lg border border-border"
      >
        <img src={src} alt={filename} className="h-full w-full object-cover" />
      </ImageViewer>
    );
  }

  const chipClass = cn(
    "flex items-center gap-1.5 rounded-lg border border-border bg-secondary/60 px-2.5 py-1.5 text-xs text-muted-foreground",
    "transition-colors duration-150 hover:bg-secondary hover:text-foreground",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  );

  if (interaction === "text") {
    return (
      <TextFileViewer base64={attachment.base64} filename={filename} triggerClassName={chipClass}>
        <FileTypeIcon mime={attachment.mime} />
        <span className="max-w-[120px] truncate">{filename}</span>
      </TextFileViewer>
    );
  }

  // download — PDFs, archives, binaries
  return (
    <button
      type="button"
      aria-label={`Download ${filename}`}
      onClick={() => downloadAttachment(attachment)}
      className={chipClass}
    >
      <FileTypeIcon mime={attachment.mime} />
      <span className="max-w-[120px] truncate">{filename}</span>
    </button>
  );
}

function UserBubble({ message }: { message: UserMessage }) {
  const hasAttachments = message.attachments && message.attachments.length > 0;

  return (
    <div className="flex justify-end">
      <div className={cn("max-w-[75%]", message.queued && "opacity-50")}>
        {hasAttachments && (
          <div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
            {message.attachments!.map((att, i) => (
              <AttachmentChip key={i} attachment={att} />
            ))}
          </div>
        )}
        {message.content && (
          <div className="rounded-2xl rounded-tr-sm bg-grind-elevated px-4 py-2.5 text-sm text-foreground leading-relaxed whitespace-pre-wrap break-words">
            {message.content}
          </div>
        )}
        {message.queued && (
          <div className="mt-1 flex items-center justify-end gap-1 pr-1">
            <HourglassIcon size={10} aria-hidden="true" className="text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">queued</span>
          </div>
        )}
      </div>
    </div>
  );
}

function AssistantBubble({
  message,
  companionEmoji,
}: {
  message: AssistantMessage;
  companionEmoji: string;
}) {
  const hasContent = message.content.trim().length > 0;
  const hasTools = message.toolCalls.length > 0;
  const showAvatar = hasContent || hasTools;

  return (
    <div className="flex items-start gap-2 justify-start">
      {showAvatar ? (
        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-grind-orange/20 bg-grind-orange/10">
          <span aria-hidden="true" className="text-[10px] leading-none">
            {companionEmoji}
          </span>
        </div>
      ) : (
        <div className="w-5 shrink-0" />
      )}
      <div className="max-w-[85%] w-full space-y-1">
        {hasTools && (
          <div className="space-y-1">
            {message.toolCalls.map((tc) => (
              <ToolCallCard
                key={tc.id}
                toolName={tc.toolName}
                toolArgsJson={tc.toolArgsJson}
                status={tc.status}
                {...(tc.toolResultJson !== undefined ? { toolResultJson: tc.toolResultJson } : {})}
              />
            ))}
          </div>
        )}

        {(hasContent || message.isStreaming) && (
          <div className="rounded-2xl rounded-tl-sm bg-card px-4 py-2.5 text-sm text-foreground leading-relaxed border border-border/50">
            <MarkdownContent content={message.content} />
            {message.isStreaming && (
              <span
                aria-label="AI is typing"
                className="ml-0.5 inline-block h-[1em] w-[2px] bg-grind-orange motion-safe:animate-blink align-middle"
              />
            )}
          </div>
        )}

        {!hasContent && !hasTools && message.isStreaming && (
          <div className="rounded-2xl rounded-tl-sm bg-card px-4 py-2.5 border border-border/50">
            <span aria-label="AI is thinking" className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full bg-muted-foreground motion-safe:animate-pulse"
                  style={{ animationDelay: `${i * 150}ms` }}
                />
              ))}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>,
        h1: ({ children }) => (
          <h1 className="text-base font-bold mt-4 mb-2 first:mt-0">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-sm font-bold mt-3 mb-1.5 first:mt-0">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-sm font-semibold mt-2 mb-1 first:mt-0">{children}</h3>
        ),
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        del: ({ children }) => <del className="line-through text-muted-foreground">{children}</del>,
        ul: ({ children }) => (
          <ul className="mb-3 last:mb-0 space-y-0.5 pl-4 list-disc">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-3 last:mb-0 space-y-0.5 pl-4 list-decimal">{children}</ol>
        ),
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-border pl-3 my-2 text-muted-foreground italic">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="my-3 border-border" />,
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-sm text-primary underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {children}
            <span className="sr-only"> (opens in new tab)</span>
          </a>
        ),
        code: ({ className, children, ...props }) => {
          const isBlock = "data-language" in props || className?.startsWith("language-");
          if (isBlock) {
            return <code className={cn("block", className)}>{children}</code>;
          }
          return (
            <code className="rounded px-1 py-0.5 bg-muted font-mono text-[0.8em]">{children}</code>
          );
        },
        pre: ({ children }) => (
          <pre className="my-2 overflow-x-auto rounded-lg bg-muted px-3 py-2.5 text-xs font-mono leading-relaxed">
            {children}
          </pre>
        ),
        table: ({ children }) => (
          <div className="my-2 overflow-x-auto">
            <table className="w-full border-collapse text-xs">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="border-b border-border">{children}</thead>,
        tbody: ({ children }) => <tbody>{children}</tbody>,
        tr: ({ children }) => (
          <tr className="border-b border-border/50 last:border-0">{children}</tr>
        ),
        th: ({ children }) => (
          <th className="px-2 py-1.5 text-left font-semibold text-foreground">{children}</th>
        ),
        td: ({ children }) => <td className="px-2 py-1.5 text-muted-foreground">{children}</td>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function ToolResultBubble({ message }: { message: ToolMessage }) {
  const label = TOOL_LABELS[message.toolName] ?? message.toolName;

  return (
    <div className="my-1 overflow-hidden rounded-r-lg border-l-2 border-grind-xp/40 bg-secondary/30">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <LightningIcon
          size={12}
          weight="fill"
          aria-hidden="true"
          className="shrink-0 text-muted-foreground/60"
        />
        <span className="flex-1 truncate font-mono text-xs text-muted-foreground">
          {label}
          {message.content && (
            <span className="text-muted-foreground/60"> · {message.content}</span>
          )}
        </span>
        <span className="text-[10px] text-grind-xp/80">done</span>
      </div>
    </div>
  );
}

interface MessageBubbleProps {
  message: ChatMessage;
  companionEmoji?: string;
}

export function MessageBubble({ message, companionEmoji = "⚡" }: MessageBubbleProps) {
  if (message.role === "user") return <UserBubble message={message} />;
  if (message.role === "tool") return <ToolResultBubble message={message} />;
  return <AssistantBubble message={message} companionEmoji={companionEmoji} />;
}
