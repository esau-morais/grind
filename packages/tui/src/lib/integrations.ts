import { getOAuthToken, GOOGLE_OAUTH_KEY } from "@grindxp/core";
import type { GrindConfig } from "@grindxp/core";

export function buildIntegrationSummary(config: GrindConfig): string {
  const lines: string[] = [];

  const googleConfig = config.services?.google;
  const googleToken = getOAuthToken(GOOGLE_OAUTH_KEY);
  const googleConnected = Boolean(googleToken);
  if (googleConnected && googleConfig) {
    const parts: string[] = [`Google: connected (${googleConfig.email ?? "unknown email"})`];
    if (googleConfig.calendarEnabled) parts.push("Calendar ✓");
    if (googleConfig.gmailEnabled) parts.push("Gmail ✓");
    lines.push(parts.join(" · "));
  } else {
    lines.push("Google: not connected. Use `grindxp integrations connect google` to connect.");
  }

  const gateway = config.gateway;
  if (!gateway) {
    lines.push("Gateway (bot channels): not configured.");
  } else {
    lines.push(
      `Gateway: ${gateway.enabled ? "enabled" : "disabled"} at http://${gateway.host}:${gateway.port}/`,
    );
    const telegramConnected = Boolean(gateway.telegramBotToken);
    lines.push(`Telegram: ${telegramConnected ? "connected" : "not connected"}`);
    const discordConfigured = Boolean(gateway.discordPublicKey);
    lines.push(`Discord: ${discordConfigured ? "configured" : "not configured"}`);
    if (gateway.whatsAppMode === "qr-link") {
      const linked = gateway.whatsAppLinkedAt ? "linked" : "link pending";
      lines.push(`WhatsApp: qr-link ${linked}`);
    } else if (gateway.whatsAppMode === "cloud-api") {
      const cloudReady = Boolean(gateway.whatsAppAccessToken && gateway.whatsAppPhoneNumberId);
      lines.push(`WhatsApp: cloud-api ${cloudReady ? "configured" : "missing credentials"}`);
    } else {
      lines.push("WhatsApp: not configured");
    }
    lines.push("Inbound automations require the gateway process to be running.");
  }

  return lines.join("\n");
}
