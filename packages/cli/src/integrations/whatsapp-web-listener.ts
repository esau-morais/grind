import { join } from "node:path";

import { getGrindHome } from "@grindxp/core";

export interface WhatsAppWebListenerOptions {
  gatewayUrl: string;
  token: string;
}

export interface WhatsAppWebListener {
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

  const child = Bun.spawn(["node", runnerPath, payload], {
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });

  return {
    stop: async () => {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
      }
      await child.exited;
    },
  };
}
