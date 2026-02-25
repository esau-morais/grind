import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { getGrindHome } from "@grindxp/core";

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

export async function linkWhatsAppAccount(
  options: WhatsAppLinkOptions,
): Promise<WhatsAppLinkResult> {
  const authDir = ensureWhatsAppAuthDir();
  const timeoutMs = Math.max(options.timeoutMs ?? 180_000, 30_000);
  const runnerPath = join(import.meta.dir, "whatsapp-link-runner.mjs");

  const payload = JSON.stringify({
    authDir,
    timeoutMs,
    pairingMethod: options.pairingMethod,
    ...(options.pairingPhone ? { pairingPhone: options.pairingPhone } : {}),
  });

  options.onInfo?.("Launching Node WhatsApp linker...");

  const child = Bun.spawn(["node", runnerPath, payload], {
    stdin: "ignore",
    stdout: "inherit",
    stderr: "pipe",
  });

  const code = await child.exited;
  if (code === 0) {
    return { linkedAt: Date.now() };
  }

  const errorText = await new Response(child.stderr).text();
  const trimmed = errorText.trim();
  return {
    error: trimmed || "WhatsApp link did not complete.",
  };
}

function ensureWhatsAppAuthDir(): string {
  const authDir = join(getGrindHome(), "channels", "whatsapp", "auth");
  mkdirSync(authDir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(authDir, 0o700);
  } catch {
    // best effort
  }
  return authDir;
}
