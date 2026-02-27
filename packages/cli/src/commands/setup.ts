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

async function syncCompanionFromAi(config: NonNullable<ReturnType<typeof readGrindConfig>>, ai: AiConfig) {
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

      const openCmd =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "start"
            : "xdg-open";

      try {
        Bun.spawn([openCmd, flow.authUrl], { stdio: ["ignore", "ignore", "ignore"] });
        p.log.info("Browser opened for authentication.");
      } catch {
        p.log.warn("Could not open browser automatically.");
        p.log.info(`Open this URL manually:\n  ${flow.authUrl}`);
      }

      if (flow.method === "code") {
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
        spin.start("Exchanging authorization code...");

        try {
          await flow.completeWithCode(codeResult as string);
          spin.stop("Authenticated successfully.");
        } catch (err) {
          spin.error("Authentication failed.");
          p.log.error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      } else {
        const spin = spinner();
        spin.start("Waiting for browser authentication");

        try {
          await flow.complete();
          spin.stop("Authenticated successfully.");
        } catch (err) {
          spin.error("Authentication failed.");
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
