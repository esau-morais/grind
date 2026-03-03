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
  readTimer,
  resolveModel,
  runAgent,
  storedToModelMessages,
  type ForgeTickResult,
  type GatewayConfig,
  type GrindConfig,
  type InboundMedia,
  type NormalizedGatewayEvent,
  type VaultDb,
} from "@grindxp/core";

import type { ChannelAdapter, PermissionReply, ToolOutputBlock } from "./channel-adapter";

const PERMISSION_TIMEOUT_MS = 2 * 60_000;

interface PendingPermission {
  id: string;
  chatId: string;
  senderId: string | null;
  toolName: string;
  resolve: (reply: PermissionReply) => void;
  timeout: ReturnType<typeof setTimeout>;
  promptMessageId?: string;
}

interface ChatResponderOptions {
  db: VaultDb;
  userId: string;
  config: GrindConfig;
  gateway: GatewayConfig;
  adapter: ChannelAdapter;
  onWarn?: (message: string) => void;
  onFirstContact?: (chatId: string) => void;
  onMessageAllowed?: (chatId: string) => void;
  allowedChatIds?: string[];
  allowedSenderIds?: string[];
}

export interface ChatResponder {
  handle: (event: { normalized: NormalizedGatewayEvent; tick: ForgeTickResult }) => Promise<void>;
}

export async function createChatResponder(
  options: ChatResponderOptions,
): Promise<ChatResponder | null> {
  if (!options.config.ai) {
    options.onWarn?.(`AI config is missing; ${options.adapter.channel} chat responder disabled.`);
    return null;
  }

  const model = await resolveModel(options.config.ai);
  const provider = options.config.ai.provider;

  const alwaysAllowedTools = new Set(await getToolPermissions(options.db, options.userId));
  const pendingPermissions = new Map<string, PendingPermission>();

  const conversationByChatId = new Map<string, string>();
  const pendingByChatId = new Map<string, Promise<void>>();
  const seenDedupeKeys = new Map<string, number>();
  const allowedChatIds = new Set(options.allowedChatIds ?? []);
  const allowedSenderIds = new Set(options.allowedSenderIds ?? []);

  function isAllowed(chatId: string, senderId: string | null): boolean {
    if (allowedChatIds.size > 0 && allowedChatIds.has(chatId)) return true;
    if (allowedSenderIds.size > 0 && senderId && allowedSenderIds.has(senderId)) return true;
    if (
      allowedChatIds.size === 0 &&
      allowedSenderIds.size === 0 &&
      options.onFirstContact !== undefined
    )
      return true;
    return false;
  }

  return {
    handle: async (event) => {
      if (isPermissionCallback(event.normalized)) {
        const callbackChatId = extractChatId(event.normalized);
        const callbackSenderId = extractSenderId(event.normalized);
        if (callbackChatId && !isAllowed(callbackChatId, callbackSenderId)) return;
        await handlePermissionCallback({
          db: options.db,
          userId: options.userId,
          adapter: options.adapter,
          pendingPermissions,
          alwaysAllowedTools,
          normalized: event.normalized,
          ...(options.onWarn ? { onWarn: options.onWarn } : {}),
        });
        return;
      }

      const queueKey = extractChatId(event.normalized);
      if (!queueKey) return;

      const senderId = extractSenderId(event.normalized);

      if (!isAllowed(queueKey, senderId)) return;

      if (allowedChatIds.size === 0 && allowedSenderIds.size === 0) {
        allowedChatIds.add(queueKey);
        options.onFirstContact?.(queueKey);
      }

      options.onMessageAllowed?.(queueKey);

      const chain = pendingByChatId.get(queueKey) ?? Promise.resolve();
      const next = chain
        .catch(() => {})
        .then(async () => {
          await handleInboundMessage({
            ...options,
            model,
            conversationByChatId,
            seenDedupeKeys,
            event,
            alwaysAllowedTools,
            pendingPermissions,
            ...(provider ? { provider } : {}),
          });
        });

      pendingByChatId.set(queueKey, next);
      await next;
    },
  };
}

async function handleInboundMessage(options: {
  db: VaultDb;
  userId: string;
  config: GrindConfig;
  adapter: ChannelAdapter;
  model: Awaited<ReturnType<typeof resolveModel>>;
  provider?: string;
  onWarn?: (message: string) => void;
  conversationByChatId: Map<string, string>;
  seenDedupeKeys: Map<string, number>;
  event: { normalized: NormalizedGatewayEvent; tick: ForgeTickResult };
  alwaysAllowedTools: Set<string>;
  pendingPermissions: Map<string, PendingPermission>;
}): Promise<void> {
  const payload = options.event.normalized.forgeEvent.payload;
  const eventName = asString(payload.eventName);
  if (eventName !== "message.received") return;

  const dedupeKey =
    asString(payload.dedupeKey) ?? asString(payload.updateId) ?? asString(payload.messageId);
  if (dedupeKey !== null) {
    if (options.seenDedupeKeys.has(dedupeKey)) return;
    options.seenDedupeKeys.set(dedupeKey, Date.now());
    pruneSeenKeys(options.seenDedupeKeys);
  }

  const chatId = asString(payload.chatId) ?? asString(payload.from);
  const senderId = asString(payload.senderId) ?? asString(payload.from);
  const text = asString(payload.text) ?? "";
  const inboundMedia = payload.inboundMedia as InboundMedia | undefined;
  if (!chatId || (!text && !inboundMedia)) return;

  const conversationId = await resolveConversationId({
    db: options.db,
    userId: options.userId,
    chatId,
    channel: options.adapter.channel,
    cache: options.conversationByChatId,
  });

  let attachment: { mime: string; base64: string } | undefined;
  if (inboundMedia) {
    if (inboundMedia.base64 && inboundMedia.mime) {
      attachment = { base64: inboundMedia.base64, mime: inboundMedia.mime };
    } else if (inboundMedia.fileId || inboundMedia.url) {
      const fetched = await options.adapter.fetchAttachment(inboundMedia);
      if (fetched) {
        attachment = fetched;
      } else {
        options.onWarn?.(
          `[${options.adapter.channel}] fetchAttachment returned null for media (url=${inboundMedia.url ?? ""} fileId=${inboundMedia.fileId ?? ""}). Image will not be sent to model.`,
        );
      }
    }
  }

  await appendMessage(options.db, conversationId, {
    role: "user",
    content: text,
    ...(attachment ? { attachments: [attachment] } : {}),
  });

  const [storedMessages, user, quests, companion, companionInsights] = await Promise.all([
    getConversationMessages(options.db, conversationId, 100),
    getUserById(options.db, options.userId),
    listQuestsByUser(options.db, options.userId),
    getCompanionByUserId(options.db, options.userId),
    listCompanionInsights(options.db, options.userId, 20),
  ]);

  if (!user) {
    await options.adapter.sendText(chatId, "User not found in GRIND vault.");
    return;
  }

  const timer = readTimer(getTimerPath());
  const modelMessages = storedToModelMessages(storedMessages);
  let assistantText = "";
  const toolOutputBlocks: ToolOutputBlock[] = [];

  const channelLabel = options.adapter.channel.replace(/-/g, " ");
  const toolCtx = {
    db: options.db,
    userId: options.userId,
    timerPath: getTimerPath(),
    config: options.config,
    trustLevel: companion?.trustLevel ?? 0,
    interactive: true as const,
    requestPermission: async (toolName: string, detail: string) => {
      if (options.alwaysAllowedTools.has(toolName)) {
        return "once" as const;
      }

      return requestPermission({
        adapter: options.adapter,
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
    channelContext: `Channel: ${channelLabel} DM. Respond as a full GRIND chat. Tool permissions are requested via inline buttons; proceed autonomously when granted.`,
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
        const block = formatToolOutput(part.toolName ?? "tool", part.toolResult);
        if (block) {
          toolOutputBlocks.push(block);
        }
      } else if (part.type === "error") {
        options.onWarn?.(`${options.adapter.channel} stream error: ${part.error}`);
        assistantText = "I hit an error while generating a reply. Try again in a moment.";
      }
    }
  } catch (error) {
    options.onWarn?.(
      `${options.adapter.channel} responder model error: ${error instanceof Error ? error.message : String(error)}`,
    );
    assistantText = "I hit an error while generating a reply. Try again in a moment.";
  }

  const finalText = assistantText.trim() || "Got it.";

  await appendMessage(options.db, conversationId, {
    role: "assistant",
    content: finalText,
  });

  const formatted = options.adapter.formatReply(finalText);
  for (const chunk of formatted.chunks) {
    await options.adapter.sendText(chatId, chunk);
  }

  if (options.adapter.sendToolOutput) {
    for (const block of toolOutputBlocks) {
      await options.adapter.sendToolOutput(chatId, block);
    }
  }
}

function isPermissionCallback(normalized: NormalizedGatewayEvent): boolean {
  const payload = normalized.forgeEvent.payload;
  const eventName = asString(payload.eventName);
  const callbackData = asString(payload.callbackData);
  return eventName === "callback.received" && Boolean(callbackData?.startsWith("grindperm:"));
}

async function handlePermissionCallback(options: {
  db: VaultDb;
  userId: string;
  adapter: ChannelAdapter;
  pendingPermissions: Map<string, PendingPermission>;
  alwaysAllowedTools: Set<string>;
  normalized: NormalizedGatewayEvent;
  onWarn?: (message: string) => void;
}): Promise<void> {
  const payload = options.normalized.forgeEvent.payload;
  const callbackData = asString(payload.callbackData);
  const callbackId = asString(payload.callbackQueryId) ?? asString(payload.callbackId);
  const chatId = asString(payload.chatId);
  const senderId = asString(payload.senderId);
  if (!callbackData) return;

  const parsed = parsePermissionCallbackData(callbackData);
  if (!parsed) {
    if (callbackId) {
      await options.adapter.answerPermissionCallback({ callbackId, text: "Unknown action." });
    }
    return;
  }

  const pending = options.pendingPermissions.get(parsed.permissionId);
  if (!pending) {
    if (callbackId) {
      await options.adapter.answerPermissionCallback({
        callbackId,
        text: "Permission request expired.",
      });
    }
    return;
  }

  if (
    pending.chatId !== chatId ||
    (pending.senderId && senderId && pending.senderId !== senderId)
  ) {
    if (callbackId) {
      await options.adapter.answerPermissionCallback({
        callbackId,
        text: "Permission request belongs to another user/chat.",
      });
    }
    return;
  }

  clearTimeout(pending.timeout);
  options.pendingPermissions.delete(parsed.permissionId);

  if (parsed.reply === "always") {
    options.alwaysAllowedTools.add(pending.toolName);
    await grantToolPermission(options.db, options.userId, pending.toolName);
  }

  if (callbackId) {
    await options.adapter.answerPermissionCallback({
      callbackId,
      text:
        parsed.reply === "deny"
          ? "Denied"
          : parsed.reply === "always"
            ? "Allowed always"
            : "Allowed once",
    });
  }

  if (pending.promptMessageId !== undefined) {
    try {
      await options.adapter.editPermissionMessage({
        chatId: pending.chatId,
        messageId: pending.promptMessageId,
        text: `Permission ${parsed.reply === "deny" ? "denied" : "granted"} for ${pending.toolName}.`,
      });
    } catch (error) {
      options.onWarn?.(
        `Failed to update permission message: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  pending.resolve(parsed.reply);
}

async function requestPermission(options: {
  adapter: ChannelAdapter;
  chatId: string;
  senderId: string | null;
  toolName: string;
  detail: string;
  pendingPermissions: Map<string, PendingPermission>;
}): Promise<PermissionReply> {
  const permissionId = crypto.randomUUID();
  const promptText = [
    `Tool permission needed: ${options.toolName}`,
    options.detail.length > 240 ? `${options.detail.slice(0, 240)}...` : options.detail,
    "",
    "Allow this action?",
  ].join("\n");

  const messageId = await options.adapter.sendPermissionPrompt({
    chatId: options.chatId,
    permissionId,
    text: promptText,
  });

  return await new Promise<PermissionReply>((resolve) => {
    const timeout = setTimeout(async () => {
      options.pendingPermissions.delete(permissionId);
      try {
        if (messageId !== undefined) {
          await options.adapter.editPermissionMessage({
            chatId: options.chatId,
            messageId,
            text: `Permission request timed out for ${options.toolName}.`,
          });
        }
      } catch {
        // best effort
      }
      resolve("deny");
    }, PERMISSION_TIMEOUT_MS);

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

async function resolveConversationId(options: {
  db: VaultDb;
  userId: string;
  chatId: string;
  channel: string;
  cache: Map<string, string>;
}): Promise<string> {
  const cacheKey = `${options.channel}:${options.chatId}`;
  const cached = options.cache.get(cacheKey);
  if (cached) return cached;

  const prefix = channelConversationPrefix(options.channel);
  const expectedTitle = `${prefix}${options.chatId}`;
  const conversations = await listConversations(options.db, options.userId, 200);
  const existing = conversations.find((c) => c.title === expectedTitle);
  if (existing) {
    options.cache.set(cacheKey, existing.id);
    return existing.id;
  }

  const created = await createConversation(options.db, options.userId, expectedTitle);
  options.cache.set(cacheKey, created.id);
  return created.id;
}

function channelConversationPrefix(channel: string): string {
  switch (channel) {
    case "telegram":
      return "Telegram:";
    case "whatsapp":
    case "whatsapp-cloud":
      return "WhatsApp:";
    case "whatsapp-web":
      return "WhatsApp:";
    case "discord":
      return "Discord:";
    default:
      return `${channel}:`;
  }
}

function formatToolOutput(toolName: string, result: unknown): ToolOutputBlock | null {
  if (!result || typeof result !== "object") return null;

  const obj = result as Record<string, unknown>;
  if (typeof obj.error === "string" && obj.error.length > 0) {
    return { title: toolName, content: obj.error };
  }

  if (toolName === "read_file") {
    if (obj.type === "file" && typeof obj.content === "string" && obj.content.trim().length > 0) {
      const pathLabel = typeof obj.path === "string" ? obj.path : "file";
      const showing = typeof obj.showing === "string" ? obj.showing : "lines";
      const content = obj.content
        .split("\n")
        .map((line: string) => line.replace(/^\d+:\s/, ""))
        .join("\n");
      return { title: `read_file ${pathLabel} ${showing}`, content };
    }
    if (obj.type === "directory" && Array.isArray(obj.entries) && obj.entries.length > 0) {
      const pathLabel = typeof obj.path === "string" ? obj.path : "directory";
      const listing = (obj.entries as unknown[])
        .map((e) => (typeof e === "string" ? e : null))
        .filter((e): e is string => e !== null)
        .join("\n");
      return { title: `read_file directory ${pathLabel}`, content: listing };
    }
  }

  if (toolName === "glob" && Array.isArray(obj.files) && obj.files.length > 0) {
    const pattern = typeof obj.pattern === "string" ? obj.pattern : "*";
    const files = (obj.files as unknown[])
      .map((e) => (typeof e === "string" ? e : null))
      .filter((e): e is string => e !== null)
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
    if (lines.length > 0)
      return { title: "grep matches", content: lines.join("\n"), language: "text" };
  }

  if (toolName === "bash") {
    const stdout = typeof obj.stdout === "string" ? obj.stdout.trim() : "";
    const stderr = typeof obj.stderr === "string" ? obj.stderr.trim() : "";
    const combined = [stdout, stderr ? `[stderr]\n${stderr}` : ""].filter(Boolean).join("\n");
    if (combined.length > 0) return { title: "bash output", content: combined, language: "bash" };
  }

  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function pruneSeenKeys(map: Map<string, number>): void {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [key, timestamp] of map.entries()) {
    if (timestamp < cutoff) map.delete(key);
  }
}

function extractChatId(normalized: NormalizedGatewayEvent): string | null {
  const p = normalized.forgeEvent.payload;
  return asString(p.chatId) ?? asString(p.from);
}

function extractSenderId(normalized: NormalizedGatewayEvent): string | null {
  const p = normalized.forgeEvent.payload;
  return asString(p.senderId);
}
