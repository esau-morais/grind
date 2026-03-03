import { join } from "node:path";
import { rmSync } from "node:fs";

import qrcode from "qrcode-terminal";

import { getGrindHome } from "@grindxp/core";
import { DisconnectReason } from "@whiskeysockets/baileys";

import { createContactCollector } from "./whatsapp-contacts.js";
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
const CONTACT_SYNC_EXTRA_MS = 10_000;

type WASocket = Awaited<ReturnType<typeof createWASocket>>;

/**
 * Waits for a socket to connect, stabilize, sync contacts, flush creds, and close.
 * Handles the standard 515 (restartRequired) post-pairing cycle: closes the socket,
 * creates a new one with the now-saved creds, and reconnects once.
 */
async function connectAndSync(sock: WASocket, authDir: string, timeoutMs: number): Promise<void> {
  const collector = createContactCollector(sock.socket.ev);

  try {
    await waitForConnection(sock.socket, timeoutMs);
    await waitForStableOpen(sock.socket, OPEN_STABILITY_MS);
    if (collector.pending.size === 0) await Bun.sleep(CONTACT_SYNC_EXTRA_MS);
    collector.flush();
    await sock.flushCreds();
    await closeSocket(sock.socket);
  } catch (err) {
    const statusCode = extractDisconnectStatusCode(err);

    if (statusCode === DisconnectReason.restartRequired) {
      process.stdout.write("WhatsApp requested restart after pairing. Reconnecting once...\n");
      await closeSocket(sock.socket);

      const retry = await createWASocket(authDir, { syncFullHistory: true });
      const retryCollector = createContactCollector(retry.socket.ev);
      try {
        await waitForConnection(retry.socket, timeoutMs);
        await waitForStableOpen(retry.socket, OPEN_STABILITY_MS);
        if (retryCollector.pending.size === 0) await Bun.sleep(CONTACT_SYNC_EXTRA_MS);
        retryCollector.flush();
        await retry.flushCreds();
        await closeSocket(retry.socket);
        return;
      } catch (retryErr) {
        await closeSocket(retry.socket);
        throw retryErr;
      }
    }

    await closeSocket(sock.socket);
    throw err;
  }
}

/**
 * Registers QR display and pairing-code request listeners on the given socket.
 */
function registerPairingListeners(sock: WASocket, options: WhatsAppLinkOptions): void {
  let qrShown = false;
  let pairingRequested = false;

  sock.socket.ev.on("connection.update", async (update) => {
    if (options.pairingMethod === "qr" && update.qr && !qrShown) {
      qrShown = true;
      process.stdout.write("Scan this QR in WhatsApp -> Linked Devices\n");
      qrcode.generate(update.qr, { small: true });
    }

    if (
      options.pairingMethod === "pairing-code" &&
      !pairingRequested &&
      !sock.socket.authState.creds.registered &&
      (update.connection === "connecting" || Boolean(update.qr))
    ) {
      pairingRequested = true;
      if (!options.pairingPhone) {
        process.stderr.write("Pairing-code mode requires a phone number.\n");
        return;
      }
      try {
        const code = await sock.socket.requestPairingCode(options.pairingPhone);
        process.stdout.write(`Enter this pairing code in WhatsApp: ${code}\n`);
      } catch (err) {
        process.stderr.write(`Failed to request pairing code: ${formatDisconnectError(err)}\n`);
      }
    }
  });
}

export async function linkWhatsAppAccount(
  options: WhatsAppLinkOptions,
): Promise<WhatsAppLinkResult> {
  const authDir = join(getGrindHome(), "channels", "whatsapp", "auth");
  ensureAuthDir(authDir);

  const timeoutMs = Math.max(options.timeoutMs ?? 180_000, 30_000);

  try {
    const primary = await createWASocket(authDir, { syncFullHistory: true });
    registerPairingListeners(primary, options);

    try {
      await connectAndSync(primary, authDir, timeoutMs);
      return { linkedAt: Date.now() };
    } catch (err) {
      const statusCode = extractDisconnectStatusCode(err);

      if (statusCode === DisconnectReason.loggedOut) {
        process.stdout.write("Session was removed. Clearing credentials and showing a new QR...\n");
        await closeSocket(primary.socket);
        rmSync(authDir, { recursive: true, force: true });
        ensureAuthDir(authDir);

        const fresh = await createWASocket(authDir, { syncFullHistory: true });
        registerPairingListeners(fresh, options);

        try {
          await connectAndSync(fresh, authDir, timeoutMs);
          return { linkedAt: Date.now() };
        } catch (freshErr) {
          return { error: formatDisconnectError(freshErr) };
        }
      }

      return { error: formatDisconnectError(err) };
    }
  } catch (err) {
    return { error: formatDisconnectError(err) };
  }
}
