import { useState } from "react";
import { PlusIcon, XIcon } from "@phosphor-icons/react";
import { cn } from "#/lib/utils";
import { createQuestFn } from "#/server/data.functions";
import type { SimpleQuest } from "#/server/data.functions";

const QUEST_TYPES = ["daily", "weekly", "epic", "bounty", "chain", "ritual"] as const;
const DIFFICULTIES = ["easy", "medium", "hard", "epic"] as const;

interface CreateQuestFormProps {
  onCreated: (quest: SimpleQuest) => void;
  className?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateQuestForm({
  onCreated,
  className,
  open,
  onOpenChange,
}: CreateQuestFormProps) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<string>("daily");
  const [difficulty, setDifficulty] = useState<string>("medium");
  const [baseXp, setBaseXp] = useState(100);
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addTag() {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) setTags((prev) => [...prev, t]);
    setTagInput("");
  }

  function removeTag(tag: string) {
    setTags((prev) => prev.filter((t) => t !== tag));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const quest = await createQuestFn({
        data: { title: title.trim(), type, difficulty, baseXp, skillTags: tags },
      });
      onCreated(quest);
      setTitle("");
      setType("daily");
      setDifficulty("medium");
      setBaseXp(100);
      setTags([]);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create quest");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        className={cn(
          "flex items-center gap-2 rounded-lg border border-dashed border-border bg-card px-4 py-3 text-sm text-muted-foreground transition-colors hover:border-grind-orange/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        <PlusIcon size={16} aria-hidden="true" />
        New Quest
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn("rounded-lg border border-grind-orange/30 bg-card p-4", className)}
    >
      <div className="flex flex-col gap-3">
        <input
          autoFocus
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Quest title…"
          className="rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          required
        />

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="flex flex-col gap-1">
            <label className="font-mono text-[10px] text-muted-foreground">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="rounded-md border border-border bg-secondary px-2 py-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {QUEST_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-mono text-[10px] text-muted-foreground">Difficulty</label>
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
              className="rounded-md border border-border bg-secondary px-2 py-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {DIFFICULTIES.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-mono text-[10px] text-muted-foreground">Base XP</label>
            <input
              type="number"
              value={baseXp}
              min={10}
              max={10000}
              step={10}
              onChange={(e) => setBaseXp(Number(e.target.value))}
              className="rounded-md border border-border bg-secondary px-2 py-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-mono text-[10px] text-muted-foreground">Skill Tag</label>
            <div className="flex gap-1">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag();
                  }
                }}
                placeholder="fitness:running"
                className="min-w-0 flex-1 rounded-md border border-border bg-secondary px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <button
                type="button"
                onClick={addTag}
                className="shrink-0 rounded-md border border-border bg-secondary px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                +
              </button>
            </div>
          </div>
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-full border border-grind-orange/20 bg-grind-orange/10 px-2 py-0.5 font-mono text-[10px] text-grind-orange"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  aria-label={`Remove tag ${tag}`}
                  className="text-grind-orange/70 hover:text-grind-orange"
                >
                  <XIcon size={8} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={submitting || !title.trim()}
            className="rounded-md bg-grind-orange px-4 py-1.5 text-sm font-medium text-background transition-opacity disabled:cursor-not-allowed disabled:opacity-50 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {submitting ? "Creating…" : "Create Quest"}
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}
