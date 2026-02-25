import { useMemo } from "react";
import { QuestRow } from "../components/QuestRow";
import { StreakBar } from "../components/StreakBar";
import { XpBar } from "../components/XpBar";
import { formatElapsedShort, levelTitle, streakDisplay, xpProgress } from "../lib/format";
import { useStore } from "../lib/store";
import { useTheme } from "../theme/context";

function proficiencyDots(level: number): string {
  const filled = Math.min(level, 5);
  return "●".repeat(filled) + "○".repeat(5 - filled);
}

export function DashboardScreen() {
  const { user, quests, skills, timer } = useStore();
  const {
    theme: { colors },
  } = useTheme();
  const xp = xpProgress(user);

  const activeQuests = useMemo(() => quests.filter((q) => q.status === "active"), [quests]);

  const completedToday = useMemo(() => {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const ts = dayStart.getTime();
    return quests.filter((q) => q.status === "completed" && q.completedAt && q.completedAt >= ts);
  }, [quests]);

  const bestStreak = useMemo(() => {
    const streaks = activeQuests.map((q) => q.streakCount);
    return streaks.length > 0 ? Math.max(...streaks) : 0;
  }, [activeQuests]);

  return (
    <box style={{ flexDirection: "column", width: "100%", flexGrow: 1, gap: 1 }}>
      {/* Main content: two columns */}
      <box style={{ flexDirection: "row", width: "100%", flexGrow: 1, gap: 1 }}>
        {/* Left: Active Quests */}
        <box
          title="Active Quests"
          style={{
            flexGrow: 1,
            flexDirection: "column",
            border: true,
            borderColor: colors.border,
            padding: 1,
          }}
        >
          {activeQuests.length === 0 ? (
            <text fg={colors.ghost}>No active quests. Create one with `grindxp quest create`.</text>
          ) : (
            activeQuests.map((q) => <QuestRow key={q.id} quest={q} />)
          )}

          {timer ? (
            <box style={{ marginTop: 1 }}>
              <text fg={colors.warn}>
                ⏱ Timer running: {timer.questTitle} (
                {formatElapsedShort(Date.now() - timer.startedAt)})
              </text>
            </box>
          ) : null}
        </box>

        {/* Right: Stats */}
        <box
          title="Stats"
          style={{
            width: 30,
            flexDirection: "column",
            border: true,
            borderColor: colors.border,
            padding: 1,
            gap: 1,
          }}
        >
          <box style={{ flexDirection: "column" }}>
            <text fg={colors.level}>
              Lv.{user.level} {levelTitle(user.level)}
            </text>
            <XpBar progress={xp.progress} needed={xp.needed} width={16} />
          </box>

          <box style={{ flexDirection: "column" }}>
            <text fg={colors.muted}>Total XP</text>
            <text fg={colors.xpBright}>{user.totalXp}</text>
          </box>

          <box style={{ flexDirection: "column" }}>
            <text fg={colors.muted}>Active</text>
            <text fg={colors.text}>{activeQuests.length}/5</text>
          </box>

          <box style={{ flexDirection: "column" }}>
            <text fg={colors.muted}>Done Today</text>
            <text fg={colors.success}>{completedToday.length}</text>
          </box>

          <box style={{ flexDirection: "column" }}>
            <text fg={colors.muted}>Best Streak</text>
            <StreakBar days={bestStreak} width={12} />
          </box>

          {skills.length > 0 ? (
            <box style={{ flexDirection: "column" }}>
              <text fg={colors.muted}>Top Skills</text>
              {skills.slice(0, 4).map((s) => (
                <text key={s.id} fg={colors.text}>
                  {proficiencyDots(s.level)} {s.name}
                </text>
              ))}
            </box>
          ) : null}
        </box>
      </box>

      {/* Bottom: Recently completed */}
      {completedToday.length > 0 ? (
        <box
          title="Completed Today"
          style={{
            width: "100%",
            height: Math.min(completedToday.length + 2, 6),
            flexDirection: "column",
            border: true,
            borderColor: colors.border,
            paddingLeft: 1,
            paddingRight: 1,
          }}
        >
          {completedToday.slice(0, 4).map((q) => (
            <QuestRow key={q.id} quest={q} />
          ))}
        </box>
      ) : null}
    </box>
  );
}
