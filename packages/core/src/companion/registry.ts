import { type CompanionProvider, type CompanionSettings, companionProviderSchema } from "../schema";

export const DEFAULT_MODEL_BY_PROVIDER: Record<CompanionProvider, string> = {
  anthropic: "claude-3-5-haiku-latest",
  openai: "gpt-4o-mini",
  google: "gemini-2.0-flash-exp",
  ollama: "llama3.1:8b",
};

export function parseModelId(modelId: string): { provider: CompanionProvider; model: string } {
  const [providerRaw, ...rest] = modelId.split(":");
  const provider = companionProviderSchema.parse(providerRaw);
  const model = rest.join(":");

  if (!model) {
    throw new Error(`Invalid model identifier: ${modelId}`);
  }

  return { provider, model };
}

export function resolveModelId(settings: Pick<CompanionSettings, "provider" | "model">): string {
  return `${settings.provider}:${settings.model}`;
}
