import type { LanguageModel } from "ai";
import type { AiConfig, AiProvider } from "../grind-home";
import { getOAuthToken, isTokenExpired } from "./auth-store";
import { OAUTH_CONFIGS, refreshOAuthToken } from "./oauth";

const DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4o",
  google: "gemini-2.0-flash",
  ollama: "llama3.1",
};

// ---------------------------------------------------------------------------
// OpenAI Codex OAuth — custom fetch interceptor
// Mirrors the approach used by opencode (anomalyco/opencode):
//   - Always targets chatgpt.com/backend-api/codex (Responses API endpoint)
//   - Uses the raw OAuth access token as the Bearer — no API key exchange
//   - Refreshes the token inline on each request if expired
//   - Injects ChatGPT-Account-Id when present
// ---------------------------------------------------------------------------

type FetchFn = (input: Parameters<typeof fetch>[0], init?: RequestInit) => Promise<Response>;

interface CachedCodexFunctionCall {
  callId: string;
  name: string;
  argumentsJson: string;
  cachedAt: number;
}

const CODEX_FUNCTION_CALL_TTL_MS = 5 * 60 * 1000;
const codexFunctionCallsByCallId = new Map<string, CachedCodexFunctionCall>();

function cacheCodexFunctionCall(callId: string, name: string, args: unknown): void {
  const argumentsJson = typeof args === "string" ? args : JSON.stringify(args ?? {});
  codexFunctionCallsByCallId.set(callId, {
    callId,
    name,
    argumentsJson,
    cachedAt: Date.now(),
  });
  pruneCodexFunctionCallCache();
}

export function registerCodexToolCall(callId: string, name: string, args: unknown): void {
  if (process.env.GRIND_CODEX_DEBUG === "1") {
    console.error("[grind codex debug] register tool call:", callId, name);
  }
  cacheCodexFunctionCall(callId, name, args);
}

function pruneCodexFunctionCallCache(now = Date.now()): void {
  for (const [callId, cached] of codexFunctionCallsByCallId.entries()) {
    if (now - cached.cachedAt > CODEX_FUNCTION_CALL_TTL_MS) {
      codexFunctionCallsByCallId.delete(callId);
    }
  }
}

function rewriteCodexInputItems(rawItems: Record<string, unknown>[]): Record<string, unknown>[] {
  pruneCodexFunctionCallCache();

  const result: Record<string, unknown>[] = [];
  const existingFunctionCalls = new Set<string>();

  for (const item of rawItems) {
    if (item.type === "function_call" && typeof item.call_id === "string") {
      existingFunctionCalls.add(item.call_id);
    }
  }

  for (const item of rawItems) {
    if (item.type === "item_reference") {
      continue;
    }

    if (item.type === "function_call_output" && typeof item.call_id === "string") {
      const callId = item.call_id;
      if (!existingFunctionCalls.has(callId)) {
        const cached = codexFunctionCallsByCallId.get(callId);
        if (cached) {
          result.push({
            type: "function_call",
            call_id: cached.callId,
            name: cached.name,
            arguments: cached.argumentsJson,
          });
          existingFunctionCalls.add(callId);
        }
      }
    }

    result.push(item);
  }

  return result;
}

// Transforms an AI SDK Responses API request body for the Codex endpoint:
//   - Extracts "developer"-role messages from `input` → joined as `instructions`
//   - Removes `include` field (reasoning.encrypted_content not supported)
//   - Forces `store=false` (required by Codex endpoint)
//   - Removes previous-response linkage fields that conflict with store=false
function transformCodexBody(bodyText: string): string {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(bodyText) as Record<string, unknown>;
  } catch {
    return bodyText;
  }

  const rawInputItems = Array.isArray(body.input) ? (body.input as Record<string, unknown>[]) : [];
  const inputItems = rewriteCodexInputItems(rawInputItems);
  const developerMessages = inputItems.filter((m) => m.role === "developer");
  const otherItems = inputItems.filter((m) => m.role !== "developer");

  if (developerMessages.length > 0 && !body.instructions) {
    body.instructions = developerMessages
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .join("\n\n");
    body.input = otherItems;
  } else {
    body.input = inputItems;
  }

  // Codex endpoint doesn't support the `include` field
  delete body.include;

  // Codex endpoint requires explicit store=false.
  body.store = false;

  // With store=false, previous-response continuation ids are invalid.
  // Keep conversation fully message-based.
  delete body.previous_response_id;
  delete body.conversation;

  if (process.env.GRIND_CODEX_DEBUG === "1") {
    const itemPreview = inputItems.map((item) => ({
      type: typeof item.type === "string" ? item.type : null,
      role: typeof item.role === "string" ? item.role : null,
      id: typeof item.id === "string" ? item.id : null,
      callId: typeof item.call_id === "string" ? item.call_id : null,
      hasContent: "content" in item,
      keys: Object.keys(item),
    }));
    console.error("[grind codex debug] input items:", JSON.stringify(itemPreview));
  }

  return JSON.stringify(body);
}

function makeAnthropicOAuthFetch(): FetchFn {
  return async (input, init) => {
    let token = getOAuthToken("anthropic");
    if (!token) {
      throw new Error("No OAuth token found for Anthropic. Run `grindxp setup` to authenticate.");
    }

    const oauthConfig = OAUTH_CONFIGS["anthropic"];
    if (isTokenExpired(token) && oauthConfig) {
      await refreshOAuthToken("anthropic", oauthConfig, token);
      token = getOAuthToken("anthropic")!;
    }

    const headers = new Headers(init?.headers as ConstructorParameters<typeof Headers>[0]);
    headers.set("authorization", `Bearer ${token.accessToken}`);

    return fetch(input, { ...init, headers });
  };
}

function makeCodexFetch(): FetchFn {
  return async (input, init) => {
    let token = getOAuthToken("openai");
    if (!token) {
      throw new Error("No OAuth token found for OpenAI. Run `grindxp setup` to authenticate.");
    }

    const oauthConfig = OAUTH_CONFIGS["openai"];
    if (isTokenExpired(token) && oauthConfig) {
      await refreshOAuthToken("openai", oauthConfig, token);
      token = getOAuthToken("openai")!;
    }

    const headers = new Headers(init?.headers as ConstructorParameters<typeof Headers>[0]);
    headers.set("Authorization", `Bearer ${token.accessToken}`);
    headers.set("originator", "grind");
    if (token.chatgptAccountId) {
      headers.set("ChatGPT-Account-Id", token.chatgptAccountId);
    }

    const transformedBody = init?.body ? transformCodexBody(String(init.body)) : null;
    const fetchInit: RequestInit = { ...init, headers };
    if (transformedBody !== null) fetchInit.body = transformedBody;

    return fetch(input, fetchInit);
  };
}

export async function resolveModel(config: AiConfig): Promise<LanguageModel> {
  const provider = config.provider ?? "anthropic";
  const modelId = config.model ?? DEFAULT_MODELS[provider];

  switch (provider) {
    case "anthropic": {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      if (config.authType === "oauth") {
        // Token is read and refreshed dynamically on every request — safe for
        // long-running processes (gateway) where the token may expire or be
        // refreshed by another process writing to auth.json.
        const client = createAnthropic({
          authToken: "grind-oauth-managed",
          headers: {
            "anthropic-beta": "oauth-2025-04-20",
            "anthropic-product": "claude-code",
          },
          fetch: makeAnthropicOAuthFetch() as unknown as typeof fetch,
        });
        return client(modelId);
      }
      const client = createAnthropic({
        ...(config.apiKey ? { apiKey: config.apiKey } : {}),
      });
      return client(modelId);
    }
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai");

      if (config.authType === "oauth") {
        // Always route to chatgpt.com/backend-api/codex (Responses API).
        // The custom fetch injects the Bearer token and handles refresh.
        const client = createOpenAI({
          apiKey: "openai-oauth-dummy",
          baseURL: "https://chatgpt.com/backend-api/codex",
          fetch: makeCodexFetch() as unknown as typeof fetch,
        });
        return client.responses(modelId);
      }

      const client = createOpenAI({
        ...(config.apiKey ? { apiKey: config.apiKey } : {}),
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      });
      return client(modelId);
    }
    case "google": {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      const client = createGoogleGenerativeAI({
        ...(config.apiKey ? { apiKey: config.apiKey } : {}),
      });
      return client(modelId);
    }
    case "ollama": {
      const { createOpenAI } = await import("@ai-sdk/openai");
      const client = createOpenAI({
        baseURL: config.baseUrl ?? "http://localhost:11434/v1",
        apiKey: "ollama",
      });
      return client.chat(modelId);
    }
  }
}

export { DEFAULT_MODELS };
