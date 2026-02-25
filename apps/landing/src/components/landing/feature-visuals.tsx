import { motion, useInView } from "motion/react";
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "#/lib/utils";

// ── Hooks ────────────────────────────────────────────────────

function useTypewriter(text: string, speed: number, active: boolean) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!active || index >= text.length) return;
    const timeout = setTimeout(() => setIndex((i) => i + 1), speed);
    return () => clearTimeout(timeout);
  }, [active, index, text.length, speed]);

  return text.slice(0, index);
}

function useAnimatedNumber(target: number, duration: number, active: boolean) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!active) return;
    const start = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - (1 - t) ** 3;
      setValue(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, target, duration]);

  return value;
}

// ── Shared ───────────────────────────────────────────────────

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.09 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 8, filter: "blur(4px)" },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.4, ease: "easeOut" as const },
  },
};

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border/10 bg-background/40 p-4 font-mono text-xs leading-relaxed">
      {children}
    </div>
  );
}

// ── 1. QuestVisual (wide) ────────────────────────────────────

const quests = [
  { diff: 2, name: "Morning Routine", prog: "2/3", time: "06:31" },
  { diff: 2, name: "GMAT Practice", prog: "0/1", time: "10:00" },
  { diff: 1, name: "Read 30 Pages", prog: "0/1", time: "21:00" },
  { diff: 3, name: "Ship Feature", prog: "1/4", time: "──:──" },
];

export function QuestVisual() {
  return (
    <motion.div
      variants={stagger}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.3 }}
    >
      <Frame>
        <motion.div
          variants={fadeUp}
          className="mb-3 flex justify-between text-muted-foreground/60"
        >
          <span>ACTIVE QUESTS</span>
          <span>3/5</span>
        </motion.div>
        {quests.map((q) => (
          <motion.div
            key={q.name}
            variants={fadeUp}
            className="flex items-center justify-between py-0.5"
          >
            <span className="flex items-center gap-2">
              <span>
                {Array.from({ length: 3 }, (_, i) => (
                  <span
                    key={i}
                    className={i < q.diff ? "text-grind-orange" : "text-muted-foreground/30"}
                  >
                    {i < q.diff ? "◆" : "◇"}
                  </span>
                ))}
              </span>
              <span className="text-foreground/80">{q.name}</span>
            </span>
            <span className="flex items-center gap-3 text-muted-foreground/50">
              <span>{q.prog}</span>
              <span>{q.time}</span>
            </span>
          </motion.div>
        ))}
      </Frame>
    </motion.div>
  );
}

// ── 2. XpVisual (narrow) ─────────────────────────────────────

export function XpVisual() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, amount: 0.5 });
  const xp = useAnimatedNumber(445, 1400, isInView);
  const streak = useAnimatedNumber(14, 800, isInView);

  return (
    <div ref={ref}>
      <Frame>
        <div className="mb-4 text-center text-muted-foreground/60">
          <span className="text-foreground/70">APPRENTICE</span>
          <span className="text-grind-orange"> · Lv.3</span>
        </div>

        <div className="mb-1">
          <div className="h-2 overflow-hidden rounded-full bg-muted-foreground/10">
            <motion.div
              className="h-full rounded-full bg-grind-orange"
              initial={{ width: 0 }}
              animate={isInView ? { width: "74%" } : { width: 0 }}
              transition={{ duration: 1.2, ease: "easeOut", delay: 0.3 }}
            />
          </div>
          <div className="mt-1.5 text-right text-muted-foreground/50">
            <span className="text-grind-orange">{xp}</span>/600 XP
          </div>
        </div>

        <div className="mt-4 space-y-1.5 border-t border-border/10 pt-3 text-muted-foreground/50">
          <div>
            <span className="text-grind-orange">▲</span> x2.5 difficulty mult
          </div>
          <div>
            <span className="text-grind-streak-start">■</span>{" "}
            <span className="text-grind-streak-start">{streak}</span>-day streak
          </div>
        </div>
      </Frame>
    </div>
  );
}

// ── 3. AiVisual (narrow) ─────────────────────────────────────

const aiScript = `$ grindxp suggest
⟩ Reviewing patterns...
⟩ "Try a morning
   meditation quest"
$ `;

export function AiVisual() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, amount: 0.5 });
  const typed = useTypewriter(aiScript, 35, isInView);
  const lines = typed.split("\n");
  const isDone = typed.length >= aiScript.length;

  return (
    <div ref={ref}>
      <Frame>
        <div className="min-h-[7.5rem]">
          {lines.map((line, i) => (
            <div key={i} className="whitespace-pre">
              {line.startsWith("$") ? (
                <>
                  <span className="text-grind-orange">$</span>
                  <span className="text-foreground/80">{line.slice(1)}</span>
                  {i === lines.length - 1 && isDone && (
                    <span className="animate-blink text-grind-orange">█</span>
                  )}
                </>
              ) : line.startsWith("⟩") ? (
                <>
                  <span className="text-muted-foreground/40">⟩</span>
                  <span className="text-foreground/70">{line.slice(1)}</span>
                </>
              ) : (
                <span className="text-foreground/70">{line}</span>
              )}
            </div>
          ))}
        </div>
      </Frame>
    </div>
  );
}

// ── 4. SkillTreeVisual (wide) ────────────────────────────────

const skills = [
  {
    name: "Fitness",
    level: 3,
    subs: [
      { name: "Strength", filled: 3 },
      { name: "Cardio", filled: 2 },
    ],
  },
  {
    name: "Music",
    level: 4,
    subs: [
      { name: "Guitar", filled: 4 },
      { name: "Theory", filled: 3 },
    ],
  },
];

function SkillDots({
  filled,
  total,
  inView,
  delay,
}: {
  filled: number;
  total: number;
  inView: boolean;
  delay: number;
}) {
  return (
    <span className="ml-auto flex gap-0.5">
      {Array.from({ length: total }, (_, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0, scale: 0.5 }}
          animate={inView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.5 }}
          transition={{ delay: delay + i * 0.07, duration: 0.25 }}
          className={i < filled ? "text-grind-orange" : "text-muted-foreground/30"}
        >
          {i < filled ? "●" : "○"}
        </motion.span>
      ))}
    </span>
  );
}

export function SkillTreeVisual() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, amount: 0.3 });

  return (
    <motion.div
      ref={ref}
      variants={stagger}
      initial="hidden"
      animate={isInView ? "visible" : "hidden"}
    >
      <Frame>
        {skills.map((skill, si) => {
          const isLast = si === skills.length - 1;
          const branch = isLast ? "╰" : "╭";

          return (
            <Fragment key={skill.name}>
              <motion.div variants={fadeUp} className="whitespace-pre">
                <span className="text-muted-foreground/30">{branch}── </span>
                <span className="text-foreground/80">{skill.name}</span>
                <span className="text-muted-foreground/20">
                  {" "}
                  {"─".repeat(Math.max(1, 10 - skill.name.length))}{" "}
                </span>
                <span className="text-grind-orange">Lv.{skill.level}</span>
              </motion.div>
              {skill.subs.map((sub, ci) => {
                const isLastSub = ci === skill.subs.length - 1;
                const connector = isLast ? " " : "│";
                const subBranch = isLastSub ? "└" : "├";
                const dotDelay = 0.5 + si * 0.3 + ci * 0.15;

                return (
                  <motion.div
                    key={sub.name}
                    variants={fadeUp}
                    className="flex items-center whitespace-pre"
                  >
                    <span className="text-muted-foreground/30">
                      {connector} {subBranch}──{" "}
                    </span>
                    <span className="text-foreground/60">{sub.name}</span>
                    <SkillDots filled={sub.filled} total={5} inView={isInView} delay={dotDelay} />
                  </motion.div>
                );
              })}
              {!isLast && (
                <motion.div variants={fadeUp} className="text-muted-foreground/30">
                  │
                </motion.div>
              )}
            </Fragment>
          );
        })}
      </Frame>
    </motion.div>
  );
}

// ── 5. ForgeVisual (narrow) ──────────────────────────────────

const triggers = [
  { event: "06:00", action: "queue", accent: false },
  { event: "on:commit", action: "+15 XP", accent: true },
  { event: "on:streak", action: "badge", accent: true },
];

export function ForgeVisual() {
  return (
    <motion.div
      variants={stagger}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.3 }}
    >
      <Frame>
        <motion.div variants={fadeUp} className="mb-3 text-muted-foreground/60">
          TRIGGERS
        </motion.div>
        <motion.div variants={fadeUp} className="mb-3 border-t border-border/10" />
        {triggers.map((t) => (
          <motion.div
            key={t.event}
            variants={fadeUp}
            className="flex items-center py-0.5 whitespace-pre"
          >
            <span className="flex-1 text-foreground/60">{t.event}</span>
            <span className="text-muted-foreground/30"> ──→ </span>
            <span
              className={cn(
                "flex-1 text-right",
                t.accent ? "text-grind-orange" : "text-foreground/60",
              )}
            >
              {t.action}
            </span>
          </motion.div>
        ))}
        <motion.div
          variants={fadeUp}
          className="mt-3 border-t border-border/10 pt-2 text-muted-foreground/40"
        >
          3 triggers · 2 active
        </motion.div>
      </Frame>
    </motion.div>
  );
}

// ── 6. VaultVisual (wide) ────────────────────────────────────

const vaultEntries = [
  { name: "quests.db", bar: "████", tag: "local" },
  { name: "skills.db", bar: "████", tag: "local" },
  { name: "streaks.db", bar: "████", tag: "local" },
  { name: "keys.enc", bar: "████", tag: "argon2id" },
];

export function VaultVisual() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, amount: 0.3 });

  return (
    <motion.div
      ref={ref}
      variants={stagger}
      initial="hidden"
      animate={isInView ? "visible" : "hidden"}
    >
      <Frame>
        <motion.div variants={fadeUp} className="mb-3 flex items-center justify-between">
          <span className="text-foreground/80">GRIND VAULT</span>
          <span className="text-muted-foreground/40">encrypted</span>
        </motion.div>
        {vaultEntries.map((entry, i) => {
          const isLast = i === vaultEntries.length - 1;
          const branch = isLast ? "└" : "├";

          return (
            <motion.div
              key={entry.name}
              variants={fadeUp}
              className="flex items-center whitespace-pre py-0.5"
            >
              <span className="text-muted-foreground/30">{branch}── </span>
              <span className="text-foreground/60">{entry.name}</span>
              <span className="ml-auto flex items-center gap-3">
                <span className="text-grind-orange/60">{entry.bar}</span>
                <span className="text-muted-foreground/40">{entry.tag}</span>
              </span>
            </motion.div>
          );
        })}
        <motion.div
          variants={fadeUp}
          className="mt-3 flex items-center justify-between border-t border-border/10 pt-2 text-muted-foreground/40"
        >
          <span>sync: OFF</span>
          <motion.span
            initial={{ opacity: 0, scale: 0.5 }}
            animate={isInView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.5 }}
            transition={{ delay: 0.8, duration: 0.3, ease: "backOut" }}
          >
            export: <span className="text-grind-xp">✓</span> ready
          </motion.span>
        </motion.div>
      </Frame>
    </motion.div>
  );
}
