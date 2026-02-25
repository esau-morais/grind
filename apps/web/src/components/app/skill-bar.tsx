import { cn } from "#/lib/utils";
import type { SimpleSkill } from "#/server/data.functions";

const SKILL_LEVEL_THRESHOLDS = [0, 100, 300, 600, 1000, 1500] as const;
const SKILL_LEVEL_NAMES = [
  "Novice",
  "Apprentice",
  "Journeyman",
  "Expert",
  "Master",
  "Grandmaster",
] as const;

const CATEGORY_COLORS: Record<string, string> = {
  fitness: "bg-grind-xp",
  music: "bg-[oklch(0.72_0.19_285)]",
  academics: "bg-[oklch(0.72_0.19_220)]",
  discipline: "bg-grind-orange",
  life: "bg-[oklch(0.72_0.19_180)]",
};

function getSkillProgress(skill: SimpleSkill): {
  progress: number;
  xpInLevel: number;
  xpForLevel: number;
} {
  const level = Math.min(skill.level, 5);
  const currentThreshold = SKILL_LEVEL_THRESHOLDS[level] ?? 0;
  const nextThreshold = SKILL_LEVEL_THRESHOLDS[level + 1] ?? 1500;

  if (level >= 5) {
    return { progress: 1, xpInLevel: skill.xp - currentThreshold, xpForLevel: 1 };
  }

  const xpInLevel = Math.max(0, skill.xp - currentThreshold);
  const xpForLevel = nextThreshold - currentThreshold;
  const progress = Math.min(1, xpInLevel / xpForLevel);

  return { progress, xpInLevel, xpForLevel };
}

function LevelDots({ level }: { level: number }) {
  const capped = Math.min(level, 5);
  return (
    <span className="flex items-center gap-0.5" aria-label={`Level ${capped}`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={cn("h-1.5 w-1.5 rounded-full", i < capped ? "bg-grind-orange" : "bg-border")}
        />
      ))}
    </span>
  );
}

interface SkillBarProps {
  skill: SimpleSkill;
  className?: string;
}

export function SkillBar({ skill, className }: SkillBarProps) {
  const { progress } = getSkillProgress(skill);
  const levelName = SKILL_LEVEL_NAMES[Math.min(skill.level, 5)] ?? "Grandmaster";
  const barColor = CATEGORY_COLORS[skill.category] ?? "bg-primary";

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{skill.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{levelName}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <LevelDots level={skill.level} />
          <span
            className="font-mono text-xs text-muted-foreground tabular-nums"
            style={{ fontVariantNumeric: "tabular-nums" }}
            aria-label={`${skill.xp} XP`}
          >
            {skill.xp.toLocaleString()} XP
          </span>
        </div>
      </div>

      <div
        className="h-1 overflow-hidden rounded-full bg-secondary"
        role="progressbar"
        aria-valuenow={Math.round(progress * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${skill.name} progress: ${Math.round(progress * 100)}%`}
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-500", barColor)}
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </div>
  );
}
