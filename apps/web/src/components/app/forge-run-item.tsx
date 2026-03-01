import { useState } from "react";
import { CaretRightIcon } from "@phosphor-icons/react";
import { cn } from "#/lib/utils";
import { StatusIcon } from "./status-icon";
import { formatRelativeTime } from "./forge-rule-row";

export interface SimpleForgeRun {
  id: string;
  ruleId: string;
  ruleName: string;
  triggerType: string;
  actionType: string;
  status: string;
  error?: string;
  startedAt: number;
  finishedAt: number;
}

interface ForgeRunItemProps {
  run: SimpleForgeRun;
  className?: string;
}

const STATUS_CLASS: Record<string, string> = {
  success: "text-grind-xp",
  failed: "text-red-400",
  skipped: "text-muted-foreground",
};

const ACTION_LABELS: Record<string, string> = {
  "queue-quest": "queue-quest",
  "send-notification": "notify",
  "update-skill": "update-skill",
  "log-to-vault": "log",
  "trigger-companion": "companion",
  "run-script": "script",
};

function formatExactTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function ForgeRunItem({ run, className }: ForgeRunItemProps) {
  const [expanded, setExpanded] = useState(false);
  const statusClass = STATUS_CLASS[run.status] ?? "text-muted-foreground";
  const iconStatus =
    run.status === "success" ? "completed" : run.status === "failed" ? "failed" : "skipped";
  const hasError = run.error !== undefined && run.error.length > 0;
  const duration = run.finishedAt - run.startedAt;

  return (
    <div className={cn("flex flex-col", className)}>
      <button
        type="button"
        onClick={hasError ? () => setExpanded((v) => !v) : undefined}
        aria-expanded={hasError ? expanded : undefined}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
          hasError
            ? "cursor-pointer hover:bg-secondary/40"
            : "cursor-default hover:bg-secondary/40",
        )}
      >
        <StatusIcon status={iconStatus} size={14} className={statusClass} />

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm text-foreground">{run.ruleName}</span>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {ACTION_LABELS[run.actionType] ?? run.actionType}
            </span>
          </div>
          {hasError && (
            <span className="truncate font-mono text-[10px] text-red-400">{run.error}</span>
          )}
        </div>

        <span className="shrink-0 text-xs text-muted-foreground">
          {formatRelativeTime(run.startedAt)}
        </span>

        {hasError && (
          <CaretRightIcon
            size={12}
            aria-hidden="true"
            className={cn(
              "shrink-0 text-muted-foreground/50 transition-transform duration-150",
              expanded && "rotate-90",
            )}
          />
        )}
      </button>

      {hasError && expanded && (
        <div className="mx-3 mb-2.5 flex flex-col gap-1.5">
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background/60 px-3 py-2 font-mono text-[10px] text-red-400">
            {run.error}
          </pre>
          <div className="flex items-center gap-3 font-mono text-[10px] text-muted-foreground/70">
            <span>{formatExactTime(run.startedAt)}</span>
            <span>·</span>
            <span>{formatDuration(duration)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
