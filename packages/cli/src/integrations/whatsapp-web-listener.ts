import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

import type { WAMessage } from "@whiskeysockets/baileys";
import { DisconnectReason } from "@whiskeysockets/baileys";

import { getGrindHome, readGrindConfig, writeGrindConfig } from "@grindxp/core";

import { createContactCollector } from "./whatsapp-contacts.js";

import {
  closeSocket,
  createWASocket,
  extractDisconnectStatusCode,
  formatDisconnectError,
  waitForConnection,
} from "./whatsapp-session.js";

export interface WhatsAppWebListenerOptions {
  gatewayUrl: string;
  token: string;
}

export interface WhatsAppWebListener {
  sendMessage:
    | ((jid: string, content: { text: string }) => Promise<{ key?: { id?: string } }>)
    | null;
  stop: () => void;
}

export function startWhatsAppWebListener(options: WhatsAppWebListenerOptions): WhatsAppWebListener {
  const authDir = join(getGrindHome(), "channels", "whatsapp", "auth");

  if (!existsSync(authDir)) {
    process.stderr.write(
      "WhatsApp auth is missing. Run `grindxp integrations setup` and link first.\n",
    );
    return { sendMessage: null, stop: () => {} };
  }

  let stopRequested = false;
  let activeSendMessage: WhatsAppWebListener["sendMessage"] = null;

  void runLoop();

  return {
    get sendMessage() {
      return activeSendMessage;
    },
    stop: () => {
      stopRequested = true;
    },
  };

  async function runLoop() {
    let retryMs = 2000;

    while (!stopRequested) {
      const { socket, flushCreds } = await createWASocket(authDir);

      // Register contact listeners before waitForConnection — messaging-history.set
      // fires during the handshake, before the connection is fully open.
      const contactCollector = createContactCollector(socket.ev);
      let contactsFlushTimer: ReturnType<typeof setTimeout> | null = null;

      const scheduleContactFlush = () => {
        if (contactsFlushTimer) clearTimeout(contactsFlushTimer);
        contactsFlushTimer = setTimeout(() => contactCollector.flush(), 2000);
      };

      socket.ev.on("contacts.upsert", scheduleContactFlush);
      socket.ev.on("contacts.update", scheduleContactFlush);
      socket.ev.on("messaging-history.set", scheduleContactFlush);

      try {
        await waitForConnection(socket, 30_000);
        process.stdout.write("WhatsApp Web listener connected.\n");
        retryMs = 2000;
        void flushCreds();

        activeSendMessage = async (jid, content) => {
          const result = await socket.sendMessage(jid, content);
          return result ?? {};
        };

        const closeReason = await runListenerLoop(socket, () => {
          activeSendMessage = null;
        });
        activeSendMessage = null;

        if (stopRequested) break;

        if (closeReason.loggedOut) {
          process.stderr.write(
            "WhatsApp session logged out. Re-link with `grindxp integrations setup`.\n",
          );
          clearWhatsAppLinkedState(authDir);
          break;
        }

        process.stderr.write("WhatsApp listener disconnected. Reconnecting...\n");
      } catch (err) {
        activeSendMessage = null;
        if (!stopRequested) {
          process.stderr.write(
            `WhatsApp listener connection error: ${formatDisconnectError(err)}\n`,
          );
        }
      } finally {
        await closeSocket(socket);
      }

      if (!stopRequested) {
        await Bun.sleep(retryMs);
        retryMs = Math.min(retryMs * 2, 30_000);
      }
    }
  }

  async function runListenerLoop(
    socket: Awaited<ReturnType<typeof createWASocket>>["socket"],
    onDisconnecting: () => void,
  ): Promise<{ status: number | undefined; loggedOut: boolean }> {
    return new Promise((resolve) => {
      const close = (reason: { status: number | undefined; loggedOut: boolean }) => {
        cleanup();
        resolve(reason);
      };

      const onMessage = async (upsert: { type: string; messages: WAMessage[] }) => {
        if (upsert?.type !== "notify") return;

        for (const message of upsert.messages ?? []) {
          const key = message?.key;
          if (!key || key.fromMe) continue;

          const remoteJid = key.remoteJid;
          const messageId = key.id;
          if (!remoteJid || !messageId) continue;
          const participant = key.participant ?? null;
          const fromJid = participant ?? remoteJid;
          const text = extractText(message.message as Record<string, unknown> | undefined);
          const detectedAt =
            typeof message.messageTimestamp === "number"
              ? Math.max(1, Math.trunc(message.messageTimestamp)) * 1000
              : Date.now();

          const eventPayload = {
            channel: "whatsapp-web",
            eventName: "message.received",
            messageId,
            chatId: remoteJid,
            from: jidToId(fromJid),
            ...(participant ? { senderJid: participant } : {}),
            ...(text ? { text } : {}),
          };

          const body = {
            type: "context",
            confidence: 0.95,
            detectedAt,
            dedupeKey: `whatsapp-web:${messageId}`,
            payload: eventPayload,
            eventPayload,
          };

          try {
            const response = await fetch(`${options.gatewayUrl}/hooks/inbound`, {
              method: "POST",
              headers: {
                authorization: `Bearer ${options.token}`,
                "content-type": "application/json",
              },
              body: JSON.stringify(body),
            });

            if (!response.ok) {
              process.stderr.write(`Failed forwarding WhatsApp event (${response.status}).\n`);
            }
          } catch (err) {
            process.stderr.write(
              `Failed forwarding WhatsApp event: ${formatDisconnectError(err)}\n`,
            );
          }
        }
      };

      const onConnectionUpdate = (update: {
        connection?: string;
        lastDisconnect?: { error?: unknown };
      }) => {
        if (update.connection !== "close") return;
        onDisconnecting();
        const status = extractDisconnectStatusCode(update.lastDisconnect?.error);
        close({ status, loggedOut: status === DisconnectReason.loggedOut });
      };

      const interval = setInterval(() => {
        if (stopRequested) close({ status: undefined, loggedOut: false });
      }, 400);

      const cleanup = () => {
        clearInterval(interval);
        socket.ev.off("messages.upsert", onMessage);
        socket.ev.off("connection.update", onConnectionUpdate);
      };

      socket.ev.on("messages.upsert", onMessage);
      socket.ev.on("connection.update", onConnectionUpdate);
    });
  }
}

function extractText(message: Record<string, unknown> | undefined): string | undefined {
  if (!message || typeof message !== "object") return undefined;

  if (typeof message.conversation === "string" && message.conversation.trim()) {
    return message.conversation.trim();
  }

  const extended = message.extendedTextMessage as { text?: string } | undefined;
  if (extended && typeof extended.text === "string" && extended.text.trim()) {
    return extended.text.trim();
  }

  const image = message.imageMessage as { caption?: string } | undefined;
  if (image && typeof image.caption === "string" && image.caption.trim()) {
    return image.caption.trim();
  }

  const video = message.videoMessage as { caption?: string } | undefined;
  if (video && typeof video.caption === "string" && video.caption.trim()) {
    return video.caption.trim();
  }

  return undefined;
}

function jidToId(jid: string): string {
  const at = jid.indexOf("@");
  return at === -1 ? jid : jid.slice(0, at);
}

function clearWhatsAppLinkedState(authDir: string): void {
  try {
    rmSync(authDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }

  try {
    const config = readGrindConfig();
    if (!config?.gateway) return;
    const {
      whatsAppLinkedAt: _,
      whatsAppDefaultChatId: __,
      whatsAppAllowedChatIds: ___,
      ...rest
    } = config.gateway;
    writeGrindConfig({ ...config, gateway: rest });
  } catch {
    // best-effort
  }
}
