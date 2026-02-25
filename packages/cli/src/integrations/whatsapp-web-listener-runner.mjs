import { existsSync } from "node:fs";

import {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  makeWASocket,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";

const payloadRaw = process.argv[2];
if (!payloadRaw) {
  process.stderr.write("Missing WhatsApp listener payload.\n");
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(payloadRaw);
} catch {
  process.stderr.write("Invalid WhatsApp listener payload.\n");
  process.exit(1);
}

const authDir = typeof payload?.authDir === "string" ? payload.authDir : "";
const gatewayUrl = typeof payload?.gatewayUrl === "string" ? payload.gatewayUrl : "";
const token = typeof payload?.token === "string" ? payload.token : "";

if (!authDir || !gatewayUrl || !token) {
  process.stderr.write("Missing WhatsApp listener configuration.\n");
  process.exit(1);
}

if (!existsSync(authDir)) {
  process.stderr.write(
    "WhatsApp auth is missing. Run `grindxp integrations setup` and link first.\n",
  );
  process.exit(1);
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

let stopRequested = false;
process.on("SIGTERM", () => {
  stopRequested = true;
});
process.on("SIGINT", () => {
  stopRequested = true;
});

let retryMs = 2000;

while (!stopRequested) {
  const socket = await createSocket(authDir);

  try {
    await waitForConnection(socket, 30_000);
    process.stdout.write("WhatsApp Web listener connected.\n");
    retryMs = 2000;

    const closeReason = await runListenerLoop(socket, {
      gatewayUrl,
      token,
    });

    if (stopRequested) {
      break;
    }

    if (closeReason.loggedOut) {
      process.stderr.write(
        "WhatsApp session logged out. Re-link with `grindxp integrations setup`.\n",
      );
      process.exit(1);
    }

    process.stderr.write("WhatsApp listener disconnected. Reconnecting...\n");
  } catch (error) {
    if (!stopRequested) {
      process.stderr.write(`WhatsApp listener connection error: ${formatError(error)}\n`);
    }
  } finally {
    try {
      socket.ws?.close();
    } catch {
      // best effort
    }
  }

  if (!stopRequested) {
    await sleep(retryMs);
    retryMs = Math.min(retryMs * 2, 30_000);
  }
}

process.exit(0);

async function createSocket(authDir) {
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
    void Promise.resolve(saveCreds());
  });

  return socket;
}

async function waitForConnection(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for WhatsApp Web listener connection."));
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
        reject(update.lastDisconnect?.error ?? new Error("Connection closed."));
      }
    };

    socket.ev.on("connection.update", onUpdate);
  });
}

async function runListenerLoop(socket, options) {
  return new Promise((resolve) => {
    const close = (reason) => {
      cleanup();
      resolve(reason);
    };

    const onMessage = async (upsert) => {
      if (upsert?.type !== "notify") {
        return;
      }

      for (const message of upsert.messages ?? []) {
        const key = message?.key;
        if (!key || key.fromMe) continue;

        const remoteJid = key.remoteJid;
        const messageId = key.id;
        if (!remoteJid || !messageId) continue;
        if (remoteJid.endsWith("@status") || remoteJid.endsWith("@broadcast")) continue;

        const participant = key.participant ?? null;
        const fromJid = participant ?? remoteJid;
        const text = extractText(message.message);
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
        } catch (error) {
          process.stderr.write(`Failed forwarding WhatsApp event: ${formatError(error)}\n`);
        }
      }
    };

    const onConnectionUpdate = (update) => {
      if (update.connection !== "close") return;
      const status = extractDisconnectStatusCode(update.lastDisconnect?.error);
      close({
        status,
        loggedOut: status === DisconnectReason.loggedOut,
      });
    };

    const interval = setInterval(() => {
      if (stopRequested) {
        close({ status: undefined, loggedOut: false });
      }
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

function extractText(message) {
  if (!message || typeof message !== "object") return undefined;

  if (typeof message.conversation === "string" && message.conversation.trim()) {
    return message.conversation.trim();
  }

  const extended = message.extendedTextMessage;
  if (extended && typeof extended.text === "string" && extended.text.trim()) {
    return extended.text.trim();
  }

  const image = message.imageMessage;
  if (image && typeof image.caption === "string" && image.caption.trim()) {
    return image.caption.trim();
  }

  const video = message.videoMessage;
  if (video && typeof video.caption === "string" && video.caption.trim()) {
    return video.caption.trim();
  }

  return undefined;
}

function jidToId(jid) {
  const at = jid.indexOf("@");
  if (at === -1) return jid;
  return jid.slice(0, at);
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

function formatError(error) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
