import { ArrowRightIcon } from "@phosphor-icons/react/ssr";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useRef, useState } from "react";
import { GrindButton } from "#/components/ui/grind-button";
import { InstallBlock } from "#/components/landing/InstallBlock";
import { WEB_APP_ROUTE } from "#/lib/useConnectionStatus";

const MOCKUP_THEMES = [
  {
    id: "grind",
    name: "Grind",
    bg: "#050506",
    panel: "#0f0f13",
    highlight: "#27272c",
    border: "#1f1f22",
    text: "#fafafa",
    dim: "#626269",
    primary: "#ff6c02",
    accent: "#ff7527",
    xp: "#22c560",
    streak: "#fa720d",
    level: "#ad46ff",
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    bg: "#1a1b26",
    panel: "#1e2030",
    highlight: "#292e42",
    border: "#3b4261",
    text: "#c8d3f5",
    dim: "#545c7e",
    primary: "#82aaff",
    accent: "#86e1fc",
    xp: "#c3e88d",
    streak: "#ff966c",
    level: "#c099ff",
  },
  {
    id: "catppuccin",
    name: "Catppuccin",
    bg: "#1e1e2e",
    panel: "#181825",
    highlight: "#313244",
    border: "#45475a",
    text: "#cdd6f4",
    dim: "#6c7086",
    primary: "#89b4fa",
    accent: "#cba6f7",
    xp: "#a6e3a1",
    streak: "#fab387",
    level: "#cba6f7",
  },
  {
    id: "dracula",
    name: "Dracula",
    bg: "#282a36",
    panel: "#21222c",
    highlight: "#44475a",
    border: "#44475a",
    text: "#f8f8f2",
    dim: "#6272a4",
    primary: "#bd93f9",
    accent: "#8be9fd",
    xp: "#50fa7b",
    streak: "#ffb86c",
    level: "#bd93f9",
  },
] as const;

function DotGrid() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 opacity-[0.07]"
      style={{
        backgroundImage: "radial-gradient(circle, oklch(0.985 0 0) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }}
    />
  );
}

export function HeroSection() {
  const heroRef = useRef<HTMLElement>(null);
  const reducedMotion = useReducedMotion();
  const [themeIndex, setThemeIndex] = useState(0);
  const theme = MOCKUP_THEMES[themeIndex]!;

  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });

  const gridY = useTransform(scrollYProgress, [0, 1], ["0%", "40%"]);
  const textY = useTransform(scrollYProgress, [0, 1], ["0%", "20%"]);
  const textOpacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);

  return (
    <section ref={heroRef} className="relative overflow-hidden pb-24 pt-20 sm:pt-32">
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={reducedMotion ? {} : { y: gridY }}
      >
        <DotGrid />
      </motion.div>

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 600px 400px at 50% 30%, oklch(0.704 0.2 45.2 / 0.06), transparent)",
        }}
      />

      <motion.div
        className="relative mx-auto max-w-4xl px-6 text-center"
        style={reducedMotion ? {} : { y: textY, opacity: textOpacity }}
      >
        <a
          href="https://docs.grindxp.app/reference/changelog"
          target="_blank"
          rel="noreferrer"
          className="mb-8 inline-flex cursor-pointer items-center gap-2 rounded-full border border-border bg-secondary/50 py-1 pl-1 pr-3 transition-colors duration-150 hover:border-grind-orange/30"
        >
          <span className="rounded-full bg-grind-orange px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
            v0.1
          </span>
          <span className="text-xs text-muted-foreground">Local-first gamified life OS</span>
          <ArrowRightIcon size={12} className="text-muted-foreground" />
        </a>

        <h1 className="text-balance font-display text-5xl leading-[1.08] tracking-tight sm:text-6xl md:text-7xl lg:text-8xl">
          Your Life Is The Game.
          <br />
          <span className="text-grind-orange">Level Up For Real.</span>
        </h1>

        <p className="mx-auto mt-6 max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground sm:text-xl">
          A local-first operating system where habits are quests, progress is XP, and your growth
          has a skill tree.
        </p>

        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <GrindButton asChild size="md">
            <a href={WEB_APP_ROUTE}>
              Enter the Grind
              <ArrowRightIcon size={16} weight="bold" />
            </a>
          </GrindButton>
          <GrindButton asChild variant="ghost" size="md">
            <a href="#features">Learn more</a>
          </GrindButton>
        </div>

        <div className="mt-6 w-full">
          <InstallBlock />
        </div>
      </motion.div>

      {/* ── App mockup ─────────────────────────────────────── */}
      <div className="relative mx-auto mt-20 max-w-5xl px-6">
        <div
          className="relative overflow-hidden rounded-xl border border-border/50 shadow-2xl transition-colors duration-300"
          style={{
            backgroundColor: theme.bg,
            boxShadow: `0 25px 50px -12px ${theme.primary}08`,
          }}
        >
          {/* Window chrome */}
          <div
            className="flex items-center px-4 py-2.5 transition-colors duration-300"
            style={{ borderBottom: `1px solid ${theme.border}` }}
          >
            <div className="flex items-center gap-1.5">
              <span className="block size-2.5 rounded-full bg-white/15" />
              <span className="block size-2.5 rounded-full bg-white/15" />
              <span className="block size-2.5 rounded-full bg-white/15" />
            </div>
            <span
              className="flex-1 text-center font-mono text-[10px] tracking-wider transition-colors duration-300"
              style={{ color: theme.dim }}
            >
              GRIND
            </span>
            <div className="flex items-center gap-1.5">
              {MOCKUP_THEMES.map((t, i) => (
                <button
                  key={t.id}
                  type="button"
                  aria-label={`Switch to ${t.name} theme`}
                  onClick={() => setThemeIndex(i)}
                  className="block size-2.5 rounded-full transition-transform duration-150 hover:scale-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                  style={{
                    backgroundColor: t.primary,
                    opacity: i === themeIndex ? 1 : 0.35,
                    boxShadow: i === themeIndex ? `0 0 6px ${t.primary}80` : "none",
                  }}
                />
              ))}
            </div>
          </div>

          {/* Agent header */}
          <div
            className="flex items-center justify-between px-4 py-2 transition-colors duration-300"
            style={{
              borderBottom: `1px solid ${theme.border}`,
              backgroundColor: theme.panel,
            }}
          >
            <div className="flex items-center gap-2">
              <span
                className="font-mono text-[11px] font-medium tracking-wider transition-colors duration-300"
                style={{ color: theme.text }}
              >
                GRIND AGENT
              </span>
              <span
                className="font-mono text-[10px] transition-colors duration-300"
                style={{ color: theme.dim }}
              >
                think:medium
              </span>
            </div>
            <span
              className="rounded px-2 py-0.5 text-[10px] font-medium transition-colors duration-300"
              style={{
                backgroundColor: `${theme.level}20`,
                color: theme.level,
              }}
            >
              Lv.3 Apprentice
            </span>
          </div>

          {/* Chat messages */}
          <div className="space-y-4 px-4 py-5 sm:px-6">
            <div>
              <span
                className="text-xs font-bold transition-colors duration-300"
                style={{ color: theme.accent }}
              >
                You:
              </span>
              <span
                className="ml-2 text-xs transition-colors duration-300"
                style={{ color: theme.text }}
              >
                just finished my chest workout, 47 minutes
              </span>
            </div>
            <div
              className="text-[11px] transition-colors duration-300"
              style={{ color: theme.dim }}
            >
              <span style={{ color: theme.accent }}>{"  "}&#x2713;</span> stop_timer &middot;
              complete: true
            </div>
            <div
              className="rounded-md border-l-2 px-3 py-2.5 transition-colors duration-300"
              style={{
                borderColor: theme.highlight,
                backgroundColor: `${theme.panel}99`,
              }}
            >
              <p
                className="font-mono text-[11px] transition-colors duration-300"
                style={{ color: theme.text }}
              >
                &quot;Chest Workout&quot; completed &mdash; 47m, timer proof
              </p>
              <div className="mt-2 space-y-1">
                {[
                  { skill: "fitness:strength", dots: 3, xp: "+15 XP" },
                  { skill: "fitness:endurance", dots: 2, xp: "+8 XP" },
                  { skill: "discipline", dots: 3, xp: "+5 XP" },
                ].map(({ skill, dots, xp }) => (
                  <div
                    key={skill}
                    className="flex items-center justify-between font-mono text-[11px]"
                  >
                    <span
                      className="transition-colors duration-300"
                      style={{ color: `${theme.text}b3` }}
                    >
                      {skill}
                    </span>
                    <span>
                      <span style={{ color: theme.primary }}>{"●".repeat(dots)}</span>
                      <span style={{ color: theme.dim }}>{"○".repeat(5 - dots)}</span>
                      <span
                        className="ml-2 transition-colors duration-300"
                        style={{ color: theme.xp }}
                      >
                        {xp}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
              <div
                className="mt-2 pt-2 font-mono text-[11px] transition-colors duration-300"
                style={{ borderTop: `1px solid ${theme.border}` }}
              >
                <span style={{ color: theme.xp }}>+45 XP</span>
                <span style={{ color: theme.dim }}> (1.5x timer proof)</span>
                <span className="ml-3" style={{ color: theme.streak }}>
                  Streak: 14d &#x1f525;
                </span>
              </div>
            </div>
            <p
              className="text-xs leading-relaxed transition-colors duration-300"
              style={{ color: theme.text }}
            >
              47 minutes, solid. Strength hit Lv.3 &mdash; that unlocks{" "}
              <span style={{ color: theme.accent }}>Core</span> in the skill tree. 14-day streak
              puts you in <span style={{ color: theme.streak }}>Flame</span> tier. GMAT practice
              still on deck for today.
            </p>
            <div>
              <span
                className="text-xs font-bold transition-colors duration-300"
                style={{ color: theme.accent }}
              >
                You:
              </span>
              <span
                className="ml-2 text-xs transition-colors duration-300"
                style={{ color: theme.text }}
              >
                create a quest for learning guitar, start easy
              </span>
            </div>
            <div
              className="text-[11px] transition-colors duration-300"
              style={{ color: theme.dim }}
            >
              <span style={{ color: theme.accent }}>{"  "}+</span> create_quest &middot; &quot;Daily
              Guitar Practice&quot; &middot; daily &middot; easy
            </div>
            <p
              className="text-xs leading-relaxed transition-colors duration-300"
              style={{ color: theme.text }}
            >
              Created. 15 XP base, feeds into{" "}
              <span style={{ color: theme.level }}>music:guitar</span>. Starts tomorrow &mdash; 20
              minutes minimum. Miss 3 days, streak resets. Go.
            </p>
          </div>

          {/* Input */}
          <div
            className="px-4 py-3 transition-colors duration-300 sm:px-6"
            style={{ borderTop: `1px solid ${theme.border}` }}
          >
            <div
              className="flex items-center rounded-lg border px-3 py-2 transition-colors duration-300"
              style={{
                borderColor: theme.highlight,
                backgroundColor: theme.bg,
              }}
            >
              <span className="text-xs transition-colors duration-300" style={{ color: theme.dim }}>
                Type a message&hellip; (/ for commands)
              </span>
              <span className="animate-blink ml-0.5 text-xs" style={{ color: theme.primary }}>
                ▎
              </span>
            </div>
          </div>

          {/* Status bar */}
          <div
            className="px-4 py-1.5 transition-colors duration-300 sm:px-6"
            style={{
              borderTop: `1px solid ${theme.border}`,
              backgroundColor: `${theme.panel}80`,
            }}
          >
            <span
              className="font-mono text-[10px] transition-colors duration-300"
              style={{ color: theme.dim }}
            >
              3.2Kin/0.5Kout &middot; cache:2.1K &middot; claude-sonnet
            </span>
          </div>

          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-20 left-1/2 h-40 w-3/4 -translate-x-1/2 rounded-full blur-3xl transition-colors duration-500"
            style={{ backgroundColor: `${theme.primary}14` }}
          />
        </div>
      </div>
    </section>
  );
}
