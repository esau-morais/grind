import type { ThemeDefinition } from "../types";

import grindJson from "./grind.json";
import tokyoNightJson from "./tokyo-night.json";
import catppuccinJson from "./catppuccin.json";
import draculaJson from "./dracula.json";
import nordJson from "./nord.json";
import gruvboxJson from "./gruvbox.json";
import rosepineJson from "./rosepine.json";
import oneDarkJson from "./one-dark.json";
import monokaiJson from "./monokai.json";
import solarizedJson from "./solarized.json";

export const builtinThemes: Record<string, ThemeDefinition> = {
  grind: grindJson as ThemeDefinition,
  "tokyo-night": tokyoNightJson as ThemeDefinition,
  catppuccin: catppuccinJson as ThemeDefinition,
  dracula: draculaJson as ThemeDefinition,
  nord: nordJson as ThemeDefinition,
  gruvbox: gruvboxJson as ThemeDefinition,
  rosepine: rosepineJson as ThemeDefinition,
  "one-dark": oneDarkJson as ThemeDefinition,
  monokai: monokaiJson as ThemeDefinition,
  solarized: solarizedJson as ThemeDefinition,
};

export const DEFAULT_THEME = "grind";
