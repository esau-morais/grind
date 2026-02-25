import {
  CalendarCheckIcon,
  CurrencyCircleDollarIcon,
  FlameIcon,
  LinkIcon,
  MountainsIcon,
  RepeatIcon,
} from "@phosphor-icons/react/ssr";
import { motion, useReducedMotion } from "motion/react";

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];

const questTypes = [
  { icon: RepeatIcon, label: "Daily", color: "text-grind-orange" },
  { icon: CalendarCheckIcon, label: "Weekly", color: "text-chart-2" },
  { icon: MountainsIcon, label: "Epic", color: "text-chart-4" },
  { icon: CurrencyCircleDollarIcon, label: "Bounty", color: "text-chart-3" },
  { icon: LinkIcon, label: "Chain", color: "text-chart-5" },
  { icon: FlameIcon, label: "Ritual", color: "text-grind-streak-start" },
];

export function QuestTypesSection() {
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
    <motion.section {...sectionReveal} id="quest-types" className="relative py-16">
      <div className="mx-auto max-w-4xl px-6 text-center">
        <h2 className="text-balance text-2xl font-medium sm:text-3xl">
          Six quest types. <span className="font-display italic">One system.</span>
        </h2>
        <p className="mx-auto mt-4 max-w-md text-pretty text-base leading-relaxed text-muted-foreground">
          From daily habits to life-changing epics. Each type has its own scheduling, streak rules,
          and XP curves.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          {questTypes.map((qt) => (
            <div
              key={qt.label}
              className="flex items-center gap-2 rounded-lg border border-border bg-grind-surface px-4 py-2 transition duration-150 hover:border-grind-orange/25 hover:bg-grind-surface/80"
            >
              <qt.icon size={16} weight="duotone" className={qt.color} />
              <span className="text-sm text-foreground/80">{qt.label}</span>
            </div>
          ))}
        </div>
      </div>
    </motion.section>
  );
}
