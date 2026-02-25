import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getGrindHome } from "@grindxp/core";
import type { ThemeDefinition } from "./types";

export function loadCustomThemes(): Record<string, ThemeDefinition> {
  const themesDir = join(getGrindHome(), "themes");
  if (!existsSync(themesDir)) return {};

  const themes: Record<string, ThemeDefinition> = {};
  for (const file of readdirSync(themesDir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = readFileSync(join(themesDir, file), "utf-8");
      const def = JSON.parse(raw) as ThemeDefinition;
      const id = file.replace(/\.json$/, "");
      themes[id] = def;
    } catch {
      // skip malformed theme files
    }
  }
  return themes;
}
