import { CopyIcon, CheckIcon } from "@phosphor-icons/react/ssr";
import { useState } from "react";
import { cn } from "#/lib/utils";
import { useInstall } from "#/components/landing/InstallContext";

type TokenType = "cmd" | "sub" | "flag" | "url" | "pkg" | "op";
type Token = { t: string; c?: TokenType };

const TOKEN_CLASS: Record<TokenType, string> = {
  cmd: "text-grind-orange",
  sub: "text-foreground/75",
  flag: "text-muted-foreground",
  url: "text-sky-400",
  pkg: "text-grind-xp-green",
  op: "text-muted-foreground/60",
};

const PKG_MANAGERS = [
  {
    id: "bun" as const,
    label: "bun",
    prompt: "$",
    plain: "bun install -g grindxp",
    tokens: [
      { t: "bun", c: "cmd" as const },
      { t: " install", c: "sub" as const },
      { t: " -g", c: "flag" as const },
      { t: " grindxp", c: "pkg" as const },
    ],
  },
  {
    id: "npm" as const,
    label: "npm",
    prompt: "$",
    plain: "npm install -g grindxp",
    tokens: [
      { t: "npm", c: "cmd" as const },
      { t: " install", c: "sub" as const },
      { t: " -g", c: "flag" as const },
      { t: " grindxp", c: "pkg" as const },
    ],
  },
  {
    id: "yarn" as const,
    label: "yarn",
    prompt: "$",
    plain: "yarn global add grindxp",
    tokens: [
      { t: "yarn", c: "cmd" as const },
      { t: " global add", c: "sub" as const },
      { t: " grindxp", c: "pkg" as const },
    ],
  },
  {
    id: "pnpm" as const,
    label: "pnpm",
    prompt: "$",
    plain: "pnpm add -g grindxp",
    tokens: [
      { t: "pnpm", c: "cmd" as const },
      { t: " add", c: "sub" as const },
      { t: " -g", c: "flag" as const },
      { t: " grindxp", c: "pkg" as const },
    ],
  },
] as const;

type CommandEntry = { prompt: string; plain: string; tokens: readonly Token[] };

const STATIC_COMMANDS: Record<"curl" | "windows", CommandEntry> = {
  curl: {
    prompt: "$",
    plain: "curl -fsSL https://grindxp.app/install.sh | bash",
    tokens: [
      { t: "curl", c: "cmd" },
      { t: " -fsSL", c: "flag" },
      { t: " https://grindxp.app/install.sh", c: "url" },
      { t: " | ", c: "op" },
      { t: "bash", c: "cmd" },
    ],
  },
  windows: {
    prompt: ">",
    plain: "iwr -useb https://grindxp.app/install.ps1 | iex",
    tokens: [
      { t: "iwr", c: "cmd" },
      { t: " -useb", c: "flag" },
      { t: " https://grindxp.app/install.ps1", c: "url" },
      { t: " | ", c: "op" },
      { t: "iex", c: "cmd" },
    ],
  },
};

const NAV_TABS: Array<{ id: "curl" | "pkg" | "windows"; label: string }> = [
  { id: "curl", label: "curl" },
  { id: "pkg", label: "bun" },
  { id: "windows", label: "windows" },
];

export function InstallBlock() {
  // Shared across all InstallBlock instances via InstallProvider
  const { activeTab, setActiveTab, activePkg, setActivePkg } = useInstall();
  // Local per-instance — each block has independent copy feedback
  const [copied, setCopied] = useState(false);

  const entry: CommandEntry =
    activeTab === "pkg"
      ? (PKG_MANAGERS.find((p) => p.id === activePkg) ?? PKG_MANAGERS[0])
      : STATIC_COMMANDS[activeTab];

  function handleCopy() {
    navigator.clipboard.writeText(entry.plain).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="mx-auto w-full max-w-xl overflow-hidden rounded-lg border border-border/60 bg-secondary/30 text-left backdrop-blur-sm">
      {/* Tab row */}
      <div className="flex items-center border-b border-border/60 px-3 pt-2.5 pb-0">
        {/* Left: main tabs */}
        <div className="flex flex-1 items-center gap-0.5">
          {NAV_TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            const label =
              tab.id === "pkg"
                ? (PKG_MANAGERS.find((p) => p.id === activePkg)?.label ?? "bun")
                : tab.label;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "relative px-2.5 pb-2 font-mono text-[11px] tracking-wide transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  isActive ? "text-grind-orange" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-px bg-grind-orange" />
                )}
              </button>
            );
          })}
        </div>

        {/* Right: pkg manager selector — always rendered to avoid layout shift */}
        <div
          className={cn(
            "flex items-center gap-1 pb-2 transition-opacity duration-150",
            activeTab === "pkg" ? "visible opacity-100" : "invisible opacity-0 pointer-events-none",
          )}
          aria-hidden={activeTab !== "pkg"}
        >
          {PKG_MANAGERS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setActivePkg(p.id)}
              tabIndex={activeTab === "pkg" ? 0 : -1}
              className={cn(
                "w-10 rounded border py-0.5 text-center font-mono text-[10px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                activePkg === p.id
                  ? "border-grind-orange/40 bg-grind-orange/10 text-grind-orange"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Command row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="shrink-0 font-mono text-xs text-muted-foreground/50">{entry.prompt}</span>
        <code className="min-w-0 flex-1 font-mono text-xs">
          {entry.tokens.map((tok, i) => (
            <span key={i} className={tok.c ? TOKEN_CLASS[tok.c] : "text-foreground/90"}>
              {tok.t}
            </span>
          ))}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? "Copied" : "Copy command"}
          className="shrink-0 rounded p-1 text-muted-foreground transition-[transform,color] duration-150 active:scale-[0.97] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <span className="relative flex size-4 items-center justify-center">
            <CopyIcon
              size={13}
              aria-hidden="true"
              className={cn(
                "absolute transition-[opacity,filter,transform] duration-200",
                copied ? "opacity-0 blur-[4px] scale-75" : "opacity-100 blur-none scale-100",
              )}
            />
            <CheckIcon
              size={13}
              aria-hidden="true"
              className={cn(
                "absolute text-grind-xp-green transition-[opacity,filter,transform] duration-200",
                copied ? "opacity-100 blur-none scale-100" : "opacity-0 blur-[4px] scale-75",
              )}
            />
          </span>
        </button>
      </div>
    </div>
  );
}
