import type { GrindConfig, UserProfile, VaultDb } from "@grindxp/core";
import { getMigrationsPath, getTimerPath, openVault, readGrindConfig } from "@grindxp/core";
import { getUserById } from "@grindxp/core/vault";

export interface TuiContext {
  config: GrindConfig;
  db: VaultDb;
  close: () => void;
  user: UserProfile;
  timerPath: string;
}

export async function loadTuiContext(): Promise<TuiContext> {
  const config = readGrindConfig();
  if (!config) {
    console.error("grind is not initialized. Run `grind init` first.");
    process.exit(1);
  }

  const { client, db } = await openVault(
    { localDbPath: config.vaultPath, encryptionKey: config.encryptionKey },
    getMigrationsPath(),
  );

  const user = await getUserById(db, config.userId);
  if (!user) {
    console.error("User profile corrupted. Run `grindxp init` to re-initialize.");
    client.close();
    process.exit(1);
  }

  return {
    config,
    db,
    close: () => client.close(),
    user,
    timerPath: getTimerPath(),
  };
}
