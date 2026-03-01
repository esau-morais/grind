import {
  TimerIcon,
  WifiHighIcon,
  LightningIcon,
  GlobeIcon,
  HandIcon,
  SparkleIcon,
  ScrollIcon,
  BellRingingIcon,
  ArrowUpIcon,
  DatabaseIcon,
  TerminalWindowIcon,
} from "@phosphor-icons/react";
import { cn } from "#/lib/utils";
import type { ReactNode } from "react";
import { StatusIcon } from "./status-icon";

export interface SimpleForgeRule {
  id: string;
  name: string;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  actionType: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

const TRIGGER_CONFIG: Record<string, { icon: ReactNode; label: string }> = {
  cron: { icon: <TimerIcon size={12} weight="duotone" aria-hidden="true" />, label: "cron" },
  signal: { icon: <WifiHighIcon size={12} weight="duotone" aria-hidden="true" />, label: "signal" },
  event: { icon: <LightningIcon size={12} weight="duotone" aria-hidden="true" />, label: "event" },
  webhook: { icon: <GlobeIcon size={12} weight="duotone" aria-hidden="true" />, label: "webhook" },
  manual: { icon: <HandIcon size={12} weight="duotone" aria-hidden="true" />, label: "manual" },
  companion: {
    icon: <SparkleIcon size={12} weight="duotone" aria-hidden="true" />,
    label: "companion",
  },
};

const ACTION_CONFIG: Record<string, { icon: ReactNode; label: string }> = {
  "queue-quest": {
    icon: <ScrollIcon size={12} weight="duotone" aria-hidden="true" />,
    label: "queue-quest",
  },
  "send-notification": {
    icon: <BellRingingIcon size={12} weight="duotone" aria-hidden="true" />,
    label: "notify",
  },
  "update-skill": {
    icon: <ArrowUpIcon size={12} weight="duotone" aria-hidden="true" />,
    label: "update-skill",
  },
  "log-to-vault": {
    icon: <DatabaseIcon size={12} weight="duotone" aria-hidden="true" />,
    label: "log",
  },
  "trigger-companion": {
    icon: <SparkleIcon size={12} weight="duotone" aria-hidden="true" />,
    label: "companion",
  },
  "run-script": {
    icon: <TerminalWindowIcon size={12} weight="duotone" aria-hidden="true" />,
    label: "script",
  },
};

function ForgePill({ icon, label, sub }: { icon: ReactNode; label: string; sub?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2 py-1 font-mono text-[10px] text-muted-foreground">
      {icon}
      <span>{label}</span>
      {sub !== undefined && <span className="text-foreground/50">{sub}</span>}
    </span>
  );
}

interface ForgeFlowProps {
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  actionType: string;
}

export function ForgeFlow({ triggerType, triggerConfig, actionType }: ForgeFlowProps) {
  const trigger = TRIGGER_CONFIG[triggerType] ?? {
    icon: <LightningIcon size={12} weight="duotone" aria-hidden="true" />,
    label: triggerType,
  };
  const action = ACTION_CONFIG[actionType] ?? {
    icon: <LightningIcon size={12} weight="duotone" aria-hidden="true" />,
    label: actionType,
  };

  const sub =
    triggerType === "cron" && typeof triggerConfig["cron"] === "string"
      ? `"${triggerConfig["cron"]}"`
      : triggerType === "signal" && typeof triggerConfig["source"] === "string"
        ? triggerConfig["source"]
        : undefined;

  return (
    <div
      className="flex items-center gap-2"
      aria-label={`${trigger.label} triggers ${action.label}`}
    >
      <ForgePill
        icon={trigger.icon}
        label={trigger.label}
        {...(sub !== undefined ? { sub } : {})}
      />
      <svg width="36" height="14" viewBox="0 0 36 14" aria-hidden="true" className="shrink-0">
        <circle cx="4" cy="7" r="2.5" fill="oklch(0.50 0.015 286)" />
        <line x1="9" y1="7" x2="27" y2="7" stroke="oklch(0.35 0.015 286)" strokeWidth="1" />
        <circle cx="32" cy="7" r="2.5" fill="oklch(0.50 0.015 286)" />
      </svg>
      <ForgePill icon={action.icon} label={action.label} />
    </div>
  );
}

interface ForgeRuleRowProps {
  rule: SimpleForgeRule;
  runStats?: { successCount: number; failCount: number; lastRanAt: number | null };
  onToggle?: (ruleId: string, enabled: boolean) => void;
  isToggling?: boolean;
}

export function ForgeRuleRow({ rule, runStats, onToggle, isToggling }: ForgeRuleRowProps) {
  const handleToggle = () => {
    onToggle?.(rule.id, !rule.enabled);
  };

  const lastRan = runStats?.lastRanAt ? formatRelativeTime(runStats.lastRanAt) : null;

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-card px-4 py-3 transition-colors duration-150 hover:border-border/80">
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm font-medium text-foreground">{rule.name}</span>
        <button
          type="button"
          onClick={handleToggle}
          disabled={isToggling}
          aria-label={rule.enabled ? "Disable rule" : "Enable rule"}
          aria-pressed={rule.enabled}
          className={cn(
            "flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border px-1 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            rule.enabled ? "border-grind-xp/40 bg-grind-xp/20" : "border-border bg-secondary",
            isToggling && "cursor-wait opacity-60",
          )}
        >
          <span
            className={cn(
              "h-4 w-4 rounded-full transition-transform duration-200",
              rule.enabled ? "translate-x-5 bg-grind-xp" : "translate-x-0 bg-muted-foreground/40",
            )}
          />
        </button>
      </div>

      <ForgeFlow
        triggerType={rule.triggerType}
        triggerConfig={rule.triggerConfig}
        actionType={rule.actionType}
      />

      {runStats && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {lastRan !== null && <span>Last run: {lastRan}</span>}
          {runStats.successCount > 0 && (
            <span className="flex items-center gap-1">
              <StatusIcon status="completed" size={12} className="text-grind-xp" />
              {runStats.successCount}
            </span>
          )}
          {runStats.failCount > 0 && (
            <span className="flex items-center gap-1">
              <StatusIcon status="failed" size={12} className="text-red-400" />
              {runStats.failCount}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
