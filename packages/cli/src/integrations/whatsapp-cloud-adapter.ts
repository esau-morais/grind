import type { InboundMedia } from "@grindxp/core";

import type { ChannelAdapter, ToolOutputBlock } from "./channel-adapter";

const WHATSAPP_MAX_MESSAGE_CHARS = 4096;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export interface WhatsAppCloudAdapterOptions {
  phoneNumberId: string;
  accessToken: string;
}

export function createWhatsAppCloudAdapter(options: WhatsAppCloudAdapterOptions): ChannelAdapter {
  const graphUrl = "https://graph.facebook.com/v21.0";

  return {
    channel: "whatsapp",

    async sendText(chatId, text) {
      const chunks = splitWhatsAppMessage(text);
      for (const chunk of chunks) {
        await callWhatsAppApi(options, graphUrl, {
          messaging_product: "whatsapp",
          to: chatId,
          type: "text",
          text: { body: chunk },
        });
      }
    },

    async sendPermissionPrompt(opts) {
      const buttons = [
        {
          type: "reply",
          reply: { id: `grindperm:${opts.permissionId}:once`, title: "Allow once" },
        },
        { type: "reply", reply: { id: `grindperm:${opts.permissionId}:always`, title: "Always" } },
        { type: "reply", reply: { id: `grindperm:${opts.permissionId}:deny`, title: "Deny" } },
      ];

      const result = await callWhatsAppApi(options, graphUrl, {
        messaging_product: "whatsapp",
        to: opts.chatId,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: opts.text },
          action: { buttons },
        },
      });

      const messageId =
        result && typeof result === "object" && "messages" in result
          ? ((result as Record<string, unknown>).messages as Array<{ id?: string }>)?.[0]?.id
          : undefined;
      return messageId;
    },

    async answerPermissionCallback(_opts) {
      // WhatsApp doesn't have a callback answer mechanism like Telegram
    },

    async editPermissionMessage(opts) {
      // WhatsApp doesn't support message editing — send a follow-up instead
      await callWhatsAppApi(options, graphUrl, {
        messaging_product: "whatsapp",
        to: opts.chatId,
        type: "text",
        text: { body: opts.text },
      });
    },

    async fetchAttachment(media) {
      if (!media.fileId) return null;
      return fetchWhatsAppMediaAsBase64(options.accessToken, graphUrl, media.fileId, media.mime);
    },

    formatReply(markdown) {
      const chunks = splitWhatsAppMessage(markdown);
      return { text: markdown, chunks };
    },

    async sendToolOutput(chatId, block) {
      const header = `*${block.title}*`;
      const body =
        block.content.length > 3500 ? `${block.content.slice(0, 3500)}...` : block.content;
      const text = `${header}\n\`\`\`\n${body}\n\`\`\``;
      const chunks = splitWhatsAppMessage(text);
      for (const chunk of chunks) {
        await callWhatsAppApi(options, graphUrl, {
          messaging_product: "whatsapp",
          to: chatId,
          type: "text",
          text: { body: chunk },
        });
      }
    },
  };
}

async function callWhatsAppApi(
  options: WhatsAppCloudAdapterOptions,
  graphUrl: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(`${graphUrl}/${options.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`WhatsApp Cloud API failed: ${response.status} ${raw}`);
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function fetchWhatsAppMediaAsBase64(
  accessToken: string,
  graphUrl: string,
  mediaId: string,
  hintMime?: string,
): Promise<{ base64: string; mime: string } | null> {
  try {
    const metaRes = await fetch(`${graphUrl}/${mediaId}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!metaRes.ok) return null;

    const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
    const downloadUrl = meta.url;
    if (!downloadUrl) return null;

    const fileRes = await fetch(downloadUrl, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!fileRes.ok) return null;

    const buf = await fileRes.arrayBuffer();
    if (buf.byteLength > MAX_ATTACHMENT_BYTES) return null;

    const mime =
      meta.mime_type ??
      hintMime ??
      fileRes.headers.get("content-type")?.split(";")[0]?.trim() ??
      "image/jpeg";
    return { base64: Buffer.from(buf).toString("base64"), mime };
  } catch {
    return null;
  }
}

function splitWhatsAppMessage(text: string): string[] {
  if (text.length <= WHATSAPP_MAX_MESSAGE_CHARS) return [text];

  const chunks: string[] = [];
  let remaining = text;
  const minChunk = Math.floor(WHATSAPP_MAX_MESSAGE_CHARS * 0.5);

  while (remaining.length > WHATSAPP_MAX_MESSAGE_CHARS) {
    const window = remaining.slice(0, WHATSAPP_MAX_MESSAGE_CHARS);
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
    remaining = remaining.slice(WHATSAPP_MAX_MESSAGE_CHARS);
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}
