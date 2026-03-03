import { useState, useCallback } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  FlameIcon,
  LightningIcon,
  SwordIcon,
  TrophyIcon,
  StarIcon,
  CopyIcon,
  CheckIcon,
} from "@phosphor-icons/react";
import { cn } from "#/lib/utils";
import { getDashboardData } from "#/server/data.functions";
import { StatCard } from "#/components/app/stat-card";
import { QuestRow } from "#/components/app/quest-row";
import { SkillBar } from "#/components/app/skill-bar";
import { ActivityItemRow } from "#/components/app/activity-item";

export const Route = createFileRoute("/app/")({
  loader: () => getDashboardData(),
  component: DashboardPage,
  errorComponent: DashboardError,
});

const LEVEL_TITLES: Record<number, string> = {
  1: "Newcomer",
  2: "Initiate",
  3: "Apprentice",
  4: "Journeyman",
  5: "Adept",
  6: "Expert",
  7: "Veteran",
  8: "Master",
  9: "Grandmaster",
  10: "Legend",
};

function xpForLevelThreshold(level: number): number {
  if (level <= 1) return 0;
  return 50 * level * level + 50 * level;
}

function getLevelProgress(totalXp: number, level: number): { progress: number; xpToNext: number } {
  const current = xpForLevelThreshold(level);
  const next = xpForLevelThreshold(level + 1);
  const xpInLevel = Math.max(0, totalXp - current);
  const xpForLevel = next - current;
  return {
    progress: Math.min(1, xpInLevel / xpForLevel),
    xpToNext: Math.max(0, next - totalXp),
  };
}

function CopyCommandBlock({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [command]);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card pl-4 pr-3 py-3">
      <code className="flex-1 font-mono text-sm text-grind-orange">{command}</code>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? "Copied" : `Copy command: ${command}`}
        className="flex shrink-0 items-center justify-center rounded-md p-1 text-muted-foreground transition-[transform,background-color,color] duration-150 active:scale-[0.97] hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="relative flex size-4 items-center justify-center">
          <CopyIcon
            size={14}
            aria-hidden="true"
            className={cn(
              "absolute transition-[opacity,filter,transform] duration-200",
              copied ? "opacity-0 blur-[4px] scale-75" : "opacity-100 blur-none scale-100",
            )}
          />
          <CheckIcon
            size={14}
            aria-hidden="true"
            className={cn(
              "absolute text-grind-xp transition-[opacity,filter,transform] duration-200",
              copied ? "opacity-100 blur-none scale-100" : "opacity-0 blur-[4px] scale-75",
            )}
          />
        </span>
      </button>
    </div>
  );
}

function DashboardError({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : "Something went wrong";
  const isNotInit = msg.includes("not initialized");

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full border border-border bg-card">
        <LightningIcon size={28} className="text-muted-foreground" aria-hidden="true" />
      </div>
      <div>
        <h1 className="text-lg font-semibold text-foreground">
          {isNotInit ? "Grind Not Initialized" : "Failed to Load Dashboard"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isNotInit ? "Run the command below in your terminal to get started." : msg}
        </p>
      </div>
      {isNotInit && <CopyCommandBlock command="grindxp init" />}
    </div>
  );
}

function DashboardPage() {
  const data = Route.useLoaderData();
  const {
    user,
    xpToday,
    bestStreak,
    questsCompletedTotal,
    activeQuests,
    topSkills,
    recentActivity,
  } = data;

  const levelTitle = LEVEL_TITLES[user.level] ?? `Lv.${user.level}`;
  const { progress: levelProgress, xpToNext } = getLevelProgress(user.totalXp, user.level);

  return (
    <div className="flex h-full flex-col">
      {/* Level header */}
      <header className="flex h-14 shrink-0 items-center border-b border-border bg-sidebar px-6">
        <div className="flex w-full items-center justify-between gap-4">
          <div className="md:ml-8 flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">Lv.{user.level}</span>
            <h1 className="font-display text-lg text-foreground">{levelTitle}</h1>
            <span className="text-sm text-muted-foreground">— {user.displayName}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {xpToNext.toLocaleString()} XP to next level
          </p>

          <div className="hidden w-48 sm:block">
            <div
              className="h-1.5 overflow-hidden rounded-full bg-secondary"
              role="progressbar"
              aria-valuenow={Math.round(levelProgress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Level progress: ${Math.round(levelProgress * 100)}%`}
            >
              <div
                className="h-full rounded-full bg-grind-orange transition-[width] duration-700"
                style={{ width: `${levelProgress * 100}%` }}
              />
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          {/* Stat cards row */}
          <section aria-label="Stats">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard
                label="Total XP"
                value={user.totalXp.toLocaleString()}
                icon={<StarIcon size={14} aria-hidden="true" />}
                accent="orange"
              />
              <StatCard
                label="XP Today"
                value={`+${xpToday.toLocaleString()}`}
                icon={<LightningIcon size={14} aria-hidden="true" />}
                accent="green"
              />
              <StatCard
                label="Best Streak"
                value={bestStreak}
                sub={
                  bestStreak > 0
                    ? `${bestStreak} day${bestStreak === 1 ? "" : "s"}`
                    : "No active streak"
                }
                icon={<FlameIcon size={14} aria-hidden="true" />}
                accent={bestStreak > 0 ? "orange" : "default"}
              />
              <StatCard
                label="Completed"
                value={questsCompletedTotal.toLocaleString()}
                sub="quest logs"
                icon={<TrophyIcon size={14} aria-hidden="true" />}
                accent="default"
              />
            </div>
          </section>

          {/* Active quests + skills */}
          <div className="grid gap-5 lg:grid-cols-2">
            {/* Active quests */}
            <section aria-labelledby="active-quests-heading">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h2
                  id="active-quests-heading"
                  className="flex items-center gap-2 text-sm font-medium text-foreground"
                >
                  <SwordIcon
                    size={16}
                    weight="fill"
                    className="text-grind-orange"
                    aria-hidden="true"
                  />
                  Active Quests
                </h2>
                {activeQuests.length > 0 && (
                  <span className="text-xs text-muted-foreground">{activeQuests.length}/5</span>
                )}
              </div>

              {activeQuests.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-8 text-center">
                  <SwordIcon size={28} className="text-muted-foreground/40" aria-hidden="true" />
                  <div>
                    <p className="text-sm text-muted-foreground">No active quests</p>
                    <p className="mt-0.5 text-xs text-muted-foreground/70">
                      Ask the{" "}
                      <Link
                        to="/app/chat"
                        search={{ c: undefined }}
                        className="text-grind-orange underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
                      >
                        Companion
                      </Link>{" "}
                      to create some
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {activeQuests.map((quest) => (
                    <QuestRow key={quest.id} quest={quest} />
                  ))}
                </div>
              )}
            </section>

            {/* Skills overview */}
            <section aria-labelledby="skills-heading">
              <h2
                id="skills-heading"
                className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground"
              >
                <LightningIcon
                  size={16}
                  weight="fill"
                  className="text-grind-orange"
                  aria-hidden="true"
                />
                Skills
              </h2>

              {topSkills.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-8 text-center">
                  <LightningIcon
                    size={28}
                    className="text-muted-foreground/40"
                    aria-hidden="true"
                  />
                  <p className="text-sm text-muted-foreground">
                    Skills appear as you complete quests
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
                  {topSkills.map((skill) => (
                    <SkillBar key={skill.id} skill={skill} />
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Recent activity */}
          <section aria-labelledby="activity-heading">
            <h2
              id="activity-heading"
              className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground"
            >
              <FlameIcon size={16} weight="fill" className="text-grind-orange" aria-hidden="true" />
              Recent Activity
            </h2>

            {recentActivity.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-8 text-center">
                <FlameIcon size={28} className="text-muted-foreground/40" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">
                  Your completed quests will appear here
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-card">
                {recentActivity.map((item, idx) => (
                  <div
                    key={item.id}
                    className={
                      idx < recentActivity.length - 1 ? "border-b border-border/50" : undefined
                    }
                  >
                    <ActivityItemRow item={item} />
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
