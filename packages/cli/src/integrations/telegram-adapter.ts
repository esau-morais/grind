import * as path from "node:path";

import { markdownToTelegramHtml, type InboundMedia } from "@grindxp/core";

import type { ChannelAdapter, ToolOutputBlock } from "./channel-adapter";

const TELEGRAM_MAX_MESSAGE_CHARS = 4096;
const TELEGRAM_MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export interface TelegramAdapterOptions {
  token: string;
  botSenderId?: string;
  trustedChatId?: string | null;
}

export interface TelegramAdapter extends ChannelAdapter {
  readonly botSenderId: string | null;
}

export async function createTelegramAdapter(
  options: TelegramAdapterOptions,
): Promise<TelegramAdapter> {
  const botSenderId = options.botSenderId ?? (await getTelegramBotSenderId(options.token)) ?? null;

  const adapter: TelegramAdapter = {
    channel: "telegram",
    botSenderId,

    async sendText(chatId, text) {
      await sendTelegramText(options.token, chatId, text);
    },

    async sendPermissionPrompt(opts) {
      const payload = {
        chat_id: opts.chatId,
        text: opts.text,
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Allow once", callback_data: `grindperm:${opts.permissionId}:once` },
              { text: "Always allow", callback_data: `grindperm:${opts.permissionId}:always` },
            ],
            [{ text: "Deny", callback_data: `grindperm:${opts.permissionId}:deny` }],
          ],
        },
      };

      const result = await callTelegramApi(options.token, "sendMessage", payload);
      const messageId = result?.message_id;
      return typeof messageId === "number" ? String(messageId) : undefined;
    },

    async answerPermissionCallback(opts) {
      await callTelegramApi(options.token, "answerCallbackQuery", {
        callback_query_id: opts.callbackId,
        text: opts.text,
        show_alert: false,
      });
    },

    async editPermissionMessage(opts) {
      await callTelegramApi(options.token, "editMessageText", {
        chat_id: opts.chatId,
        message_id: Number(opts.messageId),
        text: opts.text,
        reply_markup: { inline_keyboard: [] },
      });
    },

    async fetchAttachment(media) {
      if (media.fileId) {
        return fetchTelegramFileAsBase64(options.token, media.fileId);
      }
      if (media.url) {
        return fetchUrlAsBase64(media.url, media.mime);
      }
      return null;
    },

    formatReply(markdown) {
      const htmlText = markdownToTelegramHtml(markdown);
      const chunks = splitTelegramMessage(htmlText);
      return {
        text: htmlText,
        chunks,
      };
    },

    async sendToolOutput(chatId, block) {
      await sendTelegramCodeBlock(
        options.token,
        chatId,
        block.title,
        block.content,
        block.language,
      );
    },
  };

  const originalSendText = adapter.sendText.bind(adapter);
  adapter.sendText = async (chatId: string, text: string) => {
    const htmlText = text;
    await callTelegramApi(options.token, "sendMessage", {
      chat_id: chatId,
      text: htmlText,
      parse_mode: "HTML",
    });
  };

  return adapter;
}

async function getTelegramBotSenderId(token: string): Promise<string | null> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, { method: "GET" });
    if (!response.ok) return null;
    const parsed = (await response.json()) as { ok?: boolean; result?: { id?: number | string } };
    if (!parsed.ok || !parsed.result || parsed.result.id === undefined) return null;
    return String(parsed.result.id);
  } catch {
    return null;
  }
}

async function sendTelegramText(token: string, chatId: string, text: string): Promise<void> {
  await callTelegramApi(token, "sendMessage", { chat_id: chatId, text });
}

async function callTelegramApi(
  token: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`telegram ${method} failed: ${response.status} ${raw}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  if (record.ok !== true) {
    throw new Error(`telegram ${method} returned non-ok payload`);
  }
  const result = record.result;
  return result && typeof result === "object" ? (result as Record<string, unknown>) : null;
}

async function fetchTelegramFileAsBase64(
  token: string,
  fileId: string,
): Promise<{ base64: string; mime: string } | null> {
  let fileInfo: Record<string, unknown> | null;
  try {
    fileInfo = await callTelegramApi(token, "getFile", { file_id: fileId });
  } catch {
    return null;
  }

  const filePath =
    fileInfo && typeof fileInfo["file_path"] === "string" ? fileInfo["file_path"] : null;
  if (!filePath) return null;

  let res: Response;
  try {
    res = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const buf = await res.arrayBuffer();
  if (buf.byteLength > TELEGRAM_MAX_ATTACHMENT_BYTES) return null;

  const mime = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
  return { base64: Buffer.from(buf).toString("base64"), mime };
}

async function fetchUrlAsBase64(
  url: string,
  mime?: string,
): Promise<{ base64: string; mime: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > TELEGRAM_MAX_ATTACHMENT_BYTES) return null;
    const resolvedMime =
      mime ?? res.headers.get("content-type")?.split(";")[0]?.trim() ?? "image/jpeg";
    return { base64: Buffer.from(buf).toString("base64"), mime: resolvedMime };
  } catch {
    return null;
  }
}

function splitTelegramMessage(text: string): string[] {
  if (text.length <= TELEGRAM_MAX_MESSAGE_CHARS) return [text];

  const chunks: string[] = [];
  let remaining = text;
  const minChunk = Math.floor(TELEGRAM_MAX_MESSAGE_CHARS * 0.5);

  while (remaining.length > TELEGRAM_MAX_MESSAGE_CHARS) {
    const window = remaining.slice(0, TELEGRAM_MAX_MESSAGE_CHARS);
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
    remaining = remaining.slice(TELEGRAM_MAX_MESSAGE_CHARS);
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

async function sendTelegramCodeBlock(
  token: string,
  chatId: string,
  title: string,
  content: string,
  language?: string,
): Promise<void> {
  const maxChunk = 3500;
  const chunks = splitContentByLines(content, maxChunk);
  const className = normalizeTelegramLanguage(language);
  const classAttr = className ? ` class="language-${className}"` : "";

  for (let i = 0; i < chunks.length; i += 1) {
    const suffix = chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : "";
    const message = `<b>${escapeTelegramHtml(title)}${suffix}</b>\n<pre><code${classAttr}>${escapeTelegramHtml(chunks[i] ?? "")}</code></pre>`;
    await callTelegramApi(token, "sendMessage", {
      chat_id: chatId,
      text: message,
      parse_mode: "HTML",
    });
  }
}

function splitContentByLines(content: string, maxChars: number): string[] {
  if (content.length <= maxChars) return [content];

  const lines = content.split("\n");
  const chunks: string[] = [];
  let current = "";

  for (const line of lines) {
    const candidate = current.length === 0 ? line : `${current}\n${line}`;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current.length > 0) {
      chunks.push(current);
      current = "";
    }
    if (line.length <= maxChars) {
      current = line;
      continue;
    }
    let remaining = line;
    while (remaining.length > maxChars) {
      chunks.push(remaining.slice(0, maxChars));
      remaining = remaining.slice(maxChars);
    }
    current = remaining;
  }

  if (current.length > 0) chunks.push(current);
  return chunks.length > 0 ? chunks : [""];
}

function escapeTelegramHtml(input: string): string {
  return input.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function normalizeTelegramLanguage(language: string | undefined): string | null {
  if (!language) return null;
  const normalized = language.trim().toLowerCase();
  if (!normalized) return null;
  if (!/^[a-z0-9_+#-]+$/.test(normalized)) return null;
  return normalized;
}

function inferCodeLanguageFromPath(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".json": "json",
    ".md": "markdown",
    ".py": "python",
    ".sh": "bash",
  };
  return map[ext] ?? null;
}
