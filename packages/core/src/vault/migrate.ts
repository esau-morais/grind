import { resolve } from "node:path";

import { openVault } from "./client";
import { resolveVaultConfig } from "./config";

export async function runMigrations(migrationsFolder?: string): Promise<void> {
  const config = resolveVaultConfig();
  const folder = migrationsFolder ?? resolve(import.meta.dir, "../../drizzle");
  const { client } = await openVault(config, folder);
  client.close();
}

if (import.meta.main) {
  await runMigrations();
}
