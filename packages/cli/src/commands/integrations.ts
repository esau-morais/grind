import * as p from "@clack/prompts";
import { spinner } from "../spinner";
import {
  generateGatewayToken,
  getOAuthToken,
  GoogleNotConnectedError,
  GOOGLE_OAUTH_KEY,
  buildGoogleOAuthConfig,
  GRIND_GOOGLE_CLIENT_ID,
  removeOAuthToken,
  saveOAuthToken,
  startOAuthFlow,
  type GatewayConfig,
  type GrindConfig,
  type ServicesConfig,
  writeGrindConfig,
} from "@grindxp/core";

import type { CliContext } from "../context";
import { linkWhatsAppAccount } from "../integrations/whatsapp-link";

export type ChannelProvider = "telegram" | "discord" | "whatsapp";
export type ServiceProvider = "google";
export type IntegrationTarget = ChannelProvider | ServiceProvider;

type WhatsAppSetupMode = "qr-link" | "cloud-api";
type ExistingConfigAction = "update" | "skip";

interface ChannelDefinition {
  provider: ChannelProvider;
  label: string;
  hint: string;
  whatsAppMode?: WhatsAppSetupMode;
}

interface ChannelWizardResult {
  gateway: GatewayConfig;
  changed: boolean;
  cancelled: boolean;
}

function generateSecretToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

function clearWhatsAppConfig(gateway: GatewayConfig): GatewayConfig {
  const {
    whatsAppMode: _mode,
    whatsAppLinkedAt: _linkedAt,
    whatsAppPairingMethod: _pairingMethod,
    whatsAppPairingPhone: _pairingPhone,
    whatsAppWebhookPath: _webhookPath,
    whatsAppVerifyToken: _verifyToken,
    whatsAppAppSecret: _appSecret,
    whatsAppAccessToken: _accessToken,
    whatsAppPhoneNumberId: _phoneNumberId,
    ...rest
  } = gateway;
  return rest;
}

const CHANNEL_DEFINITIONS: ChannelDefinition[] = [
  { provider: "telegram", label: "Telegram (Bot API)", hint: "free official bot webhook" },
  { provider: "discord", label: "Discord (Bot API)", hint: "official interactions endpoint" },
  {
    provider: "whatsapp",
    label: "WhatsApp (QR Link)",
    hint: "link account directly via QR/pairing code",
    whatsAppMode: "qr-link",
  },
  {
    provider: "whatsapp",
    label: "WhatsApp (Cloud API)",
    hint: "official number + token integration",
    whatsAppMode: "cloud-api",
  },
];

// ── Public command entry points ──────────────────────────────────────────────

export async function integrationsListCommand(ctx: CliContext): Promise<void> {
  const gateway = ctx.config.gateway;
  const services = ctx.config.services;
  const googleToken = getOAuthToken(GOOGLE_OAUTH_KEY);
  const googleConfig = services?.google;

  p.log.step("Channels (messaging)");
  p.log.message(
    `  Gateway: ${gateway ? `http://${gateway.host}:${gateway.port}/` : "not configured"} (${gateway?.enabled ? "enabled" : "disabled"})`,
  );
  p.log.message(`  Telegram : ${gateway?.telegramBotToken ? "configured" : "not configured"}`);
  p.log.message(`  Discord  : ${gateway?.discordPublicKey ? "configured" : "not configured"}`);
  p.log.message(`  WhatsApp : ${describeWhatsApp(gateway)}`);

  p.log.step("Services (data)");
  if (googleToken && googleConfig) {
    p.log.message(`  Google   : connected as ${googleConfig.email ?? "unknown"}`);
    p.log.message(
      `             Calendar: ${googleConfig.calendarEnabled ? "enabled" : "disabled"}`,
    );
    p.log.message(`             Gmail   : ${googleConfig.gmailEnabled ? "enabled" : "disabled"}`);
    p.log.message(`             Poll interval: ${googleConfig.pollIntervalSeconds ?? 300}s`);
  } else {
    p.log.message("  Google   : not connected  →  run `grindxp integrations connect google`");
  }
}

export async function integrationsConnectCommand(
  ctx: CliContext,
  target: string | undefined,
  flags: { clientId?: string; clientSecret?: string; gmail?: boolean },
): Promise<void> {
  if (target) {
    if (target === "google") {
      await connectGoogle(ctx, flags);
      return;
    }
    const channelTarget = parseChannelTarget(target);
    if (!channelTarget) {
      p.log.error(
        `Unknown target: ${target}. Valid options: google, telegram, discord, whatsapp, whatsapp-qr, whatsapp-cloud`,
      );
      return;
    }
    await connectChannel(ctx, channelTarget);
    return;
  }

  const choices = await p.multiselect({
    message: "What do you want to connect?",
    options: [
      { value: "google", label: "Google", hint: "service · Calendar + optional Gmail (OAuth)" },
      { value: "telegram", label: "Telegram", hint: "channel · Bot API token" },
      { value: "discord", label: "Discord", hint: "channel · App public key" },
      {
        value: "whatsapp",
        label: "WhatsApp (QR Link)",
        hint: "channel · link account via QR / pairing code",
      },
      {
        value: "whatsapp-cloud",
        label: "WhatsApp (Cloud API)",
        hint: "channel · official number + token",
      },
    ],
    required: true,
  });
  if (p.isCancel(choices)) {
    p.cancel("Cancelled.");
    return;
  }

  for (const choice of choices as string[]) {
    if (choice === "google") {
      await connectGoogle(ctx, {});
      continue;
    }
    const channelTarget = parseChannelTarget(choice);
    if (channelTarget) {
      await connectChannel(ctx, channelTarget);
    }
  }
}

export async function integrationsDisconnectCommand(
  ctx: CliContext,
  target: string | undefined,
): Promise<void> {
  if (!target) {
    const choice = await p.select({
      message: "What do you want to disconnect?",
      options: [
        { value: "google", label: "Google", hint: "Revoke Calendar + Gmail access" },
        { value: "telegram", label: "Telegram", hint: "Remove bot token" },
        { value: "discord", label: "Discord", hint: "Remove public key" },
        { value: "whatsapp", label: "WhatsApp", hint: "Unlink account" },
      ],
    });
    if (p.isCancel(choice)) {
      p.cancel("Cancelled.");
      return;
    }
    target = choice;
  }

  if (target === "google") {
    await disconnectGoogle(ctx);
    return;
  }

  p.log.warn(
    `Disconnect for ${target} not yet implemented. Edit config manually or re-run connect.`,
  );
}

export async function integrationsSetupCommand(
  ctx: CliContext,
  providerArg?: string,
): Promise<void> {
  await integrationsConnectCommand(
    ctx,
    providerArg === "google-calendar" ? "google" : providerArg,
    {},
  );
}

// ── Google OAuth flow ────────────────────────────────────────────────────────

interface GoogleWizardResult {
  services: ServicesConfig;
  cancelled: boolean;
}

async function runGoogleWizard(
  existingServices: ServicesConfig | undefined,
  flags: { clientId?: string; clientSecret?: string; gmail?: boolean },
): Promise<GoogleWizardResult> {
  const existingToken = getOAuthToken(GOOGLE_OAUTH_KEY);
  const existingConfig = existingServices?.google;

  if (existingToken && existingConfig) {
    const action = await p.select({
      message: `Google already connected as ${existingConfig.email ?? "unknown"}. What do you want to do?`,
      options: [
        { value: "reconnect", label: "Reconnect", hint: "authorize again (e.g. to change scopes)" },
        { value: "skip", label: "Skip", hint: "leave as-is" },
      ],
    });
    if (p.isCancel(action) || action === "skip") {
      p.log.info("No changes made.");
      return { services: existingServices ?? {}, cancelled: false };
    }
  }

  let gmailEnabled = flags.gmail ?? false;
  if (!flags.gmail) {
    const gmailChoice = await p.confirm({
      message: "Enable Gmail access? (read + send email)",
      initialValue: false,
    });
    if (p.isCancel(gmailChoice)) {
      p.cancel("Cancelled.");
      return { services: existingServices ?? {}, cancelled: true };
    }
    gmailEnabled = gmailChoice;
  }

  const clientId = flags.clientId ?? existingConfig?.clientId ?? GRIND_GOOGLE_CLIENT_ID;
  const clientSecret = flags.clientSecret ?? existingConfig?.clientSecret;
  const config = buildGoogleOAuthConfig(clientId, gmailEnabled, clientSecret);
  const flow = startOAuthFlow("google-services", config);

  if (flow.method !== "callback") {
    p.log.error("Unexpected OAuth flow type.");
    return { services: existingServices ?? {}, cancelled: true };
  }

  const completion = flow.complete();

  p.log.step("Opening browser for Google authorization...");
  p.log.message(`If the browser does not open, visit:\n  ${flow.authUrl}`);

  try {
    const openCmd =
      process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    Bun.spawn([openCmd, flow.authUrl], { stdout: "ignore", stderr: "ignore" });
  } catch {
    // Non-fatal — user can open the URL manually
  }

  const spin = spinner();
  spin.start("Waiting for authorization (120s timeout)...");

  let token: Awaited<ReturnType<typeof flow.complete>>;
  try {
    token = await completion;
  } catch (err) {
    spin.error("Authorization failed.");
    p.log.error(err instanceof Error ? err.message : String(err));
    return { services: existingServices ?? {}, cancelled: true };
  }

  spin.stop("Authorized.");

  let email: string | undefined;
  try {
    const resp = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${token.token.accessToken}` },
    });
    if (resp.ok) {
      const info = (await resp.json()) as { email?: string };
      email = info.email;
    }
  } catch {
    // non-fatal
  }

  saveOAuthToken(GOOGLE_OAUTH_KEY, { ...token.token, ...(email ? { email } : {}) });

  const services: ServicesConfig = {
    ...existingServices,
    google: {
      ...(email ? { email } : {}),
      ...(flags.clientId ? { clientId: flags.clientId } : {}),
      ...(flags.clientSecret ? { clientSecret: flags.clientSecret } : {}),
      calendarEnabled: true,
      gmailEnabled,
    },
  };

  p.log.success(
    `Google connected${email ? ` as ${email}` : ""}\n  Calendar: enabled (read + write)\n  Gmail   : ${gmailEnabled ? "enabled (read + send)" : "disabled"}`,
  );
  p.log.info("Calendar and Gmail sync automatically while the gateway runs.");

  return { services, cancelled: false };
}

async function connectGoogle(
  ctx: CliContext,
  flags: { clientId?: string; clientSecret?: string; gmail?: boolean },
): Promise<void> {
  const result = await runGoogleWizard(ctx.config.services, flags);
  if (result.cancelled) return;

  const nextConfig: GrindConfig = { ...ctx.config, services: result.services };
  writeGrindConfig(nextConfig);
  ctx.config = nextConfig;
}

async function disconnectGoogle(ctx: CliContext): Promise<void> {
  const token = getOAuthToken(GOOGLE_OAUTH_KEY);
  if (!token) {
    p.log.warn("Google is not connected.");
    return;
  }

  const email = ctx.config.services?.google?.email;
  const confirmed = await p.confirm({
    message: `Disconnect Google${email ? ` (${email})` : ""}? This will revoke Calendar and Gmail access.`,
    initialValue: false,
  });
  if (p.isCancel(confirmed) || !confirmed) {
    p.log.info("Cancelled.");
    return;
  }

  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${token.accessToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  } catch {
    // non-fatal — still remove locally
  }

  removeOAuthToken(GOOGLE_OAUTH_KEY);

  const { google: _google, ...restServices } = ctx.config.services ?? {};
  const nextConfig: GrindConfig = {
    ...ctx.config,
    services: Object.keys(restServices).length > 0 ? restServices : undefined,
  };
  writeGrindConfig(nextConfig);
  ctx.config = nextConfig;

  p.log.success("Google disconnected.");
}

// ── Channel connect flow (Telegram, Discord, WhatsApp) ───────────────────────

async function connectChannel(
  ctx: CliContext,
  selection: { provider: ChannelProvider; whatsAppMode?: WhatsAppSetupMode },
): Promise<void> {
  const startGateway = ensureGatewayDefaults(ctx.config.gateway);
  const result = await runChannelWizard(startGateway, selection);

  if (result.cancelled) {
    p.cancel("Cancelled.");
    return;
  }
  if (!result.changed) {
    p.log.info("No changes made.");
    return;
  }

  const nextConfig: GrindConfig = { ...ctx.config, gateway: result.gateway };
  writeGrindConfig(nextConfig);
  ctx.config = nextConfig;

  p.log.success("Integration saved.");
  p.note(buildWebhookNote(result.gateway), "Webhook Paths");
}

// ── Channel wizard ────────────────────────────────────────────────────────────

export function ensureGatewayDefaults(current?: GatewayConfig): GatewayConfig {
  if (!current) {
    return {
      enabled: true,
      host: "127.0.0.1",
      port: 5174,
      token: generateGatewayToken(),
    };
  }
  return {
    enabled: current.enabled,
    host: current.host,
    port: current.port,
    token: current.token,
    ...(current.telegramWebhookSecret
      ? { telegramWebhookSecret: current.telegramWebhookSecret }
      : {}),
    ...(current.telegramWebhookPath ? { telegramWebhookPath: current.telegramWebhookPath } : {}),
    ...(current.telegramBotToken ? { telegramBotToken: current.telegramBotToken } : {}),
    ...(current.telegramDefaultChatId
      ? { telegramDefaultChatId: current.telegramDefaultChatId }
      : {}),
    ...(current.discordPublicKey ? { discordPublicKey: current.discordPublicKey } : {}),
    ...(current.discordWebhookPath ? { discordWebhookPath: current.discordWebhookPath } : {}),
    ...(current.whatsAppWebhookPath ? { whatsAppWebhookPath: current.whatsAppWebhookPath } : {}),
    ...(current.whatsAppMode ? { whatsAppMode: current.whatsAppMode } : {}),
    ...(current.whatsAppLinkedAt ? { whatsAppLinkedAt: current.whatsAppLinkedAt } : {}),
    ...(current.whatsAppPairingMethod
      ? { whatsAppPairingMethod: current.whatsAppPairingMethod }
      : {}),
    ...(current.whatsAppPairingPhone ? { whatsAppPairingPhone: current.whatsAppPairingPhone } : {}),
    ...(current.whatsAppVerifyToken ? { whatsAppVerifyToken: current.whatsAppVerifyToken } : {}),
    ...(current.whatsAppAppSecret ? { whatsAppAppSecret: current.whatsAppAppSecret } : {}),
    ...(current.whatsAppAccessToken ? { whatsAppAccessToken: current.whatsAppAccessToken } : {}),
    ...(current.whatsAppPhoneNumberId
      ? { whatsAppPhoneNumberId: current.whatsAppPhoneNumberId }
      : {}),
  };
}

async function runChannelWizard(
  gateway: GatewayConfig,
  selection: { provider: ChannelProvider; whatsAppMode?: WhatsAppSetupMode },
): Promise<ChannelWizardResult> {
  const { provider } = selection;
  const configured = isChannelConfigured(gateway, provider, selection.whatsAppMode);

  if (configured) {
    const action = await promptConfiguredAction(provider);
    if (action.cancelled) return { gateway, changed: false, cancelled: true };
    if (action.value === "skip") return { gateway, changed: false, cancelled: false };
  }

  if (provider === "telegram") {
    p.note(
      [
        "1) Open Telegram and chat with @BotFather",
        "2) Run /newbot and create your bot",
        "3) Copy bot token (looks like 123456:ABC...)",
      ].join("\n"),
      "Telegram Bot Token",
    );

    const botToken = await promptValue({
      message: "Enter Telegram bot token",
      placeholder: "looks like 123456:ABC...",
      required: true,
    });
    if (botToken.cancelled) return { gateway, changed: false, cancelled: true };

    const defaultChatId = await promptValue({
      message: "Default Telegram chat ID (optional)",
      placeholder: "used by forge notifications",
      required: false,
    });
    if (defaultChatId.cancelled) return { gateway, changed: false, cancelled: true };

    return {
      gateway: {
        ...gateway,
        telegramBotToken: botToken.value,
        telegramWebhookSecret: generateSecretToken(),
        ...(defaultChatId.value ? { telegramDefaultChatId: defaultChatId.value } : {}),
      },
      changed: true,
      cancelled: false,
    };
  }

  if (provider === "discord") {
    const publicKey = await promptValue({
      message: "Discord application public key",
      placeholder: "from Discord Developer Portal",
      required: true,
    });
    if (publicKey.cancelled) return { gateway, changed: false, cancelled: true };
    return {
      gateway: { ...gateway, discordPublicKey: publicKey.value },
      changed: true,
      cancelled: false,
    };
  }

  const mode = selection.whatsAppMode ?? "qr-link";
  const base = clearWhatsAppConfig(gateway);

  if (mode === "qr-link") {
    const pairingMethod = await p.select({
      message: "WhatsApp linking method",
      options: [
        { value: "qr", label: "QR link", hint: "scan QR in WhatsApp linked devices" },
        {
          value: "pairing-code",
          label: "Phone number + pairing code",
          hint: "enter number, use code pin flow",
        },
      ],
    });
    if (p.isCancel(pairingMethod)) return { gateway, changed: false, cancelled: true };

    let pairingPhone = "";
    if (pairingMethod === "pairing-code") {
      const phone = await promptValue({
        message: "Phone number (E.164, no +)",
        placeholder: "15551234567",
        required: true,
      });
      if (phone.cancelled) return { gateway, changed: false, cancelled: true };
      pairingPhone = phone.value;
    }

    const method = pairingMethod === "pairing-code" ? "pairing-code" : "qr";
    let linkAt: number | undefined;

    while (!linkAt) {
      p.log.step("Starting WhatsApp link session...");
      const link = await linkWhatsAppAccount({
        pairingMethod: method,
        ...(pairingPhone ? { pairingPhone } : {}),
        onInfo: (message) => p.log.info(message),
      });

      if (link.linkedAt) {
        linkAt = link.linkedAt;
        break;
      }

      p.log.error(link.error ?? "WhatsApp link failed.");
      const retry = await p.confirm({ message: "Retry WhatsApp linking now?", initialValue: true });
      if (p.isCancel(retry) || !retry) return { gateway, changed: false, cancelled: false };
    }

    p.log.success("WhatsApp linked successfully.");
    return {
      gateway: {
        ...base,
        whatsAppMode: "qr-link",
        whatsAppLinkedAt: linkAt,
        whatsAppPairingMethod: pairingMethod,
        ...(pairingPhone ? { whatsAppPairingPhone: pairingPhone } : {}),
      },
      changed: true,
      cancelled: false,
    };
  }

  const phoneNumberId = await promptValue({
    message: "WhatsApp phone number ID",
    placeholder: "from Meta WhatsApp dashboard",
    required: true,
  });
  if (phoneNumberId.cancelled) return { gateway, changed: false, cancelled: true };

  const accessToken = await promptValue({
    message: "WhatsApp Cloud API access token",
    placeholder: "temporary or permanent access token",
    required: true,
  });
  if (accessToken.cancelled) return { gateway, changed: false, cancelled: true };

  const verifyToken = await promptValue({
    message: "WhatsApp verify token (optional)",
    placeholder: "Meta webhook verify token",
    required: false,
  });
  if (verifyToken.cancelled) return { gateway, changed: false, cancelled: true };

  const appSecret = await promptValue({
    message: "WhatsApp app secret (recommended)",
    placeholder: "for X-Hub-Signature-256 validation",
    required: false,
  });
  if (appSecret.cancelled) return { gateway, changed: false, cancelled: true };

  return {
    gateway: {
      ...base,
      whatsAppMode: "cloud-api",
      whatsAppPhoneNumberId: phoneNumberId.value,
      whatsAppAccessToken: accessToken.value,
      ...(verifyToken.value ? { whatsAppVerifyToken: verifyToken.value } : {}),
      ...(appSecret.value ? { whatsAppAppSecret: appSecret.value } : {}),
    },
    changed: true,
    cancelled: false,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseChannelTarget(
  value: string,
): { provider: ChannelProvider; whatsAppMode?: WhatsAppSetupMode } | null {
  if (value === "telegram") return { provider: "telegram" };
  if (value === "discord") return { provider: "discord" };
  if (value === "whatsapp" || value === "whatsapp-qr")
    return { provider: "whatsapp", whatsAppMode: "qr-link" };
  if (value === "whatsapp-cloud") return { provider: "whatsapp", whatsAppMode: "cloud-api" };
  return null;
}

function isChannelConfigured(
  gateway: GatewayConfig,
  provider: ChannelProvider,
  whatsAppMode?: WhatsAppSetupMode,
): boolean {
  if (provider === "telegram") return Boolean(gateway.telegramBotToken);
  if (provider === "discord") return Boolean(gateway.discordPublicKey);
  if (whatsAppMode === "qr-link")
    return Boolean(gateway.whatsAppMode === "qr-link" && gateway.whatsAppLinkedAt);
  return Boolean(
    gateway.whatsAppMode === "cloud-api" &&
    gateway.whatsAppAccessToken &&
    gateway.whatsAppPhoneNumberId,
  );
}

async function promptConfiguredAction(
  provider: ChannelProvider | "google",
): Promise<{ value: ExistingConfigAction; cancelled: boolean }> {
  const label =
    provider === "telegram"
      ? "Telegram"
      : provider === "discord"
        ? "Discord"
        : provider === "whatsapp"
          ? "WhatsApp"
          : "Google";
  const selected = await p.select({
    message: `${label} already configured. What do you want to do?`,
    options: [
      { value: "update", label: "Reconnect / update credentials" },
      { value: "skip", label: "Skip (leave as-is)" },
    ],
  });
  if (p.isCancel(selected)) return { value: "skip", cancelled: true };
  return { value: selected, cancelled: false };
}

async function promptValue(params: {
  message: string;
  placeholder: string;
  required: boolean;
}): Promise<{ value: string; cancelled: boolean }> {
  const value = await p.text({
    message: params.message,
    placeholder: params.placeholder,
    validate: (raw) => {
      if (!params.required) return undefined;
      if (!raw || raw.trim().length === 0) return "Required.";
      return undefined;
    },
  });

  if (p.isCancel(value)) return { value: "", cancelled: true };
  if (typeof value !== "string") return { value: "", cancelled: true };
  return { value: value.trim(), cancelled: false };
}

function describeWhatsApp(gateway?: GatewayConfig): string {
  if (!gateway) return "not configured";
  if (gateway.whatsAppMode === "qr-link") {
    const method = gateway.whatsAppPairingMethod === "pairing-code" ? "pairing-code" : "qr";
    const linked = gateway.whatsAppLinkedAt
      ? `linked ${new Date(gateway.whatsAppLinkedAt).toISOString()}`
      : "link pending";
    return `qr-link (${method}) | ${linked}`;
  }
  if (gateway.whatsAppMode === "cloud-api") {
    return `cloud-api | token: ${gateway.whatsAppAccessToken ? "set" : "missing"}`;
  }
  return "not configured";
}

function buildWebhookNote(gateway: GatewayConfig): string {
  const telegramPath = gateway.telegramWebhookPath ?? "/hooks/telegram";
  const discordPath = gateway.discordWebhookPath ?? "/hooks/discord";
  const whatsAppPath = gateway.whatsAppWebhookPath ?? "/hooks/whatsapp";
  return [
    `Telegram : ${telegramPath}`,
    `Discord  : ${discordPath}`,
    `WhatsApp : ${whatsAppPath}`,
  ].join("\n");
}

// Keep for backward compat with anything importing this
export { CHANNEL_DEFINITIONS };

// ── Integration wizard for init flow ─────────────────────────────────────────

export interface IntegrationWizardResult {
  gateway: GatewayConfig;
  services?: ServicesConfig;
  changed: boolean;
  cancelled: boolean;
}

export async function runIntegrationWizard(
  current: GatewayConfig,
  existingServices?: ServicesConfig,
): Promise<IntegrationWizardResult> {
  const channelOptions = CHANNEL_DEFINITIONS.map((def) => ({
    value: `${def.provider}${def.whatsAppMode ? `:${def.whatsAppMode}` : ""}`,
    label: def.label,
    hint: `channel · ${def.hint}`,
  }));

  const selected = await p.multiselect({
    message: "Select integrations to configure (space to toggle, enter to confirm)",
    options: [
      { value: "google", label: "Google", hint: "service · Calendar + optional Gmail (OAuth)" },
      ...channelOptions,
    ],
    required: false,
  });

  if (p.isCancel(selected)) {
    return { gateway: current, changed: false, cancelled: true };
  }

  const selections = selected as string[];
  if (selections.length === 0) {
    return { gateway: current, changed: false, cancelled: false };
  }

  let gateway = current;
  let services = existingServices;
  let changed = false;

  for (const key of selections) {
    if (key === "google") {
      const result = await runGoogleWizard(services, {});
      if (result.cancelled) {
        return {
          gateway,
          ...(services !== undefined ? { services } : {}),
          changed,
          cancelled: true,
        };
      }
      services = result.services;
      changed = true;
      continue;
    }

    const [provider, mode] = key.split(":") as [ChannelProvider, WhatsAppSetupMode | undefined];
    const result = await runChannelWizard(gateway, {
      provider,
      ...(mode ? { whatsAppMode: mode } : {}),
    });
    if (result.cancelled) {
      return { gateway, ...(services !== undefined ? { services } : {}), changed, cancelled: true };
    }
    if (result.changed) {
      gateway = result.gateway;
      changed = true;
    }
  }

  return { gateway, ...(services !== undefined ? { services } : {}), changed, cancelled: false };
}
