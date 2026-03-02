import type { InboundMedia } from "@grindxp/core";

import type { ChannelAdapter, ToolOutputBlock } from "./channel-adapter";

const DISCORD_MAX_MESSAGE_CHARS = 2000;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const DISCORD_API = "https://discord.com/api/v10";

export interface DiscordAdapterOptions {
  botToken: string;
}

export function createDiscordAdapter(options: DiscordAdapterOptions): ChannelAdapter {
  return {
    channel: "discord",

    async sendText(chatId, text) {
      const chunks = splitDiscordMessage(text);
      for (const chunk of chunks) {
        await callDiscordApi(options.botToken, `channels/${chatId}/messages`, {
          content: chunk,
        });
      }
    },

    async sendPermissionPrompt(opts) {
      const result = await callDiscordApi(options.botToken, `channels/${opts.chatId}/messages`, {
        content: opts.text,
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 1,
                label: "Allow once",
                custom_id: `grindperm:${opts.permissionId}:once`,
              },
              {
                type: 2,
                style: 1,
                label: "Always allow",
                custom_id: `grindperm:${opts.permissionId}:always`,
              },
              {
                type: 2,
                style: 4,
                label: "Deny",
                custom_id: `grindperm:${opts.permissionId}:deny`,
              },
            ],
          },
        ],
      });

      return typeof result?.id === "string" ? result.id : undefined;
    },

    async answerPermissionCallback(_opts) {
      // Discord interactions are handled separately; no-op here
    },

    async editPermissionMessage(opts) {
      await callDiscordApi(
        options.botToken,
        `channels/${opts.chatId}/messages/${opts.messageId}`,
        { content: opts.text, components: [] },
        "PATCH",
      );
    },

    async fetchAttachment(media) {
      if (media.url) {
        return fetchUrlAsBase64(media.url, media.mime);
      }
      return null;
    },

    formatReply(markdown) {
      const chunks = splitDiscordMessage(markdown);
      return { text: markdown, chunks };
    },

    async sendToolOutput(chatId, block) {
      const lang = block.language ?? "";
      const header = `**${block.title}**`;
      const body =
        block.content.length > 1800 ? `${block.content.slice(0, 1800)}...` : block.content;
      const text = `${header}\n\`\`\`${lang}\n${body}\n\`\`\``;
      const chunks = splitDiscordMessage(text);
      for (const chunk of chunks) {
        await callDiscordApi(options.botToken, `channels/${chatId}/messages`, {
          content: chunk,
        });
      }
    },
  };
}

async function callDiscordApi(
  botToken: string,
  endpoint: string,
  payload: Record<string, unknown>,
  method = "POST",
): Promise<Record<string, unknown> | null> {
  const response = await fetch(`${DISCORD_API}/${endpoint}`, {
    method,
    headers: {
      authorization: `Bot ${botToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Discord API ${endpoint} failed: ${response.status} ${raw}`);
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function fetchUrlAsBase64(
  url: string,
  hintMime?: string,
): Promise<{ base64: string; mime: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_ATTACHMENT_BYTES) return null;
    const mime = hintMime ?? res.headers.get("content-type")?.split(";")[0]?.trim() ?? "image/jpeg";
    return { base64: Buffer.from(buf).toString("base64"), mime };
  } catch {
    return null;
  }
}

function splitDiscordMessage(text: string): string[] {
  if (text.length <= DISCORD_MAX_MESSAGE_CHARS) return [text];

  const chunks: string[] = [];
  let remaining = text;
  const minChunk = Math.floor(DISCORD_MAX_MESSAGE_CHARS * 0.5);

  while (remaining.length > DISCORD_MAX_MESSAGE_CHARS) {
    const window = remaining.slice(0, DISCORD_MAX_MESSAGE_CHARS);
    const paraBreak = window.lastIndexOf("\n\n");
    if (paraBreak >= minChunk) {
      chunks.push(remaining.slice(0, paraBreak).trimEnd());
      remaining = remaining.slice(paraBreak + 2).trimStart();
      continue;
    }
    const lineBreak = window.lastIndexOf("\n");
    if (lineBreak >= minChunk) {
      chunks.push(remaining.slice(0, lineBreak).trimEnd());
      remaining = remaining.slice(lineBreak + 1).trimStart();
      continue;
    }
    chunks.push(window);
    remaining = remaining.slice(DISCORD_MAX_MESSAGE_CHARS);
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}
