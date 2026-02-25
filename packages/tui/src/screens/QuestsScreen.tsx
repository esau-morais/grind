import type { Quest, QuestStatus } from "@grindxp/core";
import { calculateStreakInfo } from "@grindxp/core";
import { useKeyboard } from "@opentui/react";
import { useCallback, useMemo, useState } from "react";
import { QuestRow } from "../components/QuestRow";
import { difficultyLabel, statusIcon } from "../lib/format";
import { useStore } from "../lib/store";
import { useTheme } from "../theme/context";

type Filter = "all" | "active" | "completed" | "abandoned";

const FILTERS: Filter[] = ["all", "active", "completed", "abandoned"];

export function QuestsScreen() {
  const { quests } = useStore();
  const {
    theme: { colors },
  } = useTheme();
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [detailMode, setDetailMode] = useState(false);

  const filtered = useMemo(() => {
    if (filter === "all") return quests;
    return quests.filter((q) => q.status === filter);
  }, [quests, filter]);

  const selectedQuest = filtered[selectedIdx] ?? null;

  useKeyboard((key) => {
    if (detailMode) {
      if (key.name === "escape" || key.name === "q") {
        setDetailMode(false);
      }
      return;
    }

    switch (key.name) {
      case "up":
      case "k":
        setSelectedIdx((i) => Math.max(0, i - 1));
        break;
      case "down":
      case "j":
        setSelectedIdx((i) => Math.min(filtered.length - 1, i + 1));
        break;
      case "return":
        if (selectedQuest) setDetailMode(true);
        break;
      case "tab": {
        const nextFilterIdx = (FILTERS.indexOf(filter) + 1) % FILTERS.length;
        setFilter(FILTERS[nextFilterIdx]!);
        setSelectedIdx(0);
        break;
      }
    }
  });

  if (detailMode && selectedQuest) {
    return <QuestDetail quest={selectedQuest} />;
  }

  return (
    <box style={{ flexDirection: "column", width: "100%", flexGrow: 1 }}>
      {/* Filter tabs */}
      <box style={{ flexDirection: "row", width: "100%", height: 1, paddingLeft: 1, gap: 2 }}>
        {FILTERS.map((f) => (
          <text key={f} fg={f === filter ? colors.accent : colors.textDim}>
            {f === filter ? `[${f.toUpperCase()}]` : f}
          </text>
        ))}
        <text fg={colors.ghost}>(tab to switch)</text>
      </box>

      {/* Quest list */}
      <scrollbox style={{ flexGrow: 1, width: "100%" }}>
        {filtered.length === 0 ? (
          <text fg={colors.ghost}>No quests matching filter.</text>
        ) : (
          filtered.map((q, i) => <QuestRow key={q.id} quest={q} selected={i === selectedIdx} />)
        )}
      </scrollbox>

      <box style={{ height: 1, paddingLeft: 1 }}>
        <text fg={colors.textDim}>
          [j/k] navigate [enter] detail [tab] filter [{filtered.length} quests]
        </text>
      </box>
    </box>
  );
}

function QuestDetail(props: { quest: Quest }) {
  const { quest } = props;
  const {
    theme: { colors },
  } = useTheme();
  const streak = calculateStreakInfo(quest.streakCount);
  const tags = quest.skillTags.length > 0 ? quest.skillTags.join(", ") : "none";

  return (
    <box
      title={quest.title}
      style={{
        flexDirection: "column",
        width: "100%",
        flexGrow: 1,
        border: true,
        borderColor: colors.border,
        padding: 1,
        gap: 1,
      }}
    >
      <box style={{ flexDirection: "column", gap: 0 }}>
        <text fg={colors.text}>
          Type: <span fg={colors.accent}>{quest.type}</span>
        </text>
        <text fg={colors.text}>
          Difficulty:{" "}
          <span fg={(colors as Record<string, string>)[quest.difficulty] ?? colors.text}>
            {difficultyLabel(quest.difficulty)}
          </span>
        </text>
        <text fg={colors.text}>
          Status:{" "}
          <span fg={(colors as Record<string, string>)[quest.status] ?? colors.text}>
            {statusIcon(quest.status)} {quest.status}
          </span>
        </text>
        <text fg={colors.text}>
          Base XP: <span fg={colors.xp}>{quest.baseXp}</span>
        </text>
        <text fg={colors.text}>
          Streak:{" "}
          <span fg={colors.streak}>
            {streak.count > 0 ? `${streak.count}d (${streak.tierName})` : "None"}
          </span>
        </text>
        <text fg={colors.text}>
          Skills: <span fg={colors.accent}>{tags}</span>
        </text>
      </box>

      {quest.description ? (
        <box style={{ marginTop: 1 }}>
          <text fg={colors.muted}>{quest.description}</text>
        </box>
      ) : null}

      <box style={{ marginTop: 1 }}>
        <text fg={colors.ghost}>ID: {quest.id}</text>
      </box>

      <box style={{ position: "absolute", bottom: 0, left: 1 }}>
        <text fg={colors.textDim}>[esc/q] back to list</text>
      </box>
    </box>
  );
}
