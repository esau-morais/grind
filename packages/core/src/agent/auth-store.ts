import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";

import { z } from "zod";

import { ensureGrindHome, getAuthStorePath } from "../grind-home";

const oauthTokenSchema = z.object({
  provider: z.string(),
  accessToken: z.string(),
  chatgptAccountId: z.string().optional(),
  email: z.string().optional(),
  refreshToken: z.string().optional(),
  idToken: z.string().optional(),
  expiresAt: z.number().optional(),
});

export type OAuthToken = z.infer<typeof oauthTokenSchema>;

const authStoreSchema = z.object({
  version: z.number(),
  tokens: z.record(z.string(), oauthTokenSchema),
});

type AuthStore = z.infer<typeof authStoreSchema>;

function readStore(): AuthStore {
  const path = getAuthStorePath();
  if (!existsSync(path)) return { version: 1, tokens: {} };
  const raw = readFileSync(path, "utf-8");
  return authStoreSchema.parse(JSON.parse(raw));
}

function writeStore(store: AuthStore): void {
  ensureGrindHome();
  const path = getAuthStorePath();
  writeFileSync(path, JSON.stringify(store, null, 2));
  chmodSync(path, 0o600);
}

export function saveOAuthToken(provider: string, token: OAuthToken): void {
  const store = readStore();
  store.tokens[provider] = token;
  writeStore(store);
}

export function getOAuthToken(provider: string): OAuthToken | null {
  const store = readStore();
  return store.tokens[provider] ?? null;
}

export function removeOAuthToken(provider: string): void {
  const store = readStore();
  delete store.tokens[provider];
  writeStore(store);
}

export function isTokenExpired(token: OAuthToken): boolean {
  if (!token.expiresAt) return false;
  return Date.now() >= token.expiresAt - 60_000;
}
