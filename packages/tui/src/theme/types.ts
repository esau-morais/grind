import type { SyntaxStyle } from "@opentui/core";

export const THEME_COLOR_KEYS = [
  // Surfaces
  "bg",
  "bgPanel",
  "bgHighlight",
  "border",
  "borderFocus",
  "borderSubtle",
  // Text
  "text",
  "textDim",
  "textMuted",
  // Status
  "success",
  "warning",
  "danger",
  "info",
  // Brand
  "primary",
  "accent",
  "xp",
  "xpBright",
  "streak",
  "streakHot",
  "level",
  // Diff
  "diffAddedBg",
  "diffRemovedBg",
  "diffAddedSign",
  "diffRemovedSign",
  "diffContextBg",
  "diffLineNumberFg",
] as const;

export type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number];

export interface SyntaxTokenStyle {
  fg: string;
  bold?: boolean;
  italic?: boolean;
}

export interface ThemeDefinition {
  name: string;
  defs?: Record<string, string>;
  colors: Record<ThemeColorKey, string>;
  syntax: Record<string, SyntaxTokenStyle>;
}

export const DERIVED_ALIASES = {
  easy: "xp",
  medium: "streak",
  hard: "danger",
  epic: "level",
  active: "streak",
  completed: "xp",
  failed: "danger",
  abandoned: "textMuted",
  available: "accent",
  white: "text",
  ghost: "borderSubtle",
  muted: "textMuted",
  warn: "warning",
} as const satisfies Record<string, ThemeColorKey>;

export type DerivedAlias = keyof typeof DERIVED_ALIASES;

export type ResolvedColors = Record<ThemeColorKey | DerivedAlias, string>;

export interface ResolvedTheme {
  name: string;
  colors: ResolvedColors;
  syntax: SyntaxStyle;
}
