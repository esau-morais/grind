import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

const GRIND_DIR = ".grind";

export const AI_PROVIDERS = ["anthropic", "openai", "google", "ollama"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AUTH_TYPES = ["api-key", "oauth"] as const;
export type AuthType = (typeof AUTH_TYPES)[number];

const aiConfigSchema = z
  .object({
    provider: z.enum(AI_PROVIDERS).optional(),
    authType: z.enum(AUTH_TYPES).optional(),
    apiKey: z.string().optional(),
    model: z.string().optional(),
    baseUrl: z.string().optional(),
    autoCompact: z.boolean().optional(),
  })
  .strict();

export type AiConfig = z.infer<typeof aiConfigSchema>;

const gatewayConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    host: z.string().min(1).default("127.0.0.1"),
    port: z.number().int().min(1).max(65_535).default(5174),
    token: z.string().min(1),
    telegramBotToken: z.string().min(1).optional(),
    telegramDefaultChatId: z.string().min(1).optional(),
    telegramWebhookSecret: z.string().min(1).optional(),
    telegramWebhookPath: z.string().min(1).optional(),
    discordPublicKey: z.string().min(1).optional(),
    discordWebhookPath: z.string().min(1).optional(),
    whatsAppWebhookPath: z.string().min(1).optional(),
    whatsAppMode: z.enum(["qr-link", "cloud-api"]).optional(),
    whatsAppLinkedAt: z.number().int().positive().optional(),
    whatsAppPairingMethod: z.enum(["qr", "pairing-code"]).optional(),
    whatsAppPairingPhone: z.string().min(1).optional(),
    whatsAppVerifyToken: z.string().min(1).optional(),
    whatsAppAppSecret: z.string().min(1).optional(),
    whatsAppAccessToken: z.string().min(1).optional(),
    whatsAppPhoneNumberId: z.string().min(1).optional(),
  })
  .strict();

export type GatewayConfig = z.infer<typeof gatewayConfigSchema>;

const googleServiceConfigSchema = z
  .object({
    email: z.string().optional(),
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    calendarEnabled: z.boolean().default(true),
    gmailEnabled: z.boolean().default(false),
    pollIntervalSeconds: z.number().int().positive().optional(),
  })
  .strict();

export type GoogleServiceConfig = z.infer<typeof googleServiceConfigSchema>;

const servicesConfigSchema = z
  .object({
    google: googleServiceConfigSchema.optional(),
  })
  .strict();

export type ServicesConfig = z.infer<typeof servicesConfigSchema>;

const grindConfigSchema = z.object({
  userId: z.string(),
  encryptionKey: z.string(),
  vaultPath: z.string(),
  createdAt: z.number(),
  ai: aiConfigSchema.optional(),
  gateway: gatewayConfigSchema.optional(),
  services: servicesConfigSchema.optional(),
  theme: z.string().optional(),
  autoupdate: z.union([z.boolean(), z.literal("notify")]).optional(),
});

export type GrindConfig = z.infer<typeof grindConfigSchema>;

export function getGrindHome(): string {
  return process.env.GRIND_HOME ?? join(homedir(), GRIND_DIR);
}

export function getConfigPath(): string {
  return join(getGrindHome(), "config.json");
}

export function getVaultPath(): string {
  return join(getGrindHome(), "vault.db");
}

export function getTimerPath(): string {
  return join(getGrindHome(), "timer.json");
}

export function getAuthStorePath(): string {
  return join(getGrindHome(), "auth.json");
}

export function getServiceStatePath(): string {
  return join(getGrindHome(), "service-state.json");
}

export function getMigrationsPath(): string {
  const bundled = join(import.meta.dir, "drizzle");
  if (existsSync(join(bundled, "meta", "_journal.json"))) return bundled;
  return join(import.meta.dir, "../drizzle");
}

export function ensureGrindHome(): void {
  const home = getGrindHome();
  if (!existsSync(home)) {
    mkdirSync(home, { recursive: true, mode: 0o700 });
  }
}

export function writeGrindConfig(config: GrindConfig): void {
  const configPath = getConfigPath();
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  chmodSync(configPath, 0o600);
}

export function readGrindConfig(): GrindConfig | null {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) return null;
  const raw = readFileSync(configPath, "utf-8");
  return grindConfigSchema.parse(JSON.parse(raw));
}

export function isInitialized(): boolean {
  return readGrindConfig() !== null;
}

export function generateEncryptionKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

export function generateGatewayToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}
