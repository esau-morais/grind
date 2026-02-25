import { readGrindConfig, getTimerPath } from "@grindxp/core";
import { createVaultDatabase } from "@grindxp/core/vault";
import type { VaultDb } from "@grindxp/core/vault";

export interface VaultContext {
  db: VaultDb;
  userId: string;
  timerPath: string;
}

let _ctx: VaultContext | null = null;

export function getVaultContext(): VaultContext {
  const config = readGrindConfig();
  if (!config) {
    _ctx = null;
    throw new Error("Grind not initialized. Run `grind init` first.");
  }

  if (_ctx) return _ctx;

  const { db } = createVaultDatabase({
    localDbPath: config.vaultPath,
    encryptionKey: config.encryptionKey,
  });

  _ctx = { db, userId: config.userId, timerPath: getTimerPath() };
  return _ctx;
}

export function getGrindConfig() {
  const config = readGrindConfig();
  if (!config) {
    throw new Error("Grind not initialized. Run `grind init` first.");
  }
  return config;
}
