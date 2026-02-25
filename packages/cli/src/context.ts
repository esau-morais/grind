import * as p from "@clack/prompts";

import {
  type GrindConfig,
  type UserProfile,
  type VaultDb,
  getMigrationsPath,
  getTimerPath,
  openVault,
  readGrindConfig,
} from "@grindxp/core";
import { getUserById } from "@grindxp/core/vault";

export interface CliContext {
  config: GrindConfig;
  db: VaultDb;
  close: () => void;
  user: UserProfile;
  timerPath: string;
}

export async function loadContext(): Promise<CliContext> {
  const config = readGrindConfig();
  if (!config) {
    p.log.error("grindxp is not initialized. Run `grindxp init` first.");
    process.exit(1);
  }

  const { client, db } = await openVault(
    { localDbPath: config.vaultPath, encryptionKey: config.encryptionKey },
    getMigrationsPath(),
  );

  const user = await getUserById(db, config.userId);
  if (!user) {
    p.log.error("User profile corrupted. Run `grindxp init` to re-initialize.");
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

export function closeContext(ctx: CliContext): void {
  ctx.close();
}
