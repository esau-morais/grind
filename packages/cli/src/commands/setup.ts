import * as p from "@clack/prompts";

import {
  AI_PROVIDERS,
  DEFAULT_SOUL,
  type AiConfig,
  type AiProvider,
  type AuthType,
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
import type { OAuthCallbackConfig } from "@grindxp/core";
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

      let proxy: ReturnType<typeof startOAuthProxy> | undefined;
      if (oauthConfig.method === "callback") {
        await ensureWebServer();
        proxy = startOAuthProxy(oauthConfig);
      }

      const flow = startOAuthFlow(provider, oauthConfig);

      // Try to open the browser automatically; always print the URL as fallback.
      const openCmd =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "start"
            : "xdg-open";

      let browserOpened = false;
      try {
        Bun.spawn([openCmd, flow.authUrl], { stdio: ["ignore", "ignore", "ignore"] });
        browserOpened = true;
      } catch {}

      if (browserOpened) {
        p.log.info("Browser opened. Complete the login and return here.");
      } else {
        p.log.info(`Open this URL in your browser:\n  ${flow.authUrl}`);
      }

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
        // OpenAI: web server handles the redirect and writes the code to disk;
        // the CLI polls for it. Falls back to manual URL paste if that times out.
        const spin = spinner();
        spin.start("Waiting for authentication…");

        const cbPort = (oauthConfig as OAuthCallbackConfig).callbackPort;
        let oauthDone = false;
        try {
          await flow.complete();
          oauthDone = true;
          spin.stop("Authenticated successfully.");
        } catch {
          spin.stop("Automatic callback not received.");
        } finally {
          proxy?.stop();
        }

        if (!oauthDone) {
          p.log.warn(
            `Could not receive the OAuth callback automatically.\n` +
              `  If you're on a remote server, make sure port ${cbPort} is forwarded:\n` +
              `  ssh -L ${cbPort}:127.0.0.1:${cbPort} <user@server>`,
          );
          p.log.info(
            `Copy the full URL from your browser's address bar after logging in\n` +
              `  (it starts with http://localhost:${cbPort}/auth/callback?code=…)`,
          );

          const urlResult = await p.text({
            message: "Paste the redirect URL",
            placeholder: `http://localhost:${cbPort}/auth/callback?code=…&state=…`,
            validate: (v) => {
              if (!v) return "URL is required";
              try {
                if (!new URL(v).searchParams.get("code")) return "No authorization code in URL";
              } catch {
                return "Invalid URL";
              }
            },
          });

          if (p.isCancel(urlResult)) {
            p.outro("Cancelled.");
            return;
          }

          const code = new URL(urlResult as string).searchParams.get("code") as string;

          const spin2 = spinner();
          spin2.start("Exchanging authorization code…");
          try {
            await flow.completeWithCode(code);
            spin2.stop("Authenticated successfully.");
          } catch (err) {
            spin2.error("Authentication failed.");
            p.log.error(err instanceof Error ? err.message : String(err));
            process.exit(1);
          }
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

async function ensureWebServer(): Promise<void> {
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

function startOAuthProxy(config: OAuthCallbackConfig) {
  const server = Bun.serve({
    port: config.callbackPort,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/auth/callback") {
        return new Response("Not found", { status: 404 });
      }
      const target = `http://${WEB_HOST}:${WEB_PORT}${url.pathname}${url.search}`;
      return fetch(target);
    },
  });
  return { stop: () => server.stop() };
}
