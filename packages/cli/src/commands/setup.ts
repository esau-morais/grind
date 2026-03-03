import * as p from "@clack/prompts";

import {
  AI_PROVIDERS,
  DEFAULT_SOUL,
  type AiConfig,
  type AiProvider,
  type AuthType,
  type OAuthCallbackConfig,
  DEFAULT_MODELS,
  OAUTH_CONFIGS,
  getMigrationsPath,
  openVault,
  readGrindConfig,
  startOAuthFlow,
  supportsOAuth,
  writeGrindConfig,
} from "@grindxp/core";
import { getCompanionByUserId, upsertCompanion } from "@grindxp/core/vault";
import { showTitle } from "../brand";
import { spinner } from "../spinner";
import { resolveWeb } from "./web";
import {
  clearWebProcessState,
  getManagedWebStatus,
  startManagedWeb,
  WEB_HOST,
  WEB_PORT,
} from "../web/service";

const PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (GPT)",
  google: "Google (Gemini)",
  ollama: "Ollama (local)",
};

interface AuthChoice {
  value: AuthType;
  label: string;
  hint: string;
}

function getAuthChoices(provider: AiProvider): AuthChoice[] {
  const choices: AuthChoice[] = [];

  if (supportsOAuth(provider)) {
    choices.push({
      value: "oauth",
      label: "OAuth (browser login)",
      hint: "sign in via browser — uses your subscription",
    });
  }

  choices.push({
    value: "api-key",
    label: "API Key",
    hint:
      provider === "anthropic"
        ? "get your key at console.anthropic.com"
        : "paste your key from the provider dashboard",
  });

  return choices;
}

async function syncCompanionFromAi(
  config: NonNullable<ReturnType<typeof readGrindConfig>>,
  ai: AiConfig,
) {
  const provider = ai.provider;
  if (!provider) return;

  const model = ai.model ?? DEFAULT_MODELS[provider];
  const { client, db } = await openVault(
    { localDbPath: config.vaultPath, encryptionKey: config.encryptionKey },
    getMigrationsPath(),
  );

  try {
    const existing = await getCompanionByUserId(db, config.userId);
    if (!existing) {
      await upsertCompanion(db, {
        userId: config.userId,
        mode: "suggest",
        provider,
        model,
        systemPrompt: DEFAULT_SOUL,
      });
      return "initialized" as const;
    }

    await upsertCompanion(db, {
      ...existing,
      provider,
      model,
    });
    return "synced" as const;
  } finally {
    client.close();
  }
}

export async function setupCommand(): Promise<void> {
  p.intro(`${showTitle()} — Agent Setup`);

  const config = readGrindConfig();
  if (!config) {
    p.log.error("grind is not initialized. Run `grind init` first.");
    process.exit(1);
  }

  const existing = config.ai;

  const providerOptions = AI_PROVIDERS.map((id) => {
    const opt: { value: AiProvider; label: string; hint?: string } = {
      value: id,
      label: PROVIDER_LABELS[id],
    };
    if (id === "ollama") opt.hint = "runs locally, no API key needed";
    return opt;
  });

  const provider = (await p.select({
    message: "Select AI provider",
    options: providerOptions,
    initialValue: existing?.provider ?? ("anthropic" as AiProvider),
  })) as AiProvider;

  if (p.isCancel(provider)) {
    p.outro("Cancelled.");
    return;
  }

  let authType: AuthType = "api-key";
  let apiKey: string | undefined;

  if (provider === "ollama") {
    authType = "api-key";
  } else {
    const authChoices = getAuthChoices(provider);

    if (authChoices.length === 1) {
      authType = "api-key";
    } else {
      const authResult = (await p.select({
        message: "Authentication method",
        options: authChoices.map((c) => {
          const opt: { value: AuthType; label: string; hint?: string } = {
            value: c.value,
            label: c.label,
          };
          opt.hint = c.hint;
          return opt;
        }),
        initialValue:
          existing?.authType ??
          (supportsOAuth(provider) ? ("oauth" as AuthType) : ("api-key" as AuthType)),
      })) as AuthType;

      if (p.isCancel(authResult)) {
        p.outro("Cancelled.");
        return;
      }
      authType = authResult;
    }

    if (authType === "api-key") {
      const keyResult = await p.text({
        message: `${PROVIDER_LABELS[provider]} API key`,
        placeholder: existing?.apiKey ? "••••••••" : "sk-...",
        validate: (v) => {
          if (!v && !existing?.apiKey) return "API key is required";
        },
      });

      if (p.isCancel(keyResult)) {
        p.outro("Cancelled.");
        return;
      }

      apiKey = (keyResult as string) || existing?.apiKey;
    } else if (authType === "oauth") {
      const oauthConfig = OAUTH_CONFIGS[provider];
      if (!oauthConfig) {
        p.log.error(`OAuth not available for ${PROVIDER_LABELS[provider]}.`);
        process.exit(1);
      }

      const flow = startOAuthFlow(provider, oauthConfig);

      p.log.info(`Open this URL in your browser:\n  ${flow.authUrl}`);

      // Best-effort browser open — silent on any failure (headless, no binary, no display).
      const openCmd =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "start"
            : "xdg-open";
      try {
        Bun.spawn([openCmd, flow.authUrl], { stdio: ["ignore", "ignore", "ignore"] });
      } catch {}

      if (flow.method === "code") {
        // Anthropic: user pastes a code shown in the browser.
        const codeResult = await p.text({
          message: "Paste the authorization code from the browser",
          placeholder: "code...",
          validate: (v) => {
            if (!v) return "Authorization code is required";
          },
        });

        if (p.isCancel(codeResult)) {
          p.outro("Cancelled.");
          return;
        }

        const spin = spinner();
        spin.start("Exchanging authorization code…");

        try {
          await flow.completeWithCode(codeResult as string);
          spin.stop("Authenticated successfully.");
        } catch (err) {
          spin.error("Authentication failed.");
          p.log.error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      } else {
        try {
          const code = await waitForOAuthCode(oauthConfig as OAuthCallbackConfig);
          await flow.completeWithCode(code);
        } catch (err) {
          p.log.error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      }
    }
  }

  const defaultModel =
    provider === "openai" && authType === "oauth" ? "gpt-5.1-codex" : DEFAULT_MODELS[provider];
  const modelResult = await p.text({
    message: "Model",
    placeholder: defaultModel,
    defaultValue: existing?.model ?? defaultModel,
  });

  if (p.isCancel(modelResult)) {
    p.outro("Cancelled.");
    return;
  }

  const model = (modelResult as string) || defaultModel;

  let baseUrl: string | undefined;
  if (provider === "ollama") {
    const urlResult = await p.text({
      message: "Ollama base URL",
      placeholder: "http://localhost:11434/v1",
      defaultValue: existing?.baseUrl ?? "http://localhost:11434/v1",
    });

    if (p.isCancel(urlResult)) {
      p.outro("Cancelled.");
      return;
    }

    baseUrl = (urlResult as string) || "http://localhost:11434/v1";
  }

  const ai: AiConfig = { provider, authType, model };
  if (apiKey) ai.apiKey = apiKey;
  if (baseUrl) ai.baseUrl = baseUrl;

  const companionSync = await syncCompanionFromAi(config, ai);

  writeGrindConfig({ ...config, ai });

  p.log.success(`Provider: ${PROVIDER_LABELS[provider]}`);
  p.log.success(`Auth: ${authType === "oauth" ? "OAuth (browser)" : "API Key"}`);
  p.log.success(`Model: ${model}`);
  if (companionSync === "initialized") {
    p.log.success("Companion: initialized from AI setup.");
  } else {
    p.log.success("Companion: synced with selected provider/model.");
  }
  p.outro("Agent configured. Run `grindxp chat` to start talking.");
}

export async function ensureWebServer(): Promise<void> {
  const status = await getManagedWebStatus();
  if (status.reachable) return;

  if (status.state && !status.running) clearWebProcessState();

  const web = resolveWeb();
  if (!web.ok) return;

  const spin = spinner();
  spin.start("Starting web server for OAuth callback…");
  try {
    await startManagedWeb(web.serverEntry);
    spin.stop(`Web server ready at http://${WEB_HOST}:${WEB_PORT}`);
  } catch {
    spin.stop("Web server could not start — OAuth callback may not work automatically.");
  }
}

export function startOAuthProxy(
  config: OAuthCallbackConfig,
  onSuccess: (code: string) => void,
  onError: (error: string) => void,
) {
  const server = Bun.serve({
    port: config.callbackPort,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/auth/callback") {
        return new Response("Not found", { status: 404 });
      }

      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        onError(error);
        return new Response(oauthCallbackHtml(false, `Authorization failed: ${error}`), {
          status: 400,
          headers: { "Content-Type": "text/html" },
        });
      }

      if (!code) {
        onError("missing_code");
        return new Response(oauthCallbackHtml(false, "Missing authorization code."), {
          status: 400,
          headers: { "Content-Type": "text/html" },
        });
      }

      onSuccess(code);
      return new Response(oauthCallbackHtml(true, "You can close this tab and return to grind."), {
        headers: { "Content-Type": "text/html" },
      });
    },
  });
  return { stop: () => server.stop() };
}

/**
 * Waits for an OAuth authorization code via the local callback proxy, with a
 * manual paste fallback for remote/headless environments where the browser
 * redirect to 127.0.0.1 can't reach the server.
 *
 * Returns the authorization code, or throws on timeout or user cancellation.
 */
export async function waitForOAuthCode(
  config: OAuthCallbackConfig,
  timeoutMs = 120_000,
): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();

  const proxy = startOAuthProxy(
    config,
    (code) => resolve(code),
    (error) => reject(new Error(`Authorization failed: ${error}`)),
  );

  const timeoutId = setTimeout(
    () => reject(new Error("Authorization timed out after 120s.")),
    timeoutMs,
  );

  const spin = spinner();
  spin.start("Waiting for authorization… (or paste the redirect URL below)");

  // Prompt the user to paste the full redirect URL — this races with the proxy.
  // On local machines the proxy wins; on remote servers the user pastes.
  const pasteResult = p.text({
    message: "If the redirect failed, paste the full URL from your browser's address bar:",
    placeholder: "http://127.0.0.1:.../auth/callback?code=...",
    validate: (v) => {
      if (!v) return;
      try {
        const code = new URL(v).searchParams.get("code");
        if (!code) return "URL does not contain a code parameter.";
      } catch {
        return "Not a valid URL.";
      }
    },
  });

  pasteResult.then((val) => {
    if (p.isCancel(val)) {
      reject(new Error("Cancelled."));
      return;
    }
    if (val) {
      try {
        const code = new URL(val).searchParams.get("code");
        if (code) resolve(code);
      } catch {
        // invalid URL — ignore, proxy may still win
      }
    }
  });

  try {
    const code = await promise;
    clearTimeout(timeoutId);
    spin.stop("Authorized.");
    return code;
  } catch (err) {
    clearTimeout(timeoutId);
    spin.error("Authorization failed.");
    throw err;
  } finally {
    proxy.stop();
  }
}

function oauthCallbackHtml(success: boolean, message: string): string {
  const accent = success ? "#22c560" : "#f14d4c";
  const title = success ? "Authenticated" : "Authentication Failed";
  const icon = success
    ? `<svg width="40" height="40" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="19" stroke="${accent}" stroke-width="1.5"/><path d="M12 20.5l5.5 5.5 10.5-11" stroke="${accent}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    : `<svg width="40" height="40" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="19" stroke="${accent}" stroke-width="1.5" stroke-dasharray="4 3"/><path d="M14 14l12 12M26 14L14 26" stroke="${accent}" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>grind — ${title}</title><style>*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,sans-serif;background:#050506;color:#fafafa;display:flex;align-items:center;justify-content:center;min-height:100dvh}.card{display:flex;flex-direction:column;align-items:center;gap:16px;padding:2.5rem 3rem;border:1px solid #1f1f22;border-radius:12px;background:#0c0c0e;text-align:center;max-width:360px;width:100%}.wordmark{font-size:10px;font-weight:600;letter-spacing:.15em;text-transform:uppercase;color:#ff6c02;margin-bottom:4px}h1{font-size:1.125rem;font-weight:600;color:${accent};line-height:1.3}p{font-size:.875rem;color:#8e8e98;line-height:1.5}</style></head><body><div class="card"><span class="wordmark">GRIND</span>${icon}<div><h1>${title}</h1><p>${message}</p></div></div></body></html>`;
}
