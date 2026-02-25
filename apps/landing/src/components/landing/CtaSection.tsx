import { ArrowRightIcon } from "@phosphor-icons/react/ssr";
import { motion, useReducedMotion } from "motion/react";
import { GrindButton } from "#/components/ui/grind-button";
import { InstallBlock } from "#/components/landing/InstallBlock";
import { WEB_APP_ROUTE } from "#/lib/useConnectionStatus";

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];

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

export function CtaSection() {
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
    <motion.section {...sectionReveal} className="relative py-24">
      <DotGrid />
      <div className="relative mx-auto max-w-2xl px-6 text-center">
        <h2 className="text-balance text-3xl font-medium tracking-tight sm:text-4xl">
          Ready to <span className="font-display italic tracking-normal">grind</span>?
        </h2>
        <p className="mx-auto mt-4 max-w-sm text-pretty text-base leading-relaxed text-muted-foreground">
          Your terminal is the game board. Your habits are the quests. Your growth is real.
        </p>
        <div className="mt-8 flex flex-col items-center gap-6">
          <GrindButton asChild size="md">
            <a href={WEB_APP_ROUTE}>
              Enter the Grind
              <ArrowRightIcon size={18} weight="bold" />
            </a>
          </GrindButton>
          <InstallBlock />
        </div>
      </div>
    </motion.section>
  );
}
