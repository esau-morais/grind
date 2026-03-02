import { join } from "node:path";

import qrcode from "qrcode-terminal";

import { getGrindHome } from "@grindxp/core";
import { DisconnectReason } from "@whiskeysockets/baileys";

import {
  closeSocket,
  createWASocket,
  ensureAuthDir,
  extractDisconnectStatusCode,
  formatDisconnectError,
  waitForConnection,
  waitForStableOpen,
} from "./whatsapp-session.js";

export type WhatsAppPairingMethod = "qr" | "pairing-code";

export interface WhatsAppLinkOptions {
  pairingMethod: WhatsAppPairingMethod;
  pairingPhone?: string;
  timeoutMs?: number;
  onInfo?: (message: string) => void;
}

export interface WhatsAppLinkResult {
  linkedAt?: number;
  error?: string;
}

const OPEN_STABILITY_MS = 6000;

export async function linkWhatsAppAccount(
  options: WhatsAppLinkOptions,
): Promise<WhatsAppLinkResult> {
  const authDir = join(getGrindHome(), "channels", "whatsapp", "auth");
  ensureAuthDir(authDir);

  const timeoutMs = Math.max(options.timeoutMs ?? 180_000, 30_000);

  try {
    const primary = await createWASocket(authDir);
    let pairingRequested = false;
    let qrShown = false;

    primary.socket.ev.on("connection.update", async (update) => {
      if (options.pairingMethod === "qr" && update.qr && !qrShown) {
        qrShown = true;
        process.stdout.write("Scan this QR in WhatsApp -> Linked Devices\n");
        qrcode.generate(update.qr, { small: true });
      }

      if (
        options.pairingMethod === "pairing-code" &&
        !pairingRequested &&
        !primary.socket.authState.creds.registered &&
        (update.connection === "connecting" || Boolean(update.qr))
      ) {
        pairingRequested = true;
        if (!options.pairingPhone) {
          process.stderr.write("Pairing-code mode requires a phone number.\n");
          return;
        }
        try {
          const code = await primary.socket.requestPairingCode(options.pairingPhone);
          process.stdout.write(`Enter this pairing code in WhatsApp: ${code}\n`);
        } catch (err) {
          process.stderr.write(`Failed to request pairing code: ${formatDisconnectError(err)}\n`);
        }
      }
    });

    try {
      await waitForConnection(primary.socket, timeoutMs);
      await waitForStableOpen(primary.socket, OPEN_STABILITY_MS);
      await primary.flushCreds();
      await closeSocket(primary.socket);
      return { linkedAt: Date.now() };
    } catch (err) {
      const statusCode = extractDisconnectStatusCode(err);

      if (statusCode === DisconnectReason.restartRequired || statusCode === 515) {
        process.stdout.write("WhatsApp requested restart after pairing. Reconnecting once...\n");
        await closeSocket(primary.socket);

        const retry = await createWASocket(authDir);
        try {
          await waitForConnection(retry.socket, timeoutMs);
          await waitForStableOpen(retry.socket, OPEN_STABILITY_MS);
          await retry.flushCreds();
          await closeSocket(retry.socket);
          return { linkedAt: Date.now() };
        } catch (retryErr) {
          await closeSocket(retry.socket);
          return { error: formatDisconnectError(retryErr) };
        }
      }

      await closeSocket(primary.socket);
      return { error: formatDisconnectError(err) };
    }
  } catch (err) {
    return { error: formatDisconnectError(err) };
  }
}
