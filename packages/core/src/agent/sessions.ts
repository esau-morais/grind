import type { ModelMessage } from "ai";
import { asc, desc, eq, inArray } from "drizzle-orm";

import { conversations, messages, promptHistory, users } from "../vault/schema";
import type { VaultDb } from "../vault/types";

export interface Conversation {
  id: string;
  userId: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface StoredMessage {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  toolCalls: unknown[] | null;
  toolResults: unknown[] | null;
  attachments: Array<{ mime: string; base64: string }> | null;
  createdAt: number;
}

export async function createConversation(
  db: VaultDb,
  userId: string,
  title?: string,
): Promise<Conversation> {
  const [row] = await db
    .insert(conversations)
    .values({ userId, title: title ?? null })
    .returning();
  if (!row) throw new Error("Failed to create conversation");
  return row;
}

export async function getLatestConversation(
  db: VaultDb,
  userId: string,
): Promise<Conversation | null> {
  const row = await db.query.conversations.findFirst({
    where: eq(conversations.userId, userId),
    orderBy: [desc(conversations.updatedAt)],
  });
  return row ?? null;
}

export async function getConversationById(db: VaultDb, id: string): Promise<Conversation | null> {
  const row = await db.query.conversations.findFirst({
    where: eq(conversations.id, id),
  });
  return row ?? null;
}

export async function listConversations(
  db: VaultDb,
  userId: string,
  limit = 20,
): Promise<Conversation[]> {
  return db.query.conversations.findMany({
    where: eq(conversations.userId, userId),
    orderBy: [desc(conversations.updatedAt)],
    limit,
  });
}

export async function deleteConversation(db: VaultDb, conversationId: string): Promise<void> {
  await db.delete(messages).where(eq(messages.conversationId, conversationId));
  await db.delete(conversations).where(eq(conversations.id, conversationId));
}

export async function updateConversationTitle(
  db: VaultDb,
  conversationId: string,
  title: string,
): Promise<void> {
  await db.update(conversations).set({ title }).where(eq(conversations.id, conversationId));
}

export async function appendMessage(
  db: VaultDb,
  conversationId: string,
  msg: {
    role: string;
    content: string;
    toolCalls?: unknown[];
    toolResults?: unknown[];
    attachments?: Array<{ mime: string; base64: string }>;
  },
): Promise<StoredMessage> {
  const [row] = await db
    .insert(messages)
    .values({
      conversationId,
      role: msg.role,
      content: msg.content,
      toolCalls: msg.toolCalls,
      toolResults: msg.toolResults,
      ...(msg.attachments ? { attachments: msg.attachments } : {}),
    })
    .returning();
  if (!row) throw new Error("Failed to insert message");

  await db
    .update(conversations)
    .set({ updatedAt: Date.now() })
    .where(eq(conversations.id, conversationId));

  return row;
}

export async function getConversationMessages(
  db: VaultDb,
  conversationId: string,
  limit = 50,
): Promise<StoredMessage[]> {
  return db.query.messages.findMany({
    where: eq(messages.conversationId, conversationId),
    orderBy: [desc(messages.createdAt)],
    limit,
  });
}

export async function getToolPermissions(db: VaultDb, userId: string): Promise<string[]> {
  const row = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!row) return [];
  const meta = row.metadata as Record<string, unknown>;
  const perms = meta["toolPermissions"];
  return Array.isArray(perms) ? (perms as string[]) : [];
}

export async function grantToolPermission(
  db: VaultDb,
  userId: string,
  toolName: string,
): Promise<void> {
  const row = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!row) return;
  const meta = row.metadata as Record<string, unknown>;
  const existing = Array.isArray(meta["toolPermissions"])
    ? (meta["toolPermissions"] as string[])
    : [];
  if (existing.includes(toolName)) return;
  await db
    .update(users)
    .set({ metadata: { ...meta, toolPermissions: [...existing, toolName] } })
    .where(eq(users.id, userId));
}

export function storedToModelMessages(stored: StoredMessage[]): ModelMessage[] {
  const sorted = [...stored].sort((a, b) => a.createdAt - b.createdAt);
  const result: ModelMessage[] = [];

  for (const msg of sorted) {
    if (msg.role === "user") {
      if (msg.attachments?.length) {
        result.push({
          role: "user",
          content: [
            ...msg.attachments.map((a) => ({
              type: "image" as const,
              image: a.base64,
              mediaType: a.mime,
            })),
            { type: "text" as const, text: msg.content },
          ],
        });
      } else {
        result.push({ role: "user", content: msg.content });
      }
    } else if (msg.role === "assistant") {
      result.push({ role: "assistant", content: msg.content });
    }
  }

  return result;
}

const PROMPT_HISTORY_MAX = 100;

export async function appendPromptHistory(
  db: VaultDb,
  userId: string,
  content: string,
): Promise<void> {
  await db.insert(promptHistory).values({ userId, content });

  const rows = await db.query.promptHistory.findMany({
    where: eq(promptHistory.userId, userId),
    orderBy: [desc(promptHistory.createdAt)],
    columns: { id: true },
  });

  if (rows.length > PROMPT_HISTORY_MAX) {
    const excess = rows.slice(PROMPT_HISTORY_MAX).map((r) => r.id);
    await db.delete(promptHistory).where(inArray(promptHistory.id, excess));
  }
}

export async function getPromptHistory(db: VaultDb, userId: string): Promise<string[]> {
  const rows = await db.query.promptHistory.findMany({
    where: eq(promptHistory.userId, userId),
    orderBy: [asc(promptHistory.createdAt)],
    limit: PROMPT_HISTORY_MAX,
    columns: { content: true },
  });
  return rows.map((r) => r.content);
}
