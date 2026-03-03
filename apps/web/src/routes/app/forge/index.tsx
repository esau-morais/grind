import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { LightningIcon, CaretDownIcon } from "@phosphor-icons/react";
import { getForgePageData, toggleForgeRuleFn } from "#/server/data.functions";
import type { SimpleForgeRuleData, SimpleForgeRunData } from "#/server/data.functions";
import { ForgeRuleRow } from "#/components/app/forge-rule-row";
import { ForgeRunItem } from "#/components/app/forge-run-item";
import { cn } from "#/lib/utils";

export const Route = createFileRoute("/app/forge/")({
  loader: () => getForgePageData(),
  component: ForgePage,
});

function computeRunStats(
  ruleId: string,
  runs: SimpleForgeRunData[],
): { successCount: number; failCount: number; lastRanAt: number | null } {
  const ruleRuns = runs.filter((r) => r.ruleId === ruleId);
  return {
    successCount: ruleRuns.filter((r) => r.status === "success").length,
    failCount: ruleRuns.filter((r) => r.status === "failed").length,
    lastRanAt: ruleRuns[0]?.startedAt ?? null,
  };
}

const DOT_STATUS: Record<string, string> = {
  success: "bg-grind-xp",
  failed: "bg-red-400",
  skipped: "bg-muted-foreground/40",
};

function MobileRunsStrip({ runs }: { runs: ReturnType<typeof toSimpleRun>[] }) {
  const [open, setOpen] = useState(false);
  const dots = runs.slice(0, 10);

  return (
    <div className="lg:hidden rounded-xl border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
      >
        <LightningIcon
          size={12}
          weight="duotone"
          className="text-grind-orange shrink-0"
          aria-hidden="true"
        />
        <span className="text-xs font-semibold text-foreground">Recent Runs</span>
        <div className="flex items-center gap-0.5 ml-2" aria-hidden="true">
          {dots.map((r) => (
            <span
              key={r.id}
              className={cn(
                "block h-1.5 w-1.5 rounded-full",
                DOT_STATUS[r.status] ?? "bg-muted-foreground/40",
              )}
            />
          ))}
        </div>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{runs.length}</span>
        <CaretDownIcon
          size={12}
          aria-hidden="true"
          className={cn(
            "shrink-0 text-muted-foreground transition-transform duration-150",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="border-t border-border max-h-72 overflow-y-auto">
          {runs.map((run, i) => (
            <div
              key={run.id}
              className={i < runs.length - 1 ? "border-b border-border/50" : undefined}
            >
              <ForgeRunItem run={run} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function toSimpleRun(r: SimpleForgeRunData) {
  return {
    id: r.id,
    ruleId: r.ruleId,
    ruleName: r.ruleName,
    triggerType: r.triggerType,
    actionType: r.actionType,
    status: r.status,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    ...(r.error !== null ? { error: r.error } : {}),
  };
}

function ForgePage() {
  const data = Route.useLoaderData();
  const [rules, setRules] = useState(data.rules);
  const [toggling, setToggling] = useState<string | null>(null);

  async function handleToggle(ruleId: string, enabled: boolean) {
    setToggling(ruleId);
    try {
      await toggleForgeRuleFn({ data: { ruleId, enabled } });
      setRules((prev) => prev.map((r) => (r.id === ruleId ? { ...r, enabled } : r)));
    } finally {
      setToggling(null);
    }
  }

  const toSimpleRule = (r: SimpleForgeRuleData) => ({
    id: r.id,
    name: r.name,
    triggerType: r.triggerType,
    triggerConfig: r.triggerConfig as Record<string, unknown>,
    actionType: r.actionType,
    enabled: r.enabled,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  });

  const visibleRuns = data.recentRuns.slice(0, 30).map(toSimpleRun);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center border-b border-border bg-sidebar px-6">
        <div className="md:ml-8 flex flex-1 items-center gap-2">
          <LightningIcon size={16} weight="fill" className="text-grind-orange" aria-hidden="true" />
          <h1 className="text-sm font-semibold text-foreground">Forge</h1>
          <span className="ml-1 font-mono text-xs text-muted-foreground">
            {rules.filter((r) => r.enabled).length}/{rules.length} active
          </span>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-6xl flex flex-col gap-4">
          {/* Mobile compact runs strip — above rules, hidden on lg */}
          {visibleRuns.length > 0 && <MobileRunsStrip runs={visibleRuns} />}

          <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[1fr_22rem] lg:items-start">
            {/* Rules — left / full on mobile */}
            <section aria-labelledby="rules-heading">
              <h2
                id="rules-heading"
                className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground"
              >
                <LightningIcon
                  size={14}
                  weight="duotone"
                  className="text-grind-orange"
                  aria-hidden="true"
                />
                Automation Rules
              </h2>

              {rules.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-12 text-center">
                  <LightningIcon
                    size={32}
                    className="text-muted-foreground/30"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-sm text-muted-foreground">No forge rules yet</p>
                    <p className="mt-0.5 text-xs text-muted-foreground/70">
                      Ask the Companion to create automation rules
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {rules.map((rule) => (
                    <ForgeRuleRow
                      key={rule.id}
                      rule={toSimpleRule(rule)}
                      runStats={computeRunStats(rule.id, data.recentRuns)}
                      onToggle={handleToggle}
                      isToggling={toggling === rule.id}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Recent Runs — sticky on lg, hidden on mobile (shown via strip above) */}
            {visibleRuns.length > 0 && (
              <aside
                aria-labelledby="runs-heading"
                className="hidden lg:block lg:sticky lg:top-6 lg:self-start"
              >
                <div className="max-h-[calc(100vh-10rem)] overflow-y-auto rounded-xl border border-border bg-card">
                  <div className="sticky top-0 z-10 border-b border-border bg-card px-4 py-2.5">
                    <h2
                      id="runs-heading"
                      className="flex items-center gap-2 text-xs font-semibold text-foreground"
                    >
                      <LightningIcon
                        size={12}
                        weight="duotone"
                        className="text-grind-orange"
                        aria-hidden="true"
                      />
                      Recent Runs
                      <span className="ml-auto font-mono text-[10px] font-normal text-muted-foreground">
                        {visibleRuns.length}
                      </span>
                    </h2>
                  </div>
                  {visibleRuns.map((run, i) => (
                    <div
                      key={run.id}
                      className={
                        i < visibleRuns.length - 1 ? "border-b border-border/50" : undefined
                      }
                    >
                      <ForgeRunItem run={run} />
                    </div>
                  ))}
                </div>
              </aside>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
