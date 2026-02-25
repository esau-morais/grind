import * as p from "@clack/prompts";
import {
  type AiConfig,
  type AiProvider,
  type AuthType,
  type GatewayConfig,
  DEFAULT_MODELS,
  DEFAULT_SOUL,
  OAUTH_CONFIGS,
  ensureGrindHome,
  generateEncryptionKey,
  getMigrationsPath,
  getVaultPath,
  isInitialized,
  openVault,
  readGrindConfig,
  startOAuthFlow,
  supportsOAuth,
  writeGrindConfig,
} from "@grindxp/core";
import { createUser, upsertCompanion } from "@grindxp/core/vault";
import { showTitle } from "../brand";
import { ensureGatewayDefaults, runIntegrationWizard } from "./integrations";
import { startManagedGateway } from "../gateway/service";
import { spinner } from "../spinner";

function bail(msg?: string): never {
  p.cancel(msg ?? "Setup cancelled.");
  process.exit(0);
}

const PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (GPT)",
  google: "Google (Gemini)",
  ollama: "Ollama (local)",
};

const VIBE_OPTIONS: Record<string, string> = {
  direct:
    "Be direct. Skip filler. Have opinions.\nWhen quests are completed, acknowledge briefly — don't over-celebrate.\nWhen streaks break, be honest but not punishing.",
  encouraging:
    "Be warm and encouraging, but genuine — not saccharine.\nCelebrate wins. Acknowledge effort even when results are mixed.\nWhen streaks break, focus on what's next, not what was lost.",
  tough:
    "Be blunt. No sugarcoating. Hold the user accountable.\nIf they skip a quest, call it out. If they crush it, respect the effort.\nYou're a drill sergeant who secretly cares.",
};

export async function initCommand(): Promise<void> {
  p.intro(showTitle());

  if (isInitialized()) {
    const overwrite = await p.confirm({
      message: "grind is already initialized. Re-initialize? This will NOT delete existing data.",
    });
    if (p.isCancel(overwrite) || !overwrite) return bail();
  }

  const displayNameInput = await p.text({
    message: "What should grind call you?",
    placeholder: "Your name",
    validate: (v) => {
      if (!v || v.length < 1) return "Name is required.";
      if (v.length > 128) return "Too long.";
      return undefined;
    },
  });
  if (p.isCancel(displayNameInput) || typeof displayNameInput !== "string") return bail();
  const displayName = displayNameInput;

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timezoneInput = await p.text({
    message: "Your timezone?",
    initialValue: tz,
    validate: (v) => {
      if (!v) return "Timezone is required.";
      return undefined;
    },
  });
  if (p.isCancel(timezoneInput) || typeof timezoneInput !== "string") return bail();
  const timezone = timezoneInput;

  const enableCompanion = await p.confirm({
    message: "Enable AI companion?",
    initialValue: true,
  });
  if (p.isCancel(enableCompanion)) return bail();

  let companionProvider: AiProvider = "anthropic";
  let companionAuthType: AuthType = "api-key";
  let companionApiKey: string | undefined;
  let companionModel: string = DEFAULT_MODELS.anthropic;
  let companionBaseUrl: string | undefined;
  let companionName: string | null = null;
  let companionEmoji: string | null = null;
  let companionSoul: string = DEFAULT_SOUL;
  let gateway: GatewayConfig | undefined;
  let gatewayStartNow = false;

  if (enableCompanion) {
    const providerOptions: Array<{ value: AiProvider; label: string; hint?: string }> = [
      { value: "anthropic", label: PROVIDER_LABELS.anthropic },
      { value: "openai", label: PROVIDER_LABELS.openai },
      { value: "google", label: PROVIDER_LABELS.google },
      {
        value: "ollama",
        label: PROVIDER_LABELS.ollama,
        hint: "runs locally, no API key",
      },
    ];

    const provider = await p.select({
      message: "AI provider",
      options: providerOptions,
    });
    if (p.isCancel(provider)) return bail();
    companionProvider = provider;

    if (provider !== "ollama") {
      const authChoices: { value: AuthType; label: string; hint: string }[] = [];

      if (supportsOAuth(provider)) {
        authChoices.push({
          value: "oauth",
          label: "OAuth (browser login)",
          hint: "sign in via browser — uses your subscription",
        });
      }
      authChoices.push({
        value: "api-key",
        label: "API Key",
        hint:
          provider === "anthropic"
            ? "get your key at console.anthropic.com"
            : "paste your key from the provider dashboard",
      });

      if (authChoices.length > 1) {
        const authResult = await p.select({
          message: "Authentication method",
          options: authChoices,
        });
        if (p.isCancel(authResult)) return bail();
        companionAuthType = authResult;
      }

      if (companionAuthType === "api-key") {
        const keyResult = await p.text({
          message: `${PROVIDER_LABELS[provider]} API key`,
          placeholder: "sk-...",
          validate: (v) => {
            if (!v) return "API key is required";
          },
        });
        if (p.isCancel(keyResult) || typeof keyResult !== "string") return bail();
        companionApiKey = keyResult;
      } else if (companionAuthType === "oauth") {
        const oauthConfig = OAUTH_CONFIGS[provider];
        if (!oauthConfig) {
          p.log.error(`OAuth not available for ${PROVIDER_LABELS[provider]}.`);
          process.exit(1);
        }

        const flow = startOAuthFlow(provider, oauthConfig);
        const completion = flow.method === "callback" ? flow.complete() : null;

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
          if (p.isCancel(codeResult) || typeof codeResult !== "string") return bail();

          const spin2 = spinner();
          spin2.start("Exchanging authorization code...");
          try {
            await flow.completeWithCode(codeResult);
            spin2.stop("Authenticated successfully.");
          } catch (err) {
            spin2.error("Authentication failed.");
            p.log.error(err instanceof Error ? err.message : String(err));
            process.exit(1);
          }
        } else {
          const spin2 = spinner();
          spin2.start("Waiting for browser authentication");
          try {
            await completion;
            spin2.stop("Authenticated successfully.");
          } catch (err) {
            spin2.error("Authentication failed.");
            p.log.error(err instanceof Error ? err.message : String(err));
            process.exit(1);
          }
        }
      }
    }

    const defaultModel =
      provider === "openai" && companionAuthType === "oauth"
        ? "gpt-5.1-codex"
        : DEFAULT_MODELS[provider];
    const modelResult = await p.text({
      message: "Model",
      placeholder: defaultModel,
      defaultValue: defaultModel,
    });
    if (p.isCancel(modelResult) || typeof modelResult !== "string") return bail();
    companionModel = modelResult || defaultModel;

    if (provider === "ollama") {
      const urlResult = await p.text({
        message: "Ollama base URL",
        placeholder: "http://localhost:11434/v1",
        defaultValue: "http://localhost:11434/v1",
      });
      if (p.isCancel(urlResult) || typeof urlResult !== "string") return bail();
      companionBaseUrl = urlResult || "http://localhost:11434/v1";
    }

    const nameResult = await p.text({
      message: "Give your companion a name (optional)",
      placeholder: "press enter to skip",
    });
    if (p.isCancel(nameResult)) return bail();
    if (typeof nameResult === "string" && nameResult.length > 0) companionName = nameResult;

    const emojiResult = await p.text({
      message: "Pick an emoji (optional)",
      placeholder: "press enter to skip",
    });
    if (p.isCancel(emojiResult)) return bail();
    if (typeof emojiResult === "string" && emojiResult.length > 0) companionEmoji = emojiResult;

    const vibeOptions = [
      { value: "direct", label: "Direct and concise", hint: "default" },
      { value: "encouraging", label: "Encouraging and warm" },
      { value: "tough", label: "Tough love" },
      { value: "custom", label: "Custom", hint: "opens $EDITOR after setup" },
    ];
    const vibe = await p.select({
      message: "Pick a vibe",
      options: vibeOptions,
    });
    if (p.isCancel(vibe)) return bail();

    const vibeText = typeof vibe === "string" ? VIBE_OPTIONS[vibe] : undefined;
    if (vibeText) {
      companionSoul = `${vibeText}\nAdjust your tone based on trust level.\nYou have access to quest history, skills, and streaks — use them to give relevant advice.`;
    }
  }

  let integrationConfigured = false;
  const baseGateway = ensureGatewayDefaults(undefined);
  let integrationGateway = baseGateway;

  const configureIntegrationsNow = await p.confirm({
    message: "Configure integrations now?",
    initialValue: true,
  });
  if (p.isCancel(configureIntegrationsNow)) return bail();

  let integrationServices: import("@grindxp/core").ServicesConfig | undefined;

  if (configureIntegrationsNow) {
    const integrationResult = await runIntegrationWizard(baseGateway);
    if (integrationResult.cancelled) return bail();
    integrationGateway = integrationResult.gateway;
    integrationServices = integrationResult.services;
    integrationConfigured = integrationResult.changed;
  }

  const inCi = process.env.CI === "true";
  const enableGateway = true;

  if (inCi) {
    gatewayStartNow = false;
    p.log.info("Gateway service will be enabled (startup skipped in CI).");
  } else {
    gatewayStartNow = true;
    p.log.info(
      integrationConfigured
        ? "Gateway autostart will be enabled now for webhooks."
        : "Gateway autostart will be enabled now.",
    );
  }

  const envPortRaw = process.env.GRIND_GATEWAY_PORT;
  const envPortParsed = envPortRaw ? Number.parseInt(envPortRaw, 10) : Number.NaN;
  const gatewayHost = process.env.GRIND_GATEWAY_HOST?.trim() || "127.0.0.1";
  const gatewayPort =
    Number.isInteger(envPortParsed) && envPortParsed >= 1 && envPortParsed <= 65_535
      ? envPortParsed
      : 5174;

  gateway = {
    ...integrationGateway,
    enabled: enableGateway,
    host: gatewayHost,
    port: gatewayPort,
  };

  p.note(
    [
      "grind encrypts your vault at rest.",
      "A random key will be generated and stored in ~/.grind/config.json (chmod 600).",
      "Back up this file if you care about your data.",
    ].join("\n"),
    "Encryption",
  );

  const spin = spinner();
  spin.start("Setting up grind...");

  try {
    ensureGrindHome();

    const existingConfig = readGrindConfig();
    const encryptionKey = existingConfig?.encryptionKey ?? generateEncryptionKey();
    const vaultPath = getVaultPath();

    const { client, db } = await openVault(
      { localDbPath: vaultPath, encryptionKey },
      getMigrationsPath(),
    );

    const user = await createUser(db, {
      displayName,
      level: 1,
      totalXp: 0,
      metadata: {},
      preferences: {
        timezone,
        locale: "en-US",
        notificationsEnabled: true,
        companionEnabled: enableCompanion,
      },
    });

    if (enableCompanion) {
      await upsertCompanion(db, {
        userId: user.id,
        name: companionName,
        emoji: companionEmoji,
        mode: "suggest",
        provider: companionProvider,
        model: companionModel,
        systemPrompt: companionSoul,
      });
    }

    const ai: AiConfig | undefined = enableCompanion
      ? {
          provider: companionProvider,
          authType: companionAuthType,
          model: companionModel,
          ...(companionApiKey ? { apiKey: companionApiKey } : {}),
          ...(companionBaseUrl ? { baseUrl: companionBaseUrl } : {}),
        }
      : undefined;

    const nextConfig = {
      userId: user.id,
      encryptionKey,
      vaultPath,
      createdAt: Date.now(),
      ...(ai ? { ai } : {}),
      ...(integrationServices !== undefined ? { services: integrationServices } : {}),
      ...(gateway ? { gateway } : {}),
    };

    writeGrindConfig(nextConfig);

    client.close();

    let gatewayStarted = false;
    let gatewayStartError: string | null = null;
    if (gateway && gatewayStartNow) {
      try {
        await startManagedGateway(nextConfig);
        gatewayStarted = true;
      } catch (error) {
        gatewayStartError = error instanceof Error ? error.message : String(error);
      }
    }

    spin.stop("Vault created and encrypted.");

    const profileLines = [
      `Name:     ${user.displayName}`,
      `Level:    ${user.level} (Newcomer)`,
      `Timezone: ${timezone}`,
      `Vault:    ${vaultPath}`,
    ];

    if (enableCompanion) {
      const nameDisplay = companionName
        ? `${companionEmoji ?? ""} ${companionName}`.trim()
        : "(unnamed)";
      profileLines.push(`Companion: ${nameDisplay} (${PROVIDER_LABELS[companionProvider]})`);
    }

    if (gateway) {
      profileLines.push(`Gateway:   http://${gateway.host}:${gateway.port}/`);
      profileLines.push(
        `Gateway:   ${gateway.enabled ? (gatewayStarted ? "running" : gatewayStartNow ? "start failed" : "configured") : "disabled"}`,
      );
    }

    p.note(profileLines.join("\n"), "Profile");

    if (gatewayStartError) {
      p.log.warn(`Gateway did not start automatically: ${gatewayStartError}`);
      p.log.info("You can start it later with `grindxp gateway start`.");
    }

    const outroLines = [
      "You're ready to grind. Run `grindxp quest create` to commit to your first quest.",
    ];
    if (enableCompanion) {
      outroLines.push("Run `grindxp companion soul` to customize your companion's personality.");
      outroLines.push("Run `grindxp setup` to reconfigure API keys or change provider.");
    }
    if (gateway) {
      outroLines.push("Run `grindxp gateway status` to verify gateway health.");
      outroLines.push("Run `grindxp integrations connect` to add more integrations later.");
    }

    p.outro(outroLines.join("\n"));
  } catch (err) {
    spin.stop("Setup failed.");
    p.log.error(String(err));
    process.exit(1);
  }
}
