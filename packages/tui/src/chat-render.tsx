import type { GrindConfig, Quest, StoredMessage, UserProfile, VaultDb } from "@grindxp/core";
import type { TimerState } from "@grindxp/core";
import type { CompanionInsightRow, CompanionSettingsRow } from "@grindxp/core/vault";
import type { Root } from "@opentui/react";
import "opentui-spinner/react";
import type { LanguageModel } from "ai";
import { ChatApp } from "./ChatApp";
import type { TuiContext } from "./lib/context";
import { buildIntegrationSummary } from "./lib/integrations";
import { StoreProvider } from "./lib/store";
import { ThemeProvider } from "./theme/context";

interface ChatRenderParams {
  config: GrindConfig;
  db: VaultDb;
  close: () => void;
  user: UserProfile;
  timerPath: string;
  model: LanguageModel;
  quests: Quest[];
  timer: TimerState | null;
  userId: string;
  companion?: CompanionSettingsRow | null;
  companionInsights?: CompanionInsightRow[];
  initialConversationId?: string;
  initialStoredMessages?: StoredMessage[];
  initialToolPermissions: string[];
  initialPromptHistory?: string[];
}

export function renderChat(root: Root, params: ChatRenderParams): void {
  const tuiCtx: TuiContext = {
    config: params.config,
    db: params.db,
    close: params.close,
    user: params.user,
    timerPath: params.timerPath,
  };

  const toolCtx = {
    db: params.db,
    userId: params.userId,
    timerPath: params.timerPath,
    config: params.config,
  };
  const promptCtx = {
    user: params.user,
    quests: params.quests,
    timer: params.timer,
    integrationSummary: buildIntegrationSummary(params.config),
    ...(params.companion != null ? { companion: params.companion } : {}),
    ...(params.companionInsights !== undefined
      ? { companionInsights: params.companionInsights }
      : {}),
  };

  root.render(
    <ThemeProvider {...(params.config.theme ? { initialTheme: params.config.theme } : {})}>
      <StoreProvider ctx={tuiCtx}>
        <ChatApp
          model={params.model}
          aiConfig={params.config.ai ?? {}}
          toolCtx={toolCtx}
          promptCtx={promptCtx}
          db={params.db}
          userId={params.userId}
          {...(params.config.ai?.provider ? { provider: params.config.ai.provider } : {})}
          autoCompact={params.config.ai?.autoCompact !== false}
          {...(params.initialConversationId
            ? { initialConversationId: params.initialConversationId }
            : {})}
          {...(params.initialStoredMessages
            ? { initialStoredMessages: params.initialStoredMessages }
            : {})}
          initialToolPermissions={params.initialToolPermissions}
          {...(params.initialPromptHistory
            ? { initialPromptHistory: params.initialPromptHistory }
            : {})}
        />
      </StoreProvider>
    </ThemeProvider>,
  );
}
