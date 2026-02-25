import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";

import { z } from "zod";

import { ensureGrindHome, getServiceStatePath } from "../../grind-home";

const googleSyncStateSchema = z.object({
  calendarSyncToken: z.string().optional(),
  calendarLastPollAt: z.number().optional(),
  gmailHistoryId: z.string().optional(),
  gmailLastPollAt: z.number().optional(),
});

const serviceStateSchema = z.object({
  version: z.number().default(1),
  google: googleSyncStateSchema.optional(),
});

export type GoogleSyncState = z.infer<typeof googleSyncStateSchema>;
type ServiceState = z.infer<typeof serviceStateSchema>;

function readState(): ServiceState {
  const path = getServiceStatePath();
  if (!existsSync(path)) return { version: 1 };
  try {
    const raw = readFileSync(path, "utf-8");
    return serviceStateSchema.parse(JSON.parse(raw));
  } catch {
    return { version: 1 };
  }
}

function writeState(state: ServiceState): void {
  ensureGrindHome();
  const path = getServiceStatePath();
  writeFileSync(path, JSON.stringify(state, null, 2));
  chmodSync(path, 0o600);
}

export function getGoogleSyncState(): GoogleSyncState {
  return readState().google ?? {};
}

export function saveGoogleSyncState(update: Partial<GoogleSyncState>): void {
  const state = readState();
  state.google = { ...state.google, ...update };
  writeState(state);
}

export function clearGoogleSyncState(): void {
  const state = readState();
  delete state.google;
  writeState(state);
}
