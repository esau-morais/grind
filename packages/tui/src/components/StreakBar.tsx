import { streakDisplay } from "../lib/format";
import { useTheme } from "../theme/context";

export function StreakBar(props: { days: number; width?: number }) {
  const {
    theme: { colors },
  } = useTheme();
  const w = props.width ?? 16;
  const info = streakDisplay(props.days);

  if (props.days <= 0) {
    return <text fg={colors.ghost}>{"░".repeat(w)} No streak</text>;
  }

  const filled = Math.round(info.ratio * w);
  const empty = w - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  const tierColor = props.days >= 61 ? colors.streakHot : colors.streak;
  const next = info.daysToNext !== null ? ` → ${info.nextTierName} in ${info.daysToNext}d` : "";

  return (
    <box style={{ flexDirection: "row", gap: 1 }}>
      <text>{info.icon}</text>
      <text fg={tierColor}>{bar}</text>
      <text fg={tierColor}>
        {props.days}d {info.tierName}
      </text>
      {next ? <text fg={colors.muted}>{next}</text> : null}
    </box>
  );
}
