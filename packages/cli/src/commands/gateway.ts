import * as p from "@clack/prompts";
import { readGrindConfig, startGatewayServer, writeGrindConfig, GooglePoller } from "@grindxp/core";
import type { GatewayConfig, NormalizedGatewayEvent } from "@grindxp/core";

import type { CliContext } from "../context";
import { createChatResponder } from "../integrations/chat-responder";
import type { ChannelAdapter } from "../integrations/channel-adapter";
import { createTelegramAdapter } from "../integrations/telegram-adapter";
import { createWhatsAppCloudAdapter } from "../integrations/whatsapp-cloud-adapter";
import { createWhatsAppWebAdapter } from "../integrations/whatsapp-web-adapter";
import { createDiscordAdapter } from "../integrations/discord-adapter";
import { startDiscordGatewayListener } from "../integrations/discord-gateway-listener";
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

const MAX_BUFFERED_EVENTS = 50;

type ChannelEvent = {
  normalized: NormalizedGatewayEvent;
  tick: Awaited<ReturnType<typeof import("@grindxp/core").runForgeTick>>;
};

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
  const cfg = resolved!;

  const selectedPort = await chooseAvailableGatewayPort(cfg.host, cfg.port);
  if (selectedPort.shifted) {
    p.log.warn(
      `Port ${cfg.port} is busy. Using ${selectedPort.port} for this gateway process instead.`,
    );
  }

  const onWarn = (message: string) => p.log.warn(message);

  const responders = new Map<string, Awaited<ReturnType<typeof createChatResponder>>>();
  const adaptersByChannel = new Map<string, ChannelAdapter>();
  const pendingEvents = new Map<string, ChannelEvent[]>();

  function bufferEvent(channel: string, event: ChannelEvent): void {
    const buf = pendingEvents.get(channel) ?? [];
    if (buf.length >= MAX_BUFFERED_EVENTS) {
      buf.shift();
    }
    buf.push(event);
    pendingEvents.set(channel, buf);
  }

  async function drainPendingEvents(channel: string): Promise<void> {
    const responder = responders.get(channel);
    if (!responder) return;
    const buf = pendingEvents.get(channel);
    if (!buf?.length) return;
    pendingEvents.delete(channel);
    for (const event of buf) {
      try {
        await responder.handle(event);
      } catch (err) {
        onWarn(
          `Error replaying buffered event for ${channel}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  async function routeChannelEvent(event: ChannelEvent): Promise<void> {
    const payload = event.normalized.forgeEvent.payload;
    const channel =
      typeof payload.channel === "string" && payload.channel.trim() ? payload.channel.trim() : null;
    if (!channel) return;

    const responder = responders.get(channel);
    if (!responder) {
      bufferEvent(channel, event);
      return;
    }

    try {
      await responder.handle(event);
    } catch (err) {
      onWarn(`Responder error (${channel}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function registerResponder(
    channel: string,
    adapter: ChannelAdapter,
    opts?: { trustedChatId?: string; onFirstContact?: (chatId: string) => void },
  ): Promise<void> {
    adaptersByChannel.set(channel, adapter);
    const responder = await createChatResponder({
      db: ctx.db,
      userId: ctx.user.id,
      config: ctx.config,
      gateway: {
        ...(ctx.config.gateway ?? {}),
        enabled: true,
        host: cfg.host,
        port: selectedPort.port,
        token: cfg.token,
      },
      adapter,
      onWarn,
      ...(opts?.trustedChatId ? { trustedChatId: opts.trustedChatId } : {}),
      ...(opts?.onFirstContact ? { onFirstContact: opts.onFirstContact } : {}),
    });
    responders.set(channel, responder);
    await drainPendingEvents(channel);
  }

  function persistWhatsAppDefaultChatId(chatId: string): void {
    const onDisk = readGrindConfig();
    if (!onDisk?.gateway) return;
    if (onDisk.gateway.whatsAppDefaultChatId === chatId) return;
    writeGrindConfig({
      ...onDisk,
      gateway: { ...onDisk.gateway, whatsAppDefaultChatId: chatId },
    });
    onWarn(`Auto-set whatsAppDefaultChatId to ${chatId}.`);
  }

  function persistDiscordDefaultChatId(chatId: string): void {
    const onDisk = readGrindConfig();
    if (!onDisk?.gateway) return;
    if (onDisk.gateway.discordDefaultChatId === chatId) return;
    writeGrindConfig({
      ...onDisk,
      gateway: { ...onDisk.gateway, discordDefaultChatId: chatId },
    });
    onWarn(`Auto-set discordDefaultChatId to ${chatId}.`);
  }

  // --- Telegram ---
  if (cfg.telegramBotToken) {
    const telegramAdapter = await createTelegramAdapter({ token: cfg.telegramBotToken });
    await registerResponder("telegram", telegramAdapter, {
      ...(cfg.telegramDefaultChatId ? { trustedChatId: cfg.telegramDefaultChatId } : {}),
    });
    p.log.message("Telegram chat responder: enabled");
  }

  // --- WhatsApp Cloud API ---
  if (cfg.whatsAppMode === "cloud-api" && cfg.whatsAppAccessToken && cfg.whatsAppPhoneNumberId) {
    const whatsAppCloudAdapter = createWhatsAppCloudAdapter({
      phoneNumberId: cfg.whatsAppPhoneNumberId,
      accessToken: cfg.whatsAppAccessToken,
    });
    await registerResponder("whatsapp", whatsAppCloudAdapter, {
      ...(cfg.whatsAppDefaultChatId
        ? { trustedChatId: cfg.whatsAppDefaultChatId }
        : { onFirstContact: persistWhatsAppDefaultChatId }),
    });
    p.log.message("WhatsApp Cloud API responder: enabled");
  }

  // --- Discord ---
  if (cfg.discordBotToken) {
    const discordAdapter = createDiscordAdapter({ botToken: cfg.discordBotToken });
    await registerResponder("discord", discordAdapter, {
      ...(cfg.discordDefaultChatId
        ? { trustedChatId: cfg.discordDefaultChatId }
        : { onFirstContact: persistDiscordDefaultChatId }),
    });
    p.log.message("Discord chat responder: enabled");
  }

  const gateway = startGatewayServer({
    db: ctx.db,
    userId: ctx.user.id,
    token: cfg.token,
    host: cfg.host,
    port: selectedPort.port,
    ...(cfg.telegramWebhookSecret ? { telegramWebhookSecret: cfg.telegramWebhookSecret } : {}),
    ...(cfg.telegramWebhookPath ? { telegramWebhookPath: cfg.telegramWebhookPath } : {}),
    ...(cfg.discordPublicKey ? { discordPublicKey: cfg.discordPublicKey } : {}),
    ...(cfg.discordWebhookPath ? { discordWebhookPath: cfg.discordWebhookPath } : {}),
    ...(cfg.whatsAppWebhookPath ? { whatsAppWebhookPath: cfg.whatsAppWebhookPath } : {}),
    ...(cfg.whatsAppVerifyToken ? { whatsAppVerifyToken: cfg.whatsAppVerifyToken } : {}),
    ...(cfg.whatsAppAppSecret ? { whatsAppAppSecret: cfg.whatsAppAppSecret } : {}),
    onChannelEvent: routeChannelEvent,
    onSendMessage: async (channel, chatId, text) => {
      const adapter = adaptersByChannel.get(channel);
      if (!adapter) {
        throw new Error(`No adapter registered for channel "${channel}".`);
      }
      await adapter.sendText(chatId, text);
    },
    onWarn,
  });

  p.log.step(`Gateway listening on ${gateway.url}`);

  writeGatewayProcessState({
    pid: process.pid,
    startedAt: Date.now(),
    host: cfg.host,
    port: selectedPort.port,
    userId: ctx.user.id,
  });

  p.log.message("POST /hooks/inbound with Authorization: Bearer <token>");
  p.log.message("POST /hooks/telegram for Telegram webhook updates");
  p.log.message("POST /hooks/discord for Discord interactions");
  p.log.message("GET/POST /hooks/whatsapp for WhatsApp webhook verify/events");

  // --- Telegram polling listener ---
  const telegramPollingListener = cfg.telegramBotToken
    ? startTelegramPollingListener({
        botToken: cfg.telegramBotToken,
        gatewayUrl: gateway.url,
        gatewayToken: cfg.token,
        ...(cfg.telegramWebhookSecret ? { telegramWebhookSecret: cfg.telegramWebhookSecret } : {}),
        onInfo: (message) => p.log.message(message),
        onWarn,
      })
    : null;

  if (telegramPollingListener) {
    p.log.message("Telegram polling listener: enabled");
  }

  // --- Discord gateway listener ---
  const discordGatewayListener = cfg.discordBotToken
    ? startDiscordGatewayListener({
        botToken: cfg.discordBotToken,
        gatewayUrl: gateway.url,
        gatewayToken: cfg.token,
        onInfo: (message) => p.log.message(message),
        onWarn,
      })
    : null;

  if (discordGatewayListener) {
    p.log.message("Discord gateway listener: enabled");
  }

  // --- WhatsApp Web (Baileys) listener ---
  const shouldRunWhatsAppWebListener =
    cfg.whatsAppMode === "qr-link" &&
    Boolean(cfg.whatsAppLinkedAt) &&
    (cfg.whatsAppPairingMethod === "qr" || cfg.whatsAppPairingMethod === "pairing-code");

  let whatsAppWebListener: Awaited<ReturnType<typeof startWhatsAppWebListener>> | null = null;

  if (shouldRunWhatsAppWebListener) {
    whatsAppWebListener = startWhatsAppWebListener({
      gatewayUrl: gateway.url,
      token: cfg.token,
    });

    // Register whatsapp-web adapter asynchronously after the send port is discovered.
    whatsAppWebListener.sendPort
      .then(async (port: number | null) => {
        if (port === null) {
          onWarn("WhatsApp Web listener did not expose a send port — outbound disabled.");
          // Still register a no-send adapter so inbound messages get responses.
          const adapter = createWhatsAppWebAdapter({
            sendMessage: async () => {
              throw new Error("WhatsApp Web send port not available.");
            },
          });
          await registerResponder("whatsapp-web", adapter, {
            ...(cfg.whatsAppDefaultChatId
              ? { trustedChatId: cfg.whatsAppDefaultChatId }
              : { onFirstContact: persistWhatsAppDefaultChatId }),
          });
          return;
        }

        const sendMessage = async (jid: string, content: { text: string }) => {
          const response = await fetch(`http://127.0.0.1:${port}/send`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jid, content }),
          });
          if (!response.ok) {
            const raw = await response.text();
            throw new Error(`WhatsApp Web send failed (${response.status}): ${raw}`);
          }
          const result = (await response.json()) as { key?: { id?: string } };
          return result;
        };

        const adapter = createWhatsAppWebAdapter({ sendMessage });
        await registerResponder("whatsapp-web", adapter, {
          ...(cfg.whatsAppDefaultChatId
            ? { trustedChatId: cfg.whatsAppDefaultChatId }
            : { onFirstContact: persistWhatsAppDefaultChatId }),
        });
        p.log.message(`WhatsApp Web responder: enabled (send port ${port})`);
      })
      .catch((err: unknown) => {
        onWarn(
          `WhatsApp Web send port setup failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

    p.log.message("WhatsApp Web listener: enabled (QR-link mode)");
  } else if (cfg.whatsAppMode === "qr-link") {
    p.log.warn(
      "WhatsApp Web listener disabled: account not linked yet. Run `grindxp integrations setup whatsapp-qr`.",
    );
  }

  // --- Google poller ---
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
    if (discordGatewayListener) {
      await discordGatewayListener.stop();
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
  const discordBotToken =
    getFlagValue(args, "--discord-bot-token") ?? process.env.GRIND_DISCORD_BOT_TOKEN ?? undefined;
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
    ...(discordBotToken ? { discordBotToken } : {}),
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
