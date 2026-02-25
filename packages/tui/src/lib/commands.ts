import { builtinThemes } from "../theme/themes";
import { loadCustomThemes } from "../theme/loader";

export interface CommandOption {
  name: string;
  description: string;
  value: string;
}

export interface CommandArg {
  label: string;
  required: boolean;
  options: CommandOption[];
  showDescription?: boolean;
}

export interface SlashCommand {
  name: string;
  description: string;
  arg?: CommandArg;
}

export const THINK_LEVELS = {
  low: 4_096,
  medium: 10_240,
  high: 32_768,
  max: 100_000,
} as const;

export type ThinkLevel = keyof typeof THINK_LEVELS;

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "thinking", description: "Toggle extended thinking" },
  {
    name: "think",
    description: "Set thinking budget",
    arg: {
      label: "level",
      required: true,
      options: [
        { name: "Low", description: "~4K tokens", value: "low" },
        { name: "Medium", description: "~10K tokens", value: "medium" },
        { name: "High", description: "~32K tokens", value: "high" },
        { name: "Max", description: "No limit", value: "max" },
      ],
    },
  },
  { name: "new", description: "Start new conversation" },
  { name: "sessions", description: "Browse past conversations" },
  { name: "clear", description: "Clear conversation" },
  { name: "save", description: "Flush memory to companion" },
  { name: "compact", description: "Summarize & trim context" },
  { name: "autocompact", description: "Toggle auto-compaction" },
  { name: "usage", description: "Show token usage" },
  {
    name: "model",
    description: "Switch AI model",
    arg: {
      label: "model",
      required: true,
      options: [], // populated dynamically from models.dev
      showDescription: true,
    },
  },
  {
    name: "theme",
    description: "Switch color theme",
    arg: {
      label: "theme",
      required: true,
      options: buildThemeOptions(),
    },
  },
  { name: "help", description: "List commands" },
];

function buildThemeOptions(): CommandOption[] {
  const custom = loadCustomThemes();
  const all = { ...builtinThemes, ...custom };
  return Object.entries(all).map(([id, def]) => ({
    name: def.name,
    description: id,
    value: id,
  }));
}

export function matchCommands(partial: string): SlashCommand[] {
  const q = partial.toLowerCase();
  if (!q) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter((c) => c.name.startsWith(q));
}

export function getGhostCompletion(partial: string): string {
  if (!partial) return "";
  const q = partial.toLowerCase();
  const match = SLASH_COMMANDS.find((c) => c.name.startsWith(q) && c.name !== q);
  return match ? match.name.slice(q.length) : "";
}

export function findCommand(name: string): SlashCommand | undefined {
  return SLASH_COMMANDS.find((c) => c.name === name.toLowerCase());
}
