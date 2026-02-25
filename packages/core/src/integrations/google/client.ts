import { getOAuthToken, isTokenExpired } from "../../agent/auth-store";
import { refreshOAuthToken } from "../../agent/oauth";
import type { GoogleServiceConfig } from "../../grind-home";
import { GRIND_GOOGLE_CLIENT_ID, GOOGLE_OAUTH_KEY, buildGoogleOAuthConfig } from "./config";

export class GoogleApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    message: string,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

export class GoogleNotConnectedError extends Error {
  constructor() {
    super("Google account not connected. Run `grindxp integrations connect google`.");
    this.name = "GoogleNotConnectedError";
  }
}

export class GoogleTokenExpiredError extends Error {
  constructor() {
    super(
      "Google token expired and could not be refreshed. Run `grindxp integrations connect google`.",
    );
    this.name = "GoogleTokenExpiredError";
  }
}

export async function getValidGoogleToken(serviceConfig: GoogleServiceConfig): Promise<string> {
  const token = getOAuthToken(GOOGLE_OAUTH_KEY);
  if (!token) throw new GoogleNotConnectedError();

  if (isTokenExpired(token)) {
    const clientId = serviceConfig.clientId ?? GRIND_GOOGLE_CLIENT_ID;
    const config = buildGoogleOAuthConfig(
      clientId,
      serviceConfig.gmailEnabled,
      serviceConfig.clientSecret,
    );
    try {
      return await refreshOAuthToken(GOOGLE_OAUTH_KEY, config, token);
    } catch {
      throw new GoogleTokenExpiredError();
    }
  }

  return token.accessToken;
}

export async function googleFetch(
  url: string,
  serviceConfig: GoogleServiceConfig,
  options?: RequestInit,
): Promise<Response> {
  const accessToken = await getValidGoogleToken(serviceConfig);

  const resp = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new GoogleApiError(resp.status, body, `Google API error ${resp.status}: ${url}`);
  }

  return resp;
}
