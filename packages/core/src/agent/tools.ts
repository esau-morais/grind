import { tool } from "ai";
import { and, desc, eq } from "drizzle-orm";
import * as fs from "fs/promises";
import * as path from "path";
import os from "os";
import { z } from "zod";

import { readGrindConfig, writeGrindConfig, type GrindConfig } from "../grind-home";
import { markdownToTelegramHtml } from "../gateway/telegram-format";
import { getOAuthToken } from "./auth-store";
import {
  type CalendarEvent,
  type CalendarItem,
  createCalendar,
  createCalendarEvent,
  deleteCalendarEvent,
  getMessage,
  GoogleApiError,
  GoogleNotConnectedError,
  GoogleTokenExpiredError,
  listCalendarEvents,
  listCalendars,
  listMessages,
  sendEmail,
  updateCalendarEvent,
  GOOGLE_OAUTH_KEY,
} from "../integrations/google";
import {
  activityTypeSchema,
  questDifficultySchema,
  type QuestDifficulty,
  type QuestType,
} from "../schema";
import { calculateStreakInfo } from "../streak";
import { clearTimer, formatElapsed, getElapsedMinutes, readTimer, writeTimer } from "../timer";
import { runForgeRuleNow } from "../forge";
import { signals } from "../vault/schema";
import {
  createCompanionInsight,
  deleteCompanionInsight,
  deleteForgeRule,
  completeQuest,
  findCompanionInsightByContent,
  findForgeRuleByPrefix,
  getCompanionByUserId,
  getForgeRuleById,
  createQuest,
  findQuestByPrefix,
  getQuestById,
  getUserById,
  insertForgeRule,
  listCompanionInsights,
  listForgeRulesByUser,
  listForgeRunsByRule,
  listRecentForgeRunsByUser,
  listQuestLogs,
  listQuestsByUser,
  listSignals,
  listSkillsByUser,
  updateCompanionInsight,
  updateCompanionMode,
  updateCompanionUserContext,
  updateForgeRule,
  updateQuest,
  updateQuestStatus,
} from "../vault/repositories";
import type { VaultDb } from "../vault/types";
import { xpForLevelThreshold } from "../xp/constants";

export type PermissionReply = "once" | "always" | "deny";

export interface ToolContext {
  db: VaultDb;
  userId: string;
  timerPath: string;
  trustLevel?: number;
  config?: GrindConfig;
  requestPermission?: (toolName: string, detail: string) => Promise<PermissionReply>;
}

const TRUST_LEVEL_NAMES = ["Watcher", "Advisor", "Scribe", "Agent", "Sovereign"] as const;

const TOOL_TRUST_REQUIREMENTS: Record<string, number> = {
  // Lv.2 Scribe: can act on behalf of the user
  complete_quest: 2,
  abandon_quest: 2,
  activate_quest: 2,
  start_timer: 2,
  stop_timer: 2,
  update_companion_mode: 2,
  // Lv.3 Agent: can create and modify structure
  create_quest: 3,
  update_quest: 3,
  // Lv.4 Sovereign: destructive or sensitive operations
  delete_insight: 4,
  // Note: forge operations are not gated by trust level — the AI reasons
  // autonomously using the xpImpact field returned by list_forge_rules.
};

function requireTrust(
  ctx: ToolContext,
  toolName: string,
): { denied: true; error: string } | { denied: false } {
  const required = TOOL_TRUST_REQUIREMENTS[toolName];
  if (required === undefined) return { denied: false };
  const current = ctx.trustLevel ?? 0;
  if (current < required) {
    const requiredName = TRUST_LEVEL_NAMES[required] ?? `Lv.${required}`;
    const currentName = TRUST_LEVEL_NAMES[current] ?? `Lv.${current}`;
    return {
      denied: true,
      error: `Action requires trust level ${required} (${requiredName}). Current level: ${current} (${currentName}). Grant trust with: grindxp companion trust ${required}`,
    };
  }
  return { denied: false };
}

const MAX_FETCH_SIZE = 50 * 1024;
const MAX_READ_SIZE = 50 * 1024;
const MAX_BASH_OUTPUT = 50 * 1024;
const DEFAULT_READ_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;

function expandPath(p: string): string {
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  if (p === "~") return os.homedir();
  if (p.startsWith("$HOME/")) return path.join(os.homedir(), p.slice(6));
  if (p === "$HOME") return os.homedir();
  return p;
}

function hasGlobMagic(input: string): boolean {
  return /[*?[\]{}()!]/.test(input);
}

function toGlobPath(input: string): string {
  return input.split(path.sep).join("/");
}

function splitAbsoluteGlob(absPattern: string): { cwd: string; pattern: string } {
  const normalized = path.resolve(absPattern);
  const parsed = path.parse(normalized);
  const segments = normalized
    .slice(parsed.root.length)
    .split(path.sep)
    .filter((segment) => segment.length > 0);

  const baseSegments: string[] = [];
  const patternSegments: string[] = [];
  let inPattern = false;

  for (const segment of segments) {
    if (!inPattern && !hasGlobMagic(segment)) {
      baseSegments.push(segment);
      continue;
    }
    inPattern = true;
    patternSegments.push(segment);
  }

  if (patternSegments.length === 0 && baseSegments.length > 0) {
    const leaf = baseSegments.pop();
    if (leaf) {
      patternSegments.push(leaf);
    }
  }

  const cwd = path.join(parsed.root, ...baseSegments);
  const pattern = patternSegments.length > 0 ? patternSegments.join("/") : "*";
  return { cwd, pattern };
}

async function statSafe(targetPath: string): Promise<Awaited<ReturnType<typeof fs.stat>> | null> {
  try {
    return await fs.stat(targetPath);
  } catch {
    return null;
  }
}

async function requirePermission(
  ctx: ToolContext,
  toolName: string,
  detail: string,
): Promise<{ denied: true; error: string } | { denied: false }> {
  if (!ctx.requestPermission) return { denied: false };
  const reply = await ctx.requestPermission(toolName, detail);
  if (reply === "deny") return { denied: true, error: "Permission denied by user" };
  return { denied: false };
}

function classifyGoogleError(err: unknown): string {
  if (err instanceof GoogleNotConnectedError || err instanceof GoogleTokenExpiredError) {
    return "Google account not connected or session expired. Run `grindxp integrations connect google`.";
  }
  if (err instanceof GoogleApiError) {
    switch (err.status) {
      case 401:
        return "Google account disconnected. Run `grindxp integrations connect google`.";
      case 403:
        return "No write access to this calendar. Check the calendar's sharing settings.";
      case 404:
        return "Calendar or event not found. Use list_calendars to verify available calendar IDs.";
      case 409:
        return "Conflict — this event may already exist on the calendar.";
      case 410:
        return "Sync token expired — a full re-sync will happen on the next poll.";
    }
    if (err.status >= 500) {
      return "Google Calendar is temporarily unavailable. Try again in a moment.";
    }
    if (err.status === 400) {
      try {
        const parsed = JSON.parse(err.body) as { error?: { message?: string } };
        const msg = parsed?.error?.message;
        if (msg) return `Invalid request: ${msg}`;
      } catch {
        // fall through
      }
      return "Invalid request — check the calendar ID and date format.";
    }
  }
  return err instanceof Error ? err.message : String(err);
}

async function extractText(html: string): Promise<string> {
  let text = "";
  let skip = false;
  const rewriter = new HTMLRewriter()
    .on("script, style, noscript, iframe, object, embed", {
      element() {
        skip = true;
      },
    })
    .on("*", {
      element(el) {
        if (!["script", "style", "noscript", "iframe", "object", "embed"].includes(el.tagName)) {
          skip = false;
        }
      },
      text(t) {
        if (!skip) text += t.text;
      },
    })
    .transform(new Response(html));
  await rewriter.text();
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

async function isBinaryBuffer(buf: Buffer, size: number): Promise<boolean> {
  const check = Math.min(4096, size);
  let nonPrint = 0;
  for (let i = 0; i < check; i++) {
    if (buf[i] === 0) return true;
    if (buf[i]! < 9 || (buf[i]! > 13 && buf[i]! < 32)) nonPrint++;
  }
  return nonPrint / check > 0.3;
}

function countSubstr(haystack: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    n++;
    idx += needle.length;
  }
  return n;
}

type LineTrimMatch = { lineStart: number; lineCount: number; total: number };

function findByLineTrim(content: string, oldString: string): LineTrimMatch | null {
  const cLines = content.split("\n");
  const sLines = oldString.split("\n");
  let lo = 0;
  let hi = sLines.length;
  while (lo < hi && sLines[lo]!.trim() === "") lo++;
  while (hi > lo && sLines[hi - 1]!.trim() === "") hi--;
  if (lo >= hi) return null;
  const core = sLines.slice(lo, hi);
  const trimCore = core.map((l) => l.trim());
  const cLen = core.length;
  let firstStart = -1;
  let total = 0;
  for (let i = 0; i <= cLines.length - cLen; i++) {
    let hit = true;
    for (let j = 0; j < cLen; j++) {
      if (cLines[i + j]!.trim() !== trimCore[j]) {
        hit = false;
        break;
      }
    }
    if (hit) {
      if (firstStart === -1) firstStart = i;
      total++;
    }
  }
  return total > 0 ? { lineStart: firstStart, lineCount: cLen, total } : null;
}

function offsetToLine(content: string, offset: number): number {
  let line = 0;
  const end = Math.min(offset, content.length);
  for (let i = 0; i < end; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

function buildUnifiedDiff(
  filePath: string,
  contentLines: string[],
  startLine: number,
  oldLines: string[],
  newLines: string[],
  ctx = 3,
): string {
  const ctxStart = Math.max(0, startLine - ctx);
  const before = contentLines.slice(ctxStart, startLine);
  const after = contentLines.slice(startLine + oldLines.length, startLine + oldLines.length + ctx);
  const hunkOldStart = ctxStart + 1;
  const hunkOldCount = before.length + oldLines.length + after.length;
  const hunkNewCount = before.length + newLines.length + after.length;
  const hunkLines = [
    `@@ -${hunkOldStart},${hunkOldCount} +${hunkOldStart},${hunkNewCount} @@`,
    ...before.map((l) => ` ${l}`),
    ...oldLines.map((l) => `-${l}`),
    ...newLines.map((l) => `+${l}`),
    ...after.map((l) => ` ${l}`),
  ];
  return [`--- a/${filePath}`, `+++ b/${filePath}`, ...hunkLines].join("\n");
}

function parseTelegramChatIdFromSignalPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (record.channel !== "telegram") return null;

  const chatIdValue = record.chatId;
  if (typeof chatIdValue === "string" && chatIdValue.trim()) {
    return chatIdValue.trim();
  }
  if (typeof chatIdValue === "number" && Number.isFinite(chatIdValue)) {
    return String(Math.trunc(chatIdValue));
  }
  return null;
}

function parseTelegramChatIdFromUpdate(update: unknown): string | null {
  if (!update || typeof update !== "object") return null;
  const entry = update as Record<string, unknown>;

  const message =
    (entry.message as Record<string, unknown> | undefined) ??
    (entry.edited_message as Record<string, unknown> | undefined) ??
    (entry.channel_post as Record<string, unknown> | undefined);

  if (message?.chat && typeof message.chat === "object") {
    const chat = message.chat as Record<string, unknown>;
    const id = chat.id;
    if (typeof id === "string" && id.trim()) return id.trim();
    if (typeof id === "number" && Number.isFinite(id)) return String(Math.trunc(id));
  }

  const callbackQuery = entry.callback_query;
  if (callbackQuery && typeof callbackQuery === "object") {
    const callback = callbackQuery as Record<string, unknown>;
    const callbackMessage = callback.message;
    if (callbackMessage && typeof callbackMessage === "object") {
      const messageRecord = callbackMessage as Record<string, unknown>;
      if (messageRecord.chat && typeof messageRecord.chat === "object") {
        const chat = messageRecord.chat as Record<string, unknown>;
        const id = chat.id;
        if (typeof id === "string" && id.trim()) return id.trim();
        if (typeof id === "number" && Number.isFinite(id)) return String(Math.trunc(id));
      }
    }
  }

  return null;
}

async function resolveTelegramChatId(
  ctx: ToolContext,
  token: string,
): Promise<{
  chatId: string | null;
  source: "config-default" | "recent-signal" | "get-updates" | "none";
  detail?: string;
}> {
  // 1. Check in-memory ctx.config first (fast path, already warm).
  const inMemoryChatId = ctx.config?.gateway?.telegramDefaultChatId;
  if (inMemoryChatId) {
    return { chatId: inMemoryChatId, source: "config-default" };
  }

  // 2. Re-read config from disk — the gateway process may have auto-persisted a chatId
  //    via ensureTrustedTelegramChat since this tool context was created. Keep ctx.config
  //    in sync so subsequent calls in the same session don't need to re-read.
  const freshConfig = readGrindConfig();
  const freshChatId = freshConfig?.gateway?.telegramDefaultChatId;
  if (freshChatId) {
    if (ctx.config?.gateway) {
      ctx.config = {
        ...ctx.config,
        gateway: { ...ctx.config.gateway, telegramDefaultChatId: freshChatId },
      };
    }
    return { chatId: freshChatId, source: "config-default" };
  }

  // 3. Scan recent webhook signals — Telegram messages received by the gateway are stored
  //    as signals with payload.channel = 'telegram' and payload.chatId.
  const recentRows = await ctx.db.query.signals.findMany({
    where: and(eq(signals.userId, ctx.userId), eq(signals.source, "webhook")),
    orderBy: [desc(signals.detectedAt)],
    limit: 100,
  });

  for (const row of recentRows) {
    const candidate = parseTelegramChatIdFromSignalPayload(row.payload);
    if (candidate) {
      // Persist so future calls within this session and across processes don't need to scan.
      persistTelegramDefaultChatId(ctx, candidate);
      return { chatId: candidate, source: "recent-signal" };
    }
  }

  // 4. Last resort: call Telegram getUpdates directly. Works when no outgoing webhook is
  //    registered via setWebhook on Telegram's side. If one is, Telegram returns 409 —
  //    handled below. Note: telegramWebhookSecret in config is a local auth secret between
  //    the polling listener and the gateway HTTP server; it does NOT indicate a Telegram
  //    webhook registration and must not be used as a proxy for that.
  const updatesResponse = await fetch(
    `https://api.telegram.org/bot${token}/getUpdates?limit=50&timeout=0`,
    {
      method: "GET",
    },
  );

  const updatesRaw = await updatesResponse.text();
  if (!updatesResponse.ok) {
    if (updatesResponse.status === 409) {
      return {
        chatId: null,
        source: "none",
        detail:
          "Send any message to your Telegram bot and I'll respond automatically. The chat ID will be captured on first contact.",
      };
    }

    return {
      chatId: null,
      source: "none",
      detail: `Telegram getUpdates failed (${updatesResponse.status}). Check that the bot token is valid.`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(updatesRaw);
  } catch {
    return { chatId: null, source: "none", detail: "Telegram getUpdates returned invalid JSON." };
  }

  if (!parsed || typeof parsed !== "object") {
    return {
      chatId: null,
      source: "none",
      detail: "Telegram getUpdates returned an empty response.",
    };
  }

  const result = (parsed as Record<string, unknown>).result;
  if (!Array.isArray(result) || result.length === 0) {
    return {
      chatId: null,
      source: "none",
      detail:
        "No messages received yet. Send any message to your Telegram bot and I'll be able to reach you.",
    };
  }

  for (let i = result.length - 1; i >= 0; i -= 1) {
    const candidate = parseTelegramChatIdFromUpdate(result[i]);
    if (candidate) {
      persistTelegramDefaultChatId(ctx, candidate);
      return { chatId: candidate, source: "get-updates" };
    }
  }

  return {
    chatId: null,
    source: "none",
    detail: "Could not infer Telegram chat ID from recent messages.",
  };
}

function persistTelegramDefaultChatId(ctx: ToolContext, chatId: string): void {
  if (!ctx.config?.gateway) return;

  if (ctx.config.gateway.telegramDefaultChatId === chatId) return;

  // Keep the in-memory ctx.config in sync for subsequent calls in this session.
  ctx.config = {
    ...ctx.config,
    gateway: {
      ...ctx.config.gateway,
      telegramDefaultChatId: chatId,
    },
  };

  // Re-read from disk before writing to avoid overwriting changes made by other processes
  // (e.g., the gateway or CLI commands) since this context was created.
  const onDisk = readGrindConfig();
  if (!onDisk?.gateway) return;
  writeGrindConfig({ ...onDisk, gateway: { ...onDisk.gateway, telegramDefaultChatId: chatId } });
}

const FORGE_TRIGGER_TYPES = ["cron", "event", "signal", "webhook", "manual"] as const;
type ForgeSupportedTriggerType = (typeof FORGE_TRIGGER_TYPES)[number];

const FORGE_ACTION_TYPES = [
  "queue-quest",
  "log-to-vault",
  "send-notification",
  "run-script",
] as const;
type ForgeSupportedActionType = (typeof FORGE_ACTION_TYPES)[number];

const FORGE_NOTIFICATION_CHANNELS = ["console", "telegram", "webhook", "whatsapp"] as const;
type ForgeNotificationChannel = (typeof FORGE_NOTIFICATION_CHANNELS)[number];

const FORGE_WEBHOOK_CHANNEL_TAGS = ["webhook", "telegram", "discord", "whatsapp"] as const;

const SIMPLE_CRON_FIELD_REGEX = /^[\d*/,\-]+$/;

const FORGE_SENSITIVE_KEYS = [
  "token",
  "accessToken",
  "apiKey",
  "secret",
  "appSecret",
  "authorization",
  "bearer",
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asIdentifierString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  return null;
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function parseForgeNotificationChannel(value: unknown): ForgeNotificationChannel | null {
  const parsed = asNonEmptyString(value)?.toLowerCase();
  if (!parsed) return null;
  return (FORGE_NOTIFICATION_CHANNELS as readonly string[]).includes(parsed)
    ? (parsed as ForgeNotificationChannel)
    : null;
}

function isLikelyValidCronExpression(expression: string): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  return fields.every((field) => SIMPLE_CRON_FIELD_REGEX.test(field));
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function redactForgeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactForgeValue(entry));
  }

  const record = asRecord(value);
  if (!record) return value;

  const redacted: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(record)) {
    if ((FORGE_SENSITIVE_KEYS as readonly string[]).includes(key)) {
      redacted[key] = "[REDACTED]";
      continue;
    }
    redacted[key] = redactForgeValue(nestedValue);
  }

  return redacted;
}

async function normalizeForgeRuleDefinition(
  ctx: ToolContext,
  input: {
    triggerType: ForgeSupportedTriggerType;
    triggerConfig: Record<string, unknown>;
    actionType: ForgeSupportedActionType;
    actionConfig: Record<string, unknown>;
  },
): Promise<
  | {
      ok: true;
      triggerConfig: Record<string, unknown>;
      actionConfig: Record<string, unknown>;
    }
  | { ok: false; error: string }
> {
  const triggerConfig: Record<string, unknown> = { ...input.triggerConfig };
  const actionConfig: Record<string, unknown> = { ...input.actionConfig };

  switch (input.triggerType) {
    case "cron": {
      const cron = asNonEmptyString(triggerConfig.cron);
      if (!cron) {
        return {
          ok: false,
          error: "cron trigger requires triggerConfig.cron (5-field expression).",
        };
      }

      const normalizedCron = cron.replace(/\s+/g, " ");
      if (!isLikelyValidCronExpression(normalizedCron)) {
        return {
          ok: false,
          error: `Invalid cron expression '${cron}'. Expected 5 fields (minute hour day month weekday).`,
        };
      }

      triggerConfig.cron = normalizedCron;
      const timezone = asNonEmptyString(triggerConfig.timezone);
      if (triggerConfig.timezone !== undefined && !timezone) {
        return {
          ok: false,
          error: "triggerConfig.timezone must be a non-empty string when provided.",
        };
      }
      if (timezone) triggerConfig.timezone = timezone;
      break;
    }

    case "signal": {
      const source = asNonEmptyString(triggerConfig.source)?.toLowerCase();
      if (source !== "git" && source !== "file" && source !== "process") {
        return {
          ok: false,
          error:
            "signal trigger requires triggerConfig.source as one of 'git', 'file', or 'process'.",
        };
      }

      triggerConfig.source = source;

      if (source === "file") {
        const filePath =
          asNonEmptyString(triggerConfig.path) ??
          asNonEmptyString(triggerConfig.filePath) ??
          asNonEmptyString(triggerConfig.targetPath);
        if (!filePath) {
          return {
            ok: false,
            error: "file signal trigger requires triggerConfig.path (or filePath/targetPath).",
          };
        }
        triggerConfig.path = filePath;
      }

      if (source === "process") {
        const processMatch =
          asNonEmptyString(triggerConfig.processName) ??
          asNonEmptyString(triggerConfig.name) ??
          asNonEmptyString(triggerConfig.match);
        if (!processMatch) {
          return {
            ok: false,
            error: "process signal trigger requires triggerConfig.processName (or name/match).",
          };
        }

        const mode = asNonEmptyString(triggerConfig.matchMode)?.toLowerCase() ?? "contains";
        if (mode !== "contains" && mode !== "exact" && mode !== "regex") {
          return {
            ok: false,
            error: "triggerConfig.matchMode must be one of 'contains', 'exact', or 'regex'.",
          };
        }

        triggerConfig.processName = processMatch;
        triggerConfig.matchMode = mode;
      }

      break;
    }

    case "webhook": {
      const channel = asNonEmptyString(triggerConfig.channel)?.toLowerCase();
      if (channel && !(FORGE_WEBHOOK_CHANNEL_TAGS as readonly string[]).includes(channel)) {
        return {
          ok: false,
          error:
            "triggerConfig.channel must be one of 'webhook', 'telegram', 'discord', or 'whatsapp'.",
        };
      }

      if (channel) triggerConfig.channel = channel;

      if (triggerConfig.eventName !== undefined) {
        const eventName = asNonEmptyString(triggerConfig.eventName);
        if (!eventName) {
          return {
            ok: false,
            error: "triggerConfig.eventName must be a non-empty string when provided.",
          };
        }
        triggerConfig.eventName = eventName;
      }
      break;
    }

    case "event": {
      if (triggerConfig.eventName !== undefined) {
        const eventName = asNonEmptyString(triggerConfig.eventName);
        if (!eventName) {
          return {
            ok: false,
            error: "triggerConfig.eventName must be a non-empty string when provided.",
          };
        }
        triggerConfig.eventName = eventName;
      }
      break;
    }

    case "manual":
      break;
  }

  switch (input.actionType) {
    case "queue-quest": {
      const questId =
        asNonEmptyString(actionConfig.questId) ?? asNonEmptyString(actionConfig.targetQuestId);
      if (!questId) {
        return { ok: false, error: "queue-quest action requires actionConfig.questId." };
      }

      const quest = await getQuestById(ctx.db, questId);
      if (!quest || quest.userId !== ctx.userId) {
        return {
          ok: false,
          error: "queue-quest action requires a valid questId owned by the current user.",
        };
      }

      if (quest.status === "completed") {
        return {
          ok: false,
          error: "queue-quest action cannot target a quest that is already completed.",
        };
      }

      actionConfig.questId = quest.id;
      break;
    }

    case "log-to-vault": {
      const activityTypeRaw = asNonEmptyString(actionConfig.activityType);
      if (activityTypeRaw) {
        const parsed = activityTypeSchema.safeParse(activityTypeRaw);
        if (!parsed.success) {
          return {
            ok: false,
            error:
              "log-to-vault actionConfig.activityType must be one of: 'workout', 'study', 'coding', 'music', 'cooking', 'reading', 'meditation', 'other'.",
          };
        }
        actionConfig.activityType = parsed.data;
      }

      if (actionConfig.durationMinutes !== undefined) {
        const duration = parsePositiveInt(actionConfig.durationMinutes);
        if (!duration) {
          return {
            ok: false,
            error: "log-to-vault actionConfig.durationMinutes must be a positive integer.",
          };
        }
        actionConfig.durationMinutes = duration;
      }

      const difficultyRaw = asNonEmptyString(actionConfig.difficulty);
      if (difficultyRaw) {
        const parsedDifficulty = questDifficultySchema.safeParse(difficultyRaw);
        if (!parsedDifficulty.success) {
          return {
            ok: false,
            error:
              "log-to-vault actionConfig.difficulty must be one of: 'easy', 'medium', 'hard', 'epic'.",
          };
        }
        actionConfig.difficulty = parsedDifficulty.data;
      }

      if (actionConfig.title !== undefined) {
        const title = asNonEmptyString(actionConfig.title);
        if (!title) {
          return {
            ok: false,
            error: "log-to-vault actionConfig.title must be a non-empty string when provided.",
          };
        }
        actionConfig.title = title;
      }
      break;
    }

    case "send-notification": {
      const channel = parseForgeNotificationChannel(actionConfig.channel) ?? "console";
      actionConfig.channel = channel;

      if (channel === "telegram") {
        const tokenFromConfig = asNonEmptyString(ctx.config?.gateway?.telegramBotToken);
        const token =
          asNonEmptyString(actionConfig.token) ??
          tokenFromConfig ??
          asNonEmptyString(process.env.GRIND_TELEGRAM_BOT_TOKEN);
        if (!token) {
          return {
            ok: false,
            error:
              "telegram notifications require a bot token via actionConfig.token, gateway.telegramBotToken, or GRIND_TELEGRAM_BOT_TOKEN.",
          };
        }

        let chatId =
          asIdentifierString(actionConfig.chatId) ??
          asIdentifierString(actionConfig.telegramChatId) ??
          asIdentifierString(ctx.config?.gateway?.telegramDefaultChatId);

        if (!chatId) {
          const resolved = await resolveTelegramChatId(ctx, token);
          if (!resolved.chatId) {
            return {
              ok: false,
              error:
                resolved.detail ??
                "telegram notifications require a chat ID. Send /start to your bot first, or set gateway.telegramDefaultChatId.",
            };
          }

          chatId = resolved.chatId;
          if (resolved.source === "recent-signal" || resolved.source === "get-updates") {
            persistTelegramDefaultChatId(ctx, resolved.chatId);
          }
        }

        actionConfig.chatId = chatId;
        if (!asNonEmptyString(actionConfig.token) && tokenFromConfig) {
          actionConfig.token = tokenFromConfig;
        }
      }

      if (channel === "webhook") {
        const url = asNonEmptyString(actionConfig.url) ?? asNonEmptyString(actionConfig.webhookUrl);
        if (!url || !isValidHttpUrl(url)) {
          return {
            ok: false,
            error: "webhook notifications require actionConfig.url with a valid http(s) URL.",
          };
        }
        actionConfig.url = url;
      }

      if (channel === "whatsapp") {
        const phoneNumberId =
          asNonEmptyString(actionConfig.phoneNumberId) ??
          asNonEmptyString(ctx.config?.gateway?.whatsAppPhoneNumberId);
        const recipient =
          asNonEmptyString(actionConfig.to) ?? asNonEmptyString(actionConfig.recipientId);
        if (!phoneNumberId || !recipient) {
          return {
            ok: false,
            error:
              "whatsapp notifications require actionConfig.phoneNumberId and actionConfig.to (recipient).",
          };
        }

        const tokenFromConfig = asNonEmptyString(ctx.config?.gateway?.whatsAppAccessToken);
        const token =
          asNonEmptyString(actionConfig.token) ??
          tokenFromConfig ??
          asNonEmptyString(process.env.GRIND_WHATSAPP_ACCESS_TOKEN);
        if (!token) {
          return {
            ok: false,
            error:
              "whatsapp notifications require actionConfig.token, gateway.whatsAppAccessToken, or GRIND_WHATSAPP_ACCESS_TOKEN.",
          };
        }

        actionConfig.phoneNumberId = phoneNumberId;
        actionConfig.to = recipient;
        if (!asNonEmptyString(actionConfig.token) && tokenFromConfig) {
          actionConfig.token = tokenFromConfig;
        }
      }

      const messageContent =
        asNonEmptyString(actionConfig.message) ??
        asNonEmptyString(actionConfig.text) ??
        asNonEmptyString(actionConfig.script);
      if (!messageContent) {
        return {
          ok: false,
          error:
            "send-notification requires actionConfig.message (static text) or actionConfig.script (shell command whose stdout becomes the message).",
        };
      }

      break;
    }

    case "run-script": {
      const script = asNonEmptyString(actionConfig.script);
      if (!script) {
        return {
          ok: false,
          error: "run-script requires actionConfig.script (shell command to execute).",
        };
      }

      actionConfig.script = script;

      if (actionConfig.timeout !== undefined) {
        const timeout = parsePositiveInt(actionConfig.timeout);
        if (!timeout) {
          return {
            ok: false,
            error: "run-script actionConfig.timeout must be a positive integer (milliseconds).",
          };
        }
        actionConfig.timeout = timeout;
      }

      if (actionConfig.workdir !== undefined) {
        const workdir = asNonEmptyString(actionConfig.workdir);
        if (!workdir) {
          return {
            ok: false,
            error: "run-script actionConfig.workdir must be a non-empty string when provided.",
          };
        }
        actionConfig.workdir = workdir;
      }

      break;
    }
  }

  return {
    ok: true,
    triggerConfig,
    actionConfig,
  };
}

export function createGrindTools(ctx: ToolContext) {
  return {
    get_integrations_status: tool({
      description:
        "Return current integration configuration for channels (Telegram, WhatsApp, Discord) and services (Google Calendar, Gmail). Use this before claiming whether integrations are connected.",
      inputSchema: z.object({}),
      execute: async () => {
        const gateway = ctx.config?.gateway;
        const services = ctx.config?.services;
        const googleConfig = services?.google;
        const googleToken = getOAuthToken(GOOGLE_OAUTH_KEY);

        const whatsAppMode = gateway?.whatsAppMode ?? "none";

        return {
          channels: {
            gatewayConfigured: Boolean(gateway),
            gatewayEnabled: gateway?.enabled ?? false,
            telegram: {
              connected: Boolean(gateway?.telegramBotToken),
              webhookPath: gateway?.telegramWebhookPath ?? "/hooks/telegram",
            },
            discord: {
              configured: Boolean(gateway?.discordPublicKey),
              webhookPath: gateway?.discordWebhookPath ?? "/hooks/discord",
            },
            whatsApp: {
              mode: whatsAppMode,
              linked: Boolean(gateway?.whatsAppLinkedAt),
              cloudApiConfigured: Boolean(
                gateway?.whatsAppAccessToken && gateway?.whatsAppPhoneNumberId,
              ),
              webhookPath: gateway?.whatsAppWebhookPath ?? "/hooks/whatsapp",
            },
          },
          services: {
            google: {
              connected: Boolean(googleToken),
              email: googleConfig?.email ?? null,
              calendarEnabled: googleConfig?.calendarEnabled ?? false,
              gmailEnabled: googleConfig?.gmailEnabled ?? false,
              pollIntervalSeconds: googleConfig?.pollIntervalSeconds ?? 300,
            },
          },
          note: "Channel automations require the gateway process to be running. Google services sync automatically while the gateway runs.",
        };
      },
    }),

    list_calendars: tool({
      description:
        'List all Google Calendars in the user\'s calendar list (primary, shared, subscribed, "Other calendars", etc.). ' +
        "Returns each calendar's id, summary (name), timeZone, primary flag, accessRole (owner/writer/reader/freeBusyReader), " +
        "and selected flag (true = checkbox is ticked in the Google Calendar UI — i.e. the calendar is currently active/visible). " +
        "Use this to discover calendar IDs and to see which calendars are currently selected before querying events.",
      inputSchema: z.object({}),
      execute: async () => {
        const googleConfig = ctx.config?.services?.google;
        if (!googleConfig) {
          return {
            ok: false,
            error: "Google account not connected. Run `grindxp integrations connect google`.",
          };
        }
        try {
          const calendars = await listCalendars(googleConfig);
          return { ok: true, calendars, count: calendars.length };
        } catch (err) {
          return { ok: false, error: classifyGoogleError(err) };
        }
      },
    }),

    get_calendar_events: tool({
      description:
        "List events from Google Calendar. " +
        'IMPORTANT: For any general "what\'s on my calendar", "show my week", or "all events" query, always set allCalendars: true — ' +
        "this fetches from every calendar the user has checked/selected in their calendar UI (Google, Birthdays, Study, shared calendars, etc.), " +
        "not just the primary calendar. " +
        "Only set a specific calendarId when the user explicitly targets one calendar by name.",
      inputSchema: z.object({
        timeMin: z.string().describe("Start of time range (ISO 8601, e.g. 2026-02-21T00:00:00Z)"),
        timeMax: z.string().describe("End of time range (ISO 8601, e.g. 2026-02-22T00:00:00Z)"),
        allCalendars: z
          .boolean()
          .optional()
          .describe(
            "When true, fetches events from all calendars the user has selected/checked in their calendar UI " +
              "(selected: true in calendarList). Events are merged, deduplicated, and sorted by start time. " +
              "Each event includes calendarId and calendarName for attribution. " +
              "Use this for all general calendar queries.",
          ),
        calendarId: z
          .string()
          .optional()
          .describe(
            "Specific calendar ID to query. Only use when the user explicitly targets one calendar by name. " +
              "Use list_calendars to discover available calendar IDs. Ignored when allCalendars is true.",
          ),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(250)
          .optional()
          .describe(
            "Maximum number of events to return (default 50; when allCalendars is true, this is per calendar)",
          ),
      }),
      execute: async ({ timeMin, timeMax, allCalendars, calendarId, maxResults }) => {
        const googleConfig = ctx.config?.services?.google;
        if (!googleConfig) {
          return {
            ok: false,
            error: "Google account not connected. Run `grindxp integrations connect google`.",
          };
        }
        try {
          if (allCalendars) {
            const calendars = await listCalendars(googleConfig);
            const selected = calendars.filter((c) => c.selected === true);

            if (selected.length === 0) {
              return {
                ok: true,
                events: [],
                count: 0,
                calendarsQueried: [],
                note: "No selected calendars found.",
              };
            }

            const results = await Promise.allSettled(
              selected.map((cal) =>
                listCalendarEvents(googleConfig, {
                  calendarId: cal.id,
                  timeMin,
                  timeMax,
                  maxResults: maxResults ?? 50,
                }).then((r) => ({ cal, events: r.events })),
              ),
            );

            type TaggedEvent = CalendarEvent & { calendarId: string; calendarName: string };
            const calendarsQueried: { id: string; name: string }[] = [];
            const calendarsSkipped: { id: string; name: string; error: string }[] = [];
            const seen = new Set<string>();
            const merged: TaggedEvent[] = [];

            for (let i = 0; i < results.length; i++) {
              const result = results[i];
              const cal = selected[i];
              if (!result || !cal) continue;
              if (result.status === "fulfilled") {
                calendarsQueried.push({ id: cal.id, name: cal.summary });
                for (const event of result.value.events) {
                  if (!seen.has(event.id)) {
                    seen.add(event.id);
                    merged.push({ ...event, calendarId: cal.id, calendarName: cal.summary });
                  }
                }
              } else {
                const reason = (result as PromiseRejectedResult).reason;
                calendarsSkipped.push({
                  id: cal.id,
                  name: cal.summary,
                  error: reason instanceof Error ? reason.message : String(reason),
                });
              }
            }

            merged.sort((a, b) => {
              const aTime = a.start.dateTime ?? a.start.date ?? "";
              const bTime = b.start.dateTime ?? b.start.date ?? "";
              return aTime < bTime ? -1 : aTime > bTime ? 1 : 0;
            });

            return {
              ok: true,
              events: merged,
              count: merged.length,
              calendarsQueried,
              ...(calendarsSkipped.length > 0 ? { calendarsSkipped } : {}),
            };
          }

          const result = await listCalendarEvents(googleConfig, {
            timeMin,
            timeMax,
            ...(calendarId ? { calendarId } : {}),
            maxResults: maxResults ?? 50,
          });
          return { ok: true, events: result.events, count: result.events.length };
        } catch (err) {
          return { ok: false, error: classifyGoogleError(err) };
        }
      },
    }),

    create_calendar_event: tool({
      description:
        "Create a new event in Google Calendar. " +
        "If the user names a specific calendar (anything other than 'primary'), call list_calendars first to resolve its id, then pass that id as calendarId. " +
        "If the calendar does not exist yet, call create_calendar first, then use the returned id.",
      inputSchema: z.object({
        summary: z.string().min(1).max(500).describe("Event title"),
        startDateTime: z.string().describe("Start time (ISO 8601, e.g. 2026-02-21T09:00:00)"),
        endDateTime: z.string().describe("End time (ISO 8601, e.g. 2026-02-21T10:00:00)"),
        description: z.string().optional().describe("Event description or notes"),
        location: z.string().optional().describe("Event location"),
        attendees: z
          .array(z.string().email())
          .optional()
          .describe("List of attendee email addresses"),
        allDay: z
          .boolean()
          .optional()
          .describe("If true, treats startDateTime/endDateTime as dates (YYYY-MM-DD)"),
        timeZone: z.string().optional().describe("IANA timezone name (e.g. America/New_York)"),
        calendarId: z
          .string()
          .optional()
          .describe(
            "Calendar ID to create the event in. Use list_calendars to resolve a calendar name to its id. Defaults to the primary calendar.",
          ),
      }),
      execute: async ({
        summary,
        startDateTime,
        endDateTime,
        description,
        location,
        attendees,
        allDay,
        timeZone,
        calendarId,
      }) => {
        const googleConfig = ctx.config?.services?.google;
        if (!googleConfig) {
          return {
            ok: false,
            error: "Google account not connected. Run `grindxp integrations connect google`.",
          };
        }
        try {
          const event = await createCalendarEvent(
            googleConfig,
            {
              summary,
              startDateTime,
              endDateTime,
              ...(description ? { description } : {}),
              ...(location ? { location } : {}),
              ...(attendees ? { attendees } : {}),
              ...(allDay ? { allDay } : {}),
              ...(timeZone ? { timeZone } : {}),
            },
            calendarId ?? "primary",
          );
          return { ok: true, event };
        } catch (err) {
          return { ok: false, error: classifyGoogleError(err) };
        }
      },
    }),

    create_calendar: tool({
      description:
        "Create a new Google Calendar. After creation, use the returned id with create_calendar_event to add events to it. " +
        "Use this when the user asks to create a calendar that does not yet exist in their list.",
      inputSchema: z.object({
        summary: z.string().min(1).max(255).describe("Calendar name (e.g. 'Work', 'God', 'Study')"),
        timeZone: z
          .string()
          .optional()
          .describe("IANA timezone name for the calendar (e.g. America/Sao_Paulo)"),
      }),
      execute: async ({ summary, timeZone }) => {
        const googleConfig = ctx.config?.services?.google;
        if (!googleConfig) {
          return {
            ok: false,
            error: "Google account not connected. Run `grindxp integrations connect google`.",
          };
        }
        try {
          const calendar = await createCalendar(googleConfig, summary, timeZone);
          return { ok: true, calendar };
        } catch (err) {
          return { ok: false, error: classifyGoogleError(err) };
        }
      },
    }),

    update_calendar_event: tool({
      description:
        "Update an existing Google Calendar event (partial patch — only provided fields are changed).",
      inputSchema: z.object({
        eventId: z.string().min(1).describe("Google Calendar event ID"),
        calendarId: z.string().optional().describe("Calendar ID (default: primary)"),
        summary: z.string().optional().describe("New event title"),
        startDateTime: z.string().optional().describe("New start time (ISO 8601)"),
        endDateTime: z.string().optional().describe("New end time (ISO 8601)"),
        description: z.string().optional().describe("New description"),
        location: z.string().optional().describe("New location"),
        attendees: z.array(z.string().email()).optional().describe("Replace attendee list"),
        timeZone: z.string().optional().describe("IANA timezone name"),
      }),
      execute: async ({
        eventId,
        calendarId,
        summary,
        startDateTime,
        endDateTime,
        description,
        location,
        attendees,
        timeZone,
      }) => {
        const googleConfig = ctx.config?.services?.google;
        if (!googleConfig) {
          return {
            ok: false,
            error: "Google account not connected. Run `grindxp integrations connect google`.",
          };
        }
        try {
          const patch = {
            ...(summary ? { summary } : {}),
            ...(startDateTime ? { startDateTime } : {}),
            ...(endDateTime ? { endDateTime } : {}),
            ...(description ? { description } : {}),
            ...(location ? { location } : {}),
            ...(attendees ? { attendees } : {}),
            ...(timeZone ? { timeZone } : {}),
          };
          const event = await updateCalendarEvent(
            googleConfig,
            eventId,
            patch,
            calendarId ?? "primary",
          );
          return { ok: true, event };
        } catch (err) {
          return { ok: false, error: classifyGoogleError(err) };
        }
      },
    }),

    delete_calendar_event: tool({
      description: "Delete a Google Calendar event.",
      inputSchema: z.object({
        eventId: z.string().min(1).describe("Google Calendar event ID"),
        calendarId: z.string().optional().describe("Calendar ID (default: primary)"),
      }),
      execute: async ({ eventId, calendarId }) => {
        const googleConfig = ctx.config?.services?.google;
        if (!googleConfig) {
          return {
            ok: false,
            error: "Google account not connected. Run `grindxp integrations connect google`.",
          };
        }
        try {
          await deleteCalendarEvent(googleConfig, eventId, calendarId ?? "primary");
          return { ok: true, eventId };
        } catch (err) {
          return { ok: false, error: classifyGoogleError(err) };
        }
      },
    }),

    get_emails: tool({
      description:
        'Search and list Gmail messages. Supports Gmail search syntax (e.g. "from:alice@example.com", "subject:invoice", "is:unread"). Requires Google account with Gmail enabled.',
      inputSchema: z.object({
        q: z
          .string()
          .optional()
          .describe(
            'Gmail search query (e.g. "from:alice is:unread", "subject:invoice after:2026/01/01")',
          ),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Maximum messages to return (default 10)"),
        includeBody: z
          .boolean()
          .optional()
          .describe(
            "If true, fetches full message body (slower). Default false returns subject/snippet only.",
          ),
      }),
      execute: async ({ q, maxResults, includeBody }) => {
        const googleConfig = ctx.config?.services?.google;
        if (!googleConfig?.gmailEnabled) {
          return {
            ok: false,
            error: "Gmail not enabled. Run `grindxp integrations connect google` and enable Gmail.",
          };
        }
        try {
          const messageRefs = await listMessages(googleConfig, {
            ...(q ? { q } : {}),
            maxResults: maxResults ?? 10,
          });
          const messages = await Promise.all(
            messageRefs.map((ref) => getMessage(googleConfig, ref.id, includeBody ?? false)),
          );
          return { ok: true, messages, count: messages.length };
        } catch (err) {
          if (err instanceof GoogleNotConnectedError) {
            return { ok: false, error: err.message };
          }
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    send_email: tool({
      description: "Send an email via Gmail. Requires Google account with Gmail enabled.",
      inputSchema: z.object({
        to: z.string().describe("Recipient email address"),
        subject: z.string().min(1).max(500).describe("Email subject"),
        body: z.string().min(1).describe("Plain text email body"),
        cc: z.string().optional().describe("CC email address (single address)"),
      }),
      execute: async ({ to, subject, body, cc }) => {
        const googleConfig = ctx.config?.services?.google;
        if (!googleConfig?.gmailEnabled) {
          return {
            ok: false,
            error: "Gmail not enabled. Run `grindxp integrations connect google` and enable Gmail.",
          };
        }
        try {
          const result = await sendEmail(googleConfig, {
            to,
            subject,
            body,
            ...(cc ? { cc } : {}),
          });
          return { ok: true, messageId: result.id, threadId: result.threadId };
        } catch (err) {
          if (err instanceof GoogleNotConnectedError) {
            return { ok: false, error: err.message };
          }
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    send_telegram_message: tool({
      description:
        "Send a Telegram message using the configured bot token. Use this for connection tests or proactive notifications when the user asks. The chat ID is resolved automatically — do not ask the user for it.",
      inputSchema: z.object({
        text: z.string().min(1).max(4000).describe("Message text to send"),
        chatId: z
          .string()
          .optional()
          .describe("Telegram chat ID. Omit to auto-resolve from config or recent activity."),
      }),
      execute: async ({ text, chatId }) => {
        const token =
          ctx.config?.gateway?.telegramBotToken ??
          process.env.GRIND_TELEGRAM_BOT_TOKEN ??
          undefined;

        if (!token) {
          return {
            ok: false,
            error:
              "Telegram bot token is not configured. Run `grindxp integrations setup telegram`.",
          };
        }

        let targetChatId = chatId ?? undefined;

        if (!targetChatId) {
          const resolved = await resolveTelegramChatId(ctx, token);
          if (!resolved.chatId) {
            return {
              ok: false,
              error: resolved.detail ?? "Could not resolve a Telegram chat ID automatically.",
            };
          }
          targetChatId = resolved.chatId;
        }

        const htmlText = markdownToTelegramHtml(text);
        const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: targetChatId, text: htmlText, parse_mode: "HTML" }),
        });

        const raw = await response.text();
        if (!response.ok) {
          let errDetail = "";
          try {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            errDetail =
              typeof parsed.description === "string"
                ? ` — ${parsed.description}`
                : ` (raw: ${raw})`;
          } catch {
            errDetail = ` (raw: ${raw})`;
          }
          return {
            ok: false,
            error: `Telegram send failed (HTTP ${response.status})${errDetail}`,
          };
        }

        return { ok: true, channel: "telegram", chatId: targetChatId };
      },
    }),

    list_forge_rules: tool({
      description:
        "List forge automation rules. Each rule includes xpImpact: true/false — use this to decide how to communicate the action to the user. Always call this before updating, deleting, or running a specific rule.",
      inputSchema: z.object({
        enabledOnly: z.boolean().optional().describe("When true, return only enabled rules."),
        includeRecentRuns: z
          .boolean()
          .default(true)
          .describe("When true, include recent execution history."),
        runsLimit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(10)
          .describe("Maximum number of recent runs to include."),
      }),
      execute: async ({ enabledOnly, includeRecentRuns, runsLimit }) => {
        const rules = await listForgeRulesByUser(
          ctx.db,
          ctx.userId,
          enabledOnly ? { enabledOnly: true } : undefined,
        );

        const runs = includeRecentRuns
          ? await listRecentForgeRunsByUser(ctx.db, ctx.userId, runsLimit)
          : [];

        return {
          count: rules.length,
          rules: rules.map((rule) => ({
            id: rule.id,
            shortId: rule.id.slice(0, 8),
            name: rule.name,
            enabled: rule.enabled,
            triggerType: rule.triggerType,
            actionType: rule.actionType,
            xpImpact: ["log-to-vault", "update-skill"].includes(rule.actionType),
            triggerConfig: redactForgeValue(rule.triggerConfig),
            actionConfig: redactForgeValue(rule.actionConfig),
            updatedAt: rule.updatedAt,
          })),
          ...(includeRecentRuns
            ? {
                recentRuns: runs.map((run) => ({
                  id: run.id,
                  ruleId: run.ruleId,
                  ruleShortId: run.ruleId.slice(0, 8),
                  triggerType: run.triggerType,
                  actionType: run.actionType,
                  status: run.status,
                  ...(run.error ? { error: run.error } : {}),
                  startedAt: run.startedAt,
                  finishedAt: run.finishedAt,
                })),
              }
            : {}),
        };
      },
    }),

    list_forge_runs: tool({
      description:
        "List forge run history globally or for a specific rule. Use this to inspect failures and delivery results.",
      inputSchema: z.object({
        ruleSearch: z
          .string()
          .optional()
          .describe("Optional rule ID prefix or rule name substring."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe("Maximum number of runs to return."),
      }),
      execute: async ({ ruleSearch, limit }) => {
        if (ruleSearch) {
          const rule = await findForgeRuleByPrefix(ctx.db, ctx.userId, ruleSearch);
          if (!rule) {
            return { error: `No forge rule matching "${ruleSearch}".` };
          }

          const runs = await listForgeRunsByRule(ctx.db, ctx.userId, rule.id, limit);
          return {
            count: runs.length,
            rule: {
              id: rule.id,
              shortId: rule.id.slice(0, 8),
              name: rule.name,
              enabled: rule.enabled,
            },
            runs: runs.map((run) => ({
              id: run.id,
              triggerType: run.triggerType,
              actionType: run.actionType,
              status: run.status,
              dedupeKey: run.dedupeKey,
              actionPayload: redactForgeValue(run.actionPayload),
              ...(run.error ? { error: run.error } : {}),
              startedAt: run.startedAt,
              finishedAt: run.finishedAt,
            })),
          };
        }

        const runs = await listRecentForgeRunsByUser(ctx.db, ctx.userId, limit);
        return {
          count: runs.length,
          runs: runs.map((run) => ({
            id: run.id,
            ruleId: run.ruleId,
            ruleShortId: run.ruleId.slice(0, 8),
            triggerType: run.triggerType,
            actionType: run.actionType,
            status: run.status,
            dedupeKey: run.dedupeKey,
            actionPayload: redactForgeValue(run.actionPayload),
            ...(run.error ? { error: run.error } : {}),
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
          })),
        };
      },
    }),

    create_forge_rule: tool({
      description:
        "Create a forge automation rule. send-notification and queue-quest have no XP impact — create autonomously. log-to-vault auto-awards XP — mention that in your reply. run-script executes a shell script — always show the full script in your reply.",
      inputSchema: z.object({
        name: z.string().min(2).max(128).describe("Human-readable rule name."),
        triggerType: z
          .enum(FORGE_TRIGGER_TYPES)
          .describe(
            "'cron': time-based schedule (provide triggerConfig.cron + timezone). " +
              "'webhook': HTTP-triggered or on-demand (triggerConfig: {}). " +
              "'manual': CLI-only execution (triggerConfig: {}). " +
              "'event'/'signal': internal system events.",
          ),
        triggerConfig: z
          .record(z.string(), z.unknown())
          .default({})
          .describe(
            "cron: { cron: '0 9 * * 1-5', timezone: 'America/Sao_Paulo' }. webhook/manual: {}.",
          ),
        actionType: z
          .enum(FORGE_ACTION_TYPES)
          .describe(
            "'run-script': execute a shell script. " +
              "'send-notification': send a message to a channel. " +
              "'queue-quest': schedule a quest. " +
              "'log-to-vault': log a completed activity (awards XP).",
          ),
        actionConfig: z
          .record(z.string(), z.unknown())
          .describe(
            "run-script: { script: '<REQUIRED: shell command>' [, timeout: <ms, default 30000>] [, workdir: '<path, supports ~>'] }. " +
              "send-notification: { channel: 'telegram|console|webhook|whatsapp', message: '<static text>' | script: '<shell command, stdout becomes message>' }. " +
              "queue-quest: { questId: '<REQUIRED>' }. " +
              "log-to-vault: { activityType: 'workout|study|coding|music|cooking|reading|meditation|other' (REQUIRED), durationMinutes: <int> (REQUIRED) [, difficulty: 'easy|medium|hard|epic'] [, title: '<string>'] }.",
          ),
        enabled: z.boolean().default(true).describe("Whether the rule starts enabled."),
      }),
      execute: async ({ name, triggerType, triggerConfig, actionType, actionConfig, enabled }) => {
        const normalized = await normalizeForgeRuleDefinition(ctx, {
          triggerType,
          triggerConfig,
          actionType,
          actionConfig,
        });
        if (!normalized.ok) {
          return { ok: false, error: normalized.error };
        }

        const rule = await insertForgeRule(ctx.db, {
          userId: ctx.userId,
          name,
          triggerType,
          triggerConfig: normalized.triggerConfig,
          actionType,
          actionConfig: normalized.actionConfig,
          enabled,
        });

        return {
          ok: true,
          rule: {
            id: rule.id,
            shortId: rule.id.slice(0, 8),
            name: rule.name,
            enabled: rule.enabled,
            triggerType: rule.triggerType,
            actionType: rule.actionType,
            triggerConfig: redactForgeValue(rule.triggerConfig),
            actionConfig: redactForgeValue(rule.actionConfig),
            createdAt: rule.createdAt,
            updatedAt: rule.updatedAt,
          },
        };
      },
    }),

    update_forge_rule: tool({
      description:
        "Update a forge rule by ID prefix or name. Call list_forge_rules first to confirm the target. Act autonomously — no permission needed unless changing to a log-to-vault action, in which case mention the XP impact in your reply.",
      inputSchema: z
        .object({
          ruleSearch: z.string().min(1).describe("Rule ID prefix or rule name substring."),
          name: z.string().min(2).max(128).optional().describe("New rule name."),
          triggerType: z
            .enum(FORGE_TRIGGER_TYPES)
            .optional()
            .describe(
              "'cron': time-based schedule (provide triggerConfig.cron + timezone). " +
                "'webhook': HTTP-triggered or on-demand (triggerConfig: {}). " +
                "'manual': CLI-only execution (triggerConfig: {}). " +
                "'event'/'signal': internal system events.",
            ),
          triggerConfig: z
            .record(z.string(), z.unknown())
            .optional()
            .describe(
              "cron: { cron: '0 9 * * 1-5', timezone: 'America/Sao_Paulo' }. webhook/manual: {}.",
            ),
          actionType: z
            .enum(FORGE_ACTION_TYPES)
            .optional()
            .describe(
              "'run-script': execute a shell script. " +
                "'send-notification': send a message to a channel. " +
                "'queue-quest': schedule a quest. " +
                "'log-to-vault': log a completed activity (awards XP).",
            ),
          actionConfig: z
            .record(z.string(), z.unknown())
            .optional()
            .describe(
              "run-script: { script: '<REQUIRED: shell command>' [, timeout: <ms>] [, workdir: '<path>'] }. " +
                "send-notification: { channel: 'telegram|console|webhook|whatsapp', message: '<text>' | script: '<shell cmd>' }. " +
                "queue-quest: { questId: '<REQUIRED>' }. " +
                "log-to-vault: { activityType: '...' (REQUIRED), durationMinutes: <int> (REQUIRED) }.",
            ),
          enabled: z.boolean().optional().describe("Enable or disable rule."),
        })
        .refine(
          (value) =>
            value.name !== undefined ||
            value.triggerType !== undefined ||
            value.triggerConfig !== undefined ||
            value.actionType !== undefined ||
            value.actionConfig !== undefined ||
            value.enabled !== undefined,
          {
            message: "Provide at least one field to update.",
          },
        ),
      execute: async ({
        ruleSearch,
        name,
        triggerType,
        triggerConfig,
        actionType,
        actionConfig,
        enabled,
      }) => {
        const rule = await findForgeRuleByPrefix(ctx.db, ctx.userId, ruleSearch);
        if (!rule) {
          return { ok: false, error: `No forge rule matching "${ruleSearch}".` };
        }

        const updatesDefinition =
          triggerType !== undefined ||
          triggerConfig !== undefined ||
          actionType !== undefined ||
          actionConfig !== undefined;

        let nextTriggerConfig = triggerConfig;
        let nextActionConfig = actionConfig;

        if (updatesDefinition) {
          const allowsEmptyTriggerConfig =
            triggerType === "webhook" || triggerType === "manual";

          if (
            triggerType !== undefined &&
            triggerConfig === undefined &&
            !allowsEmptyTriggerConfig
          ) {
            return {
              ok: false,
              error: "When changing triggerType, provide triggerConfig for the new trigger.",
            };
          }

          if (actionType !== undefined && actionConfig === undefined) {
            return {
              ok: false,
              error: "When changing actionType, provide actionConfig for the new action.",
            };
          }

          const resolvedTriggerType = (triggerType ??
            rule.triggerType) as ForgeSupportedTriggerType;
          if (!(FORGE_TRIGGER_TYPES as readonly string[]).includes(resolvedTriggerType)) {
            return {
              ok: false,
              error: `Unsupported trigger type '${rule.triggerType}' for agent updates.`,
            };
          }

          const resolvedActionType = (actionType ?? rule.actionType) as ForgeSupportedActionType;
          if (!(FORGE_ACTION_TYPES as readonly string[]).includes(resolvedActionType)) {
            return {
              ok: false,
              error: `Unsupported action type '${rule.actionType}' for agent updates.`,
            };
          }

          const normalized = await normalizeForgeRuleDefinition(ctx, {
            triggerType: resolvedTriggerType,
            triggerConfig:
              triggerConfig ??
              (triggerType !== undefined && allowsEmptyTriggerConfig
                ? {}
                : (asRecord(rule.triggerConfig) ?? {})),
            actionType: resolvedActionType,
            actionConfig: actionConfig ?? asRecord(rule.actionConfig) ?? {},
          });
          if (!normalized.ok) {
            return { ok: false, error: normalized.error };
          }

          nextTriggerConfig = normalized.triggerConfig;
          nextActionConfig = normalized.actionConfig;
        }

        const effectiveActionType = actionType ?? rule.actionType;
        const updated = await updateForgeRule(ctx.db, ctx.userId, rule.id, {
          ...(name !== undefined ? { name } : {}),
          ...(triggerType !== undefined ? { triggerType } : {}),
          ...((triggerConfig !== undefined || triggerType !== undefined) &&
          nextTriggerConfig !== undefined
            ? { triggerConfig: nextTriggerConfig }
            : {}),
          ...(actionType !== undefined ? { actionType } : {}),
          ...((actionConfig !== undefined || actionType !== undefined) &&
          nextActionConfig !== undefined
            ? { actionConfig: nextActionConfig }
            : {}),
          ...(enabled !== undefined ? { enabled } : {}),
        });

        if (!updated) {
          return { ok: false, error: "Failed to update forge rule." };
        }

        return {
          ok: true,
          rule: {
            id: updated.id,
            shortId: updated.id.slice(0, 8),
            name: updated.name,
            enabled: updated.enabled,
            triggerType: updated.triggerType,
            actionType: updated.actionType,
            triggerConfig: redactForgeValue(updated.triggerConfig),
            actionConfig: redactForgeValue(updated.actionConfig),
            createdAt: updated.createdAt,
            updatedAt: updated.updatedAt,
          },
        };
      },
    }),

    delete_forge_rule: tool({
      description:
        "Delete a forge rule by ID prefix or name. This is permanent — warn the user before calling this. Run history is also removed.",
      inputSchema: z.object({
        ruleSearch: z.string().min(1).describe("Rule ID prefix or rule name substring."),
      }),
      execute: async ({ ruleSearch }) => {
        const rule = await findForgeRuleByPrefix(ctx.db, ctx.userId, ruleSearch);
        if (!rule) {
          return { ok: false, error: `No forge rule matching "${ruleSearch}".` };
        }

        const perm = await requirePermission(
          ctx,
          "delete_forge_rule",
          `Permanently delete forge rule "${rule.name}"?`,
        );
        if (perm.denied) return { ok: false, error: "Deletion cancelled." };

        const deleted = await deleteForgeRule(ctx.db, ctx.userId, rule.id);
        if (!deleted) {
          return { ok: false, error: "Failed to delete forge rule." };
        }

        return {
          ok: true,
          deleted: true,
          rule: {
            id: rule.id,
            shortId: rule.id.slice(0, 8),
            name: rule.name,
          },
        };
      },
    }),

    batch_delete_forge_rules: tool({
      description:
        "Delete multiple forge rules at once. Call list_forge_rules first to collect rule IDs, then pass them here. One permission prompt covers the entire batch. Use this whenever the user asks to delete more than one rule (e.g. 'delete all', 'delete all of them', 'remove these').",
      inputSchema: z.object({
        ruleSearches: z
          .array(z.string().min(1))
          .min(1)
          .describe(
            "Array of rule ID prefixes or name substrings to delete. Use shortId or name values from list_forge_rules.",
          ),
      }),
      execute: async ({ ruleSearches }) => {
        const perm = await requirePermission(
          ctx,
          "batch_delete_forge_rules",
          `Permanently delete ${ruleSearches.length} forge rule(s)?`,
        );
        if (perm.denied) return { ok: false, error: "Deletion cancelled." };

        const rules = await listForgeRulesByUser(ctx.db, ctx.userId);
        const results: Array<
          | { ok: true; id: string; shortId: string; name: string }
          | { ok: false; search: string; error: string }
        > = [];
        const selectedById = new Map<string, string>();
        const toDelete: Array<{ id: string; name: string }> = [];

        for (const search of ruleSearches) {
          const lowerSearch = search.toLowerCase();
          const rule = rules.find(
            (r) => r.id.startsWith(search) || r.name.toLowerCase().includes(lowerSearch),
          );
          if (!rule) {
            results.push({ ok: false, search, error: `No forge rule matching "${search}".` });
            continue;
          }

          const priorSearch = selectedById.get(rule.id);
          if (priorSearch) {
            results.push({
              ok: false,
              search,
              error: `Duplicate target. "${search}" matches the same rule as "${priorSearch}".`,
            });
            continue;
          }

          selectedById.set(rule.id, search);
          toDelete.push({ id: rule.id, name: rule.name });
        }

        for (const rule of toDelete) {
          const deleted = await deleteForgeRule(ctx.db, ctx.userId, rule.id);
          if (deleted) {
            results.push({ ok: true, id: rule.id, shortId: rule.id.slice(0, 8), name: rule.name });
          } else {
            const search = selectedById.get(rule.id) ?? rule.id.slice(0, 8);
            results.push({ ok: false, search, error: `Failed to delete "${rule.name}".` });
          }
        }

        const succeeded = results.filter((r) => r.ok).length;
        const failed = results.length - succeeded;
        return { ok: true, deleted: succeeded, failed, total: ruleSearches.length, results };
      },
    }),

    run_forge_rule: tool({
      description:
        "Run a forge rule immediately by ID prefix or name. Check xpImpact from list_forge_rules first: if false (notifications, reminders), run autonomously; if true (log-to-vault), run and mention the XP award in your reply.",
      inputSchema: z.object({
        ruleSearch: z.string().min(1).describe("Rule ID prefix or rule name substring."),
        eventPayload: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Optional payload passed as event context for this run-now execution."),
        dryRun: z
          .boolean()
          .default(false)
          .describe("When true, skip execution and record as dry run."),
      }),
      execute: async ({ ruleSearch, eventPayload, dryRun }) => {
        const rule = await findForgeRuleByPrefix(ctx.db, ctx.userId, ruleSearch);
        if (!rule) {
          return { ok: false, error: `No forge rule matching "${ruleSearch}".` };
        }

        const result = await runForgeRuleNow({
          db: ctx.db,
          userId: ctx.userId,
          ruleId: rule.id,
          ...(eventPayload ? { eventPayload } : {}),
          dryRun,
        });

        const refreshedRule = await getForgeRuleById(ctx.db, rule.id);

        return {
          ok: true,
          rule: {
            id: rule.id,
            shortId: rule.id.slice(0, 8),
            name: rule.name,
            ...(refreshedRule ? { enabled: refreshedRule.enabled } : {}),
          },
          run: {
            status: result.status,
            actionType: result.actionType,
            dedupeKey: result.dedupeKey,
            ...(result.error ? { error: result.error } : {}),
            startedAt: result.startedAt,
            finishedAt: result.finishedAt,
          },
        };
      },
    }),

    get_status: tool({
      description:
        "Get the user's current status: level, XP, streak info, active quest count, and today's completions.",
      inputSchema: z.object({}),
      execute: async () => {
        const user = await getUserById(ctx.db, ctx.userId);
        if (!user) return { error: "User not found" };

        const allQuests = await listQuestsByUser(ctx.db, ctx.userId);
        const active = allQuests.filter((q) => q.status === "active");
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const completedToday = allQuests.filter(
          (q) => q.status === "completed" && q.completedAt && q.completedAt >= todayStart.getTime(),
        );

        const bestStreak = Math.max(0, ...allQuests.map((q) => q.streakCount));
        const streakInfo = calculateStreakInfo(bestStreak);

        const currentThreshold = xpForLevelThreshold(user.level);
        const nextThreshold = xpForLevelThreshold(user.level + 1);

        const timer = readTimer(ctx.timerPath);

        return {
          level: user.level,
          totalXp: user.totalXp,
          xpToNextLevel: nextThreshold - user.totalXp,
          xpProgress: user.totalXp - currentThreshold,
          xpNeeded: nextThreshold - currentThreshold,
          activeQuests: active.length,
          maxActiveQuests: 5,
          completedToday: completedToday.length,
          bestStreak,
          streakTier: streakInfo.tierName,
          streakBonus: streakInfo.totalBonus,
          timerRunning: timer !== null,
          timerQuest: timer?.questTitle ?? null,
          timerElapsed: timer ? formatElapsed(timer.startedAt) : null,
        };
      },
    }),

    list_quests: tool({
      description:
        "List quests. Optionally filter by status: active, completed, abandoned, available, failed.",
      inputSchema: z.object({
        status: z
          .enum(["active", "completed", "abandoned", "available", "failed"])
          .optional()
          .describe("Filter by quest status"),
      }),
      execute: async ({ status }) => {
        const filter = status ? [status] : undefined;
        const quests = await listQuestsByUser(ctx.db, ctx.userId, filter);
        return quests.map((q) => ({
          id: q.id.slice(0, 8),
          title: q.title,
          type: q.type,
          difficulty: q.difficulty,
          status: q.status,
          streakCount: q.streakCount,
          baseXp: q.baseXp,
          skillTags: q.skillTags,
          createdAt: new Date(q.createdAt).toLocaleDateString(),
        }));
      },
    }),

    create_quest: tool({
      description:
        "Create a new quest (commitment). The user has a max of 5 active quests. Choose type and difficulty wisely.",
      inputSchema: z.object({
        title: z.string().min(1).max(256).describe("Short, action-oriented title"),
        description: z.string().max(2000).optional().describe("What this commitment entails"),
        type: z
          .enum(["daily", "weekly", "epic", "bounty", "chain", "ritual"])
          .describe(
            "Quest type: daily (recurring), weekly, epic (multi-day), bounty (one-off), chain (sequential), ritual (habit)",
          ),
        difficulty: z
          .enum(["easy", "medium", "hard", "epic"])
          .describe("Difficulty affects XP multiplier: easy=1x, medium=1.5x, hard=2.5x, epic=4x"),
        skillTags: z
          .array(z.string())
          .default([])
          .describe('Skill categories this quest develops (e.g. "coding", "fitness")'),
        baseXp: z
          .number()
          .int()
          .positive()
          .default(10)
          .describe("Base XP before multipliers. 10=small, 25=medium, 50=large, 100=epic"),
      }),
      execute: async ({ title, description, type, difficulty, skillTags, baseXp }) => {
        const trust = requireTrust(ctx, "create_quest");
        if (trust.denied) return { error: trust.error };

        const active = await listQuestsByUser(ctx.db, ctx.userId, ["active"]);
        if (active.length >= 5) {
          return { error: "Max 5 active quests. Complete or abandon one first." };
        }

        const quest = await createQuest(ctx.db, {
          userId: ctx.userId,
          title,
          description,
          type: type as QuestType,
          difficulty: difficulty as QuestDifficulty,
          skillTags,
          baseXp,
          objectives: [],
          metadata: {},
        });

        return {
          id: quest.id.slice(0, 8),
          title: quest.title,
          type: quest.type,
          difficulty: quest.difficulty,
          baseXp: quest.baseXp,
          status: quest.status,
        };
      },
    }),

    complete_quest: tool({
      description:
        "Complete a quest. Awards XP with multipliers. Prefer timer proof (1.5x) over self-report (1x).",
      inputSchema: z.object({
        questSearch: z.string().describe("Quest ID prefix or title substring to find the quest"),
        proofType: z
          .enum(["self-report", "duration"])
          .default("self-report")
          .describe(
            "How completion is proven. duration=timer was used (1.5x XP), self-report=manual (1.0x)",
          ),
        durationMinutes: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Duration in minutes if timer proof"),
      }),
      execute: async ({ questSearch, proofType, durationMinutes }) => {
        const trust = requireTrust(ctx, "complete_quest");
        if (trust.denied) return { error: trust.error };

        const quest = await findQuestByPrefix(ctx.db, ctx.userId, questSearch);
        if (!quest) return { error: `No quest matching "${questSearch}"` };
        if (quest.status === "completed") return { error: "Quest already completed" };
        if (quest.status === "abandoned") return { error: "Cannot complete an abandoned quest" };

        const prevUser = await getUserById(ctx.db, ctx.userId);
        const result = await completeQuest(ctx.db, {
          questId: quest.id,
          userId: ctx.userId,
          proofType,
          durationMinutes,
          proofData: {},
        });

        const updatedUser = await getUserById(ctx.db, ctx.userId);
        const leveledUp = updatedUser && prevUser ? updatedUser.level > prevUser.level : false;

        return {
          quest: quest.title,
          xpEarned: result.xpEarned,
          proofType,
          leveledUp,
          newLevel: updatedUser?.level,
          newTotalXp: updatedUser?.totalXp,
          skillGains: result.skillGains.map((g) => ({
            name: g.name,
            xpGained: g.xpGained,
            level: g.levelAfter,
            leveledUp: g.leveledUp,
          })),
        };
      },
    }),

    abandon_quest: tool({
      description:
        "Abandon a quest. This breaks the streak and is irreversible. Push back — ask if the user is sure.",
      inputSchema: z.object({
        questSearch: z.string().describe("Quest ID prefix or title substring"),
      }),
      execute: async ({ questSearch }) => {
        const trust = requireTrust(ctx, "abandon_quest");
        if (trust.denied) return { error: trust.error };

        const quest = await findQuestByPrefix(ctx.db, ctx.userId, questSearch);
        if (!quest) return { error: `No quest matching "${questSearch}"` };
        if (quest.status !== "active") return { error: `Quest is ${quest.status}, not active` };

        await updateQuestStatus(ctx.db, quest.id, ctx.userId, "abandoned");

        return {
          quest: quest.title,
          streakLost: quest.streakCount,
          message: `Streak of ${quest.streakCount} days lost. That commitment is gone.`,
        };
      },
    }),

    start_timer: tool({
      description:
        "Start a timer for a quest. Timer proof gives 1.5x XP. Only one timer can run at a time.",
      inputSchema: z.object({
        questSearch: z.string().describe("Quest ID prefix or title substring"),
      }),
      execute: async ({ questSearch }) => {
        const trust = requireTrust(ctx, "start_timer");
        if (trust.denied) return { error: trust.error };

        const existing = readTimer(ctx.timerPath);
        if (existing) {
          const elapsed = formatElapsed(existing.startedAt);
          return {
            error: `Timer already running for "${existing.questTitle}" (${elapsed}). Stop it first.`,
          };
        }

        const quest = await findQuestByPrefix(ctx.db, ctx.userId, questSearch);
        if (!quest) return { error: `No quest matching "${questSearch}"` };
        if (quest.status !== "active") return { error: `Quest is ${quest.status}, not active` };

        writeTimer(ctx.timerPath, {
          questId: quest.id,
          questTitle: quest.title,
          userId: ctx.userId,
          startedAt: Date.now(),
        });

        return { quest: quest.title, started: true };
      },
    }),

    stop_timer: tool({
      description: "Stop the running timer and optionally complete the quest with timer proof.",
      inputSchema: z.object({
        complete: z
          .boolean()
          .default(false)
          .describe("Whether to also complete the quest with timer-duration proof"),
      }),
      execute: async ({ complete }) => {
        const trust = requireTrust(ctx, "stop_timer");
        if (trust.denied) return { error: trust.error };

        const timer = readTimer(ctx.timerPath);
        if (!timer) return { error: "No timer running" };

        const elapsed = getElapsedMinutes(timer.startedAt);
        const elapsedStr = formatElapsed(timer.startedAt);
        clearTimer(ctx.timerPath);

        if (complete) {
          const quest = await getQuestById(ctx.db, timer.questId);
          if (quest && quest.status === "active") {
            const prevUser = await getUserById(ctx.db, ctx.userId);
            const result = await completeQuest(ctx.db, {
              questId: timer.questId,
              userId: ctx.userId,
              proofType: "duration",
              durationMinutes: elapsed,
              proofData: {},
            });
            const updatedUser = await getUserById(ctx.db, ctx.userId);
            const leveledUp = updatedUser && prevUser ? updatedUser.level > prevUser.level : false;

            return {
              quest: timer.questTitle,
              elapsed: elapsedStr,
              durationMinutes: elapsed,
              completed: true,
              xpEarned: result.xpEarned,
              leveledUp,
              skillGains: result.skillGains.map((g) => ({
                name: g.name,
                xpGained: g.xpGained,
                level: g.levelAfter,
                leveledUp: g.leveledUp,
              })),
            };
          }
        }

        return {
          quest: timer.questTitle,
          elapsed: elapsedStr,
          durationMinutes: elapsed,
          completed: false,
        };
      },
    }),

    get_timer: tool({
      description: "Check if a timer is currently running and for which quest.",
      inputSchema: z.object({}),
      execute: async () => {
        const timer = readTimer(ctx.timerPath);
        if (!timer) return { running: false };

        return {
          running: true,
          quest: timer.questTitle,
          elapsed: formatElapsed(timer.startedAt),
          durationMinutes: getElapsedMinutes(timer.startedAt),
        };
      },
    }),

    analyze_patterns: tool({
      description:
        "Analyze the user's quest completion patterns. Returns insights about strengths, weaknesses, and trends.",
      inputSchema: z.object({}),
      execute: async () => {
        const allQuests = await listQuestsByUser(ctx.db, ctx.userId);

        const completed = allQuests.filter((q) => q.status === "completed");
        const abandoned = allQuests.filter((q) => q.status === "abandoned");
        const active = allQuests.filter((q) => q.status === "active");

        const byType: Record<string, number> = {};
        const byDifficulty: Record<string, number> = {};
        const bySkill: Record<string, number> = {};

        for (const q of completed) {
          byType[q.type] = (byType[q.type] ?? 0) + 1;
          byDifficulty[q.difficulty] = (byDifficulty[q.difficulty] ?? 0) + 1;
          for (const tag of q.skillTags) {
            bySkill[tag] = (bySkill[tag] ?? 0) + 1;
          }
        }

        const completionRate =
          completed.length + abandoned.length > 0
            ? Math.round((completed.length / (completed.length + abandoned.length)) * 100)
            : 0;

        const bestStreak = Math.max(0, ...allQuests.map((q) => q.streakCount));

        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const completedThisWeek = completed.filter(
          (q) => q.completedAt && q.completedAt >= weekAgo,
        ).length;

        return {
          totalCompleted: completed.length,
          totalAbandoned: abandoned.length,
          activeCount: active.length,
          completionRate: `${completionRate}%`,
          bestStreak,
          completedThisWeek,
          byType,
          byDifficulty,
          topSkills: Object.entries(bySkill)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([skill, count]) => ({ skill, quests: count })),
        };
      },
    }),

    suggest_quest: tool({
      description:
        "Suggest a quest based on the user's history and current state. Considers balance across skills and difficulty progression.",
      inputSchema: z.object({
        goal: z.string().optional().describe("What the user wants to work on, if specified"),
      }),
      execute: async ({ goal }) => {
        const user = await getUserById(ctx.db, ctx.userId);
        if (!user) return { error: "User not found" };

        const allQuests = await listQuestsByUser(ctx.db, ctx.userId);
        const active = allQuests.filter((q) => q.status === "active");
        const completed = allQuests.filter((q) => q.status === "completed");

        const skillCounts: Record<string, number> = {};
        for (const q of completed) {
          for (const tag of q.skillTags) {
            skillCounts[tag] = (skillCounts[tag] ?? 0) + 1;
          }
        }

        const suggestedDifficulty = user.level >= 7 ? "hard" : user.level >= 4 ? "medium" : "easy";

        return {
          currentLevel: user.level,
          activeCount: active.length,
          slotsAvailable: 5 - active.length,
          suggestedDifficulty,
          topSkills: Object.entries(skillCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 3)
            .map(([s]) => s),
          goal: goal ?? "none specified",
          hint: "Create a quest using create_quest with the parameters you think fit best for this user's level and goals.",
        };
      },
    }),

    list_insights: tool({
      description:
        "List stored companion insights (memory) for this user, sorted by most recently updated.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(50).default(20).describe("Maximum insights to return"),
      }),
      execute: async ({ limit }) => {
        const insights = await listCompanionInsights(ctx.db, ctx.userId, limit);
        return insights.map((insight) => ({
          id: insight.id,
          shortId: insight.id.slice(0, 8),
          category: insight.category,
          content: insight.content,
          confidence: insight.confidence,
          source: insight.source,
          updatedAt: insight.updatedAt,
        }));
      },
    }),

    store_insight: tool({
      description:
        "Store a durable companion insight (pattern, preference, goal, or context) so it survives across sessions.",
      inputSchema: z.object({
        category: z.enum(["pattern", "preference", "goal", "context"]).describe("Insight category"),
        content: z.string().min(1).max(500).describe("Durable insight text to remember"),
        confidence: z
          .number()
          .min(0)
          .max(1)
          .default(0.7)
          .describe("Confidence score from 0.0 to 1.0"),
        source: z
          .enum(["ai-observed", "user-stated"])
          .default("ai-observed")
          .describe("Where this insight came from"),
        dedupe: z
          .boolean()
          .default(true)
          .describe(
            "When true, merge with an identical category+content insight instead of duplicating it",
          ),
      }),
      execute: async ({ category, content, confidence, source, dedupe }) => {
        const normalizedContent = content.trim();
        if (!normalizedContent) {
          return { error: "Insight content cannot be empty" };
        }

        if (dedupe) {
          const existing = await findCompanionInsightByContent(
            ctx.db,
            ctx.userId,
            category,
            normalizedContent,
          );

          if (existing) {
            const nextConfidence = Math.max(existing.confidence, confidence);
            const nextSource =
              existing.source === "user-stated" || source === "user-stated"
                ? "user-stated"
                : "ai-observed";

            const updated = await updateCompanionInsight(ctx.db, existing.id, ctx.userId, {
              confidence: nextConfidence,
              source: nextSource,
            });

            return {
              id: updated.id,
              shortId: updated.id.slice(0, 8),
              category: updated.category,
              content: updated.content,
              confidence: updated.confidence,
              source: updated.source,
              created: false,
              deduped: true,
            };
          }
        }

        const created = await createCompanionInsight(ctx.db, {
          userId: ctx.userId,
          category,
          content: normalizedContent,
          confidence,
          source,
          metadata: {},
        });

        return {
          id: created.id,
          shortId: created.id.slice(0, 8),
          category: created.category,
          content: created.content,
          confidence: created.confidence,
          source: created.source,
          created: true,
          deduped: false,
        };
      },
    }),

    update_insight: tool({
      description:
        "Update a stored companion insight by ID. Use list_insights first if you need to locate the ID.",
      inputSchema: z
        .object({
          insightId: z.string().min(1).describe("Insight ID (full UUID)"),
          category: z.enum(["pattern", "preference", "goal", "context"]).optional(),
          content: z.string().min(1).max(500).optional(),
          confidence: z.number().min(0).max(1).optional(),
          source: z.enum(["ai-observed", "user-stated"]).optional(),
        })
        .refine(
          (value) =>
            value.category !== undefined ||
            value.content !== undefined ||
            value.confidence !== undefined ||
            value.source !== undefined,
          { message: "At least one field must be updated" },
        ),
      execute: async ({ insightId, category, content, confidence, source }) => {
        const normalizedContent = content?.trim();
        if (content !== undefined && !normalizedContent) {
          return { error: "Insight content cannot be empty" };
        }

        const updated = await updateCompanionInsight(ctx.db, insightId, ctx.userId, {
          ...(category !== undefined ? { category } : {}),
          ...(normalizedContent !== undefined ? { content: normalizedContent } : {}),
          ...(confidence !== undefined ? { confidence } : {}),
          ...(source !== undefined ? { source } : {}),
        });

        return {
          id: updated.id,
          shortId: updated.id.slice(0, 8),
          category: updated.category,
          content: updated.content,
          confidence: updated.confidence,
          source: updated.source,
          updatedAt: updated.updatedAt,
        };
      },
    }),

    update_user_context: tool({
      description:
        "Persist companion user context notes. Use this for stable facts that do not belong in structured insights.",
      inputSchema: z.object({
        content: z.string().min(1).max(4000).describe("Context text to persist"),
        mode: z
          .enum(["append", "replace"])
          .default("append")
          .describe("append = add to existing context, replace = overwrite existing context"),
      }),
      execute: async ({ content, mode }) => {
        const companion = await getCompanionByUserId(ctx.db, ctx.userId);
        if (!companion) {
          return { error: "Companion not initialized. Run `grindxp init` first." };
        }

        const normalized = content.trim();
        if (!normalized) {
          return { error: "Context content cannot be empty" };
        }

        const current = companion.userContext?.trim() ?? "";
        const next =
          mode === "replace"
            ? normalized
            : current.length > 0
              ? `${current}\n\n${normalized}`
              : normalized;

        const updated = await updateCompanionUserContext(ctx.db, ctx.userId, next);

        return {
          updated: true,
          mode,
          length: updated.userContext?.length ?? 0,
        };
      },
    }),

    fetch_url: tool({
      description:
        "Fetch content from a URL and return it as text. Use for reading web pages, documentation, API responses, shared conversations, etc.",
      inputSchema: z.object({
        url: z.string().describe("The URL to fetch"),
        format: z
          .enum(["text", "markdown"])
          .default("text")
          .describe("Output format: text (stripped HTML) or markdown (via Jina Reader)"),
      }),
      execute: async ({ url, format }) => {
        const perm = await requirePermission(ctx, "fetch_url", url);
        if (perm.denied) return { error: perm.error };

        let fetchUrl = url;
        if (!fetchUrl.startsWith("http://") && !fetchUrl.startsWith("https://")) {
          fetchUrl = `https://${fetchUrl}`;
        }

        try {
          if (format === "markdown") {
            const jinaKey = process.env.GRIND_JINA_API_KEY;
            const resp = await fetch(`https://r.jina.ai/${fetchUrl}`, {
              headers: {
                Accept: "text/markdown",
                "X-No-Cache": "true",
                ...(jinaKey ? { Authorization: `Bearer ${jinaKey}` } : {}),
              },
              signal: AbortSignal.timeout(30_000),
            });
            if (!resp.ok) throw new Error(`Jina Reader returned ${resp.status}`);
            let content = await resp.text();
            if (content.length > MAX_FETCH_SIZE) {
              content =
                content.slice(0, MAX_FETCH_SIZE) + `\n\n[Truncated at ${MAX_FETCH_SIZE / 1024}KB]`;
            }
            return { url: fetchUrl, content };
          }

          const resp = await fetch(fetchUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; Grind/1.0)",
              Accept: "text/html,application/xhtml+xml,text/plain,*/*",
            },
            signal: AbortSignal.timeout(30_000),
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

          const contentType = resp.headers.get("content-type") ?? "";
          const buf = await resp.arrayBuffer();
          if (buf.byteLength > MAX_FETCH_SIZE * 2) {
            return { error: `Response too large (${Math.round(buf.byteLength / 1024)}KB)` };
          }

          let content = new TextDecoder().decode(buf);
          if (contentType.includes("text/html")) {
            content = await extractText(content);
          }
          if (content.length > MAX_FETCH_SIZE) {
            content =
              content.slice(0, MAX_FETCH_SIZE) + `\n\n[Truncated at ${MAX_FETCH_SIZE / 1024}KB]`;
          }
          return { url: fetchUrl, content };
        } catch (e) {
          return { error: `Failed to fetch: ${e instanceof Error ? e.message : String(e)}` };
        }
      },
    }),

    web_search: tool({
      description: `Search the web for current information. Returns relevant results with titles, URLs, and content snippets. The current year is ${new Date().getFullYear()}.`,
      inputSchema: z.object({
        query: z.string().describe("Search query"),
        numResults: z
          .number()
          .int()
          .min(1)
          .max(10)
          .default(5)
          .describe("Number of results (default 5)"),
      }),
      execute: async ({ query, numResults }) => {
        const perm = await requirePermission(ctx, "web_search", query);
        if (perm.denied) return { error: perm.error };

        const tavily = process.env.GRIND_TAVILY_API_KEY;

        try {
          if (tavily) {
            const resp = await fetch("https://api.tavily.com/search", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                api_key: tavily,
                query,
                max_results: numResults,
                include_answer: true,
              }),
              signal: AbortSignal.timeout(15_000),
            });
            if (!resp.ok) throw new Error(`Tavily ${resp.status}`);
            const data = (await resp.json()) as {
              answer?: string;
              results: Array<{ title: string; url: string; content: string }>;
            };
            return {
              query,
              provider: "tavily",
              answer: data.answer ?? null,
              results: data.results.map((r) => ({
                title: r.title,
                url: r.url,
                snippet: r.content.slice(0, 500),
              })),
            };
          }

          const jinaKey = process.env.GRIND_JINA_API_KEY;
          const resp = await fetch(`https://s.jina.ai/${encodeURIComponent(query)}`, {
            headers: {
              Accept: "application/json",
              "X-No-Cache": "true",
              ...(jinaKey ? { Authorization: `Bearer ${jinaKey}` } : {}),
            },
            signal: AbortSignal.timeout(15_000),
          });
          if (!resp.ok) throw new Error(`Jina Search ${resp.status}`);
          const data = (await resp.json()) as {
            data?: Array<{ title: string; url: string; content: string; description?: string }>;
          };
          const results = (data.data ?? []).slice(0, numResults);
          return {
            query,
            provider: "jina",
            results: results.map((r) => ({
              title: r.title,
              url: r.url,
              snippet: (r.description ?? r.content ?? "").slice(0, 500),
            })),
          };
        } catch (e) {
          return { error: `Search failed: ${e instanceof Error ? e.message : String(e)}` };
        }
      },
    }),

    read_file: tool({
      description:
        "Read a local file or list a directory. Supports ~ and $HOME path expansion. Returns line-numbered content for files.",
      inputSchema: z.object({
        filePath: z.string().describe("Path to file or directory (supports ~/...)"),
        offset: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Line number to start from (1-indexed)"),
        limit: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(`Max lines to read (default ${DEFAULT_READ_LIMIT})`),
      }),
      execute: async ({ filePath, offset, limit }) => {
        const resolved = path.resolve(expandPath(filePath));
        const perm = await requirePermission(ctx, "read_file", resolved);
        if (perm.denied) return { error: perm.error };

        try {
          const stat = await fs.stat(resolved);

          if (stat.isDirectory()) {
            const entries = await fs.readdir(resolved, { withFileTypes: true });
            const names = entries.map((e) => (e.isDirectory() ? e.name + "/" : e.name)).sort();
            const lim = limit ?? DEFAULT_READ_LIMIT;
            const off = (offset ?? 1) - 1;
            const sliced = names.slice(off, off + lim);
            return {
              path: resolved,
              type: "directory",
              entries: sliced,
              total: names.length,
              showing: `${off + 1}-${off + sliced.length}`,
            };
          }

          if (stat.size > MAX_READ_SIZE * 4) {
            return {
              error: `File too large (${Math.round(stat.size / 1024)}KB). Use offset/limit to read sections.`,
            };
          }

          const buf = Buffer.from(await Bun.file(resolved).arrayBuffer());
          if (await isBinaryBuffer(buf, buf.length)) {
            return { error: `Cannot read binary file: ${resolved}` };
          }

          const content = buf.toString("utf-8");
          const allLines = content.split("\n");
          const lim = limit ?? DEFAULT_READ_LIMIT;
          const off = (offset ?? 1) - 1;

          if (off >= allLines.length && allLines.length > 0) {
            return { error: `Offset ${off + 1} beyond file (${allLines.length} lines)` };
          }

          const sliced = allLines.slice(off, off + lim);
          let bytes = 0;
          const numbered: string[] = [];
          for (let i = 0; i < sliced.length; i++) {
            let line = sliced[i]!;
            if (line.length > MAX_LINE_LENGTH) {
              line = line.slice(0, MAX_LINE_LENGTH) + "...";
            }
            const size = Buffer.byteLength(line, "utf-8") + 1;
            if (bytes + size > MAX_READ_SIZE) {
              numbered.push(
                `[Truncated at ${MAX_READ_SIZE / 1024}KB — use offset=${off + i + 1} to continue]`,
              );
              break;
            }
            numbered.push(`${off + i + 1}: ${line}`);
            bytes += size;
          }

          const hasMore = off + sliced.length < allLines.length;
          return {
            path: resolved,
            type: "file",
            totalLines: allLines.length,
            showing: `${off + 1}-${off + sliced.length}`,
            hasMore,
            content: numbered.join("\n"),
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("ENOENT")) return { error: `File not found: ${resolved}` };
          return { error: `Read failed: ${msg}` };
        }
      },
    }),

    write_file: tool({
      description:
        "Write content to a file, creating it and any parent directories if needed. Use to create new files or fully overwrite existing file content.",
      inputSchema: z.object({
        filePath: z.string().describe("Absolute or ~/... path to the file to write"),
        content: z.string().describe("Full content to write to the file"),
      }),
      execute: async ({ filePath, content }) => {
        const resolved = path.resolve(expandPath(filePath));
        const perm = await requirePermission(ctx, "write_file", resolved);
        if (perm.denied) return { error: perm.error };
        try {
          await fs.mkdir(path.dirname(resolved), { recursive: true });
          await Bun.write(resolved, content);
          const lines = content.split("\n");
          let diff: string | undefined;
          if (lines.length <= 200) {
            const hunkLines = [`@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)];
            diff = [`--- /dev/null`, `+++ b/${path.basename(resolved)}`, ...hunkLines].join("\n");
          }
          return {
            path: resolved,
            lines: lines.length,
            bytes: content.length,
            ...(diff !== undefined ? { diff } : {}),
          };
        } catch (e) {
          return { error: `Write failed: ${e instanceof Error ? e.message : String(e)}` };
        }
      },
    }),

    edit_file: tool({
      description:
        "Replace a string in an existing file using exact or near-exact matching. Errors if the string is not found or is ambiguous. Use write_file to create new files.",
      inputSchema: z.object({
        filePath: z.string().describe("Absolute or ~/... path to the file"),
        oldString: z
          .string()
          .describe("Text to find and replace — must uniquely identify the target"),
        newString: z.string().describe("Replacement text"),
        replaceAll: z
          .boolean()
          .optional()
          .describe("Replace all exact occurrences (default: false — errors if multiple found)"),
      }),
      execute: async ({ filePath, oldString, newString, replaceAll = false }) => {
        const resolved = path.resolve(expandPath(filePath));
        const perm = await requirePermission(ctx, "edit_file", resolved);
        if (perm.denied) return { error: perm.error };
        try {
          const stat = await fs.stat(resolved);
          if (stat.size > MAX_READ_SIZE * 4) {
            return { error: `File too large (${Math.round(stat.size / 1024)}KB) for edit` };
          }
          const content = await Bun.file(resolved).text();

          const contentLines = content.split("\n");
          const displayName = path.basename(resolved);

          // Pass 1: exact match
          const exactCount = countSubstr(content, oldString);
          if (exactCount > 0) {
            if (exactCount > 1 && !replaceAll) {
              return {
                error: `${exactCount} exact matches found — use replaceAll: true or add more context to oldString`,
              };
            }
            const updated = replaceAll
              ? content.split(oldString).join(newString)
              : content.replace(oldString, newString);
            await Bun.write(resolved, updated);
            if (exactCount === 1) {
              const startLine = offsetToLine(content, content.indexOf(oldString));
              const diff = buildUnifiedDiff(
                displayName,
                contentLines,
                startLine,
                oldString.split("\n"),
                newString.split("\n"),
              );
              return { path: resolved, replacements: 1, matchType: "exact", diff };
            }
            return { path: resolved, replacements: exactCount, matchType: "exact" };
          }

          // Pass 2: trim-boundary (strip leading/trailing whitespace from search string)
          const trimOld = oldString.trim();
          if (trimOld && trimOld !== oldString) {
            const trimCount = countSubstr(content, trimOld);
            if (trimCount > 1 && !replaceAll) {
              return {
                error: `${trimCount} near-matches found (trim) — use replaceAll: true or narrow oldString`,
              };
            }
            if (trimCount > 0) {
              const updated = replaceAll
                ? content.split(trimOld).join(newString)
                : content.replace(trimOld, newString);
              let diff: string | undefined;
              if (trimCount === 1) {
                const startLine = offsetToLine(content, content.indexOf(trimOld));
                diff = buildUnifiedDiff(
                  displayName,
                  contentLines,
                  startLine,
                  trimOld.split("\n"),
                  newString.split("\n"),
                );
              }
              await Bun.write(resolved, updated);
              return {
                path: resolved,
                replacements: replaceAll ? trimCount : 1,
                matchType: "fuzzy",
                ...(diff !== undefined ? { diff } : {}),
              };
            }
          }

          // Pass 3: per-line trim match (handles indentation differences)
          const lineMatch = findByLineTrim(content, oldString);
          if (lineMatch) {
            const { lineStart, lineCount, total } = lineMatch;
            if (total > 1) {
              return {
                error: `${total} near-matches found (line-trim) — narrow oldString to make it unique`,
              };
            }
            const before = contentLines.slice(0, lineStart).join("\n");
            const after = contentLines.slice(lineStart + lineCount).join("\n");
            const updated = [
              ...(before.length > 0 ? [before] : []),
              newString,
              ...(after.length > 0 ? [after] : []),
            ].join("\n");
            const diff = buildUnifiedDiff(
              displayName,
              contentLines,
              lineStart,
              contentLines.slice(lineStart, lineStart + lineCount),
              newString.split("\n"),
            );
            await Bun.write(resolved, updated);
            return { path: resolved, replacements: 1, matchType: "fuzzy", diff };
          }

          return {
            error: "No match found for oldString — verify the text exists in the file as written",
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("ENOENT")) return { error: `File not found: ${resolved}` };
          return { error: `Edit failed: ${msg}` };
        }
      },
    }),

    glob: tool({
      description:
        "Find files and directories matching a glob pattern. Returns paths relative to the search directory.",
      inputSchema: z.object({
        pattern: z.string().describe('Glob pattern, e.g. "src/**/*.ts", "**/*.json"'),
        cwd: z
          .string()
          .optional()
          .describe("Directory to search from (default: current working directory)"),
      }),
      execute: async ({ pattern, cwd }) => {
        const initialCwd = cwd ? path.resolve(expandPath(cwd)) : process.cwd();
        const expandedPatternRaw = expandPath(pattern);
        const perm = await requirePermission(ctx, "glob", `${expandedPatternRaw} in ${initialCwd}`);
        if (perm.denied) return { error: perm.error };

        let resolvedCwd = initialCwd;
        let effectivePattern = expandedPatternRaw;

        if (path.isAbsolute(expandedPatternRaw)) {
          const split = splitAbsoluteGlob(expandedPatternRaw);
          resolvedCwd = split.cwd;
          effectivePattern = split.pattern;
        }

        if (!hasGlobMagic(effectivePattern)) {
          const candidate = path.isAbsolute(expandedPatternRaw)
            ? path.resolve(expandedPatternRaw)
            : path.resolve(resolvedCwd, effectivePattern);
          const candidateStat = await statSafe(candidate);
          if (candidateStat?.isDirectory()) {
            resolvedCwd = candidate;
            effectivePattern = "*";
          } else if (candidateStat?.isFile()) {
            resolvedCwd = path.dirname(candidate);
            effectivePattern = path.basename(candidate);
          }
        }

        try {
          await fs.access(resolvedCwd);
        } catch {
          return { error: `Directory not found: ${resolvedCwd}` };
        }
        const MAX_GLOB = 200;
        const files: string[] = [];
        let truncated = false;
        try {
          const g = new Bun.Glob(toGlobPath(effectivePattern));
          for await (const file of g.scan({
            cwd: resolvedCwd,
            onlyFiles: false,
            followSymlinks: false,
          })) {
            if (files.length >= MAX_GLOB) {
              truncated = true;
              break;
            }
            files.push(file);
          }
        } catch (e) {
          return { error: `Glob failed: ${e instanceof Error ? e.message : String(e)}` };
        }
        files.sort();

        if (files.length === 0) {
          return {
            pattern: effectivePattern,
            cwd: resolvedCwd,
            files,
            count: 0,
            truncated,
            note: 'No matches. If you passed a directory path, try pattern "*" or "**/*" inside that directory.',
          };
        }

        return {
          pattern: effectivePattern,
          cwd: resolvedCwd,
          files,
          count: files.length,
          truncated,
        };
      },
    }),

    grep: tool({
      description:
        "Search file contents with a regex pattern. Returns matching lines with file paths and line numbers. Uses ripgrep for speed.",
      inputSchema: z.object({
        pattern: z.string().describe("Regular expression to search for"),
        path: z
          .string()
          .optional()
          .describe("File or directory to search (default: current working directory)"),
        include: z.string().optional().describe('Glob to filter files, e.g. "*.ts"'),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(50)
          .describe("Max matches to return (default 50)"),
      }),
      execute: async ({ pattern, path: searchPath, include, maxResults }) => {
        const resolvedPath = searchPath ? path.resolve(expandPath(searchPath)) : process.cwd();
        const perm = await requirePermission(ctx, "grep", pattern);
        if (perm.denied) return { error: perm.error };

        const args = [
          "rg",
          "--json",
          "--max-count",
          String(maxResults),
          "-e",
          pattern,
          ...(include ? ["--glob", include] : []),
          resolvedPath,
        ];

        const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
        const matches: Array<{ file: string; line: number; text: string }> = [];
        let truncated = false;

        try {
          const reader = proc.stdout.getReader();
          let buf = "";
          outer: while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += new TextDecoder().decode(value);
            let nl: number;
            while ((nl = buf.indexOf("\n")) !== -1) {
              const raw = buf.slice(0, nl);
              buf = buf.slice(nl + 1);
              if (!raw) continue;
              let obj: { type: string; data: Record<string, unknown> };
              try {
                obj = JSON.parse(raw) as typeof obj;
              } catch {
                continue;
              }
              if (obj.type !== "match") continue;
              const d = obj.data;
              matches.push({
                file: String((d["path"] as Record<string, unknown>)["text"]),
                line: Number(d["line_number"]),
                text: String((d["lines"] as Record<string, unknown>)["text"]).trimEnd(),
              });
              if (matches.length >= maxResults) {
                truncated = true;
                break outer;
              }
            }
          }
        } finally {
          proc.kill();
        }

        return { pattern, matches, totalMatches: matches.length, truncated };
      },
    }),

    list_skills: tool({
      description:
        "List all skills with current XP, level, and category. Use this to see the full skill breakdown before making quest suggestions or updates.",
      inputSchema: z.object({}),
      execute: async () => {
        const allSkills = await listSkillsByUser(ctx.db, ctx.userId);
        return allSkills.map((s) => ({
          id: s.id.slice(0, 8),
          name: s.name,
          category: s.category,
          xp: s.xp,
          level: s.level,
        }));
      },
    }),

    list_quest_logs: tool({
      description:
        "List recent quest completion history. Returns completions with XP earned, duration, and proof type. Use this to see what the user has actually done recently.",
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe("Maximum number of logs to return"),
        sinceDaysAgo: z
          .number()
          .int()
          .min(1)
          .max(90)
          .optional()
          .describe("Only return logs from this many days ago"),
      }),
      execute: async ({ limit, sinceDaysAgo }) => {
        const since = sinceDaysAgo ? Date.now() - sinceDaysAgo * 24 * 60 * 60 * 1000 : undefined;
        const logs = await listQuestLogs(ctx.db, ctx.userId, {
          limit,
          ...(since ? { since } : {}),
        });

        const questIds = [...new Set(logs.map((l) => l.questId))];
        const questTitles: Record<string, string> = {};
        for (const qid of questIds) {
          const q = await getQuestById(ctx.db, qid);
          if (q) questTitles[qid] = q.title;
        }

        return logs.map((l) => ({
          questTitle: questTitles[l.questId] ?? l.questId.slice(0, 8),
          completedAt: new Date(l.completedAt).toLocaleDateString(),
          xpEarned: l.xpEarned,
          durationMinutes: l.durationMinutes ?? null,
          proofType: l.proofType,
          streakDay: l.streakDay,
        }));
      },
    }),

    list_signals: tool({
      description:
        "List recently detected signals (git commits, file changes, process observations, webhook events). Use this to understand what the user has been doing passively.",
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(20)
          .describe("Maximum number of signals to return"),
        source: z
          .enum(["git", "file", "process", "webhook"])
          .optional()
          .describe("Filter by signal source"),
      }),
      execute: async ({ limit, source }) => {
        const sigs = await listSignals(ctx.db, ctx.userId, {
          limit,
          ...(source ? { source } : {}),
        });
        return sigs.map((s) => ({
          source: s.source,
          type: s.type,
          confidence: s.confidence,
          detectedAt: new Date(s.detectedAt).toLocaleString(),
          payload: s.payload,
        }));
      },
    }),

    update_quest: tool({
      description:
        "Update quest details: title, description, difficulty, type, baseXp, skillTags, or schedule. Does NOT change quest status — use abandon_quest or complete_quest for that.",
      inputSchema: z
        .object({
          questSearch: z.string().describe("Quest ID prefix or title substring"),
          title: z.string().min(1).max(256).optional().describe("New quest title"),
          description: z.string().max(2000).nullable().optional().describe("New description"),
          type: z
            .enum(["daily", "weekly", "epic", "bounty", "chain", "ritual"])
            .optional()
            .describe("New quest type"),
          difficulty: z
            .enum(["easy", "medium", "hard", "epic"])
            .optional()
            .describe("New difficulty"),
          skillTags: z.array(z.string()).optional().describe("Replace skill tags"),
          baseXp: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("New base XP (before multipliers)"),
          scheduleCron: z
            .string()
            .nullable()
            .optional()
            .describe("New cron schedule (null to remove)"),
        })
        .refine(
          (v) =>
            v.title !== undefined ||
            v.description !== undefined ||
            v.type !== undefined ||
            v.difficulty !== undefined ||
            v.skillTags !== undefined ||
            v.baseXp !== undefined ||
            v.scheduleCron !== undefined,
          { message: "Provide at least one field to update." },
        ),
      execute: async ({
        questSearch,
        title,
        description,
        type,
        difficulty,
        skillTags,
        baseXp,
        scheduleCron,
      }) => {
        const trust = requireTrust(ctx, "update_quest");
        if (trust.denied) return { error: trust.error };

        const quest = await findQuestByPrefix(ctx.db, ctx.userId, questSearch);
        if (!quest) return { error: `No quest matching "${questSearch}"` };

        const updated = await updateQuest(ctx.db, quest.id, ctx.userId, {
          ...(title !== undefined ? { title } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(type !== undefined ? { type } : {}),
          ...(difficulty !== undefined ? { difficulty } : {}),
          ...(skillTags !== undefined ? { skillTags } : {}),
          ...(baseXp !== undefined ? { baseXp } : {}),
          ...(scheduleCron !== undefined ? { scheduleCron } : {}),
        });

        if (!updated) return { error: "Failed to update quest." };

        return {
          ok: true,
          id: updated.id.slice(0, 8),
          title: updated.title,
          type: updated.type,
          difficulty: updated.difficulty,
          skillTags: updated.skillTags,
          baseXp: updated.baseXp,
        };
      },
    }),

    activate_quest: tool({
      description:
        "Move a quest from 'available' to 'active'. Use when the user is ready to start working on a quest that isn't active yet. Subject to the 5-quest active limit.",
      inputSchema: z.object({
        questSearch: z.string().describe("Quest ID prefix or title substring"),
      }),
      execute: async ({ questSearch }) => {
        const trust = requireTrust(ctx, "activate_quest");
        if (trust.denied) return { error: trust.error };

        const quest = await findQuestByPrefix(ctx.db, ctx.userId, questSearch);
        if (!quest) return { error: `No quest matching "${questSearch}"` };
        if (quest.status === "active") return { error: "Quest is already active." };
        if (quest.status === "completed")
          return { error: "Quest is completed — cannot reactivate." };
        if (quest.status === "abandoned")
          return { error: "Quest is abandoned — cannot reactivate." };

        const active = await listQuestsByUser(ctx.db, ctx.userId, ["active"]);
        if (active.length >= 5) {
          return { error: "Max 5 active quests. Complete or abandon one first." };
        }

        await updateQuestStatus(ctx.db, quest.id, ctx.userId, "active");

        return { ok: true, quest: quest.title, status: "active" };
      },
    }),

    delete_insight: tool({
      description:
        "Delete a stored companion insight. Only AI-observed insights can be deleted. User-stated insights are permanent and cannot be removed by the companion.",
      inputSchema: z.object({
        insightId: z.string().min(1).describe("Insight ID (full UUID or short ID prefix)"),
      }),
      execute: async ({ insightId }) => {
        const trust = requireTrust(ctx, "delete_insight");
        if (trust.denied) return { error: trust.error };

        const insights = await listCompanionInsights(ctx.db, ctx.userId, 200);
        const match = insights.find((i) => i.id === insightId || i.id.startsWith(insightId));

        if (!match) return { error: `No insight matching "${insightId}"` };

        if (match.source === "user-stated") {
          return {
            error:
              "Cannot delete user-stated insights. These are facts you provided — they can only be updated, not removed.",
          };
        }

        const deleted = await deleteCompanionInsight(ctx.db, match.id, ctx.userId);
        if (!deleted) return { error: "Failed to delete insight." };

        return { ok: true, deleted: true, content: match.content };
      },
    }),

    update_companion_mode: tool({
      description:
        "Change the companion operating mode. 'suggest' = propose only, 'assist' = act on explicit requests, 'auto' = act proactively.",
      inputSchema: z.object({
        mode: z.enum(["off", "suggest", "assist", "auto"]).describe("New companion mode"),
      }),
      execute: async ({ mode }) => {
        const trust = requireTrust(ctx, "update_companion_mode");
        if (trust.denied) return { error: trust.error };

        const updated = await updateCompanionMode(ctx.db, ctx.userId, mode);

        return { ok: true, mode: updated.mode };
      },
    }),

    bash: tool({
      description:
        "Execute a shell command. Returns stdout, stderr, and exit code. Both stdout and stderr are capped at 50KB.",
      inputSchema: z.object({
        command: z.string().describe("Shell command to execute"),
        cwd: z
          .string()
          .optional()
          .describe("Working directory (default: current working directory)"),
        timeout: z
          .number()
          .int()
          .min(1)
          .max(120)
          .default(30)
          .describe("Timeout in seconds (default 30, max 120)"),
      }),
      execute: async ({ command, cwd, timeout }) => {
        const resolvedCwd = cwd ? path.resolve(expandPath(cwd)) : process.cwd();
        const perm = await requirePermission(ctx, "bash", command);
        if (perm.denied) return { error: perm.error };

        async function drainStream(
          stream: ReadableStream<Uint8Array>,
        ): Promise<{ text: string; truncated: boolean }> {
          const reader = stream.getReader();
          const chunks: Uint8Array[] = [];
          let total = 0;
          let truncated = false;
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (!truncated) {
                const remaining = MAX_BASH_OUTPUT - total;
                if (value.length >= remaining) {
                  chunks.push(value.slice(0, remaining));
                  total += remaining;
                  truncated = true;
                } else {
                  chunks.push(value);
                  total += value.length;
                }
              }
              // continue draining (discard) even after cap to prevent pipe stall
            }
          } finally {
            reader.releaseLock();
          }
          const out = new Uint8Array(total);
          let off = 0;
          for (const c of chunks) {
            out.set(c, off);
            off += c.length;
          }
          return { text: new TextDecoder().decode(out), truncated };
        }

        const proc = Bun.spawn(["sh", "-c", command], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: resolvedCwd,
        });

        let timedOut = false;
        const timeoutId = setTimeout(() => {
          timedOut = true;
          proc.kill();
        }, timeout * 1000);

        try {
          // Read both streams concurrently to prevent pipe deadlock
          const [stdoutResult, stderrResult] = await Promise.all([
            drainStream(proc.stdout),
            drainStream(proc.stderr),
          ]);
          clearTimeout(timeoutId);
          const exitCode = await proc.exited;
          return {
            stdout: stdoutResult.text,
            stderr: stderrResult.text,
            exitCode: timedOut ? null : exitCode,
            truncated: stdoutResult.truncated || stderrResult.truncated,
            ...(timedOut ? { error: `Timed out after ${timeout}s` } : {}),
          };
        } catch (e) {
          return {
            error: `Execution failed: ${e instanceof Error ? e.message : String(e)}`,
            stdout: "",
            stderr: "",
            exitCode: null,
          };
        } finally {
          clearTimeout(timeoutId);
          proc.kill();
        }
      },
    }),
  };
}
