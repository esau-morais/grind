import { cn } from "#/lib/utils";
import type { ActivityItem } from "#/server/data.functions";

const PROOF_LABELS: Record<string, string> = {
  "self-report": "self",
  timestamp: "timestamp",
  duration: "timed",
  screenshot: "screenshot",
  "git-commit": "git",
  "file-change": "file",
  "process-check": "process",
  "ai-verify": "AI verified",
  "calendar-match": "calendar",
  "multi-proof": "multi",
};

const PROOF_MULTIPLIERS: Record<string, number> = {
  "self-report": 1.0,
  timestamp: 1.1,
  duration: 1.5,
  screenshot: 1.25,
  "git-commit": 1.5,
  "file-change": 1.5,
  "process-check": 1.5,
  "ai-verify": 1.75,
  "calendar-match": 1.1,
  "multi-proof": 2.0,
};

function formatRelativeTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

interface ActivityItemRowProps {
  item: ActivityItem;
  className?: string;
}

export function ActivityItemRow({ item, className }: ActivityItemRowProps) {
  const proofLabel = PROOF_LABELS[item.proofType] ?? item.proofType;
  const multiplier = PROOF_MULTIPLIERS[item.proofType] ?? 1.0;

  const timeLabel = formatRelativeTime(item.completedAt);

  const durationStr = item.durationMinutes != null ? `${item.durationMinutes}m` : null;

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-150 hover:bg-secondary/40",
        className,
      )}
    >
      <span aria-hidden="true" className="shrink-0 text-base">
        ✅
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm text-foreground">{item.questTitle}</span>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <time dateTime={new Date(item.completedAt).toISOString()}>{timeLabel}</time>
          {durationStr && (
            <>
              <span aria-hidden="true">·</span>
              <span>{durationStr}</span>
            </>
          )}
          <span aria-hidden="true">·</span>
          <span
            className={cn(
              "rounded px-1 py-0.5 font-mono text-[10px]",
              item.proofType === "ai-verify"
                ? "bg-[oklch(0.72_0.19_285)]/10 text-[oklch(0.72_0.19_285)]"
                : item.proofType === "duration" || item.proofType === "multi-proof"
                  ? "bg-grind-xp/10 text-grind-xp"
                  : "bg-secondary text-muted-foreground",
            )}
          >
            {proofLabel}
            {multiplier > 1 && ` ${multiplier}×`}
          </span>
        </div>
      </div>

      <div className="shrink-0 text-right">
        <span
          className="font-mono text-sm font-semibold text-grind-xp tabular-nums"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          +{item.xpEarned}
        </span>
        <span className="ml-0.5 text-xs text-muted-foreground">XP</span>
      </div>
    </div>
  );
}
