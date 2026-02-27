import { type CompanionProvider, type CompanionSettings, companionProviderSchema } from "../schema";

export const DEFAULT_MODEL_BY_PROVIDER: Record<CompanionProvider, string> = {
  anthropic: "claude-haiku-4-5",
  openai: "gpt-5-mini",
  google: "gemini-2.5-flash",
  ollama: "qwen2.5:7b",
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
