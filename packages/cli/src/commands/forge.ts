import * as p from "@clack/prompts";
import { runForgeDaemon, runForgeRuleNow, runForgeTick } from "@grindxp/core";
import { listQuestsByUser } from "@grindxp/core/vault";
import {
  findForgeRuleByPrefix,
  insertForgeRule,
  listForgeRulesByUser,
  listRecentForgeRunsByUser,
  setForgeRuleEnabled,
} from "@grindxp/core/vault";

import type { CliContext } from "../context";

function bail(message = "Cancelled."): never {
  p.cancel(message);
  process.exit(0);
}

export async function forgeListCommand(ctx: CliContext): Promise<void> {
  const rules = await listForgeRulesByUser(ctx.db, ctx.user.id);

  if (rules.length === 0) {
    p.log.info("No forge rules yet. Run `grindxp forge create`.");
    return;
  }

  p.log.step(`Forge rules (${rules.length})`);
  for (const rule of rules) {
    const status = rule.enabled ? "on " : "off";
    p.log.message(
      `  [${status}] ${rule.name} (${rule.triggerType} -> ${rule.actionType}) ${rule.id.slice(0, 8)}`,
    );
  }

  const recent = await listRecentForgeRunsByUser(ctx.db, ctx.user.id, 5);
  if (recent.length > 0) {
    p.log.step("Recent runs");
    for (const run of recent) {
      p.log.message(
        `  ${formatRunStatus(run.status)} ${run.actionType} (${run.triggerType}) ${run.ruleId.slice(0, 8)} ${new Date(run.startedAt).toISOString()}`,
      );
    }
  }
}

export async function forgeCreateCommand(ctx: CliContext): Promise<void> {
  p.intro("Create Forge Rule");

  const name = await p.text({
    message: "Rule name:",
    placeholder: "e.g. Morning routine queue",
    validate: (value) => {
      if (!value || value.length < 2) return "Name is required (min 2 chars).";
      if (value.length > 128) return "Name too long.";
      return undefined;
    },
  });
  if (p.isCancel(name)) return bail();

  const triggerType = await p.select({
    message: "Trigger type:",
    options: [
      { value: "cron", label: "cron", hint: "Schedule based" },
      { value: "signal", label: "signal", hint: "Git/file/process signal" },
      { value: "webhook", label: "webhook", hint: "Inbound HTTP event" },
      { value: "event", label: "event", hint: "Internal event bus" },
      { value: "manual", label: "manual", hint: "Run only when requested" },
    ],
  });
  if (p.isCancel(triggerType)) return bail();

  const triggerConfig: Record<string, unknown> = {};
  if (triggerType === "cron") {
    const cron = await p.text({
      message: "Cron expression (UTC, 5-field):",
      placeholder: "30 6 * * *",
      validate: (value) => {
        if (!value) return "Cron expression is required.";
        if (value.trim().split(/\s+/).length !== 5)
          return "Expected 5 fields (min hour day month weekday).";
        return undefined;
      },
    });
    if (p.isCancel(cron)) return bail();
    triggerConfig.cron = cron;
    triggerConfig.timezone = "UTC";
  }

  if (triggerType === "signal") {
    const source = await p.select({
      message: "Signal source:",
      options: [
        { value: "git", label: "git", hint: "Auto-detect latest commit" },
        { value: "file", label: "file" },
        { value: "process", label: "process" },
      ],
    });
    if (p.isCancel(source)) return bail();

    triggerConfig.source = source;
    if (source === "git") {
      triggerConfig.signalType = "completion";
    } else if (source === "file") {
      const path = await p.text({
        message: "File path to watch:",
        placeholder: "./daily.md",
        validate: (value) => (!value ? "File path is required." : undefined),
      });
      if (p.isCancel(path)) return bail();

      triggerConfig.path = path;
      triggerConfig.signalType = "completion";
    } else if (source === "process") {
      const processMatch = await p.text({
        message: "Process match pattern:",
        placeholder: "code",
        validate: (value) => (!value ? "Process pattern is required." : undefined),
      });
      if (p.isCancel(processMatch)) return bail();

      const matchMode = await p.select({
        message: "Process match mode:",
        options: [
          { value: "contains", label: "contains", hint: "Matches command substring" },
          { value: "exact", label: "exact", hint: "Matches executable name" },
          { value: "regex", label: "regex", hint: "Matches regex pattern" },
        ],
      });
      if (p.isCancel(matchMode)) return bail();

      triggerConfig.processName = processMatch;
      triggerConfig.matchMode = matchMode;
      triggerConfig.signalType = "activity";
    }
  }

  if (triggerType === "event") {
    const eventName = await p.text({
      message: "Event name:",
      placeholder: "quest.completed",
      validate: (value) => (!value ? "Event name is required." : undefined),
    });
    if (p.isCancel(eventName)) return bail();
    triggerConfig.eventName = eventName;
  }

  if (triggerType === "webhook") {
    const channel = await p.select({
      message: "Webhook channel tag:",
      options: [
        { value: "webhook", label: "webhook", hint: "Generic inbound event" },
        { value: "telegram", label: "telegram" },
        { value: "discord", label: "discord" },
        { value: "whatsapp", label: "whatsapp" },
      ],
    });
    if (p.isCancel(channel)) return bail();

    const eventName = await p.text({
      message: "Webhook event name:",
      placeholder: "message.received",
      defaultValue: "message.received",
      validate: (value) => (!value ? "Event name is required." : undefined),
    });
    if (p.isCancel(eventName)) return bail();

    triggerConfig.channel = channel;
    triggerConfig.eventName = eventName;
  }

  const actionType = await p.select({
    message: "Action type:",
    options: [
      {
        value: "send-notification",
        label: "send-notification",
        hint: "Send a message or run a script whose stdout becomes the message",
      },
      { value: "run-script", label: "run-script", hint: "Execute a shell script silently" },
      { value: "queue-quest", label: "queue-quest", hint: "Activate a quest" },
      { value: "log-to-vault", label: "log-to-vault", hint: "Auto-log an activity and award XP" },
    ],
  });
  if (p.isCancel(actionType)) return bail();

  const actionConfig: Record<string, unknown> = {};
  if (actionType === "queue-quest") {
    const quests = await listQuestsByUser(ctx.db, ctx.user.id);
    const selectable = quests.filter((q) => q.status !== "completed");
    if (selectable.length === 0) {
      p.log.error("No eligible quests found. Create one first.");
      process.exit(1);
    }

    const questId = await p.select({
      message: "Quest to queue:",
      options: selectable.map((q) => ({
        value: q.id,
        label: q.title,
        hint: `${q.status} • ${q.type}`,
      })),
    });
    if (p.isCancel(questId)) return bail();
    actionConfig.questId = questId;
  }

  if (actionType === "log-to-vault") {
    const activityType = await p.select({
      message: "Activity type:",
      options: [
        { value: "coding", label: "coding" },
        { value: "study", label: "study" },
        { value: "workout", label: "workout" },
        { value: "other", label: "other" },
      ],
    });
    if (p.isCancel(activityType)) return bail();

    const duration = await p.text({
      message: "Default duration in minutes:",
      placeholder: "15",
      defaultValue: "15",
      validate: (value) => {
        const parsed = Number.parseInt(value ?? "", 10);
        if (!Number.isInteger(parsed) || parsed <= 0) return "Enter a positive integer.";
        return undefined;
      },
    });
    if (p.isCancel(duration)) return bail();

    actionConfig.activityType = activityType;
    actionConfig.durationMinutes = Number.parseInt(String(duration), 10);
  }

  if (actionType === "send-notification") {
    const channel = await p.select({
      message: "Notification transport:",
      options: [
        { value: "console", label: "console", hint: "Print in daemon logs" },
        { value: "telegram", label: "telegram", hint: "Telegram Bot API" },
        { value: "whatsapp", label: "whatsapp", hint: "WhatsApp Cloud API" },
        { value: "webhook", label: "webhook", hint: "POST to URL" },
      ],
    });
    if (p.isCancel(channel)) return bail();

    const message = await p.text({
      message: "Notification message (optional):",
      placeholder: "Time to start your quest",
    });
    if (p.isCancel(message)) return bail();
    actionConfig.channel = channel;
    if (message) actionConfig.message = message;

    if (channel === "telegram") {
      const configuredChatId = ctx.config.gateway?.telegramDefaultChatId ?? "";
      const configuredToken =
        ctx.config.gateway?.telegramBotToken ?? process.env.GRIND_TELEGRAM_BOT_TOKEN ?? "";

      const chatId = await p.text({
        message: "Telegram chat ID:",
        placeholder: "e.g. 123456789",
        ...(configuredChatId ? { defaultValue: configuredChatId } : {}),
        validate: (value) => (!value ? "chat ID is required for telegram." : undefined),
      });
      if (p.isCancel(chatId)) return bail();
      actionConfig.chatId = chatId;

      if (configuredToken) {
        actionConfig.token = configuredToken;
      } else {
        const token = await p.text({
          message: "Telegram bot token",
          placeholder: "123456:ABC...",
          validate: (value) =>
            !value ? "bot token is required for telegram notifications." : undefined,
        });
        if (p.isCancel(token)) return bail();
        actionConfig.token = token;
      }
    }

    if (channel === "webhook") {
      const webhookUrl = await p.text({
        message: "Webhook URL:",
        placeholder: "https://example.com/inbox",
        validate: (value) => {
          if (!value) return "URL is required for webhook.";
          try {
            new URL(value);
            return undefined;
          } catch {
            return "Provide a valid URL.";
          }
        },
      });
      if (p.isCancel(webhookUrl)) return bail();
      actionConfig.url = webhookUrl;
    }

    if (channel === "whatsapp") {
      const whatsAppMode = ctx.config.gateway?.whatsAppMode;
      if (whatsAppMode === "qr-link") {
        p.log.warn(
          "WhatsApp QR-link setup is configured. Forge outbound currently uses WhatsApp Cloud API credentials.",
        );
      }

      const configuredPhoneNumberId = ctx.config.gateway?.whatsAppPhoneNumberId ?? "";
      const configuredAccessToken =
        ctx.config.gateway?.whatsAppAccessToken ?? process.env.GRIND_WHATSAPP_ACCESS_TOKEN ?? "";

      const phoneNumberId = await p.text({
        message: "WhatsApp phone number ID:",
        placeholder: "from Meta app dashboard",
        ...(configuredPhoneNumberId ? { defaultValue: configuredPhoneNumberId } : {}),
        validate: (value) => (!value ? "phone number ID is required for whatsapp." : undefined),
      });
      if (p.isCancel(phoneNumberId)) return bail();

      const recipient = await p.text({
        message: "Recipient phone (E.164 digits, no +):",
        placeholder: "15551234567",
        validate: (value) => (!value ? "recipient is required for whatsapp." : undefined),
      });
      if (p.isCancel(recipient)) return bail();

      actionConfig.phoneNumberId = phoneNumberId;
      actionConfig.to = recipient;

      if (configuredAccessToken) {
        actionConfig.token = configuredAccessToken;
      } else {
        const accessToken = await p.text({
          message: "WhatsApp Cloud API access token",
          placeholder: "temporary or permanent token",
          validate: (value) =>
            !value ? "access token is required for whatsapp notifications." : undefined,
        });
        if (p.isCancel(accessToken)) return bail();
        actionConfig.token = accessToken;
      }
    }
  }

  if (actionType === "run-script") {
    const script = await p.text({
      message: "Shell script to execute:",
      placeholder: "curl -s https://example.com/data | jq .price",
      validate: (value) => (!value?.trim() ? "Script is required." : undefined),
    });
    if (p.isCancel(script)) return bail();
    actionConfig.script = (script as string).trim();

    const timeoutRaw = await p.text({
      message: "Timeout in seconds (default 30):",
      placeholder: "30",
      defaultValue: "30",
      validate: (value) => {
        const parsed = Number.parseInt(value ?? "", 10);
        if (!Number.isInteger(parsed) || parsed <= 0) return "Enter a positive integer.";
        return undefined;
      },
    });
    if (p.isCancel(timeoutRaw)) return bail();
    actionConfig.timeout = Number.parseInt(String(timeoutRaw), 10) * 1_000;

    const workdir = await p.text({
      message: "Working directory (optional):",
      placeholder: "~/projects/myapp",
    });
    if (p.isCancel(workdir)) return bail();
    if (workdir) actionConfig.workdir = workdir;
  }

  const rule = await insertForgeRule(ctx.db, {
    userId: ctx.user.id,
    name,
    triggerType,
    triggerConfig,
    actionType,
    actionConfig,
    enabled: true,
  });

  p.log.success(`Forge rule created: ${rule.name} (${rule.id.slice(0, 8)})`);
}

export async function forgeToggleCommand(
  ctx: CliContext,
  rulePrefix: string,
  nextStateRaw?: string,
): Promise<void> {
  if (!rulePrefix) {
    p.log.error("Usage: grindxp forge toggle <rule-id-or-name> [on|off]");
    process.exit(1);
  }

  const rule = await findForgeRuleByPrefix(ctx.db, ctx.user.id, rulePrefix);
  if (!rule) {
    p.log.error(`No forge rule matching "${rulePrefix}".`);
    process.exit(1);
  }

  const nextState = parseToggleState(nextStateRaw, !rule.enabled);
  const updated = await setForgeRuleEnabled(ctx.db, rule.id, nextState);
  if (!updated) {
    p.log.error("Failed to update forge rule state.");
    process.exit(1);
  }

  p.log.success(`${updated.name} is now ${updated.enabled ? "enabled" : "disabled"}.`);
}

export async function forgeTickCommand(ctx: CliContext, args: string[]): Promise<void> {
  const dryRun = args.includes("--dry-run") || args.includes("--dry");
  const tick = await runForgeTick({
    db: ctx.db,
    userId: ctx.user.id,
    includeCollectors: true,
    dryRun,
  });

  p.log.step(
    `tick @ ${new Date(tick.at).toISOString()} | rules=${tick.rulesEvaluated} plans=${tick.plansBuilt} success=${tick.executed} skipped=${tick.skipped} failed=${tick.failed}`,
  );

  for (const result of tick.results) {
    p.log.message(
      `  ${formatRunStatus(result.status)} ${result.actionType} ${result.ruleId.slice(0, 8)}${result.error ? ` — ${result.error}` : ""}`,
    );
  }
}

export async function forgeRunCommand(ctx: CliContext, rulePrefix: string): Promise<void> {
  if (!rulePrefix) {
    p.log.error("Usage: grindxp forge run <rule-id-or-name>");
    process.exit(1);
  }

  const rule = await findForgeRuleByPrefix(ctx.db, ctx.user.id, rulePrefix);
  if (!rule) {
    p.log.error(`No forge rule matching "${rulePrefix}".`);
    process.exit(1);
  }

  const result = await runForgeRuleNow({
    db: ctx.db,
    userId: ctx.user.id,
    ruleId: rule.id,
  });

  p.log.step(
    `${formatRunStatus(result.status)} ${rule.name}${result.error ? ` — ${result.error}` : ""}`,
  );
}

export async function forgeDaemonCommand(ctx: CliContext, args: string[]): Promise<void> {
  const intervalMs = parseIntervalArg(args) ?? 60_000;
  const abortController = new AbortController();

  const handleStop = () => {
    if (!abortController.signal.aborted) {
      p.log.warn("Stopping forge daemon...");
      abortController.abort();
    }
  };

  process.once("SIGINT", handleStop);
  process.once("SIGTERM", handleStop);

  p.log.step(`Forge daemon running (interval ${Math.floor(intervalMs / 1000)}s). Ctrl+C to stop.`);

  try {
    await runForgeDaemon({
      db: ctx.db,
      userId: ctx.user.id,
      intervalMs,
      signal: abortController.signal,
      onTick: (tick) => {
        if (tick.plansBuilt === 0) return;
        p.log.message(
          `tick ${new Date(tick.at).toISOString()} success=${tick.executed} skipped=${tick.skipped} failed=${tick.failed}`,
        );
      },
    });
  } finally {
    process.removeListener("SIGINT", handleStop);
    process.removeListener("SIGTERM", handleStop);
    p.log.info("Forge daemon stopped.");
  }
}

function formatRunStatus(status: ForgeRunStatusLike): string {
  switch (status) {
    case "success":
      return "✓";
    case "failed":
      return "✗";
    default:
      return "○";
  }
}

type ForgeRunStatusLike = "success" | "skipped" | "failed";

function parseToggleState(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.toLowerCase();
  if (normalized === "on" || normalized === "true" || normalized === "1") return true;
  if (normalized === "off" || normalized === "false" || normalized === "0") return false;
  return fallback;
}

function parseIntervalArg(args: string[]): number | null {
  const index = args.findIndex((value) => value === "--interval");
  if (index === -1) return null;

  const raw = args[index + 1];
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed * 1000;
}
