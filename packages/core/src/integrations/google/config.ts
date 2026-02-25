import type { OAuthCallbackConfig } from "../../agent/oauth";

export const GRIND_GOOGLE_CLIENT_ID =
  "1088389786699-jd79edc3c10jadamcl0rlua5lmn0pc06.apps.googleusercontent.com";

export const GOOGLE_OAUTH_CALLBACK_PORT = 5175;
export const GOOGLE_OAUTH_KEY = "google-services";

export const GOOGLE_SCOPE_CALENDAR = "https://www.googleapis.com/auth/calendar";
export const GOOGLE_SCOPE_GMAIL_READONLY = "https://www.googleapis.com/auth/gmail.readonly";
export const GOOGLE_SCOPE_GMAIL_SEND = "https://www.googleapis.com/auth/gmail.send";
export const GOOGLE_SCOPE_PROFILE = "openid profile email";

/**
 * Builds the OAuth config for Google.
 *
 * clientSecret resolution order:
 *   1. Explicit arg — user-provided credentials via flag or config
 *   2. process.env.GRIND_GOOGLE_CLIENT_SECRET — set in .env for local dev,
 *      or baked into compiled binaries via `bun build --compile --define`
 *
 * Token exchange always goes directly to Google. No proxy involved.
 */
export function buildGoogleOAuthConfig(
  clientId: string,
  gmailEnabled: boolean,
  clientSecret?: string,
): OAuthCallbackConfig {
  const scopes = [
    GOOGLE_SCOPE_PROFILE,
    GOOGLE_SCOPE_CALENDAR,
    ...(gmailEnabled ? [GOOGLE_SCOPE_GMAIL_READONLY, GOOGLE_SCOPE_GMAIL_SEND] : []),
  ].join(" ");

  const resolvedSecret = clientSecret ?? process.env.GRIND_GOOGLE_CLIENT_SECRET;

  return {
    method: "callback",
    issuer: "https://accounts.google.com",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientId,
    ...(resolvedSecret ? { clientSecret: resolvedSecret } : {}),
    scopes,
    callbackPort: GOOGLE_OAUTH_CALLBACK_PORT,
    extraParams: {
      access_type: "offline",
      prompt: "consent",
    },
  };
}
