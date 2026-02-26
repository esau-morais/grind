import * as path from "node:path";

import {
  appendMessage,
  createConversation,
  getToolPermissions,
  getCompanionByUserId,
  getConversationMessages,
  getTimerPath,
  getUserById,
  grantToolPermission,
  listCompanionInsights,
  listConversations,
  listQuestsByUser,
  markdownToTelegramHtml,
  readGrindConfig,
  readTimer,
  resolveModel,
  runAgent,
  storedToModelMessages,
  writeGrindConfig,
  type ForgeTickResult,
  type GatewayConfig,
  type GrindConfig,
  type NormalizedGatewayEvent,
  type VaultDb,
} from "@grindxp/core";

const TELEGRAM_CONVERSATION_PREFIX = "Telegram:";
const TELEGRAM_MAX_MESSAGE_CHARS = 4096;
const TELEGRAM_PERMISSION_TIMEOUT_MS = 2 * 60_000;

type PermissionReply = "once" | "always" | "deny";

interface PendingTelegramPermission {
  id: string;
  chatId: string;
  senderId: string | null;
  toolName: string;
  resolve: (reply: PermissionReply) => void;
  timeout: ReturnType<typeof setTimeout>;
  promptMessageId?: number;
}

interface TelegramToolOutput {
  title: string;
  content: string;
  language?: string;
}

interface TelegramChatResponderOptions {
  db: VaultDb;
  userId: string;
  config: GrindConfig;
  gateway: GatewayConfig;
  onWarn?: (message: string) => void;
}

export interface TelegramChatResponder {
  handle: (event: { normalized: NormalizedGatewayEvent; tick: ForgeTickResult }) => Promise<void>;
}

export async function createTelegramChatResponder(
  options: TelegramChatResponderOptions,
): Promise<TelegramChatResponder | null> {
  if (!options.config.ai) {
    options.onWarn?.("AI config is missing; Telegram chat responder disabled.");
    return null;
  }

  const token = options.gateway.telegramBotToken ?? process.env.GRIND_TELEGRAM_BOT_TOKEN ?? null;
  if (!token) {
    return null;
  }

  const model = await resolveModel(options.config.ai);
  const provider = options.config.ai.provider;
  const botSenderId = await getTelegramBotSenderId(token, options.onWarn);
  let trustedChatId = options.config.gateway?.telegramDefaultChatId ?? null;
  const alwaysAllowedTools = new Set(await getToolPermissions(options.db, options.userId));
  const pendingPermissions = new Map<string, PendingTelegramPermission>();

  const conversationByChatId = new Map<string, string>();
  const pendingByChatId = new Map<string, Promise<void>>();
  const seenUpdateIds = new Map<number, number>();

  return {
    handle: async (event) => {
      if (isTelegramPermissionCallback(event.normalized)) {
        await handlePermissionCallback({
          db: options.db,
          userId: options.userId,
          token,
          pendingPermissions,
          alwaysAllowedTools,
          normalized: event.normalized,
          ...(options.onWarn ? { onWarn: options.onWarn } : {}),
        });
        return;
      }

      const queueKey = extractChatId(event.normalized);
      if (!queueKey) return;

      const chain = pendingByChatId.get(queueKey) ?? Promise.resolve();
      const next = chain
        .catch(() => {})
        .then(async () => {
          await handleTelegramEvent({
            ...options,
            token,
            model,
            conversationByChatId,
            seenUpdateIds,
            event,
            trustedChatId,
            setTrustedChatId: (chatId) => {
              trustedChatId = chatId;
            },
            alwaysAllowedTools,
            pendingPermissions,
            ...(botSenderId ? { botSenderId } : {}),
            ...(provider ? { provider } : {}),
          });
        });

      pendingByChatId.set(queueKey, next);
      await next;
    },
  };
}

async function handleTelegramEvent(options: {
  db: VaultDb;
  userId: string;
  config: GrindConfig;
  token: string;
  model: Awaited<ReturnType<typeof resolveModel>>;
  provider?: string;
  onWarn?: (message: string) => void;
  conversationByChatId: Map<string, string>;
  seenUpdateIds: Map<number, number>;
  event: { normalized: NormalizedGatewayEvent; tick: ForgeTickResult };
  trustedChatId: string | null;
  setTrustedChatId: (chatId: string) => void;
  botSenderId?: string;
  alwaysAllowedTools: Set<string>;
  pendingPermissions: Map<string, PendingTelegramPermission>;
}): Promise<void> {
  const payload = options.event.normalized.forgeEvent.payload;
  const eventName = asString(payload.eventName);
  const channel = asString(payload.channel);
  if (channel !== "telegram" || eventName !== "message.received") {
    return;
  }

  const updateId = asNumber(payload.updateId);
  if (updateId !== null) {
    if (options.seenUpdateIds.has(updateId)) {
      return;
    }
    options.seenUpdateIds.set(updateId, Date.now());
    pruneSeenUpdates(options.seenUpdateIds);
  }

  const chatId = asString(payload.chatId);
  const senderId = asString(payload.senderId);
  const text = asString(payload.text);
  if (!chatId || !text) {
    return;
  }

  if (options.botSenderId && senderId === options.botSenderId) {
    return;
  }

  if (!ensureTrustedTelegramChat(options, chatId)) {
    await sendTelegramText(
      options.token,
      chatId,
      "This bot is locked to another chat. Use the configured owner chat, or update telegramDefaultChatId in GRIND config.",
    );
    return;
  }

  const conversationId = await resolveTelegramConversationId({
    db: options.db,
    userId: options.userId,
    chatId,
    cache: options.conversationByChatId,
  });

  await appendMessage(options.db, conversationId, {
    role: "user",
    content: text,
  });

  const [storedMessages, user, quests, companion, companionInsights] = await Promise.all([
    getConversationMessages(options.db, conversationId, 100),
    getUserById(options.db, options.userId),
    listQuestsByUser(options.db, options.userId),
    getCompanionByUserId(options.db, options.userId),
    listCompanionInsights(options.db, options.userId, 20),
  ]);

  if (!user) {
    await sendTelegramText(options.token, chatId, "User not found in GRIND vault.");
    return;
  }

  const timer = readTimer(getTimerPath());
  const modelMessages = storedToModelMessages(storedMessages);
  let assistantText = "";
  const toolOutputBlocks: TelegramToolOutput[] = [];

  const toolCtx = {
    db: options.db,
    userId: options.userId,
    timerPath: getTimerPath(),
    config: options.config,
    trustLevel: companion?.trustLevel ?? 0,
    requestPermission: async (toolName: string, detail: string) => {
      if (options.alwaysAllowedTools.has(toolName)) {
        return "once";
      }

      return requestTelegramPermission({
        token: options.token,
        chatId,
        senderId,
        toolName,
        detail,
        pendingPermissions: options.pendingPermissions,
      });
    },
  } as const;

  const promptCtx = {
    user,
    quests,
    timer,
    channelContext:
      "Channel: Telegram DM. Respond as a full GRIND chat. Tool permissions are requested via Telegram inline buttons; proceed autonomously when granted.",
    companionInsights,
    timezone: user.preferences.timezone,
    ...(companion ? { companion } : {}),
  } as const;

  try {
    const stream = runAgent({
      model: options.model,
      toolCtx,
      promptCtx,
      messages: modelMessages,
      ...(options.provider ? { provider: options.provider } : {}),
    });

    for await (const part of stream) {
      if (part.type === "text-delta" && part.text) {
        assistantText += part.text;
      } else if (part.type === "tool-result") {
        const block = formatTelegramToolOutput(part.toolName ?? "tool", part.toolResult);
        if (block) {
          toolOutputBlocks.push(block);
        }
      } else if (part.type === "error") {
        options.onWarn?.(`Telegram stream error: ${part.error}`);
        assistantText = "I hit an error while generating a reply. Try again in a moment.";
      }
    }
  } catch (error) {
    options.onWarn?.(
      `Telegram responder model error: ${error instanceof Error ? error.message : String(error)}`,
    );
    assistantText = "I hit an error while generating a reply. Try again in a moment.";
  }

  const finalText = assistantText.trim() || "Got it.";

  await appendMessage(options.db, conversationId, {
    role: "assistant",
    content: finalText,
  });

  const htmlText = markdownToTelegramHtml(finalText);
  for (const chunk of splitTelegramMessage(htmlText)) {
    await sendTelegramText(options.token, chatId, chunk, { parseMode: "HTML" });
  }

  for (const block of toolOutputBlocks) {
    await sendTelegramCodeBlock(options.token, chatId, block.title, block.content, block.language);
  }
}

function isTelegramPermissionCallback(normalized: NormalizedGatewayEvent): boolean {
  const payload = normalized.forgeEvent.payload;
  const eventName = asString(payload.eventName);
  const callbackData = asString(payload.callbackData);
  return eventName === "callback.received" && Boolean(callbackData?.startsWith("grindperm:"));
}

async function handlePermissionCallback(options: {
  db: VaultDb;
  userId: string;
  token: string;
  pendingPermissions: Map<string, PendingTelegramPermission>;
  alwaysAllowedTools: Set<string>;
  normalized: NormalizedGatewayEvent;
  onWarn?: (message: string) => void;
}): Promise<void> {
  const payload = options.normalized.forgeEvent.payload;
  const callbackData = asString(payload.callbackData);
  const callbackQueryId = asString(payload.callbackQueryId);
  const chatId = asString(payload.chatId);
  const senderId = asString(payload.senderId);
  if (!callbackData || !callbackQueryId) {
    return;
  }

  const parsed = parsePermissionCallbackData(callbackData);
  if (!parsed) {
    await answerTelegramCallback(options.token, callbackQueryId, "Unknown action.");
    return;
  }

  const pending = options.pendingPermissions.get(parsed.permissionId);
  if (!pending) {
    await answerTelegramCallback(options.token, callbackQueryId, "Permission request expired.");
    return;
  }

  if (
    pending.chatId !== chatId ||
    (pending.senderId && senderId && pending.senderId !== senderId)
  ) {
    await answerTelegramCallback(
      options.token,
      callbackQueryId,
      "Permission request belongs to another user/chat.",
    );
    return;
  }

  clearTimeout(pending.timeout);
  options.pendingPermissions.delete(parsed.permissionId);

  if (parsed.reply === "always") {
    options.alwaysAllowedTools.add(pending.toolName);
    await grantToolPermission(options.db, options.userId, pending.toolName);
  }

  await answerTelegramCallback(
    options.token,
    callbackQueryId,
    parsed.reply === "deny"
      ? "Denied"
      : parsed.reply === "always"
        ? "Allowed always"
        : "Allowed once",
  );

  if (pending.promptMessageId !== undefined) {
    try {
      await editTelegramMessage(options.token, pending.chatId, pending.promptMessageId, {
        text: `Permission ${parsed.reply === "deny" ? "denied" : "granted"} for ${pending.toolName}.`,
        clearInlineKeyboard: true,
      });
    } catch (error) {
      options.onWarn?.(
        `Failed to update Telegram permission message: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  pending.resolve(parsed.reply);
}

async function requestTelegramPermission(options: {
  token: string;
  chatId: string;
  senderId: string | null;
  toolName: string;
  detail: string;
  pendingPermissions: Map<string, PendingTelegramPermission>;
}): Promise<PermissionReply> {
  const permissionId = crypto.randomUUID();
  const promptText = [
    `Tool permission needed: ${options.toolName}`,
    options.detail.length > 240 ? `${options.detail.slice(0, 240)}...` : options.detail,
    "",
    "Allow this action?",
  ].join("\n");

  const messageId = await sendTelegramPermissionPrompt({
    token: options.token,
    chatId: options.chatId,
    permissionId,
    text: promptText,
  });

  return await new Promise<PermissionReply>((resolve) => {
    const timeout = setTimeout(async () => {
      options.pendingPermissions.delete(permissionId);
      try {
        if (messageId !== undefined) {
          await editTelegramMessage(options.token, options.chatId, messageId, {
            text: `Permission request timed out for ${options.toolName}.`,
            clearInlineKeyboard: true,
          });
        }
      } catch {
        // best effort
      }
      resolve("deny");
    }, TELEGRAM_PERMISSION_TIMEOUT_MS);

    options.pendingPermissions.set(permissionId, {
      id: permissionId,
      chatId: options.chatId,
      senderId: options.senderId,
      toolName: options.toolName,
      resolve,
      timeout,
      ...(messageId !== undefined ? { promptMessageId: messageId } : {}),
    });
  });
}

function parsePermissionCallbackData(
  data: string,
): { permissionId: string; reply: PermissionReply } | null {
  const parts = data.split(":");
  if (parts.length !== 3) return null;
  if (parts[0] !== "grindperm") return null;
  const permissionId = parts[1];
  const rawReply = parts[2];
  if (!permissionId) return null;
  if (rawReply !== "once" && rawReply !== "always" && rawReply !== "deny") return null;
  return { permissionId, reply: rawReply };
}

function ensureTrustedTelegramChat(
  options: {
    config: GrindConfig;
    trustedChatId: string | null;
    setTrustedChatId: (chatId: string) => void;
    onWarn?: (message: string) => void;
  },
  chatId: string,
): boolean {
  if (!options.trustedChatId) {
    // Re-read from disk before writing to avoid overwriting changes made by other processes
    // (e.g., CLI commands, agent tools) since the gateway's config snapshot was created.
    const onDisk = readGrindConfig() ?? options.config;
    const gatewayBase = onDisk.gateway ?? options.config.gateway;
    if (!gatewayBase) {
      return false;
    }

    writeGrindConfig({ ...onDisk, gateway: { ...gatewayBase, telegramDefaultChatId: chatId } });
    options.setTrustedChatId(chatId);
    options.onWarn?.(`Auto-set telegramDefaultChatId to ${chatId}.`);
    return true;
  }

  return options.trustedChatId === chatId;
}

async function getTelegramBotSenderId(
  token: string,
  onWarn?: (message: string) => void,
): Promise<string | null> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      method: "GET",
    });
    if (!response.ok) {
      onWarn?.(`Telegram getMe failed (${response.status}).`);
      return null;
    }

    const parsed = (await response.json()) as {
      ok?: boolean;
      result?: { id?: number | string };
    };
    if (!parsed.ok || !parsed.result || parsed.result.id === undefined) {
      return null;
    }

    return String(parsed.result.id);
  } catch (error) {
    onWarn?.(`Telegram getMe error: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function resolveTelegramConversationId(options: {
  db: VaultDb;
  userId: string;
  chatId: string;
  cache: Map<string, string>;
}): Promise<string> {
  const cached = options.cache.get(options.chatId);
  if (cached) {
    return cached;
  }

  const expectedTitle = `${TELEGRAM_CONVERSATION_PREFIX}${options.chatId}`;
  const conversations = await listConversations(options.db, options.userId, 200);
  const existing = conversations.find((conversation) => conversation.title === expectedTitle);
  if (existing) {
    options.cache.set(options.chatId, existing.id);
    return existing.id;
  }

  const created = await createConversation(options.db, options.userId, expectedTitle);
  options.cache.set(options.chatId, created.id);
  return created.id;
}

async function sendTelegramText(
  token: string,
  chatId: string,
  text: string,
  options?: { parseMode?: "HTML" | "MarkdownV2" },
): Promise<void> {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text,
  };
  if (options?.parseMode) {
    payload.parse_mode = options.parseMode;
  }

  await callTelegramApi(token, "sendMessage", payload);
}

async function sendTelegramPermissionPrompt(options: {
  token: string;
  chatId: string;
  permissionId: string;
  text: string;
}): Promise<number | undefined> {
  const payload = {
    chat_id: options.chatId,
    text: options.text,
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Allow once", callback_data: `grindperm:${options.permissionId}:once` },
          { text: "Always allow", callback_data: `grindperm:${options.permissionId}:always` },
        ],
        [{ text: "Deny", callback_data: `grindperm:${options.permissionId}:deny` }],
      ],
    },
  };

  const result = await callTelegramApi(options.token, "sendMessage", payload);
  const messageId = result?.message_id;
  return typeof messageId === "number" ? messageId : undefined;
}

async function answerTelegramCallback(
  token: string,
  callbackQueryId: string,
  text: string,
): Promise<void> {
  await callTelegramApi(token, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
    show_alert: false,
  });
}

async function editTelegramMessage(
  token: string,
  chatId: string,
  messageId: number,
  options: { text: string; clearInlineKeyboard?: boolean },
): Promise<void> {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text: options.text,
  };
  if (options.clearInlineKeyboard) {
    payload.reply_markup = { inline_keyboard: [] };
  }

  await callTelegramApi(token, "editMessageText", payload);
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

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  if (record.ok !== true) {
    throw new Error(`telegram ${method} returned non-ok payload`);
  }

  const result = record.result;
  return result && typeof result === "object" ? (result as Record<string, unknown>) : null;
}

function extractChatId(normalized: NormalizedGatewayEvent): string | null {
  return asString(normalized.forgeEvent.payload.chatId);
}

function splitTelegramMessage(text: string): string[] {
  if (text.length <= TELEGRAM_MAX_MESSAGE_CHARS) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;
  const minChunk = Math.floor(TELEGRAM_MAX_MESSAGE_CHARS * 0.5);

  while (remaining.length > TELEGRAM_MAX_MESSAGE_CHARS) {
    const window = remaining.slice(0, TELEGRAM_MAX_MESSAGE_CHARS);

    // Prefer paragraph boundary in the back half of the window
    const paraBreak = window.lastIndexOf("\n\n");
    if (paraBreak >= minChunk) {
      chunks.push(remaining.slice(0, paraBreak).trimEnd());
      remaining = remaining.slice(paraBreak + 2).trimStart();
      continue;
    }

    // Fall back to line boundary
    const lineBreak = window.lastIndexOf("\n");
    if (lineBreak >= minChunk) {
      chunks.push(remaining.slice(0, lineBreak).trimEnd());
      remaining = remaining.slice(lineBreak + 1).trimStart();
      continue;
    }

    // Last resort: hard cut
    chunks.push(window);
    remaining = remaining.slice(TELEGRAM_MAX_MESSAGE_CHARS);
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }
  return chunks;
}

function formatTelegramToolOutput(toolName: string, result: unknown): TelegramToolOutput | null {
  if (!result || typeof result !== "object") {
    return null;
  }

  const obj = result as Record<string, unknown>;
  if (typeof obj.error === "string" && obj.error.length > 0) {
    return { title: toolName, content: obj.error };
  }

  if (toolName === "read_file") {
    if (obj.type === "file" && typeof obj.content === "string" && obj.content.trim().length > 0) {
      const pathLabel = typeof obj.path === "string" ? obj.path : "file";
      const showing = typeof obj.showing === "string" ? obj.showing : "lines";
      const language = inferCodeLanguageFromPath(pathLabel) ?? undefined;
      return {
        title: `read_file ${pathLabel} ${showing}`,
        content: stripReadFileLineNumbers(obj.content),
        ...(language ? { language } : {}),
      };
    }
    if (obj.type === "directory" && Array.isArray(obj.entries) && obj.entries.length > 0) {
      const pathLabel = typeof obj.path === "string" ? obj.path : "directory";
      const listing = (obj.entries as unknown[])
        .map((entry) => (typeof entry === "string" ? entry : null))
        .filter((entry): entry is string => entry !== null)
        .join("\n");
      return { title: `read_file directory ${pathLabel}`, content: listing };
    }
  }

  if (toolName === "glob" && Array.isArray(obj.files) && obj.files.length > 0) {
    const pattern = typeof obj.pattern === "string" ? obj.pattern : "*";
    const files = (obj.files as unknown[])
      .map((entry) => (typeof entry === "string" ? entry : null))
      .filter((entry): entry is string => entry !== null)
      .join("\n");
    return { title: `glob ${pattern}`, content: files };
  }

  if (toolName === "grep" && Array.isArray(obj.matches) && obj.matches.length > 0) {
    const lines: string[] = [];
    for (const match of obj.matches as unknown[]) {
      if (!match || typeof match !== "object") continue;
      const item = match as Record<string, unknown>;
      const file = typeof item.file === "string" ? item.file : "unknown";
      const line = typeof item.line === "number" ? item.line : 0;
      const text = typeof item.text === "string" ? item.text : "";
      lines.push(`${file}:${line}: ${text}`);
    }
    if (lines.length > 0) {
      return { title: "grep matches", content: lines.join("\n"), language: "text" };
    }
  }

  if (toolName === "bash") {
    const stdout = typeof obj.stdout === "string" ? obj.stdout.trim() : "";
    const stderr = typeof obj.stderr === "string" ? obj.stderr.trim() : "";
    const combined = [stdout, stderr ? `[stderr]\n${stderr}` : ""].filter(Boolean).join("\n");
    if (combined.length > 0) {
      return { title: "bash output", content: combined, language: "bash" };
    }
  }

  return null;
}

function stripReadFileLineNumbers(content: string): string {
  return content
    .split("\n")
    .map((line) => line.replace(/^\d+:\s/, ""))
    .join("\n");
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
    await sendTelegramText(token, chatId, message, { parseMode: "HTML" });
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

  if (current.length > 0) {
    chunks.push(current);
  }

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
    ".zsh": "bash",
    ".rb": "ruby",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".hpp": "cpp",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".toml": "toml",
    ".sql": "sql",
    ".html": "html",
    ".css": "css",
    ".scss": "scss",
    ".xml": "xml",
    ".txt": "text",
    ".log": "text",
    ".csv": "csv",
  };
  return map[ext] ?? null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  return null;
}

function pruneSeenUpdates(map: Map<number, number>): void {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [updateId, timestamp] of map.entries()) {
    if (timestamp < cutoff) {
      map.delete(updateId);
    }
  }
}
