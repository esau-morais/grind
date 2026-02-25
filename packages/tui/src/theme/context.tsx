import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { ResolvedTheme, ThemeDefinition } from "./types";
import { resolveTheme } from "./resolve";
import { builtinThemes, DEFAULT_THEME } from "./themes";
import { loadCustomThemes } from "./loader";

interface ThemeContextValue {
  theme: ResolvedTheme;
  themeName: string;
  allThemes: Record<string, ThemeDefinition>;
  setTheme: (name: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

let cachedAllThemes: Record<string, ThemeDefinition> | undefined;
function getAllThemes(): Record<string, ThemeDefinition> {
  if (!cachedAllThemes) {
    cachedAllThemes = { ...builtinThemes, ...loadCustomThemes() };
  }
  return cachedAllThemes;
}

interface ThemeProviderProps {
  initialTheme?: string;
  onThemeChange?: (name: string) => void;
  children: ReactNode;
}

export function ThemeProvider({ initialTheme, onThemeChange, children }: ThemeProviderProps) {
  const allThemes = useMemo(getAllThemes, []);
  const [themeName, setThemeNameState] = useState(
    initialTheme && allThemes[initialTheme] ? initialTheme : DEFAULT_THEME,
  );

  const theme = useMemo(() => {
    const def = allThemes[themeName] ?? allThemes[DEFAULT_THEME]!;
    return resolveTheme(def);
  }, [themeName, allThemes]);

  const setTheme = (name: string) => {
    if (!allThemes[name]) return;
    setThemeNameState(name);
    onThemeChange?.(name);
  };

  const value = useMemo(
    () => ({ theme, themeName, allThemes, setTheme }),
    [theme, themeName, allThemes],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within <ThemeProvider>");
  return ctx;
}
