import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

import { z } from "zod";

const timerStateSchema = z
  .object({
    questId: z.string(),
    questTitle: z.string(),
    userId: z.string(),
    startedAt: z.number(),
  })
  .strict();

export type TimerState = z.infer<typeof timerStateSchema>;

export function readTimer(timerPath: string): TimerState | null {
  if (!existsSync(timerPath)) return null;
  try {
    const raw = readFileSync(timerPath, "utf-8");
    return timerStateSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeTimer(timerPath: string, state: TimerState): void {
  writeFileSync(timerPath, JSON.stringify(state, null, 2));
}

export function clearTimer(timerPath: string): void {
  if (existsSync(timerPath)) unlinkSync(timerPath);
}

export function getElapsedMinutes(startedAt: number): number {
  return Math.round((Date.now() - startedAt) / 60_000);
}

export function formatElapsed(startedAt: number): string {
  const mins = getElapsedMinutes(startedAt);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
