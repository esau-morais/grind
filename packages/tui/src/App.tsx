import { useKeyboard, useRenderer } from "@opentui/react";
import { useCallback, useState } from "react";
import { Header } from "./components/Header";
import { StatusBar } from "./components/StatusBar";
import { DashboardScreen } from "./screens/DashboardScreen";
import { QuestsScreen } from "./screens/QuestsScreen";
import { SkillsScreen } from "./screens/SkillsScreen";
import { useTheme } from "./theme/context";

type Screen = "dashboard" | "quests" | "skills";

const SCREEN_LABELS: Record<Screen, string> = {
  dashboard: "Dashboard",
  quests: "Quests",
  skills: "Skills",
};

const NAV_KEYS: Array<{ key: string; label: string }> = [
  { key: "d", label: "ashboard" },
  { key: "q", label: "uests" },
  { key: "s", label: "kills" },
  { key: "c", label: "hat" },
  { key: "r", label: "efresh" },
  { key: "C-c", label: " quit" },
];

export function App(props: { onRefresh: () => Promise<void> }) {
  const [screen, setScreen] = useState<Screen>("dashboard");
  const renderer = useRenderer();
  const {
    theme: { colors },
  } = useTheme();

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      renderer.destroy();
      process.exit(0);
    }

    if (key.name === "d") setScreen("dashboard");
    else if (key.name === "q") setScreen("quests");
    else if (key.name === "s") setScreen("skills");
    else if (key.name === "c") {
      renderer.destroy();
      import("./chat").then((m) => m.startChat()).catch(() => process.exit(1));
    } else if (key.name === "r") props.onRefresh();
  });

  return (
    <box
      style={{
        flexDirection: "column",
        width: "100%",
        height: "100%",
        backgroundColor: colors.bg,
      }}
    >
      <Header />

      {/* Screen label */}
      <box style={{ height: 1, paddingLeft: 1, backgroundColor: colors.bgPanel }}>
        <text fg={colors.accent}>{SCREEN_LABELS[screen]}</text>
      </box>

      {/* Main content */}
      <box style={{ flexGrow: 1, width: "100%" }}>
        {screen === "dashboard" && <DashboardScreen />}
        {screen === "quests" && <QuestsScreen />}
        {screen === "skills" && <SkillsScreen />}
      </box>

      <StatusBar items={NAV_KEYS} />
    </box>
  );
}
