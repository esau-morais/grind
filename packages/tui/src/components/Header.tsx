import { levelTitle, xpProgress } from "../lib/format";
import { useStore } from "../lib/store";
import { useTheme } from "../theme/context";

export function Header() {
  const { user } = useStore();
  const {
    theme: { colors },
  } = useTheme();
  const xp = xpProgress(user);

  return (
    <box
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        width: "100%",
        height: 1,
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      <text fg={colors.xp}>
        <b>GRIND</b>
      </text>
      <text fg={colors.level}>
        Lv.{user.level} {levelTitle(user.level)} <span fg={colors.muted}>{user.totalXp} XP</span>
      </text>
    </box>
  );
}
