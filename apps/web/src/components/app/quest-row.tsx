import { cn } from "#/lib/utils";
import type { SimpleQuest, SimpleObjective } from "#/server/data.functions";

const DIFFICULTY_DOTS: Record<string, string> = {
  easy: "◆◇◇",
  medium: "◆◆◇",
  hard: "◆◆◆",
  epic: "◆◆◆★",
};

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: "text-grind-xp",
  medium: "text-grind-orange",
  hard: "text-[oklch(0.65_0.24_27)]",
  epic: "text-[oklch(0.72_0.19_285)]",
};

const TYPE_LABELS: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly",
  epic: "Epic",
  bounty: "Bounty",
  chain: "Chain",
  ritual: "Ritual",
};

function ObjectiveCheck({ objective }: { objective: SimpleObjective }) {
  return (
    <span
      aria-label={
        objective.completed ? `${objective.label} — done` : `${objective.label} — pending`
      }
      className={cn(
        "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[10px] font-bold",
        objective.completed
          ? "border-grind-xp/40 bg-grind-xp/10 text-grind-xp"
          : "border-border bg-transparent text-transparent",
      )}
    >
      {objective.completed ? "✓" : ""}
    </span>
  );
}

interface QuestRowProps {
  quest: SimpleQuest;
  className?: string;
}

export function QuestRow({ quest, className }: QuestRowProps) {
  const completedObjectives = quest.objectives.filter((o) => o.completed).length;
  const totalObjectives = quest.objectives.length;
  const difficultyDots = DIFFICULTY_DOTS[quest.difficulty] ?? "◆◇◇";
  const difficultyColor = DIFFICULTY_COLORS[quest.difficulty] ?? "text-muted-foreground";
  const typeLabel = TYPE_LABELS[quest.type] ?? quest.type;

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3 transition-colors duration-150 hover:border-border/80 hover:bg-card/80",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-medium text-foreground">{quest.title}</span>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px]">
              {typeLabel}
            </span>
            {quest.streakCount > 0 && (
              <span className="text-grind-orange" aria-label={`${quest.streakCount} day streak`}>
                🔥 {quest.streakCount}d
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={cn("font-mono text-sm font-semibold", difficultyColor)}
            aria-label={`Difficulty: ${quest.difficulty}`}
          >
            {difficultyDots}
          </span>
          {totalObjectives > 0 && (
            <span
              className="text-xs text-muted-foreground"
              aria-label={`${completedObjectives} of ${totalObjectives} objectives complete`}
            >
              {completedObjectives}/{totalObjectives}
            </span>
          )}
        </div>
      </div>

      {quest.objectives.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {quest.objectives.map((obj) => (
            <div key={obj.id} className="flex items-center gap-1.5">
              <ObjectiveCheck objective={obj} />
              <span
                className={cn(
                  "text-xs",
                  obj.completed ? "text-muted-foreground line-through" : "text-foreground",
                )}
              >
                {obj.label}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">+{quest.baseXp} XP base</span>
      </div>
    </div>
  );
}
