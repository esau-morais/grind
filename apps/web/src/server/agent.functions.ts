import { createServerFn } from "@tanstack/react-start";
import {
  runAgent,
  resolveModel,
  createConversation,
  getConversationById,
  appendMessage,
  getConversationMessages,
  storedToModelMessages,
  buildUserContext,
  mergeUserContext,
} from "@grindxp/core";
import { getUserById, listCompanionInsights, listQuestsByUser } from "@grindxp/core/vault";
import { getVaultContext, getGrindConfig } from "./vault.server";

// Discriminated union — tool args/results are JSON strings to avoid
// Record<string, unknown> being incompatible with TanStack Start's {} serialization constraint
export type WebAgentEvent =
  | { type: "conversation-id"; conversationId: string }
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; toolName: string; toolArgsJson: string }
  | { type: "tool-result"; toolName: string; toolResultJson: string }
  | { type: "step-finish" }
  | { type: "error"; error: string }
  | { type: "done" };

function validateSendInput(data: unknown): {
  message: string;
  conversationId?: string;
  attachments?: Array<{ mime: string; base64: string }>;
} {
  if (typeof data !== "object" || data === null) throw new Error("Invalid input");
  const raw = data as Record<string, unknown>;
  const message = raw["message"];
  if (typeof message !== "string") throw new Error("Invalid input");
  const conversationId = raw["conversationId"];
  const rawAttachments = raw["attachments"];
  const attachments = Array.isArray(rawAttachments)
    ? rawAttachments.filter(
        (a): a is { mime: string; base64: string } =>
          typeof a === "object" &&
          a !== null &&
          typeof (a as Record<string, unknown>)["mime"] === "string" &&
          typeof (a as Record<string, unknown>)["base64"] === "string",
      )
    : undefined;
  if (!message.trim() && (!attachments || attachments.length === 0)) {
    throw new Error("message is required");
  }
  return {
    message,
    ...(typeof conversationId === "string" ? { conversationId } : {}),
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
  };
}

export const streamMessage = createServerFn({ method: "POST" })
  .inputValidator(validateSendInput)
  .handler(async function* ({ data }): AsyncGenerator<WebAgentEvent> {
    const { db, userId, timerPath } = getVaultContext();
    const config = getGrindConfig();

    let model;
    try {
      model = await resolveModel(config.ai ?? {});
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to resolve AI model";
      yield { type: "error", error: msg };
      return;
    }

    const user = await getUserById(db, userId);
    if (!user) {
      yield { type: "error", error: "User not found" };
      return;
    }

    const activeQuests = await listQuestsByUser(db, userId, ["active"]);

    const companionRow = await db.query.companionSettings.findFirst({
      where: (cs, { eq }) => eq(cs.userId, userId),
    });

    const autoContext = await buildUserContext(db, userId);
    const mergedContext = mergeUserContext(autoContext, companionRow?.userContext ?? null);

    const companionWithContext = companionRow
      ? { ...companionRow, userContext: mergedContext }
      : null;
    const companionInsights = await listCompanionInsights(db, userId, 20);

    let conversation;
    if (data.conversationId) {
      conversation = await getConversationById(db, data.conversationId);
    }
    if (!conversation) {
      conversation = await createConversation(db, userId);
    }

    const convId = conversation.id;
    yield { type: "conversation-id", conversationId: convId };

    await appendMessage(db, convId, {
      role: "user",
      content: data.message,
      ...(data.attachments && data.attachments.length > 0 ? { attachments: data.attachments } : {}),
    });

    const stored = await getConversationMessages(db, convId, 50);
    const modelMessages = storedToModelMessages(stored);

    const toolCtx = { db, userId, timerPath, config };

    const promptCtxBase = { user, quests: activeQuests, timer: null as null };
    const promptCtx = companionWithContext
      ? { ...promptCtxBase, companion: companionWithContext, companionInsights }
      : { ...promptCtxBase, companionInsights };

    let assistantText = "";
    const assistantToolCalls: unknown[] = [];

    for await (const event of runAgent({
      model,
      toolCtx,
      promptCtx,
      messages: modelMessages,
      ...(config.ai?.provider ? { provider: config.ai.provider } : {}),
    })) {
      if (event.type === "text-delta" && event.text) {
        assistantText += event.text;
        yield { type: "text-delta", text: event.text };
      } else if (event.type === "tool-call") {
        const toolName = event.toolName ?? "unknown";
        const toolArgs = event.toolArgs ?? {};
        assistantToolCalls.push({ name: toolName, args: toolArgs });
        yield { type: "tool-call", toolName, toolArgsJson: JSON.stringify(toolArgs) };
      } else if (event.type === "tool-result") {
        yield {
          type: "tool-result",
          toolName: event.toolName ?? "unknown",
          toolResultJson: JSON.stringify(event.toolResult ?? null),
        };
      } else if (event.type === "error") {
        yield { type: "error", error: event.error ?? "Unknown error" };
      } else if (event.type === "done") {
        await appendMessage(db, convId, {
          role: "assistant",
          content: assistantText,
          ...(assistantToolCalls.length > 0 ? { toolCalls: assistantToolCalls } : {}),
        });
        yield { type: "done" };
      }
    }
  });
