import * as p from "@clack/prompts";
import { startGatewayServer, GooglePoller } from "@grindxp/core";

import type { CliContext } from "../context";
import { createTelegramChatResponder } from "../integrations/telegram-chat-responder";
import { startTelegramPollingListener } from "../integrations/telegram-polling-listener";
import { startWhatsAppWebListener } from "../integrations/whatsapp-web-listener";
import {
  chooseAvailableGatewayPort,
  disableManagedGatewayAutostart,
  type GatewayStartOptions,
  clearGatewayProcessState,
  getManagedGatewayStatus,
  resolveGatewayConfig,
  startManagedGateway,
  stopManagedGateway,
  writeGatewayProcessState,
} from "../gateway/service";

export async function gatewayServeCommand(ctx: CliContext, args: string[]): Promise<void> {
  const overrides = parseGatewayOverrides(args);
  const resolved = resolveGatewayConfig(ctx.config, {
    ...overrides,
    ...(overrides.token ? { token: overrides.token } : {}),
  });

  if (!resolved) {
    p.log.error("Gateway token is required. Re-run `grindxp init` or pass --token <value>.");
    process.exit(1);
  }

  const selectedPort = await chooseAvailableGatewayPort(resolved.host, resolved.port);
  if (selectedPort.shifted) {
    p.log.warn(
      `Port ${resolved.port} is busy. Using ${selectedPort.port} for this gateway process instead.`,
    );
  }

  const telegramResponder = await createTelegramChatResponder({
    db: ctx.db,
    userId: ctx.user.id,
    config: ctx.config,
    gateway: {
      ...(ctx.config.gateway ?? {}),
      enabled: true,
      host: resolved.host,
      port: selectedPort.port,
      token: resolved.token,
      ...(resolved.telegramBotToken ? { telegramBotToken: resolved.telegramBotToken } : {}),
      ...(resolved.telegramWebhookSecret
        ? { telegramWebhookSecret: resolved.telegramWebhookSecret }
        : {}),
      ...(resolved.telegramWebhookPath
        ? { telegramWebhookPath: resolved.telegramWebhookPath }
        : {}),
      ...(resolved.discordPublicKey ? { discordPublicKey: resolved.discordPublicKey } : {}),
      ...(resolved.discordWebhookPath ? { discordWebhookPath: resolved.discordWebhookPath } : {}),
      ...(resolved.whatsAppMode ? { whatsAppMode: resolved.whatsAppMode } : {}),
      ...(resolved.whatsAppLinkedAt ? { whatsAppLinkedAt: resolved.whatsAppLinkedAt } : {}),
      ...(resolved.whatsAppPairingMethod
        ? { whatsAppPairingMethod: resolved.whatsAppPairingMethod }
        : {}),
      ...(resolved.whatsAppPairingPhone
        ? { whatsAppPairingPhone: resolved.whatsAppPairingPhone }
        : {}),
      ...(resolved.whatsAppWebhookPath
        ? { whatsAppWebhookPath: resolved.whatsAppWebhookPath }
        : {}),
      ...(resolved.whatsAppVerifyToken
        ? { whatsAppVerifyToken: resolved.whatsAppVerifyToken }
        : {}),
      ...(resolved.whatsAppAppSecret ? { whatsAppAppSecret: resolved.whatsAppAppSecret } : {}),
    },
    onWarn: (message) => p.log.warn(message),
  });

  const gateway = startGatewayServer({
    db: ctx.db,
    userId: ctx.user.id,
    token: resolved.token,
    host: resolved.host,
    port: selectedPort.port,
    ...(telegramResponder
      ? {
          onTelegramEvent: (event) => telegramResponder.handle(event),
        }
      : {}),
    ...(resolved.telegramBotToken ? { telegramBotToken: resolved.telegramBotToken } : {}),
    ...(resolved.telegramWebhookSecret
      ? { telegramWebhookSecret: resolved.telegramWebhookSecret }
      : {}),
    ...(resolved.telegramWebhookPath ? { telegramWebhookPath: resolved.telegramWebhookPath } : {}),
    ...(resolved.discordPublicKey ? { discordPublicKey: resolved.discordPublicKey } : {}),
    ...(resolved.discordWebhookPath ? { discordWebhookPath: resolved.discordWebhookPath } : {}),
    ...(resolved.whatsAppWebhookPath ? { whatsAppWebhookPath: resolved.whatsAppWebhookPath } : {}),
    ...(resolved.whatsAppVerifyToken ? { whatsAppVerifyToken: resolved.whatsAppVerifyToken } : {}),
    ...(resolved.whatsAppAppSecret ? { whatsAppAppSecret: resolved.whatsAppAppSecret } : {}),
  });

  p.log.step(`Gateway listening on ${gateway.url}`);

  writeGatewayProcessState({
    pid: process.pid,
    startedAt: Date.now(),
    host: resolved.host,
    port: selectedPort.port,
    userId: ctx.user.id,
  });

  p.log.message("POST /hooks/inbound with Authorization: Bearer <token>");
  p.log.message("POST /hooks/telegram for Telegram webhook updates");
  p.log.message("POST /hooks/discord for Discord interactions");
  p.log.message("GET/POST /hooks/whatsapp for WhatsApp webhook verify/events");

  const telegramPollingListener = resolved.telegramBotToken
    ? startTelegramPollingListener({
        botToken: resolved.telegramBotToken,
        gatewayUrl: gateway.url,
        gatewayToken: resolved.token,
        ...(resolved.telegramWebhookSecret
          ? { telegramWebhookSecret: resolved.telegramWebhookSecret }
          : {}),
        onInfo: (message) => p.log.message(message),
        onWarn: (message) => p.log.warn(message),
      })
    : null;

  if (telegramPollingListener) {
    p.log.message("Telegram polling listener: enabled");
  }

  if (telegramResponder) {
    p.log.message("Telegram chat responder: enabled");
  }

  const shouldRunWhatsAppWebListener =
    resolved.whatsAppMode === "qr-link" &&
    Boolean(resolved.whatsAppLinkedAt) &&
    (resolved.whatsAppPairingMethod === "qr" || resolved.whatsAppPairingMethod === "pairing-code");

  const whatsAppWebListener = shouldRunWhatsAppWebListener
    ? startWhatsAppWebListener({
        gatewayUrl: gateway.url,
        token: resolved.token,
      })
    : null;

  if (resolved.whatsAppMode === "qr-link") {
    if (whatsAppWebListener) {
      p.log.message("WhatsApp Web listener: enabled (QR-link mode)");
    } else {
      p.log.warn(
        "WhatsApp Web listener disabled: account not linked yet. Run `grindxp integrations setup whatsapp-qr`.",
      );
    }
  }

  const googleServiceConfig = ctx.config.services?.google;
  const googlePoller = googleServiceConfig
    ? new GooglePoller({ db: ctx.db, userId: ctx.user.id, serviceConfig: googleServiceConfig })
    : null;

  if (googlePoller) {
    googlePoller.start();
    const sources = [
      googleServiceConfig?.calendarEnabled && "Calendar",
      googleServiceConfig?.gmailEnabled && "Gmail",
    ]
      .filter(Boolean)
      .join(" + ");
    p.log.message(`Google poller: enabled (${sources})`);
  }

  p.log.message("Press Ctrl+C to stop.");

  await waitForStop(async () => {
    if (telegramPollingListener) {
      await telegramPollingListener.stop();
    }
    if (whatsAppWebListener) {
      await whatsAppWebListener.stop();
    }
    if (googlePoller) {
      googlePoller.stop();
    }
    await gateway.stop();
    clearGatewayProcessState();
    p.log.info("Gateway stopped.");
  });
}

export async function gatewayStartCommand(ctx: CliContext, args: string[]): Promise<void> {
  const overrides = parseGatewayOverrides(args);
  const state = await startManagedGateway(ctx.config, overrides);
  const pid = state.pid ? ` (pid ${state.pid})` : "";
  p.log.success(`Gateway started${pid} at http://${state.host}:${state.port}/`);
  if (state.managedByService) {
    p.log.message("Autostart: enabled");
  }
}

export async function gatewayEnableCommand(ctx: CliContext, args: string[]): Promise<void> {
  await gatewayStartCommand(ctx, args);
}

export async function gatewayDisableCommand(): Promise<void> {
  const disabled = await disableManagedGatewayAutostart();
  const stopped = await stopManagedGateway();

  if (disabled.disabled) {
    p.log.success(`Gateway autostart disabled (${disabled.manager}).`);
  } else {
    p.log.info("Gateway autostart is not configured on this system.");
  }

  if (stopped.pid && stopped.stopped) {
    p.log.success(`Gateway stopped (pid ${stopped.pid}).`);
  }
}

export async function gatewayStopCommand(): Promise<void> {
  const result = await stopManagedGateway();
  if (!result.pid) {
    p.log.info("Gateway is not running.");
    return;
  }

  if (!result.stopped) {
    p.log.warn(`Gateway process ${result.pid} was already stopped.`);
    return;
  }

  const suffix = result.forced ? " (forced)" : "";
  const managedSuffix = result.managedByService ? " via service manager" : "";
  p.log.success(`Gateway stopped (pid ${result.pid})${suffix}${managedSuffix}.`);
}

export async function gatewayRestartCommand(ctx: CliContext, args: string[]): Promise<void> {
  await gatewayStopCommand();
  await gatewayStartCommand(ctx, args);
}

export async function gatewayStatusCommand(ctx: CliContext): Promise<void> {
  const status = await getManagedGatewayStatus(ctx.config);
  const config = resolveGatewayConfig(ctx.config);

  const autostartStatus = status.autostart.supported
    ? `${status.autostart.enabled ? "enabled" : "disabled"} (${status.autostart.manager})`
    : "unsupported";
  p.log.message(`Autostart: ${autostartStatus}`);

  if (!status.autostart.available && status.autostart.detail) {
    p.log.message(`Autostart detail: ${status.autostart.detail}`);
  }

  if (!status.running && !status.state) {
    p.log.step("Gateway: stopped");
    p.log.message("No managed gateway process found.");
    if (config) {
      p.log.message(`Configured endpoint: http://${config.host}:${config.port}/`);
    }
    return;
  }

  p.log.step(`Gateway: ${status.running ? "running" : "stopped"}`);
  if (status.state) {
    p.log.message(`PID: ${status.state.pid}`);
    p.log.message(`Started: ${new Date(status.state.startedAt).toISOString()}`);
    p.log.message(`Endpoint: http://${status.state.host}:${status.state.port}/`);
  } else if (config) {
    p.log.message(`Endpoint: http://${config.host}:${config.port}/`);
  }
  p.log.message(
    `Health: ${status.healthOk ? "ok" : `error${status.healthError ? ` (${status.healthError})` : ""}`}`,
  );
}

async function waitForStop(onStop: () => Promise<void>): Promise<void> {
  await new Promise<void>((resolve) => {
    let stopping = false;

    const stop = async () => {
      if (stopping) return;
      stopping = true;
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
      await onStop();
      resolve();
    };

    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}

function parseGatewayOverrides(args: string[]): GatewayStartOptions {
  const host = getFlagValue(args, "--host") ?? process.env.GRIND_GATEWAY_HOST ?? undefined;
  const portRaw = getFlagValue(args, "--port") ?? process.env.GRIND_GATEWAY_PORT;
  const token = getFlagValue(args, "--token") ?? process.env.GRIND_GATEWAY_TOKEN ?? undefined;
  const telegramBotToken =
    getFlagValue(args, "--telegram-bot-token") ?? process.env.GRIND_TELEGRAM_BOT_TOKEN ?? undefined;
  const telegramWebhookSecret =
    getFlagValue(args, "--telegram-secret") ??
    process.env.GRIND_TELEGRAM_WEBHOOK_SECRET ??
    undefined;
  const telegramWebhookPath =
    getFlagValue(args, "--telegram-path") ?? process.env.GRIND_TELEGRAM_WEBHOOK_PATH ?? undefined;
  const discordPublicKey =
    getFlagValue(args, "--discord-public-key") ?? process.env.GRIND_DISCORD_PUBLIC_KEY ?? undefined;
  const discordWebhookPath =
    getFlagValue(args, "--discord-path") ?? process.env.GRIND_DISCORD_WEBHOOK_PATH ?? undefined;
  const whatsAppWebhookPath =
    getFlagValue(args, "--whatsapp-path") ?? process.env.GRIND_WHATSAPP_WEBHOOK_PATH ?? undefined;
  const whatsAppModeRaw =
    getFlagValue(args, "--whatsapp-mode") ?? process.env.GRIND_WHATSAPP_MODE ?? undefined;
  const whatsAppMode =
    whatsAppModeRaw === "qr-link" || whatsAppModeRaw === "cloud-api" ? whatsAppModeRaw : undefined;
  const whatsAppLinkedAtRaw =
    getFlagValue(args, "--whatsapp-linked-at") ?? process.env.GRIND_WHATSAPP_LINKED_AT ?? undefined;
  const whatsAppLinkedAt = parseTimestamp(whatsAppLinkedAtRaw);
  const whatsAppPairingMethodRaw =
    getFlagValue(args, "--whatsapp-pairing-method") ??
    process.env.GRIND_WHATSAPP_PAIRING_METHOD ??
    undefined;
  const whatsAppPairingMethod =
    whatsAppPairingMethodRaw === "qr" || whatsAppPairingMethodRaw === "pairing-code"
      ? whatsAppPairingMethodRaw
      : undefined;
  const whatsAppPairingPhone =
    getFlagValue(args, "--whatsapp-pairing-phone") ??
    process.env.GRIND_WHATSAPP_PAIRING_PHONE ??
    undefined;
  const whatsAppVerifyToken =
    getFlagValue(args, "--whatsapp-verify-token") ??
    process.env.GRIND_WHATSAPP_VERIFY_TOKEN ??
    undefined;
  const whatsAppAppSecret =
    getFlagValue(args, "--whatsapp-app-secret") ??
    process.env.GRIND_WHATSAPP_APP_SECRET ??
    undefined;

  const parsedPort = parsePort(portRaw);
  if (portRaw && !parsedPort) {
    p.log.error(`Invalid port: ${portRaw}`);
    process.exit(1);
  }

  return {
    ...(host ? { host } : {}),
    ...(parsedPort ? { port: parsedPort } : {}),
    ...(token ? { token } : {}),
    ...(telegramBotToken ? { telegramBotToken } : {}),
    ...(telegramWebhookSecret ? { telegramWebhookSecret } : {}),
    ...(telegramWebhookPath ? { telegramWebhookPath } : {}),
    ...(discordPublicKey ? { discordPublicKey } : {}),
    ...(discordWebhookPath ? { discordWebhookPath } : {}),
    ...(whatsAppMode ? { whatsAppMode } : {}),
    ...(whatsAppLinkedAt ? { whatsAppLinkedAt } : {}),
    ...(whatsAppPairingMethod ? { whatsAppPairingMethod } : {}),
    ...(whatsAppPairingPhone ? { whatsAppPairingPhone } : {}),
    ...(whatsAppWebhookPath ? { whatsAppWebhookPath } : {}),
    ...(whatsAppVerifyToken ? { whatsAppVerifyToken } : {}),
    ...(whatsAppAppSecret ? { whatsAppAppSecret } : {}),
  };
}

function getFlagValue(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function parsePort(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) return null;
  return value;
}

function parseTimestamp(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) return undefined;
  return value;
}
