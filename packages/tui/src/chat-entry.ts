import {
  getConversationById,
  getConversationMessages,
  getLatestConversation,
  getMigrationsPath,
  getPromptHistory,
  getTimerPath,
  getToolPermissions,
  listQuestsByUser,
  openVault,
  readGrindConfig,
  readTimer,
  resolveModel,
} from "@grindxp/core";
import { getCompanionByUserId, getUserById, listCompanionInsights } from "@grindxp/core/vault";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";

const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface ChatFlags {
  new?: boolean;
  session?: string;
}

export async function startChat(flags?: ChatFlags): Promise<void> {
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
  const [
    quests,
    timer,
    companion,
    companionInsights,
    initialToolPermissions,
    initialPromptHistory,
  ] = await Promise.all([
    listQuestsByUser(db, config.userId),
    Promise.resolve(readTimer(timerPath)),
    getCompanionByUserId(db, config.userId),
    listCompanionInsights(db, config.userId, 20),
    getToolPermissions(db, config.userId),
    getPromptHistory(db, config.userId),
  ]);

  let initialConversationId: string | undefined;
  let initialStoredMessages: Awaited<ReturnType<typeof getConversationMessages>> | undefined;

  if (flags?.session) {
    const conv = await getConversationById(db, flags.session);
    if (conv) {
      initialConversationId = conv.id;
      initialStoredMessages = await getConversationMessages(db, conv.id, 200);
    }
  } else if (!flags?.new) {
    const latest = await getLatestConversation(db, config.userId);
    if (latest && Date.now() - latest.updatedAt < SESSION_MAX_AGE_MS) {
      initialConversationId = latest.id;
      initialStoredMessages = await getConversationMessages(db, latest.id, 200);
    }
  }

  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    targetFps: 30,
    useMouse: true,
  });

  const root = createRoot(renderer);

  const { renderChat } = await import("./chat-render");
  renderChat(root, {
    config,
    db,
    close: () => client.close(),
    user,
    timerPath,
    model,
    quests,
    timer,
    userId: config.userId,
    companion,
    companionInsights,
    ...(initialConversationId ? { initialConversationId } : {}),
    ...(initialStoredMessages ? { initialStoredMessages } : {}),
    initialToolPermissions,
    initialPromptHistory,
  });

  renderer.on("destroy", () => {
    client.close();
  });
}
