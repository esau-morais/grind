import { existsSync, readFileSync, unlinkSync } from "node:fs";
import type { AiProvider } from "../grind-home";
import { getOAuthPendingPath } from "../grind-home";
import { type OAuthToken, saveOAuthToken } from "./auth-store";

interface PkceCodes {
  verifier: string;
  challenge: string;
}

function generatePKCE(): PkceCodes {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  const verifier = Buffer.from(bytes).toString("base64url");

  const digest = new Bun.CryptoHasher("sha256").update(verifier).digest();
  const challenge = Buffer.from(digest).toString("base64url");

  return { verifier, challenge };
}

function generateState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

// ---------------------------------------------------------------------------
// Provider configs
// ---------------------------------------------------------------------------

export interface OAuthCallbackConfig {
  method: "callback";
  issuer: string;
  authorizeUrl?: string;
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  scopes: string;
  callbackPort: number;
  extraParams?: Record<string, string>;
}

export interface OAuthCodeConfig {
  method: "code";
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  scopes: string;
  redirectUri: string;
  stateIsVerifier?: boolean;
}

export type OAuthProviderConfig = OAuthCallbackConfig | OAuthCodeConfig;

const OPENAI_OAUTH: OAuthCallbackConfig = {
  method: "callback",
  issuer: "https://auth.openai.com",
  tokenUrl: "https://auth.openai.com/oauth/token",
  clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
  scopes: "openid profile email offline_access",
  callbackPort: 1455,
  extraParams: {
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    originator: "grind",
  },
};

const ANTHROPIC_OAUTH: OAuthCodeConfig = {
  method: "code",
  authorizeUrl: "https://claude.ai/oauth/authorize",
  tokenUrl: "https://console.anthropic.com/v1/oauth/token",
  clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  scopes: "org:create_api_key user:profile user:inference",
  redirectUri: "https://console.anthropic.com/oauth/code/callback",
  stateIsVerifier: true,
};

// Anthropic consumer OAuth is enabled for personal use. grind is a personal
// productivity tool — not a third-party product redistributed to other users.
// Set GRIND_DISABLE_ANTHROPIC_OAUTH=1 to opt out and use an API key instead.
export const OAUTH_CONFIGS: Partial<Record<AiProvider, OAuthProviderConfig>> = {
  openai: OPENAI_OAUTH,
  ...(process.env.GRIND_DISABLE_ANTHROPIC_OAUTH !== "1" ? { anthropic: ANTHROPIC_OAUTH } : {}),
};

export function supportsOAuth(provider: AiProvider): boolean {
  return provider in OAUTH_CONFIGS;
}

// ---------------------------------------------------------------------------
// Flow handles
// ---------------------------------------------------------------------------

export interface OAuthResult {
  token: OAuthToken;
}

export interface OAuthCallbackFlowHandle {
  method: "callback";
  authUrl: string;
  complete: () => Promise<OAuthResult>;
  completeWithCode: (code: string) => Promise<OAuthResult>;
}

export interface OAuthCodeFlowHandle {
  method: "code";
  authUrl: string;
  completeWithCode: (code: string) => Promise<OAuthResult>;
}

export type OAuthFlowHandle = OAuthCallbackFlowHandle | OAuthCodeFlowHandle;

export function startOAuthFlow(provider: string, config: OAuthProviderConfig): OAuthFlowHandle {
  const pkce = generatePKCE();

  if (config.method === "code") {
    return startCodeFlow(provider, config, pkce);
  }
  return startCallbackFlow(provider, config, pkce);
}

// ---------------------------------------------------------------------------
// Code-paste flow (Anthropic)
// ---------------------------------------------------------------------------

function startCodeFlow(
  provider: string,
  config: OAuthCodeConfig,
  pkce: PkceCodes,
): OAuthCodeFlowHandle {
  const state = config.stateIsVerifier ? pkce.verifier : generateState();

  const params = new URLSearchParams({
    code: "true",
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    scope: config.scopes,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    state,
  });

  const authUrl = `${config.authorizeUrl}?${params.toString()}`;

  const completeWithCode = async (rawCode: string): Promise<OAuthResult> => {
    const parts = rawCode.split("#");
    const code = parts[0] ?? rawCode;
    const returnedState = parts[1];

    const body: Record<string, string> = {
      grant_type: "authorization_code",
      code,
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      code_verifier: pkce.verifier,
    };
    if (returnedState) body.state = returnedState;

    const resp = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-beta": "oauth-2025-04-20",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Token exchange failed (${resp.status}): ${text}`);
    }

    const data = (await resp.json()) as Record<string, unknown>;
    const accessToken = String(data.access_token ?? "");

    const oauthToken: OAuthToken = { provider, accessToken };
    if (data.refresh_token) oauthToken.refreshToken = String(data.refresh_token);
    if (data.expires_in) oauthToken.expiresAt = Date.now() + Number(data.expires_in) * 1000;

    saveOAuthToken(provider, oauthToken);

    return { token: oauthToken };
  };

  return { method: "code", authUrl, completeWithCode };
}

// ---------------------------------------------------------------------------
// Callback flow (OpenAI)
// ---------------------------------------------------------------------------

function startCallbackFlow(
  provider: string,
  config: OAuthCallbackConfig,
  pkce: PkceCodes,
): OAuthCallbackFlowHandle {
  const state = generateState();
  const redirectUri = `http://127.0.0.1:${config.callbackPort}/auth/callback`;

  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: redirectUri,
    scope: config.scopes,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    state,
    ...config.extraParams,
  });
  const baseAuthUrl = config.authorizeUrl ?? `${config.issuer}/oauth/authorize`;
  const authUrl = `${baseAuthUrl}?${params.toString()}`;

  const completeWithCode = async (code: string): Promise<OAuthResult> => {
    const tokens = await exchangeCallbackCode(config, redirectUri, pkce, code);

    const chatgptAccountId = extractChatgptAccountId(tokens.idToken, tokens.accessToken);

    const oauthToken: OAuthToken = {
      provider,
      accessToken: tokens.accessToken,
      ...(chatgptAccountId ? { chatgptAccountId } : {}),
    };
    if (tokens.refreshToken) oauthToken.refreshToken = tokens.refreshToken;
    if (tokens.idToken) oauthToken.idToken = tokens.idToken;
    if (tokens.expiresIn) oauthToken.expiresAt = Date.now() + tokens.expiresIn * 1000;

    saveOAuthToken(provider, oauthToken);

    return { token: oauthToken };
  };

  const complete = async (): Promise<OAuthResult> => {
    const code = await waitForCallback(state);
    return completeWithCode(code);
  };

  return { method: "callback", authUrl, complete, completeWithCode };
}

// ---------------------------------------------------------------------------
// Token exchange helpers
// ---------------------------------------------------------------------------

interface ExchangedTokens {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresIn?: number;
}

function parseJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  const payload = parts[1];
  if (!payload) return null;
  try {
    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractChatgptAccountId(idToken?: string, accessToken?: string): string | undefined {
  if (idToken) {
    const payload = parseJwtPayload(idToken);
    if (payload) {
      const authClaim =
        payload["https://api.openai.com/auth"] &&
        typeof payload["https://api.openai.com/auth"] === "object"
          ? (payload["https://api.openai.com/auth"] as Record<string, unknown>)
          : null;
      const fromId =
        (authClaim && typeof authClaim.chatgpt_account_id === "string"
          ? authClaim.chatgpt_account_id
          : undefined) ??
        (typeof payload.chatgpt_account_id === "string" ? payload.chatgpt_account_id : undefined);
      if (fromId) return fromId;
    }
  }

  if (accessToken) {
    const payload = parseJwtPayload(accessToken);
    if (payload && typeof payload.chatgpt_account_id === "string") {
      return payload.chatgpt_account_id;
    }
  }

  return undefined;
}

async function exchangeCallbackCode(
  config: OAuthCallbackConfig,
  redirectUri: string,
  pkce: PkceCodes,
  code: string,
): Promise<ExchangedTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: config.clientId,
    code_verifier: pkce.verifier,
    ...(config.clientSecret ? { client_secret: config.clientSecret } : {}),
  });

  const resp = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token exchange failed (${resp.status}): ${text}`);
  }

  const data = (await resp.json()) as Record<string, unknown>;
  const result: ExchangedTokens = { accessToken: String(data.access_token ?? "") };
  if (data.refresh_token) result.refreshToken = String(data.refresh_token);
  if (data.id_token) result.idToken = String(data.id_token);
  if (data.expires_in) result.expiresIn = Number(data.expires_in);
  return result;
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

export async function refreshOAuthToken(
  provider: string,
  config: OAuthProviderConfig,
  token: OAuthToken,
): Promise<string> {
  if (!token.refreshToken) {
    throw new Error("No refresh token available. Re-run `grindxp setup` to re-authenticate.");
  }

  const body: Record<string, string> = {
    grant_type: "refresh_token",
    client_id: config.clientId,
    refresh_token: token.refreshToken,
    ...(config.method === "callback" && config.clientSecret
      ? { client_secret: config.clientSecret }
      : {}),
  };

  const tokenUrl = config.tokenUrl;
  const contentType =
    config.method === "code" ? "application/json" : "application/x-www-form-urlencoded";
  const reqBody =
    config.method === "code" ? JSON.stringify(body) : new URLSearchParams(body).toString();

  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: reqBody,
  });

  if (!resp.ok) {
    throw new Error(`Token refresh failed (${resp.status}). Re-run \`grindxp setup\`.`);
  }

  const data = (await resp.json()) as Record<string, unknown>;
  const newAccess = String(data.access_token ?? "");

  const updated: OAuthToken = { ...token, accessToken: newAccess };
  if (data.refresh_token) updated.refreshToken = String(data.refresh_token);
  if (data.id_token) updated.idToken = String(data.id_token);
  if (data.expires_in) updated.expiresAt = Date.now() + Number(data.expires_in) * 1000;
  const chatgptAccountId = extractChatgptAccountId(updated.idToken, updated.accessToken);
  if (chatgptAccountId) updated.chatgptAccountId = chatgptAccountId;

  saveOAuthToken(provider, updated);

  return newAccess;
}

// ---------------------------------------------------------------------------
// File-based callback poller (OpenAI flow)
//
// The web server (localhost:3000) handles GET /auth/callback and writes the
// code + state to ~/.grind/oauth-pending.json. This poller reads that file
// so the CLI process can pick up the result without needing its own HTTP server.
// ---------------------------------------------------------------------------

interface OAuthPending {
  code?: string;
  state: string;
  error?: string;
  ts: number;
}

function waitForCallback(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const pendingPath = getOAuthPendingPath();
    const deadline = Date.now() + 120_000;

    // Clean up any stale pending file from a previous run.
    try {
      if (existsSync(pendingPath)) unlinkSync(pendingPath);
    } catch {}

    const tick = () => {
      if (Date.now() > deadline) {
        reject(new Error("OAuth callback timed out after 120s"));
        return;
      }

      if (existsSync(pendingPath)) {
        try {
          const data = JSON.parse(readFileSync(pendingPath, "utf-8")) as OAuthPending;
          if (data.state === expectedState) {
            try {
              unlinkSync(pendingPath);
            } catch {}
            if (data.error) {
              reject(new Error(`OAuth error: ${data.error}`));
            } else if (data.code) {
              resolve(data.code);
            } else {
              reject(new Error("OAuth callback received but contained no code"));
            }
            return;
          }
        } catch {}
      }

      setTimeout(tick, 300);
    };

    tick();
  });
}
