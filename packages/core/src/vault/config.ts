import { z } from "zod";

export interface VaultConfig {
  localDbPath: string;
  encryptionKey: string;
  syncUrl?: string;
  authToken?: string;
  syncIntervalSeconds?: number;
}

const vaultEnvSchema = z
  .object({
    GRIND_VAULT_PATH: z.string().default("./.grind/vault.db"),
    GRIND_ENCRYPTION_KEY: z.string().min(16),
    TURSO_DATABASE_URL: z.string().optional(),
    TURSO_AUTH_TOKEN: z.string().optional(),
    GRIND_SYNC_INTERVAL_SECONDS: z.coerce.number().int().positive().optional(),
  })
  .strict();

export function resolveVaultConfig(env: NodeJS.ProcessEnv = process.env): VaultConfig {
  const parsed = vaultEnvSchema.parse({
    GRIND_VAULT_PATH: env.GRIND_VAULT_PATH,
    GRIND_ENCRYPTION_KEY: env.GRIND_ENCRYPTION_KEY,
    TURSO_DATABASE_URL: env.TURSO_DATABASE_URL,
    TURSO_AUTH_TOKEN: env.TURSO_AUTH_TOKEN,
    GRIND_SYNC_INTERVAL_SECONDS: env.GRIND_SYNC_INTERVAL_SECONDS,
  });

  const config: VaultConfig = {
    localDbPath: parsed.GRIND_VAULT_PATH,
    encryptionKey: parsed.GRIND_ENCRYPTION_KEY,
  };

  if (parsed.TURSO_DATABASE_URL) {
    config.syncUrl = parsed.TURSO_DATABASE_URL;
  }

  if (parsed.TURSO_AUTH_TOKEN) {
    config.authToken = parsed.TURSO_AUTH_TOKEN;
  }

  if (typeof parsed.GRIND_SYNC_INTERVAL_SECONDS === "number") {
    config.syncIntervalSeconds = parsed.GRIND_SYNC_INTERVAL_SECONDS;
  }

  return config;
}
