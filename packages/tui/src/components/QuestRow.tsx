import type { Quest } from "@grindxp/core";
import { difficultyLabel, statusIcon } from "../lib/format";
import { useTheme } from "../theme/context";
import type { ResolvedColors } from "../theme/types";

interface QuestRowProps {
  quest: Quest;
  selected?: boolean;
}

function diffColor(d: string, c: ResolvedColors): string {
  return (c as Record<string, string>)[d] ?? c.text;
}

function statusColor(s: string, c: ResolvedColors): string {
  return (c as Record<string, string>)[s] ?? c.text;
}

export function QuestRow(props: QuestRowProps) {
  const { quest, selected } = props;
  const {
    theme: { colors },
  } = useTheme();
  const bg = selected ? colors.bgHighlight : "transparent";
  const icon = statusIcon(quest.status);
  const diff = difficultyLabel(quest.difficulty);
  const streak = quest.streakCount > 0 ? ` ${quest.streakCount}d` : "";

  return (
    <box
      style={{
        flexDirection: "row",
        width: "100%",
        height: 1,
        paddingLeft: 1,
        paddingRight: 1,
        gap: 1,
        backgroundColor: bg,
      }}
    >
      <text fg={statusColor(quest.status, colors)}>{icon}</text>
      <text fg={selected ? colors.white : colors.text}>{quest.title}</text>
      <text fg={diffColor(quest.difficulty, colors)}>{diff}</text>
      <text fg={colors.ghost}>{quest.type}</text>
      {streak ? <text fg={colors.streak}>{streak}🔥</text> : null}
    </box>
  );
}
