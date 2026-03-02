import type { InboundMedia } from "@grindxp/core";

import type { ChannelAdapter, ToolOutputBlock } from "./channel-adapter";

const WHATSAPP_MAX_MESSAGE_CHARS = 4096;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export type WhatsAppWebSendFn = (
  jid: string,
  content: { text: string },
) => Promise<{ key?: { id?: string | undefined } } | null>;

export interface WhatsAppWebAdapterOptions {
  sendMessage: WhatsAppWebSendFn;
}

export function createWhatsAppWebAdapter(options: WhatsAppWebAdapterOptions): ChannelAdapter {
  const send = options.sendMessage;

  return {
    channel: "whatsapp-web",

    async sendText(chatId, text) {
      const chunks = splitMessage(text);
      for (const chunk of chunks) {
        await send(chatId, { text: chunk });
      }
    },

    async sendPermissionPrompt(opts) {
      const text = `${opts.text}\n\nReply with:\n• "allow" — allow once\n• "always" — always allow\n• "deny" — deny`;
      const result = await send(opts.chatId, { text });
      return result?.key?.id ?? undefined;
    },

    async answerPermissionCallback(_opts) {
      // Baileys doesn't have callback answer; no-op
    },

    async editPermissionMessage(opts) {
      await send(opts.chatId, { text: opts.text });
    },

    async fetchAttachment(media) {
      if (media.url) {
        return fetchUrlAsBase64(media.url, media.mime);
      }
      // Baileys media download would require the socket reference;
      // for now, media downloaded in the runner and forwarded as base64 is the intended path.
      return null;
    },

    formatReply(markdown) {
      const chunks = splitMessage(markdown);
      return { text: markdown, chunks };
    },

    async sendToolOutput(chatId, block) {
      const header = `*${block.title}*`;
      const body =
        block.content.length > 3500 ? `${block.content.slice(0, 3500)}...` : block.content;
      const text = `${header}\n\`\`\`${body}\`\`\``;
      const chunks = splitMessage(text);
      for (const chunk of chunks) {
        await send(chatId, { text: chunk });
      }
    },
  };
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

function splitMessage(text: string): string[] {
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
