import { SyntaxStyle, parseColor } from "@opentui/core";
import {
  DERIVED_ALIASES,
  THEME_COLOR_KEYS,
  type DerivedAlias,
  type ResolvedColors,
  type ResolvedTheme,
  type ThemeColorKey,
  type ThemeDefinition,
} from "./types";

function resolveRef(value: string, defs: Record<string, string>): string {
  if (value.startsWith("#")) return value;
  const resolved = defs[value];
  if (!resolved) throw new Error(`Unknown theme ref: "${value}"`);
  if (resolved.startsWith("#")) return resolved;
  return resolveRef(resolved, defs);
}

export function resolveTheme(def: ThemeDefinition): ResolvedTheme {
  const defs = def.defs ?? {};

  const baseColors = {} as Record<ThemeColorKey, string>;
  for (const key of THEME_COLOR_KEYS) {
    const raw = def.colors[key];
    if (!raw) throw new Error(`Theme "${def.name}" missing color: ${key}`);
    baseColors[key] = resolveRef(raw, defs);
  }

  const derived = {} as Record<DerivedAlias, string>;
  for (const [alias, source] of Object.entries(DERIVED_ALIASES)) {
    derived[alias as DerivedAlias] = baseColors[source];
  }

  const colors: ResolvedColors = { ...baseColors, ...derived };

  const syntaxStyles: Record<
    string,
    { fg?: ReturnType<typeof parseColor>; bold?: boolean; italic?: boolean }
  > = {};
  for (const [token, style] of Object.entries(def.syntax)) {
    syntaxStyles[token] = {
      fg: parseColor(resolveRef(style.fg, defs)),
      ...(style.bold ? { bold: true } : {}),
      ...(style.italic ? { italic: true } : {}),
    };
  }
  const syntax = SyntaxStyle.fromStyles(syntaxStyles);

  return { name: def.name, colors, syntax };
}
