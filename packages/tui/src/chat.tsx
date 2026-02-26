import {
  getMigrationsPath,
  getTimerPath,
  listQuestsByUser,
  openVault,
  readGrindConfig,
  readTimer,
  resolveModel,
} from "@grindxp/core";
import { getCompanionByUserId, getUserById, listCompanionInsights } from "@grindxp/core/vault";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import "opentui-spinner/react";
import { ChatApp } from "./ChatApp";
import type { TuiContext } from "./lib/context";
import { buildIntegrationSummary } from "./lib/integrations";
import { StoreProvider } from "./lib/store";

export async function startChat(): Promise<void> {
  const config = readGrindConfig();
  if (!config) {
    console.error("grindxp is not initialized. Run `grindxp init` first.");
    process.exit(1);
  }

  if (!config.ai?.provider) {
    console.error("AI provider not configured. Run `grindxp setup` first.");
    process.exit(1);
  }

  const { client, db } = await openVault(
    { localDbPath: config.vaultPath, encryptionKey: config.encryptionKey },
    getMigrationsPath(),
  );

  const user = await getUserById(db, config.userId);
  if (!user) {
    console.error("User profile corrupted. Run `grindxp init` to re-initialize.");
    client.close();
    process.exit(1);
  }

  const model = await resolveModel(config.ai);

  const timerPath = getTimerPath();
  const quests = await listQuestsByUser(db, config.userId);
  const timer = readTimer(timerPath);

  const tuiCtx: TuiContext = {
    config,
    db,
    close: () => client.close(),
    user,
    timerPath,
  };

  const [companion, companionInsights] = await Promise.all([
    getCompanionByUserId(db, config.userId),
    listCompanionInsights(db, config.userId, 20),
  ]);

  const toolCtx = {
    db,
    userId: config.userId,
    timerPath,
    config,
    trustLevel: companion?.trustLevel ?? 0,
  };
  const promptCtx = {
    user,
    quests,
    timer,
    companion,
    companionInsights,
    integrationSummary: buildIntegrationSummary(config),
    timezone: user.preferences.timezone,
    channelContext:
      "Channel: TUI. Tool results (calendar events, emails, etc.) are rendered as formatted blocks visible to the user. Keep text responses brief — do not re-list data already shown in a block.",
  };

  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    targetFps: 30,
    useMouse: true,
  });

  const root = createRoot(renderer);

  root.render(
    <StoreProvider ctx={tuiCtx}>
      <ChatApp
        model={model}
        aiConfig={config.ai}
        toolCtx={toolCtx}
        promptCtx={promptCtx}
        db={db}
        userId={config.userId}
        provider={config.ai.provider}
        autoCompact={config.ai.autoCompact !== false}
      />
    </StoreProvider>,
  );

  renderer.on("destroy", () => {
    client.close();
  });
}

if (import.meta.main) {
  startChat().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
