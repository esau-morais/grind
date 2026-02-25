import { SKILL_LEVEL_THRESHOLDS } from "@grindxp/core";
import { useMemo } from "react";
import { useStore } from "../lib/store";
import { useTheme } from "../theme/context";

const PROFICIENCY = [
  "Novice",
  "Apprentice",
  "Journeyman",
  "Expert",
  "Master",
  "Grandmaster",
] as const;

function proficiencyDots(level: number): string {
  const filled = Math.min(level, 5);
  return "●".repeat(filled) + "○".repeat(5 - filled);
}

function xpToNextLevel(currentXp: number, currentLevel: number): string {
  if (currentLevel >= 5) return "MAX";
  const next = SKILL_LEVEL_THRESHOLDS[currentLevel + 1];
  if (next === undefined) return "MAX";
  const remaining = next - currentXp;
  return `${remaining} XP to Lv.${currentLevel + 1}`;
}

export function SkillsScreen() {
  const { skills } = useStore();
  const {
    theme: { colors },
  } = useTheme();

  const grouped = useMemo(() => {
    const groups = new Map<string, typeof skills>();
    for (const skill of skills) {
      const cat = skill.category;
      const list = groups.get(cat);
      if (list) list.push(skill);
      else groups.set(cat, [skill]);
    }
    return Array.from(groups.entries())
      .map(([category, list]) => ({
        category,
        skills: list.sort((a, b) => b.xp - a.xp),
      }))
      .sort((a, b) => {
        const aXp = a.skills.reduce((s, sk) => s + sk.xp, 0);
        const bXp = b.skills.reduce((s, sk) => s + sk.xp, 0);
        return bXp - aXp;
      });
  }, [skills]);

  if (grouped.length === 0) {
    return (
      <box style={{ flexDirection: "column", width: "100%", flexGrow: 1, padding: 2 }}>
        <text fg={colors.ghost}>No skills yet.</text>
        <text fg={colors.muted}>Complete quests with skill tags to grow your skill tree.</text>
        <text fg={colors.textDim}>Skills emerge from action, not configuration.</text>
      </box>
    );
  }

  return (
    <scrollbox style={{ flexDirection: "column", width: "100%", flexGrow: 1 }}>
      {grouped.map((group) => (
        <box
          key={group.category}
          title={group.category}
          style={{
            flexDirection: "column",
            width: "100%",
            border: true,
            borderColor: colors.border,
            padding: 1,
            marginBottom: 1,
          }}
        >
          {group.skills.map((skill) => (
            <box key={skill.id} style={{ flexDirection: "row", gap: 1, height: 1 }}>
              <text fg={colors.accent}>{skill.name.padEnd(20)}</text>
              <text fg={colors.xp}>{proficiencyDots(skill.level)}</text>
              <text fg={colors.level}>
                Lv.{skill.level} {PROFICIENCY[skill.level] ?? ""}
              </text>
              <text fg={colors.ghost}>
                {skill.xp} XP · {xpToNextLevel(skill.xp, skill.level)}
              </text>
            </box>
          ))}
        </box>
      ))}
    </scrollbox>
  );
}
