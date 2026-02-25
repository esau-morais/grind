import { motion, useReducedMotion } from "motion/react";
import {
  AiVisual,
  ForgeVisual,
  QuestVisual,
  SkillTreeVisual,
  VaultVisual,
  XpVisual,
} from "#/components/landing/feature-visuals";
import { GlowingCard, GlowingCards } from "#/components/ui/glowing-card";

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];

export function FeaturesSection() {
  const reducedMotion = useReducedMotion();

  const sectionReveal = reducedMotion
    ? {}
    : {
        initial: { opacity: 0, y: 40 } as const,
        whileInView: { opacity: 1, y: 0 } as const,
        viewport: { once: true, margin: "-80px" } as const,
        transition: { duration: 0.5, ease: EASE },
      };

  return (
    <motion.section {...sectionReveal} id="features" className="relative py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-14 text-center">
          <span className="mb-3 inline-block font-mono text-xs uppercase tracking-[0.2em] text-grind-orange/70">
            The System
          </span>
          <h2 className="text-balance text-3xl font-medium tracking-tight sm:text-4xl">
            Built for the{" "}
            <span className="font-display italic tracking-normal text-grind-orange">grind</span>.
          </h2>
        </div>
        <GlowingCards>
          <GlowingCard
            className="lg:col-span-2"
            title="Quests, Not Tasks"
            body="Every habit is a quest. Daily routines, epic goals, one-off bounties, sequential chains. Each with difficulty, deadlines, and streaks."
          >
            <QuestVisual />
          </GlowingCard>
          <GlowingCard
            title="XP & Streaks"
            body="Earn XP with difficulty multipliers, proof bonuses, and streak tiers from Spark to Eternal Fire. Level up through 10 ranks."
          >
            <XpVisual />
          </GlowingCard>
          <GlowingCard
            title="AI Companion"
            body="An optional AI that earns your trust. Starts as a Watcher, grows to Sovereign. Suggests quests, detects patterns, parses natural language."
          >
            <AiVisual />
          </GlowingCard>
          <GlowingCard
            className="lg:col-span-2"
            title="Skill Trees"
            body="Watch real skills grow. Completing quests feeds XP into a directed graph of abilities - fitness, music, academics, discipline."
          >
            <SkillTreeVisual />
          </GlowingCard>
          <GlowingCard
            title="Forge Automation"
            body="Cron triggers, event hooks, signal collectors. Auto-queue morning routines, detect git commits, run scripts on quest completion."
          >
            <ForgeVisual />
          </GlowingCard>
          <GlowingCard
            className="lg:col-span-2"
            title="Local-First & Encrypted"
            body="SQLite vault with Argon2id encryption. No cloud required. Your data stays on your machine. Export anytime. Ollama for offline AI."
          >
            <VaultVisual />
          </GlowingCard>
        </GlowingCards>
      </div>
    </motion.section>
  );
}
