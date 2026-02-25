import { type LanguageModel, type ModelMessage, stepCountIs, streamText } from "ai";
import { registerCodexToolCall } from "./provider";
import { buildDynamicPrompt, buildStablePrompt } from "./system-prompt";
import type { SystemPromptContext } from "./system-prompt";
import type { PermissionReply, ToolContext } from "./tools";
import { createGrindTools } from "./tools";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
}

export interface AgentStreamEvent {
  type: "text-delta" | "tool-call" | "tool-result" | "reasoning" | "error" | "done" | "step-finish";
  text?: string;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: unknown;
  error?: string;
  usage?: TokenUsage;
}

export interface ThinkingConfig {
  enabled: boolean;
  budgetTokens: number;
}

export interface RunAgentParams {
  model: LanguageModel;
  toolCtx: ToolContext;
  promptCtx: SystemPromptContext;
  messages: ModelMessage[];
  abortSignal?: AbortSignal;
  thinking?: ThinkingConfig;
  provider?: string;
  requestPermission?: (toolName: string, detail: string) => Promise<PermissionReply>;
}

function isAnthropicModel(model: LanguageModel, provider?: string): boolean {
  if (provider === "anthropic") return true;
  const id = typeof model === "string" ? model : model.modelId;
  return id.includes("claude") || id.includes("anthropic");
}

function applyCacheControl(
  messages: ModelMessage[],
  model: LanguageModel,
  provider?: string,
): ModelMessage[] {
  if (!isAnthropicModel(model, provider)) return messages;

  const cacheMarker = {
    anthropic: { cacheControl: { type: "ephemeral" as const } },
  };

  return messages.map((msg, i) => {
    const isSystem = msg.role === "system";
    const isLastTwo = i >= messages.length - 2 && msg.role !== "system";

    if (isSystem || isLastTwo) {
      return {
        ...msg,
        providerOptions: {
          ...msg.providerOptions,
          ...cacheMarker,
        },
      };
    }
    return msg;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function instrumentCodexToolCalls(tools: Record<string, unknown>, provider?: string): void {
  if (provider !== "openai") {
    return;
  }

  for (const [toolName, toolDefinition] of Object.entries(tools)) {
    if (!isRecord(toolDefinition)) {
      continue;
    }

    const execute = toolDefinition.execute;
    if (typeof execute !== "function") {
      continue;
    }

    toolDefinition.execute = async (input: unknown, options?: { toolCallId?: string }) => {
      if (options?.toolCallId) {
        registerCodexToolCall(options.toolCallId, toolName, input);
      }
      return execute(input, options);
    };
  }
}

export function estimateTokens(text: string): number {
  return Math.max(0, Math.round((text || "").length / 4));
}

export const CONTEXT_LIMITS: Record<string, number> = {
  "claude-sonnet": 200_000,
  "claude-haiku": 200_000,
  "claude-opus": 200_000,
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "gemini-2.0-flash": 1_000_000,
  "gemini-2.5-flash": 1_000_000,
  "llama3.1": 128_000,
};

const DEFAULT_CONTEXT_LIMIT = 128_000;

export function getContextLimit(model: LanguageModel): number {
  const id = typeof model === "string" ? model : model.modelId;
  for (const [pattern, limit] of Object.entries(CONTEXT_LIMITS)) {
    if (id.includes(pattern)) return limit;
  }
  return DEFAULT_CONTEXT_LIMIT;
}

export async function* runAgent(params: RunAgentParams): AsyncGenerator<AgentStreamEvent> {
  const {
    model,
    toolCtx,
    promptCtx,
    messages,
    abortSignal,
    thinking,
    provider,
    requestPermission,
  } = params;

  const extendedCtx: ToolContext = requestPermission ? { ...toolCtx, requestPermission } : toolCtx;
  const tools = createGrindTools(extendedCtx);
  instrumentCodexToolCalls(tools, provider);
  const stablePrompt = buildStablePrompt(promptCtx.companion);
  const dynamicPrompt = buildDynamicPrompt(promptCtx);

  const systemMessages: ModelMessage[] = [
    { role: "system" as const, content: stablePrompt },
    { role: "system" as const, content: dynamicPrompt },
  ];

  const allMessages = [...systemMessages, ...messages];
  const cachedMessages = applyCacheControl(allMessages, model, provider);

  const streamParams: Parameters<typeof streamText>[0] = {
    model,
    messages: cachedMessages,
    tools,
    stopWhen: stepCountIs(8),
    maxRetries: 1,
    ...(thinking?.enabled
      ? {
          providerOptions: {
            anthropic: {
              thinking: { type: "enabled" as const, budgetTokens: thinking.budgetTokens },
            },
          },
        }
      : {}),
  };

  if (abortSignal) {
    streamParams.abortSignal = abortSignal;
  }

  const result = streamText(streamParams);

  for await (const part of result.fullStream) {
    switch (part.type) {
      case "text-delta":
        yield { type: "text-delta", text: part.text };
        break;
      case "tool-call":
        yield {
          type: "tool-call",
          toolName: part.toolName,
          toolArgs: part.input,
        };
        break;
      case "tool-result":
        yield {
          type: "tool-result",
          toolName: part.toolName,
          toolResult: part.output,
        };
        break;
      case "reasoning-delta":
        yield { type: "reasoning", text: part.text };
        break;
      case "finish-step": {
        const u = part.usage;
        const inputDetails = u?.inputTokenDetails;
        const outputDetails = u?.outputTokenDetails;
        yield {
          type: "step-finish",
          usage: {
            inputTokens: u?.inputTokens ?? 0,
            outputTokens: u?.outputTokens ?? 0,
            reasoningTokens: outputDetails?.reasoningTokens ?? 0,
            cacheReadTokens: inputDetails?.cacheReadTokens ?? 0,
            cacheWriteTokens: inputDetails?.cacheWriteTokens ?? 0,
            totalTokens: u?.totalTokens ?? 0,
          },
        };
        break;
      }
      case "error": {
        const err = part.error;
        let errorStr = String(err);
        if (err !== null && typeof err === "object" && "responseBody" in err) {
          const body = (err as { responseBody?: string }).responseBody;
          if (body) {
            try {
              const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string };
              const msg = parsed?.error?.message ?? parsed?.message;
              if (msg) errorStr = `AI_APICallError: ${msg}`;
            } catch {
              errorStr += `\nResponse: ${body}`;
            }
          }
        }
        yield { type: "error", error: errorStr };
        break;
      }
    }
  }

  yield { type: "done" };
}

export type GrindTools = ReturnType<typeof createGrindTools>;
