import type { ReactNode } from "react";
import { cn } from "#/lib/utils";

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon?: ReactNode;
  accent?: "orange" | "green" | "purple" | "default";
  className?: string;
}

const accentClasses: Record<string, string> = {
  orange: "text-grind-orange",
  green: "text-grind-xp",
  purple: "text-[oklch(0.72_0.19_285)]",
  default: "text-foreground",
};

export function StatCard({
  label,
  value,
  sub,
  icon,
  accent = "default",
  className,
}: StatCardProps) {
  const valueClass = accentClasses[accent] ?? accentClasses["default"];

  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-xl border border-border bg-card px-5 py-4",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon && (
          <span aria-hidden="true" className="shrink-0">
            {icon}
          </span>
        )}
        {label}
      </div>
      <div
        className={cn("font-mono text-2xl font-semibold leading-none tabular-nums", valueClass)}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
