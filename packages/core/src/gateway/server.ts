import { createHmac, createPublicKey, timingSafeEqual, verify } from "node:crypto";

import type { VaultDb } from "../vault/types";
import { recordSignal } from "../vault/repositories";
import { runForgeTick } from "../forge";

import {
  type NormalizedGatewayEvent,
  normalizeDiscordInteraction,
  normalizeInboundWebhook,
  normalizeTelegramWebhookUpdate,
  normalizeWhatsAppWebhook,
} from "./normalize";

export interface GatewayServerOptions {
  db: VaultDb;
  userId: string;
  token: string;
  host?: string;
  port?: number;
  telegramWebhookSecret?: string;
  telegramWebhookPath?: string;
  onTelegramEvent?: (event: {
    normalized: NormalizedGatewayEvent;
    tick: Awaited<ReturnType<typeof runForgeTick>>;
  }) => Promise<void> | void;
  discordPublicKey?: string;
  discordWebhookPath?: string;
  whatsAppWebhookPath?: string;
  whatsAppVerifyToken?: string;
  whatsAppAppSecret?: string;
}

export interface GatewayServer {
  url: string;
  stop: (force?: boolean) => Promise<void>;
}

export function startGatewayServer(options: GatewayServerOptions): GatewayServer {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 5174;
  const telegramPath = options.telegramWebhookPath ?? "/hooks/telegram";
  const discordPath = options.discordWebhookPath ?? "/hooks/discord";
  const whatsAppPath = options.whatsAppWebhookPath ?? "/hooks/whatsapp";

  const server = Bun.serve({
    hostname: host,
    port,
    fetch: async (request) => {
      const url = new URL(request.url);
      const path = url.pathname;

      if (request.method === "GET" && path === "/health") {
        return Response.json({ ok: true, service: "grind-gateway" });
      }

      if (request.method === "POST" && path === "/hooks/inbound") {
        if (!isAuthorized(request, options.token)) {
          return jsonError(401, "Unauthorized");
        }

        const payload = await safeJson(request);
        if (!payload.ok) {
          return jsonError(400, "Invalid JSON body");
        }

        try {
          const normalized = normalizeInboundWebhook(payload.value, options.userId);
          const result = await ingestNormalizedEvent(options, normalized);
          return Response.json({ ok: true, signalId: result.signalId, tick: result.tick });
        } catch (error) {
          return jsonError(400, error instanceof Error ? error.message : String(error));
        }
      }

      if (request.method === "POST" && path === telegramPath) {
        if (!isTelegramAuthorized(request, options.token, options.telegramWebhookSecret)) {
          return jsonError(401, "Unauthorized");
        }

        const payload = await safeJson(request);
        if (!payload.ok) {
          return jsonError(400, "Invalid Telegram update payload");
        }

        try {
          const normalized = normalizeTelegramWebhookUpdate(payload.value, options.userId);
          const result = await ingestNormalizedEvent(options, normalized);

          if (options.onTelegramEvent) {
            queueMicrotask(async () => {
              try {
                await options.onTelegramEvent?.({ normalized, tick: result.tick });
              } catch {
                // keep webhook endpoint stable even if external callback fails
              }
            });
          }

          return Response.json({ ok: true, signalId: result.signalId, tick: result.tick });
        } catch (error) {
          return jsonError(400, error instanceof Error ? error.message : String(error));
        }
      }

      if (request.method === "POST" && path === discordPath) {
        if (!options.discordPublicKey) {
          return jsonError(400, "Discord public key is not configured.");
        }

        const bodyText = await safeText(request);
        if (bodyText === null) {
          return jsonError(400, "Invalid request body");
        }

        const signature = request.headers.get("x-signature-ed25519");
        const timestamp = request.headers.get("x-signature-timestamp");
        if (!signature || !timestamp) {
          return jsonError(401, "Missing Discord signature headers");
        }

        const verified = verifyDiscordSignature({
          publicKeyHex: options.discordPublicKey,
          signatureHex: signature,
          timestamp,
          bodyText,
        });
        if (!verified) {
          return jsonError(401, "Invalid Discord signature");
        }

        const parsed = safeParseJson(bodyText);
        if (!parsed.ok) {
          return jsonError(400, "Invalid Discord interaction payload");
        }

        const interactionType =
          typeof parsed.value === "object" && parsed.value && "type" in parsed.value
            ? (parsed.value as { type?: unknown }).type
            : undefined;

        if (interactionType === 1) {
          return Response.json({ type: 1 });
        }

        queueMicrotask(async () => {
          try {
            const normalized = normalizeDiscordInteraction(parsed.value, options.userId);
            await ingestNormalizedEvent(options, normalized);
          } catch {
            // intentionally swallowed to preserve interaction ACK timing
          }
        });

        if (interactionType === 3) {
          return Response.json({ type: 6 });
        }

        if (interactionType === 4) {
          return Response.json({ type: 8, data: { choices: [] } });
        }

        return Response.json({ type: 5 });
      }

      if (path === whatsAppPath && request.method === "GET") {
        const mode = url.searchParams.get("hub.mode");
        const verifyToken = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");
        if (mode !== "subscribe" || !challenge) {
          return jsonError(400, "Invalid WhatsApp webhook verification request");
        }

        if (!options.whatsAppVerifyToken) {
          return jsonError(400, "WhatsApp verify token is not configured.");
        }

        if (verifyToken !== options.whatsAppVerifyToken) {
          return jsonError(401, "Invalid WhatsApp verify token");
        }

        return new Response(challenge, { status: 200 });
      }

      if (path === whatsAppPath && request.method === "POST") {
        const bodyText = await safeText(request);
        if (bodyText === null) {
          return jsonError(400, "Invalid WhatsApp request body");
        }

        if (options.whatsAppAppSecret) {
          const signatureHeader = request.headers.get("x-hub-signature-256");
          if (
            !signatureHeader ||
            !verifyWhatsAppSignature(bodyText, signatureHeader, options.whatsAppAppSecret)
          ) {
            return jsonError(401, "Invalid WhatsApp signature");
          }
        }

        const parsed = safeParseJson(bodyText);
        if (!parsed.ok) {
          return jsonError(400, "Invalid WhatsApp webhook payload");
        }

        const messageEvents = normalizeWhatsAppWebhook(parsed.value, options.userId, {
          source: "message",
        });
        const statusEvents = normalizeWhatsAppWebhook(parsed.value, options.userId, {
          source: "status",
        });
        const normalizedEvents = [...messageEvents, ...statusEvents];

        for (const normalized of normalizedEvents) {
          await ingestNormalizedEvent(options, normalized);
        }

        return Response.json({ ok: true, events: normalizedEvents.length });
      }

      return jsonError(404, "Not found");
    },
  });

  return {
    url: String(server.url),
    stop: (force = false) => server.stop(force),
  };
}

async function ingestNormalizedEvent(
  options: GatewayServerOptions,
  normalized: NormalizedGatewayEvent,
): Promise<{ signalId: string; tick: Awaited<ReturnType<typeof runForgeTick>> }> {
  const signal = await recordSignal(options.db, normalized.signal);

  const tick = await runForgeTick({
    db: options.db,
    userId: options.userId,
    includeCollectors: false,
    events: [
      {
        ...normalized.forgeEvent,
        payload: {
          ...normalized.forgeEvent.payload,
          signalId: signal.id,
          signalType: signal.type,
          source: signal.source,
        },
      },
    ],
  });

  return { signalId: signal.id, tick };
}

function isAuthorized(request: Request, token: string): boolean {
  if (!token) return false;

  const bearer = request.headers.get("authorization");
  if (bearer?.startsWith("Bearer ")) {
    const authToken = bearer.slice("Bearer ".length).trim();
    if (timingSafeEqualsString(authToken, token)) return true;
  }

  const headerToken = request.headers.get("x-grind-token");
  return headerToken !== null && timingSafeEqualsString(headerToken, token);
}

function isTelegramAuthorized(request: Request, token: string, telegramSecret?: string): boolean {
  if (telegramSecret) {
    const telegramHeader = request.headers.get("x-telegram-bot-api-secret-token");
    return telegramHeader !== null && timingSafeEqualsString(telegramHeader, telegramSecret);
  }

  return isAuthorized(request, token);
}

async function safeJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    const value = await request.json();
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

async function safeText(request: Request): Promise<string | null> {
  try {
    return await request.text();
  } catch {
    return null;
  }
}

function safeParseJson(input: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(input) };
  } catch {
    return { ok: false };
  }
}

function verifyDiscordSignature(options: {
  publicKeyHex: string;
  signatureHex: string;
  timestamp: string;
  bodyText: string;
}): boolean {
  try {
    const keyBytes = decodeHex(options.publicKeyHex);
    const signatureBytes = decodeHex(options.signatureHex);
    if (!keyBytes || !signatureBytes) return false;

    const keyObject = createPublicKey({
      key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), keyBytes]),
      format: "der",
      type: "spki",
    });

    return verify(
      null,
      Buffer.from(`${options.timestamp}${options.bodyText}`, "utf8"),
      keyObject,
      signatureBytes,
    );
  } catch {
    return false;
  }
}

function decodeHex(value: string): Buffer | null {
  if (!/^[0-9a-fA-F]+$/.test(value) || value.length % 2 !== 0) {
    return null;
  }
  return Buffer.from(value, "hex");
}

function timingSafeEqualsString(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function verifyWhatsAppSignature(
  bodyText: string,
  signatureHeader: string,
  appSecret: string,
): boolean {
  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) return false;
  const expected = signatureHeader.slice(prefix.length);
  const digest = createHmac("sha256", appSecret).update(bodyText, "utf8").digest("hex");
  if (digest.length !== expected.length) return false;
  return timingSafeEqualsString(digest, expected);
}

function jsonError(status: number, error: string): Response {
  return Response.json({ ok: false, error }, { status });
}
