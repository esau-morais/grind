import { useTheme } from "../theme/context";

export function XpBar(props: { progress: number; needed: number; width?: number }) {
  const {
    theme: { colors },
  } = useTheme();
  const w = props.width ?? 20;
  const ratio = props.needed > 0 ? Math.min(1, props.progress / props.needed) : 0;
  const filled = Math.round(ratio * w);
  const empty = w - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);

  return (
    <box style={{ flexDirection: "row", gap: 1 }}>
      <text fg={colors.xp}>{bar}</text>
      <text fg={colors.muted}>
        {props.progress}/{props.needed} XP
      </text>
    </box>
  );
}
