import { useTheme } from "../theme/context";

interface StatusBarProps {
  items: Array<{ key: string; label: string }>;
}

export function StatusBar(props: StatusBarProps) {
  const {
    theme: { colors },
  } = useTheme();
  return (
    <box
      style={{
        flexDirection: "row",
        width: "100%",
        height: 1,
        paddingLeft: 1,
        paddingRight: 1,
        gap: 2,
        backgroundColor: colors.bgPanel,
      }}
    >
      {props.items.map((item) => (
        <text key={item.key} fg={colors.textDim}>
          [<span fg={colors.accent}>{item.key}</span>]{item.label}
        </text>
      ))}
    </box>
  );
}
