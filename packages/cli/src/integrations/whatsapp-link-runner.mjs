import { chmodSync, mkdirSync } from "node:fs";

import {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  makeWASocket,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";

const payloadRaw = process.argv[2];
if (!payloadRaw) {
  process.stderr.write("Missing WhatsApp link payload.\n");
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(payloadRaw);
} catch {
  process.stderr.write("Invalid WhatsApp link payload.\n");
  process.exit(1);
}

if (!payload || typeof payload !== "object") {
  process.stderr.write("Invalid WhatsApp link payload.\n");
  process.exit(1);
}

const authDir =
  typeof payload.authDir === "string" && payload.authDir.length > 0 ? payload.authDir : null;
const pairingMethod = payload.pairingMethod === "pairing-code" ? "pairing-code" : "qr";
const pairingPhone =
  typeof payload.pairingPhone === "string" && payload.pairingPhone.length > 0
    ? payload.pairingPhone
    : undefined;
const timeoutMs =
  typeof payload.timeoutMs === "number" && Number.isFinite(payload.timeoutMs)
    ? Math.max(payload.timeoutMs, 30_000)
    : 180_000;
const OPEN_STABILITY_MS = 6000;

if (!authDir) {
  process.stderr.write("Missing auth directory path.\n");
  process.exit(1);
}

mkdirSync(authDir, { recursive: true, mode: 0o700 });
try {
  chmodSync(authDir, 0o700);
} catch {
  // best effort
}

const silentLogger = {
  level: "silent",
  child() {
    return silentLogger;
  },
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
};

try {
  const primary = await createSocket({
    authDir,
    pairingMethod,
    pairingPhone,
    emitQr: true,
  });

  try {
    await waitForConnection(primary.socket, timeoutMs);
    await waitForStableOpen(primary.socket, OPEN_STABILITY_MS);
    await primary.flushCreds();
    process.stdout.write("WhatsApp link complete.\n");
    await closeSocket(primary.socket);
    process.exit(0);
  } catch (err) {
    const statusCode = extractDisconnectStatusCode(err);
    if (statusCode === DisconnectReason.restartRequired || statusCode === 515) {
      process.stdout.write("WhatsApp requested restart after pairing. Reconnecting once...\n");
      await closeSocket(primary.socket);

      const retry = await createSocket({
        authDir,
        pairingMethod,
        pairingPhone,
        emitQr: false,
      });

      try {
        await waitForConnection(retry.socket, timeoutMs);
        await waitForStableOpen(retry.socket, OPEN_STABILITY_MS);
        await retry.flushCreds();
        process.stdout.write("WhatsApp link complete.\n");
        await closeSocket(retry.socket);
        process.exit(0);
      } catch (retryError) {
        await closeSocket(retry.socket);
        process.stderr.write(`${formatDisconnectError(retryError)}\n`);
        process.exit(1);
      }
    }

    process.stderr.write(`${formatDisconnectError(err)}\n`);
    await closeSocket(primary.socket);
    process.exit(1);
  }
} catch (error) {
  process.stderr.write(`${formatDisconnectError(error)}\n`);
  process.exit(1);
}

async function createSocket(options) {
  const { state, saveCreds } = await useMultiFileAuthState(options.authDir);
  const { version } = await fetchLatestBaileysVersion();

  let saveQueue = Promise.resolve();
  let pairingRequested = false;
  let qrShown = false;

  const socket = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, silentLogger),
    },
    version,
    logger: silentLogger,
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    browser: ["grind", "cli", "0.1.0"],
  });

  socket.ev.on("creds.update", () => {
    saveQueue = saveQueue.then(() => Promise.resolve(saveCreds())).catch(() => Promise.resolve());
  });

  socket.ev.on("connection.update", async (update) => {
    if (options.emitQr && options.pairingMethod === "qr" && update.qr && !qrShown) {
      qrShown = true;
      process.stdout.write("Scan this QR in WhatsApp -> Linked Devices\n");
      qrcode.generate(update.qr, { small: true });
    }

    if (
      options.pairingMethod === "pairing-code" &&
      !pairingRequested &&
      (update.connection === "connecting" || Boolean(update.qr))
    ) {
      pairingRequested = true;
      if (!options.pairingPhone) {
        process.stderr.write("Pairing-code mode requires a phone number.\n");
        return;
      }

      try {
        const code = await socket.requestPairingCode(options.pairingPhone);
        process.stdout.write(`Enter this pairing code in WhatsApp: ${code}\n`);
      } catch (error) {
        process.stderr.write(`Failed to request pairing code: ${formatDisconnectError(error)}\n`);
      }
    }
  });

  return {
    socket,
    flushCreds: async () => {
      await saveQueue;
      try {
        await saveCreds();
      } catch {
        // best effort
      }
    },
  };
}

async function waitForConnection(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for WhatsApp link confirmation."));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      socket.ev.off("connection.update", onUpdate);
    };

    const onUpdate = (update) => {
      if (update.connection === "open") {
        cleanup();
        resolve();
        return;
      }

      if (update.connection === "close") {
        cleanup();
        reject(update.lastDisconnect?.error ?? new Error("Connection closed"));
      }
    };

    socket.ev.on("connection.update", onUpdate);
  });
}

async function waitForStableOpen(socket, stableMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, stableMs);

    const cleanup = () => {
      clearTimeout(timer);
      socket.ev.off("connection.update", onUpdate);
    };

    const onUpdate = (update) => {
      if (update.connection === "close") {
        cleanup();
        reject(update.lastDisconnect?.error ?? new Error("Connection closed right after opening."));
      }
    };

    socket.ev.on("connection.update", onUpdate);
  });
}

async function closeSocket(socket) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  try {
    socket.ws?.close();
  } catch {
    // best effort
  }
}

function extractDisconnectStatusCode(error) {
  if (!error || typeof error !== "object") return undefined;

  if ("output" in error && error.output && typeof error.output === "object") {
    const output = error.output;
    if ("statusCode" in output && typeof output.statusCode === "number") {
      return output.statusCode;
    }
  }

  if ("status" in error && typeof error.status === "number") {
    return error.status;
  }

  return undefined;
}

function formatDisconnectError(error) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.length > 0) return error;

  const status = extractDisconnectStatusCode(error);
  if (status === DisconnectReason.loggedOut) {
    return "WhatsApp session logged out. Clear auth and scan a fresh QR.";
  }
  if (status === DisconnectReason.restartRequired || status === 515) {
    return "Restart required.";
  }
  if (status) {
    return `Disconnected (status ${status}).`;
  }

  return "Connection failure.";
}
