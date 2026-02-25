import { type Client, type Config, createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { readMigrationFiles } from "drizzle-orm/migrator";

import type { VaultConfig } from "./config";
import * as relations from "./relations";
import * as schema from "./schema";
import type { VaultDb } from "./types";

// drizzle-orm/libsql/migrator uses `SERIAL PRIMARY KEY` (Postgres syntax) which
// fails on SQLite/libSQL. This custom implementation uses `INTEGER PRIMARY KEY`.
async function runMigrations(client: Client, migrationsFolder: string): Promise<void> {
  const migrations = readMigrationFiles({ migrationsFolder });

  await client.execute(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      hash  TEXT NOT NULL,
      created_at NUMERIC
    )
  `);

  const { rows } = await client.execute("SELECT hash FROM __drizzle_migrations");
  const appliedHashes = new Set(rows.map((r) => String(r.hash)));

  for (const migration of migrations) {
    if (!appliedHashes.has(migration.hash)) {
      const stmts = migration.sql
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((sql) => ({ sql }));

      await client.batch(
        [
          ...stmts,
          {
            sql: "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
            args: [migration.hash, migration.folderMillis],
          },
        ],
        "write",
      );
    }
  }
}

function toFileUrl(path: string): string {
  return path.startsWith("file:") ? path : `file:${path}`;
}

export function createVaultClient(config: VaultConfig): Client {
  const clientConfig: Config = {
    url: toFileUrl(config.localDbPath),
    encryptionKey: config.encryptionKey,
  };

  if (config.syncUrl) {
    clientConfig.syncUrl = config.syncUrl;
  }

  if (config.authToken) {
    clientConfig.authToken = config.authToken;
  }

  if (typeof config.syncIntervalSeconds === "number") {
    clientConfig.syncInterval = config.syncIntervalSeconds;
  }

  return createClient(clientConfig);
}

export function createVaultDatabase(config: VaultConfig): { client: Client; db: VaultDb } {
  const client = createVaultClient(config);
  const db = drizzle({ client, schema: { ...schema, ...relations } });
  return { client, db };
}

export async function openVault(
  config: VaultConfig,
  migrationsFolder: string,
): Promise<{ client: Client; db: VaultDb }> {
  const { client, db } = createVaultDatabase(config);
  await runMigrations(client, migrationsFolder);
  return { client, db };
}
