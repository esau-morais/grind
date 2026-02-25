import { type LanguageModel, type ModelMessage, type ToolSet, generateText, stepCountIs } from "ai";

const SUMMARIZE_PROMPT = `Summarize the conversation above for continuation by another agent.
Use this template exactly:

## Goal
What the user is trying to accomplish.

## Accomplished
What was done, including quest/skill changes and XP earned.

## Current State
Active quests, XP, streaks, timer status — any relevant state.

## Next Steps
What was planned or in progress.

Be concise. This summary replaces the full conversation history.`;

const MEMORY_FLUSH_PROMPT = `Session is nearing compaction.

Before summarization, persist any durable user memory via tools:
- store_insight for concise durable facts (pattern, preference, goal, context)
- update_user_context only for high-level narrative context that should stay in a user notes blob

Rules:
- Store only durable information likely to matter in future sessions.
- Do not store transient chatter.
- Keep insights short and factual.
- If there is nothing useful to store, reply exactly: NO_REPLY`;

export interface MemoryFlushResult {
  text: string;
  toolCallCount: number;
  toolResultCount: number;
}

export interface CompactResult {
  summary: string;
  droppedCount: number;
  keptCount: number;
}

export async function flushCompanionMemory(params: {
  model: LanguageModel;
  messages: ModelMessage[];
  tools: ToolSet;
  abortSignal?: AbortSignal;
}): Promise<MemoryFlushResult> {
  const { model, messages, tools, abortSignal } = params;

  const result = await generateText({
    model,
    messages: [...messages, { role: "user" as const, content: MEMORY_FLUSH_PROMPT }],
    tools,
    activeTools: ["list_insights", "store_insight", "update_user_context"],
    stopWhen: stepCountIs(4),
    maxOutputTokens: 128,
    maxRetries: 1,
    ...(abortSignal ? { abortSignal } : {}),
  });

  const toolCallCount = result.steps.reduce((sum, step) => sum + step.toolCalls.length, 0);
  const toolResultCount = result.steps.reduce((sum, step) => sum + step.toolResults.length, 0);

  return {
    text: result.text.trim(),
    toolCallCount,
    toolResultCount,
  };
}

export async function summarizeConversation(params: {
  model: LanguageModel;
  messages: ModelMessage[];
  abortSignal?: AbortSignal;
}): Promise<string> {
  const { model, messages, abortSignal } = params;

  const result = await generateText({
    model,
    messages: [...messages, { role: "user" as const, content: SUMMARIZE_PROMPT }],
    maxOutputTokens: 1024,
    maxRetries: 1,
    ...(abortSignal ? { abortSignal } : {}),
  });

  return result.text.trim();
}

export function compactMessages(params: {
  messages: ModelMessage[];
  keepCount: number;
  summary: string;
}): { messages: ModelMessage[]; dropped: number } {
  const { messages, keepCount, summary } = params;

  if (messages.length <= keepCount) {
    return { messages, dropped: 0 };
  }

  const kept = messages.slice(-keepCount);
  const dropped = messages.length - keepCount;

  const summaryMessage: ModelMessage = {
    role: "system" as const,
    content: `[Conversation summary — ${dropped} earlier messages compacted]\n\n${summary}`,
  };

  return {
    messages: [summaryMessage, ...kept],
    dropped,
  };
}
