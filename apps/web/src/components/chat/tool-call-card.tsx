import { useState } from "react";
import { CaretDownIcon, LightningIcon } from "@phosphor-icons/react";
import { cn } from "#/lib/utils";

export const TOOL_LABELS: Record<string, string> = {
  get_status: "Get status",
  list_quests: "List quests",
  create_quest: "Create quest",
  complete_quest: "Complete quest",
  abandon_quest: "Abandon quest",
  start_timer: "Start timer",
  stop_timer: "Stop timer",
  get_timer: "Get timer",
  analyze_patterns: "Analyze patterns",
  suggest_quest: "Suggest quest",
  list_forge_rules: "List forge rules",
  list_forge_runs: "List forge runs",
  create_forge_rule: "Create forge rule",
  update_forge_rule: "Update forge rule",
  run_forge_rule: "Run forge rule",
  delete_forge_rule: "Delete forge rule",
  fetch_url: "Fetch URL",
  web_search: "Web search",
  read_file: "Read file",
  write_file: "Write file",
  edit_file: "Edit file",
  glob: "Glob",
  grep: "Search",
  bash: "Run command",
  send_telegram_message: "Send Telegram",
  get_integrations_status: "Check integrations",
  get_calendar_events: "Get calendar events",
  create_calendar_event: "Create calendar event",
  update_calendar_event: "Update calendar event",
  delete_calendar_event: "Delete calendar event",
  get_emails: "Get emails",
  send_email: "Send email",
};

interface ToolCallCardProps {
  toolName: string;
  toolArgsJson: string;
  toolResultJson?: string;
  status: "pending" | "complete";
}

function tryFormatJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

// ── Calendar agenda helpers ───────────────────────────────────────────────────

interface CalendarEventDateTime {
  dateTime?: string;
  date?: string;
}

interface CalendarEvent {
  id: string;
  summary?: string;
  start: CalendarEventDateTime;
  end: CalendarEventDateTime;
}

interface DateGroup {
  dateKey: string;
  label: string;
  events: Array<{
    id: string;
    time: string;
    title: string;
    duration: string;
    isAllDay: boolean;
  }>;
}

function getDateKey(event: CalendarEvent): string {
  if (event.start.date) return event.start.date;
  if (!event.start.dateTime) return "";
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(event.start.dateTime));
}

function formatDateLabel(dateKey: string): string {
  const parts = dateKey.split("-");
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
    .format(date)
    .replace(",", "");
}

function formatTime(dt: CalendarEventDateTime): string {
  if (!dt.dateTime) return "All day";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(dt.dateTime));
}

function formatDuration(start: CalendarEventDateTime, end: CalendarEventDateTime): string {
  if (!start.dateTime || !end.dateTime) return "";
  const ms = new Date(end.dateTime).getTime() - new Date(start.dateTime).getTime();
  const totalMins = Math.round(ms / 60000);
  if (totalMins <= 0) return "";
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function groupCalendarEvents(events: CalendarEvent[]): DateGroup[] {
  const map = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = getDateKey(event);
    if (!key) continue;
    const bucket = map.get(key);
    if (bucket) bucket.push(event);
    else map.set(key, [event]);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateKey, dayEvents]) => {
      const sorted = [...dayEvents].sort((a, b) => {
        const aAllDay = Boolean(a.start.date);
        const bAllDay = Boolean(b.start.date);
        if (aAllDay && !bAllDay) return -1;
        if (!aAllDay && bAllDay) return 1;
        if (a.start.dateTime && b.start.dateTime)
          return new Date(a.start.dateTime).getTime() - new Date(b.start.dateTime).getTime();
        return 0;
      });
      return {
        dateKey,
        label: formatDateLabel(dateKey),
        events: sorted.map((e) => ({
          id: e.id,
          time: formatTime(e.start),
          title: e.summary ?? "(no title)",
          duration: Boolean(e.start.date) ? "" : formatDuration(e.start, e.end),
          isAllDay: Boolean(e.start.date),
        })),
      };
    });
}

function CalendarAgenda({ resultJson }: { resultJson: string }) {
  let parsed: { ok?: boolean; events?: CalendarEvent[]; count?: number };
  try {
    parsed = JSON.parse(resultJson) as typeof parsed;
  } catch {
    return null;
  }

  if (!parsed.ok || !Array.isArray(parsed.events)) return null;

  if (parsed.events.length === 0) {
    return <p className="py-2 text-xs text-muted-foreground italic">No events in this period.</p>;
  }

  const groups = groupCalendarEvents(parsed.events);

  return (
    <div className="space-y-3 py-1">
      {groups.map((group) => (
        <div key={group.dateKey}>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {group.label}
          </p>
          <div className="space-y-0.5">
            {group.events.map((event) => (
              <div key={event.id} className="flex items-baseline gap-3 text-xs">
                <span
                  className={cn(
                    "w-16 shrink-0 text-right font-mono tabular-nums",
                    event.isAllDay ? "text-muted-foreground/60 italic" : "text-muted-foreground",
                  )}
                >
                  {event.time}
                </span>
                <span className="min-w-0 flex-1 text-foreground/90">
                  {event.title}
                  {event.duration && (
                    <span className="ml-1.5 text-muted-foreground">· {event.duration}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ToolCallCard({
  toolName,
  toolArgsJson,
  toolResultJson,
  status,
}: ToolCallCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const label = TOOL_LABELS[toolName] ?? toolName;
  const isPending = status === "pending";

  const formattedArgs = tryFormatJson(toolArgsJson);
  const formattedResult = toolResultJson != null ? tryFormatJson(toolResultJson) : null;

  const isCalendarTool = toolName === "get_calendar_events";

  return (
    <div
      className={cn(
        "my-1 overflow-hidden rounded-r-lg border-l-2 bg-secondary/30",
        isPending ? "border-grind-orange/60" : "border-grind-xp/40",
      )}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors duration-100 hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={() => setIsExpanded((prev) => !prev)}
        aria-expanded={isExpanded}
        aria-controls={`tool-call-${toolName}-body`}
      >
        <LightningIcon
          size={12}
          weight="fill"
          aria-hidden="true"
          className={cn(
            "shrink-0 transition-colors duration-150",
            isPending ? "text-grind-orange animate-pulse" : "text-muted-foreground/60",
          )}
        />
        <span
          className={cn(
            "flex-1 font-mono text-xs",
            isPending ? "text-foreground/70" : "text-muted-foreground",
          )}
        >
          {label}
        </span>
        {isPending && (
          <span className="text-[10px] text-muted-foreground/60 tabular-nums" aria-live="polite">
            running…
          </span>
        )}
        {!isPending && <span className="text-[10px] text-grind-xp/80">done</span>}
        <CaretDownIcon
          size={11}
          aria-hidden="true"
          className={cn(
            "shrink-0 text-muted-foreground/50 transition-transform duration-150",
            isExpanded ? "rotate-180" : "",
          )}
        />
      </button>

      {isExpanded && (
        <div
          id={`tool-call-${toolName}-body`}
          className="border-t border-border/30 px-3 py-2 space-y-2"
        >
          <div>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
              Input
            </p>
            <pre className="overflow-x-auto rounded bg-background/60 p-2 font-mono text-[11px] text-foreground/70 leading-relaxed">
              {formattedArgs}
            </pre>
          </div>

          {formattedResult != null && (
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                Output
              </p>
              {isCalendarTool ? (
                <div className="rounded bg-background/60 px-3 py-2">
                  <CalendarAgenda resultJson={toolResultJson!} />
                </div>
              ) : (
                <pre className="max-h-48 overflow-auto rounded bg-background/60 p-2 font-mono text-[11px] text-foreground/70 leading-relaxed">
                  {formattedResult}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
