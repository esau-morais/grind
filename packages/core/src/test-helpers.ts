import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { Client } from "@libsql/client";

import { openVault } from "./vault/client";
import { createUser } from "./vault/repositories/users";
import type { VaultDb } from "./vault/types";
import type { UserProfile } from "./schema";
import type { ToolContext } from "./agent/tools";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../drizzle");

export interface TestVault {
  db: VaultDb;
  client: Client;
  close: () => void;
}

export async function createTestVault(): Promise<TestVault> {
  const dir = mkdtempSync(join(tmpdir(), "grind-vault-"));
  const dbPath = join(dir, "vault.db");

  const { client, db } = await openVault(
    { localDbPath: dbPath, encryptionKey: "test-key-for-testing-only" },
    MIGRATIONS_FOLDER,
  );

  return {
    db,
    client,
    close: () => {
      client.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function createTestUser(
  db: VaultDb,
  overrides: { displayName?: string; totalXp?: number; level?: number } = {},
): Promise<UserProfile> {
  return createUser(db, {
    displayName: overrides.displayName ?? "Test User",
    totalXp: overrides.totalXp ?? 0,
    level: overrides.level ?? 1,
    preferences: {
      timezone: "UTC",
      locale: "en-US",
      notificationsEnabled: true,
      companionEnabled: false,
    },
    metadata: {},
  });
}

export function createTestToolContext(
  db: VaultDb,
  userId: string,
  overrides: { timerDir?: string } = {},
): ToolContext & { timerDir: string } {
  const dir = overrides.timerDir ?? mkdtempSync(join(tmpdir(), "grind-test-"));
  return {
    db,
    userId,
    timerPath: join(dir, "timer.json"),
    timerDir: dir,
    trustLevel: 4,
  };
}
