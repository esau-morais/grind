import { useState, useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  SwordIcon,
  TrophyIcon,
  FlameIcon,
  CheckCircleIcon,
  ChatCircleIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { getQuestsPageData, updateQuestStatusFn } from "#/server/data.functions";
import type { SimpleQuest } from "#/server/data.functions";
import { StatCard } from "#/components/app/stat-card";
import { QuestRow } from "#/components/app/quest-row";
import { QuestTypeBadge, QuestStatusBadge } from "#/components/app/quest-badge";
import { RouteError } from "#/components/app/route-error";
import { SegmentedControl } from "#/components/app/segmented-control";
import { CreateQuestForm } from "#/components/app/create-quest-form";

export const Route = createFileRoute("/app/quests/")({
  loader: () => getQuestsPageData(),
  component: QuestsPage,
  errorComponent: ({ error }) => <RouteError error={error} label="Quests" />,
});

const FILTER_TABS = [
  { label: "All", value: "all" },
  { label: "Active", value: "active" },
  { label: "Daily", value: "daily" },
  { label: "Weekly", value: "weekly" },
  { label: "Epic", value: "epic" },
  { label: "Bounty", value: "bounty" },
  { label: "Completed", value: "completed" },
] as const;

function QuestsPage() {
  const data = Route.useLoaderData();
  const [quests, setQuests] = useState(data.quests);
  const [filter, setFilter] = useState("all");
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (filter === "all") return quests;
    if (filter === "active") return quests.filter((q) => q.status === "active");
    if (filter === "completed") return quests.filter((q) => q.status === "completed");
    return quests.filter((q) => q.type === filter);
  }, [quests, filter]);

  const activeQuests = useMemo(() => filtered.filter((q) => q.status === "active"), [filtered]);
  const completedQuests = useMemo(
    () => filtered.filter((q) => q.status === "completed"),
    [filtered],
  );
  const otherQuests = useMemo(
    () => filtered.filter((q) => q.status !== "active" && q.status !== "completed"),
    [filtered],
  );

  const activeCount = quests.filter((q) => q.status === "active").length;

  async function handleStatusChange(questId: string, status: string) {
    setActionInFlight(questId);
    try {
      await updateQuestStatusFn({ data: { questId, status } });
      setQuests((prev) =>
        prev.map((q) =>
          q.id === questId
            ? {
                ...q,
                status,
                ...(status === "completed" ? { completedAt: Date.now() } : {}),
                ...(status === "abandoned" ? { streakCount: 0 } : {}),
              }
            : q,
        ),
      );
    } finally {
      setActionInFlight(null);
    }
  }

  const [formOpen, setFormOpen] = useState(false);

  function handleQuestCreated(quest: SimpleQuest) {
    setQuests((prev) => [quest, ...prev]);
  }

  const [completedOpen, setCompletedOpen] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center border-b border-border bg-sidebar px-6">
        <div className="md:ml-8 flex flex-1 items-center gap-2">
          <SwordIcon size={16} weight="duotone" className="text-grind-orange" aria-hidden="true" />
          <h1 className="text-sm font-semibold text-foreground">Quest Board</h1>
          <span className="ml-1 font-mono text-xs text-muted-foreground">
            {activeCount}/5 active
          </span>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          {/* Stat cards */}
          <section aria-label="Quest stats">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard
                label="Active"
                value={activeCount}
                icon={<SwordIcon size={14} weight="duotone" aria-hidden="true" />}
                accent="orange"
              />
              <StatCard
                label="Completed"
                value={data.completedCount}
                icon={<TrophyIcon size={14} weight="duotone" aria-hidden="true" />}
                accent="green"
              />
              <StatCard
                label="Streaks"
                value={data.activeStreaks}
                sub={data.activeStreaks > 0 ? "active chains" : "none"}
                icon={<FlameIcon size={14} weight="duotone" aria-hidden="true" />}
                accent={data.activeStreaks > 0 ? "orange" : "default"}
              />
              <StatCard
                label="Success"
                value={`${Math.round(data.successRate * 100)}%`}
                icon={<CheckCircleIcon size={14} weight="duotone" aria-hidden="true" />}
                accent="green"
              />
            </div>
          </section>

          {/* Filter tabs — segmented on desktop, select on mobile */}
          <div className="hidden sm:block">
            <SegmentedControl value={filter} onChange={setFilter} options={FILTER_TABS} />
          </div>
          <div className="sm:hidden">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full rounded-lg border border-border bg-secondary px-3 py-1.5 font-mono text-[10px] font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {FILTER_TABS.map((tab) => (
                <option key={tab.value} value={tab.value}>
                  {tab.label}
                </option>
              ))}
            </select>
          </div>

          {/* Create quest */}
          <CreateQuestForm
            onCreated={handleQuestCreated}
            open={formOpen}
            onOpenChange={setFormOpen}
          />

          {/* Active quests */}
          {activeQuests.length > 0 && (
            <section aria-labelledby="active-quests">
              <h2
                id="active-quests"
                className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground"
              >
                <SwordIcon
                  size={16}
                  weight="duotone"
                  className="text-grind-orange"
                  aria-hidden="true"
                />
                Active
                <span className="font-mono text-xs text-muted-foreground">
                  {activeQuests.length}
                </span>
              </h2>
              <div className="flex flex-col gap-2">
                {activeQuests.map((quest) => (
                  <QuestRowWithActions
                    key={quest.id}
                    quest={quest}
                    onStatusChange={handleStatusChange}
                    isLoading={actionInFlight === quest.id}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Other (available, failed, abandoned) */}
          {otherQuests.length > 0 && (
            <section aria-labelledby="other-quests">
              <h2
                id="other-quests"
                className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground"
              >
                Awaiting
                <span className="font-mono text-xs">{otherQuests.length}</span>
              </h2>
              <div className="flex flex-col gap-2">
                {otherQuests.map((quest) => (
                  <QuestRowWithActions
                    key={quest.id}
                    quest={quest}
                    onStatusChange={handleStatusChange}
                    isLoading={actionInFlight === quest.id}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Completed (collapsible) */}
          {completedQuests.length > 0 && (
            <section aria-labelledby="completed-quests">
              <button
                type="button"
                onClick={() => setCompletedOpen((v) => !v)}
                className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <CheckCircleIcon
                  size={16}
                  weight="duotone"
                  className="text-grind-xp"
                  aria-hidden="true"
                />
                Completed
                <span className="font-mono text-xs">{completedQuests.length}</span>
                <span className="text-xs">{completedOpen ? "▾" : "▸"}</span>
              </button>
              {completedOpen && (
                <div className="flex flex-col gap-2 opacity-60">
                  {completedQuests.map((quest) => (
                    <QuestRow key={quest.id} quest={quest} />
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Empty state */}
          {filtered.length === 0 && (
            <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border py-12 text-center">
              <SwordIcon
                size={32}
                weight="duotone"
                className="text-muted-foreground/30"
                aria-hidden="true"
              />
              {filter === "all" ? (
                <div className="flex flex-col items-center gap-3">
                  <p className="text-sm font-medium text-foreground">Your quest board awaits</p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setFormOpen(true)}
                      className="flex items-center gap-1.5 rounded-md bg-grind-orange px-3 py-1.5 font-mono text-[10px] font-semibold text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <PlusIcon size={10} aria-hidden="true" />
                      New Quest
                    </button>
                    <Link
                      to="/app/chat"
                      search={{ c: undefined }}
                      className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-mono text-[10px] font-semibold text-muted-foreground transition-colors hover:border-grind-orange/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ChatCircleIcon size={10} weight="duotone" aria-hidden="true" />
                      Ask Companion
                    </Link>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No quests match this filter</p>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function QuestRowWithActions({
  quest,
  onStatusChange,
  isLoading,
}: {
  quest: SimpleQuest;
  onStatusChange: (id: string, status: string) => void;
  isLoading: boolean;
}) {
  return (
    <div className="group relative">
      <QuestRow quest={quest} />
      {quest.status === "active" && (
        <div className="absolute right-3 top-3 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={() => onStatusChange(quest.id, "completed")}
            disabled={isLoading}
            className="rounded-md bg-grind-xp/10 px-2 py-1 font-mono text-[9px] font-semibold text-grind-xp transition-colors hover:bg-grind-xp/20 disabled:opacity-50"
          >
            Complete
          </button>
          <button
            type="button"
            onClick={() => onStatusChange(quest.id, "abandoned")}
            disabled={isLoading}
            className="rounded-md bg-red-500/10 px-2 py-1 font-mono text-[9px] font-semibold text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
          >
            Drop
          </button>
        </div>
      )}
      {quest.status === "available" && (
        <div className="absolute right-3 top-3 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={() => onStatusChange(quest.id, "active")}
            disabled={isLoading}
            className="rounded-md bg-grind-orange/10 px-2 py-1 font-mono text-[9px] font-semibold text-grind-orange transition-colors hover:bg-grind-orange/20 disabled:opacity-50"
          >
            Accept
          </button>
        </div>
      )}
    </div>
  );
}
