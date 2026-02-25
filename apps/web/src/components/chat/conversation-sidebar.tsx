import { PlusIcon } from "@phosphor-icons/react";
import { cn } from "#/lib/utils";
import type { ConversationItem } from "#/server/data.functions";

function formatConvTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const days = Math.floor(diff / 86_400_000);

  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(ts));
}

function getConvTitle(conv: ConversationItem): string {
  if (conv.title) return conv.title;
  return `Chat ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(conv.createdAt))}`;
}

interface ConversationSidebarProps {
  conversations: ConversationItem[];
  activeId: string | undefined;
  onSelect: (id: string) => void;
  onNew: () => void;
}

export function ConversationSidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
}: ConversationSidebarProps) {
  return (
    <aside
      className="flex w-52 shrink-0 flex-col border-r border-border bg-sidebar"
      aria-label="Conversations"
    >
      <div className="flex h-14 items-center justify-end px-3">
        <button
          type="button"
          onClick={onNew}
          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          aria-label="Start new conversation"
        >
          <PlusIcon size={15} aria-hidden="true" />
          New Chat
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pt-2 pb-3" aria-label="Conversation history">
        {conversations.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">
            No conversations yet
          </p>
        ) : (
          <ul role="list" className="space-y-0.5">
            {conversations.map((conv) => {
              const isActive = conv.id === activeId;
              const title = getConvTitle(conv);
              const timeLabel = formatConvTime(conv.updatedAt);

              return (
                <li key={conv.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(conv.id)}
                    className={cn(
                      "flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-left",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-primary [&]:hover:bg-sidebar-accent [&]:hover:text-sidebar-primary"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                    )}
                    aria-current={isActive ? "page" : undefined}
                    aria-label={`${title}, ${timeLabel}`}
                  >
                    <span className="truncate text-xs font-medium leading-tight">{title}</span>
                    <span className="text-[10px] text-muted-foreground">{timeLabel}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
    </aside>
  );
}
