import { join } from "node:path";

import { getGrindHome } from "@grindxp/core";

export interface WhatsAppWebListenerOptions {
  gatewayUrl: string;
  token: string;
}

export interface WhatsAppWebListener {
  sendPort: Promise<number | null>;
  stop: () => Promise<void>;
}

export function startWhatsAppWebListener(options: WhatsAppWebListenerOptions): WhatsAppWebListener {
  const authDir = join(getGrindHome(), "channels", "whatsapp", "auth");
  const runnerPath = join(import.meta.dir, "whatsapp-web-listener-runner.mjs");

  const payload = JSON.stringify({
    authDir,
    gatewayUrl: options.gatewayUrl,
    token: options.token,
  });

  let resolveSendPort: (port: number | null) => void = () => {};
  const sendPort = new Promise<number | null>((resolve) => {
    resolveSendPort = resolve;
  });

  const child = Bun.spawn(["node", runnerPath, payload], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "inherit",
  });

  // Read stdout line-by-line to capture WHATSAPP_SEND_PORT=<port>
  let portResolved = false;
  void (async () => {
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          process.stdout.write(trimmed + "\n");
          if (!portResolved && trimmed.startsWith("WHATSAPP_SEND_PORT=")) {
            const portStr = trimmed.slice("WHATSAPP_SEND_PORT=".length);
            const port = Number.parseInt(portStr, 10);
            if (Number.isInteger(port) && port > 0) {
              portResolved = true;
              resolveSendPort(port);
            }
          }
        }
      }
    } catch {
      // reader closed
    }
    if (!portResolved) {
      portResolved = true;
      resolveSendPort(null);
    }
  })();

  return {
    sendPort,
    stop: async () => {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
      }
      await child.exited;
    },
  };
}
