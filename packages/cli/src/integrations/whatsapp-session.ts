import { chmodSync, copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  makeWASocket,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";

export type { DisconnectReason };

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

// Module-level queue so creds saves are serialized across reconnect cycles.
let credsQueue: Promise<void> = Promise.resolve();

export function ensureAuthDir(authDir: string): void {
  mkdirSync(authDir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(authDir, 0o700);
  } catch {
    // best effort
  }
}

function credsPath(authDir: string) {
  return join(authDir, "creds.json");
}

function credsBackupPath(authDir: string) {
  return join(authDir, "creds.json.bak");
}

export function maybeRestoreCredsFromBackup(authDir: string): void {
  const main = credsPath(authDir);
  const backup = credsBackupPath(authDir);

  try {
    const raw = readFileSync(main, "utf8");
    JSON.parse(raw);
    // Main file is valid — nothing to restore.
  } catch {
    // Main file missing or corrupt — try backup.
    try {
      copyFileSync(backup, main);
    } catch {
      // No backup either; first run or fully lost.
    }
  }
}

async function safeSaveCreds(authDir: string, saveCreds: () => Promise<void>): Promise<void> {
  // Snapshot a known-good backup before overwriting.
  try {
    const raw = readFileSync(credsPath(authDir), "utf8");
    JSON.parse(raw); // only backup if parseable
    copyFileSync(credsPath(authDir), credsBackupPath(authDir));
    try {
      chmodSync(credsBackupPath(authDir), 0o600);
    } catch {
      // best effort
    }
  } catch {
    // ignore backup failures
  }

  try {
    await saveCreds();
    try {
      chmodSync(credsPath(authDir), 0o600);
    } catch {
      // best effort
    }
  } catch {
    // best effort
  }
}

export async function createWASocket(authDir: string) {
  maybeRestoreCredsFromBackup(authDir);
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

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
    credsQueue = credsQueue
      .then(() => safeSaveCreds(authDir, saveCreds))
      .catch(() => Promise.resolve());
  });

  // Guard unhandled WebSocket errors — without this an uncaught 'error' event
  // on the underlying EventEmitter crashes the process.
  const ws = socket.ws as unknown as { on?: (...args: unknown[]) => void } | undefined;
  if (ws && typeof ws.on === "function") {
    ws.on("error", () => {
      // Baileys will emit a connection.update close shortly after; handled there.
    });
  }

  return {
    socket,
    flushCreds: async () => {
      await credsQueue;
      await safeSaveCreds(authDir, saveCreds);
    },
  };
}

export async function waitForConnection(
  socket: ReturnType<typeof makeWASocket>,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for WhatsApp connection."));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      socket.ev.off("connection.update", onUpdate);
    };

    const onUpdate = (update: { connection?: string; lastDisconnect?: { error?: unknown } }) => {
      if (update.connection === "open") {
        cleanup();
        resolve();
        return;
      }
      if (update.connection === "close") {
        cleanup();
        reject(update.lastDisconnect?.error ?? new Error("Connection closed."));
      }
    };

    socket.ev.on("connection.update", onUpdate);
  });
}

export async function waitForStableOpen(
  socket: ReturnType<typeof makeWASocket>,
  stableMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, stableMs);

    const cleanup = () => {
      clearTimeout(timer);
      socket.ev.off("connection.update", onUpdate);
    };

    const onUpdate = (update: { connection?: string; lastDisconnect?: { error?: unknown } }) => {
      if (update.connection === "close") {
        cleanup();
        reject(update.lastDisconnect?.error ?? new Error("Connection closed right after opening."));
      }
    };

    socket.ev.on("connection.update", onUpdate);
  });
}

export async function closeSocket(socket: ReturnType<typeof makeWASocket>): Promise<void> {
  await Bun.sleep(500);
  try {
    socket.ws?.close();
  } catch {
    // best effort
  }
}

export function extractDisconnectStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;

  const withOutput = error as { output?: { statusCode?: number } };
  if (withOutput.output && typeof withOutput.output.statusCode === "number") {
    return withOutput.output.statusCode;
  }

  const withStatus = error as { status?: number };
  if (typeof withStatus.status === "number") {
    return withStatus.status;
  }

  return undefined;
}

export function formatDisconnectError(error: unknown): string {
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
