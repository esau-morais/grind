import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import type {
  ActivityType,
  ForgeActionType,
  ForgeRule,
  ForgeRunStatus,
  QuestDifficulty,
} from "../schema";
import { activityTypeSchema, questDifficultySchema } from "../schema";
import { proofTypeFromSignalSource } from "../proof";
import {
  completeQuest,
  createQuest,
  getForgeRuleById,
  getLatestSignalByFingerprint,
  getQuestById,
  hasForgeRunByDedupe,
  listForgeRulesByUser,
  recordForgeRun,
  recordSignal,
  updateQuestStatus,
} from "../vault/repositories";
import type { VaultDb } from "../vault/types";
import { ACTIVITY_BASE_XP } from "../xp";
import { buildForgeActionPlan, type ForgeActionPlan, type ForgeEvent } from "./engine";

export interface ForgeTickOptions {
  db: VaultDb;
  userId: string;
  at?: number;
  events?: ForgeEvent[];
  includeCollectors?: boolean;
  dryRun?: boolean;
  ruleIds?: string[];
  cwd?: string;
}

export interface ForgeExecutionResult {
  ruleId: string;
  actionType: ForgeActionType;
  status: ForgeRunStatus;
  dedupeKey: string;
  error?: string;
  startedAt: number;
  finishedAt: number;
}

export interface ForgeTickResult {
  at: number;
  rulesEvaluated: number;
  plansBuilt: number;
  executed: number;
  skipped: number;
  failed: number;
  results: ForgeExecutionResult[];
}

export interface ForgeDaemonOptions {
  db: VaultDb;
  userId: string;
  intervalMs?: number;
  cwd?: string;
  signal?: AbortSignal;
  onTick?: (result: ForgeTickResult) => void | Promise<void>;
}

export interface ForgeRunNowOptions {
  db: VaultDb;
  userId: string;
  ruleId: string;
  eventPayload?: Record<string, unknown>;
  at?: number;
  dryRun?: boolean;
}

interface ForgeActionExecution {
  status: ForgeRunStatus;
  actionPayload: Record<string, unknown>;
  error?: string;
}

export async function runForgeTick(options: ForgeTickOptions): Promise<ForgeTickResult> {
  const at = options.at ?? Date.now();
  const rules = await listForgeRulesByUser(options.db, options.userId, { enabledOnly: true });
  const scopedRules = options.ruleIds?.length
    ? rules.filter((rule) => options.ruleIds?.includes(rule.id))
    : rules;

  const collectorEvents =
    options.includeCollectors === false ? [] : await collectSignalEvents(options, scopedRules);

  const baseEvents: ForgeEvent[] = [
    {
      type: "cron",
      payload: { tickAt: at },
      at,
      dedupeKey: `cron:${Math.floor(at / 60_000)}`,
    },
    ...collectorEvents,
  ];

  const eventList = [...baseEvents, ...(options.events ?? [])];
  const plans = buildActionPlans(scopedRules, eventList);

  const results: ForgeExecutionResult[] = [];
  for (const plan of plans) {
    const result = await executeAndRecordPlan({
      db: options.db,
      userId: options.userId,
      plan,
      dryRun: options.dryRun ?? false,
    });
    results.push(result);
  }

  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const executed = results.filter((r) => r.status === "success").length;

  return {
    at,
    rulesEvaluated: scopedRules.length,
    plansBuilt: plans.length,
    executed,
    skipped,
    failed,
    results,
  };
}

export async function runForgeRuleNow(options: ForgeRunNowOptions): Promise<ForgeExecutionResult> {
  const at = options.at ?? Date.now();
  const rule = await getForgeRuleById(options.db, options.ruleId);
  if (!rule || rule.userId !== options.userId) {
    throw new Error("Forge rule not found.");
  }

  const plan: ForgeActionPlan = {
    ruleId: rule.id,
    triggerType: "manual",
    actionType: rule.actionType,
    actionConfig: {
      ...rule.actionConfig,
      eventPayload: options.eventPayload ?? {},
      eventAt: at,
    },
    queuedAt: at,
    eventAt: at,
    dedupeKey: `manual:${at}:${crypto.randomUUID()}`,
  };

  return executeAndRecordPlan({
    db: options.db,
    userId: options.userId,
    plan,
    dryRun: options.dryRun ?? false,
  });
}

export async function runForgeDaemon(options: ForgeDaemonOptions): Promise<void> {
  const intervalMs = Math.max(5_000, options.intervalMs ?? 60_000);

  while (!options.signal?.aborted) {
    const tick = await runForgeTick({
      db: options.db,
      userId: options.userId,
      includeCollectors: true,
      ...(options.cwd ? { cwd: options.cwd } : {}),
    });

    if (options.onTick) {
      await options.onTick(tick);
    }

    await sleepWithAbort(intervalMs, options.signal);
  }
}

async function executeAndRecordPlan(options: {
  db: VaultDb;
  userId: string;
  plan: ForgeActionPlan;
  dryRun: boolean;
}): Promise<ForgeExecutionResult> {
  const { db, userId, plan, dryRun } = options;
  const startedAt = Date.now();

  const alreadyProcessed = await hasForgeRunByDedupe(db, plan.ruleId, plan.dedupeKey);
  if (alreadyProcessed) {
    return {
      ruleId: plan.ruleId,
      actionType: plan.actionType,
      status: "skipped",
      dedupeKey: plan.dedupeKey,
      error: "Duplicate trigger (idempotency guard).",
      startedAt,
      finishedAt: Date.now(),
    };
  }

  const execution = dryRun
    ? {
        status: "skipped" as const,
        actionPayload: { dryRun: true, actionType: plan.actionType },
        error: "Dry run mode.",
      }
    : await executeForgeAction(db, userId, plan);

  const finishedAt = Date.now();
  const insert = await recordForgeRun(db, {
    userId,
    ruleId: plan.ruleId,
    triggerType: plan.triggerType,
    triggerPayload: {
      eventAt: plan.eventAt,
      dedupeKey: plan.dedupeKey,
    },
    actionType: plan.actionType,
    actionPayload: execution.actionPayload,
    status: execution.status,
    dedupeKey: plan.dedupeKey,
    ...(execution.error ? { error: execution.error } : {}),
    startedAt,
    finishedAt,
  });

  if (!insert) {
    return {
      ruleId: plan.ruleId,
      actionType: plan.actionType,
      status: "skipped",
      dedupeKey: plan.dedupeKey,
      error: "Duplicate trigger (conflicting concurrent write).",
      startedAt,
      finishedAt,
    };
  }

  return {
    ruleId: plan.ruleId,
    actionType: plan.actionType,
    status: execution.status,
    dedupeKey: plan.dedupeKey,
    ...(execution.error ? { error: execution.error } : {}),
    startedAt,
    finishedAt,
  };
}

function buildActionPlans(rules: ForgeRule[], events: ForgeEvent[]): ForgeActionPlan[] {
  const plans: ForgeActionPlan[] = [];
  const seen = new Set<string>();

  for (const rule of rules) {
    for (const event of events) {
      const plan = buildForgeActionPlan(rule, event);
      if (!plan) continue;

      const unique = `${plan.ruleId}:${plan.dedupeKey}`;
      if (seen.has(unique)) continue;

      seen.add(unique);
      plans.push(plan);
    }
  }

  return plans;
}

async function executeForgeAction(
  db: VaultDb,
  userId: string,
  plan: ForgeActionPlan,
): Promise<ForgeActionExecution> {
  try {
    switch (plan.actionType) {
      case "queue-quest":
        return executeQueueQuest(db, userId, plan);
      case "log-to-vault":
        return executeLogToVault(db, userId, plan);
      case "send-notification":
        return executeSendNotification(plan);
      case "run-script":
        return executeRunScript(plan);
      default:
        return {
          status: "skipped",
          actionPayload: { actionConfig: plan.actionConfig },
          error: `Action '${plan.actionType}' is not implemented yet.`,
        };
    }
  } catch (error) {
    return {
      status: "failed",
      actionPayload: { actionConfig: plan.actionConfig },
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function executeSendNotification(plan: ForgeActionPlan): Promise<ForgeActionExecution> {
  const channel = asString(plan.actionConfig.channel) ?? "console";

  let message = asString(plan.actionConfig.message) ?? asString(plan.actionConfig.text);

  if (!message) {
    const script = asString(plan.actionConfig.script);
    if (script) {
      const scriptTimeoutMs =
        (typeof plan.actionConfig.scriptTimeout === "number"
          ? plan.actionConfig.scriptTimeout
          : null) ?? 30_000;
      const result = spawnSync("sh", ["-c", script], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: scriptTimeoutMs,
      });
      if (result.status !== 0) {
        return {
          status: "failed",
          actionPayload: { channel, delivered: false },
          error: `script failed (exit ${result.status ?? "null"}): ${result.stderr?.trim() || "no stderr"}`,
        };
      }
      message = result.stdout.trim() || null;
    }
  }

  message ??= `Forge notification from rule ${plan.ruleId.slice(0, 8)}`;

  if (channel === "console") {
    console.log(`[forge notify] ${message}`);
    return {
      status: "success",
      actionPayload: {
        channel,
        delivered: true,
        message,
      },
    };
  }

  if (channel === "telegram") {
    const chatId = asString(plan.actionConfig.chatId) ?? asString(plan.actionConfig.telegramChatId);
    const token = asString(plan.actionConfig.token) ?? process.env.GRIND_TELEGRAM_BOT_TOKEN ?? null;
    if (!chatId || !token) {
      return {
        status: "skipped",
        actionPayload: {
          channel,
          delivered: false,
        },
        error:
          "telegram notification requires actionConfig.chatId and GRIND_TELEGRAM_BOT_TOKEN (or actionConfig.token).",
      };
    }

    const base = asString(plan.actionConfig.apiBaseUrl) ?? "https://api.telegram.org";
    const response = await fetch(`${base}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        status: "failed",
        actionPayload: {
          channel,
          delivered: false,
          chatId,
        },
        error: `telegram sendMessage failed: ${response.status} ${errorText}`,
      };
    }

    return {
      status: "success",
      actionPayload: {
        channel,
        delivered: true,
        chatId,
      },
    };
  }

  if (channel === "webhook") {
    const webhookUrl = asString(plan.actionConfig.url) ?? asString(plan.actionConfig.webhookUrl);
    if (!webhookUrl) {
      return {
        status: "skipped",
        actionPayload: {
          channel,
          delivered: false,
        },
        error: "webhook notification requires actionConfig.url.",
      };
    }

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message,
        ruleId: plan.ruleId,
        triggerType: plan.triggerType,
        eventAt: plan.eventAt,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        status: "failed",
        actionPayload: {
          channel,
          delivered: false,
          webhookUrl,
        },
        error: `webhook notification failed: ${response.status} ${errorText}`,
      };
    }

    return {
      status: "success",
      actionPayload: {
        channel,
        delivered: true,
        webhookUrl,
      },
    };
  }

  if (channel === "whatsapp") {
    const phoneNumberId = asString(plan.actionConfig.phoneNumberId);
    const recipient = asString(plan.actionConfig.to) ?? asString(plan.actionConfig.recipientId);
    const accessToken =
      asString(plan.actionConfig.token) ?? asString(process.env.GRIND_WHATSAPP_ACCESS_TOKEN);
    const apiVersion = asString(plan.actionConfig.apiVersion) ?? "v22.0";

    if (!phoneNumberId || !recipient || !accessToken) {
      return {
        status: "skipped",
        actionPayload: {
          channel,
          delivered: false,
        },
        error:
          "whatsapp notification requires actionConfig.phoneNumberId, actionConfig.to, and GRIND_WHATSAPP_ACCESS_TOKEN (or actionConfig.token).",
      };
    }

    const response = await fetch(
      `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: recipient,
          type: "text",
          text: { body: message },
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      return {
        status: "failed",
        actionPayload: {
          channel,
          delivered: false,
          phoneNumberId,
          recipient,
        },
        error: `whatsapp send failed: ${response.status} ${errorText}`,
      };
    }

    return {
      status: "success",
      actionPayload: {
        channel,
        delivered: true,
        phoneNumberId,
        recipient,
      },
    };
  }

  return {
    status: "skipped",
    actionPayload: {
      channel,
      delivered: false,
    },
    error: `Unsupported notification channel '${channel}'.`,
  };
}

async function executeRunScript(plan: ForgeActionPlan): Promise<ForgeActionExecution> {
  const script = asString(plan.actionConfig.script);
  if (!script) {
    return {
      status: "failed",
      actionPayload: {},
      error: "run-script requires actionConfig.script.",
    };
  }

  const timeoutMs = parsePositiveInt(plan.actionConfig.timeout) ?? 30_000;
  const workdir = asString(plan.actionConfig.workdir) ?? undefined;

  const result = spawnSync("sh", ["-c", script], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
    ...(workdir ? { cwd: workdir } : {}),
  });

  const timedOut =
    result.signal === "SIGTERM" ||
    (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";

  if (timedOut) {
    return {
      status: "failed",
      actionPayload: { script, exitCode: null },
      error: `Script timed out after ${timeoutMs}ms.`,
    };
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim().slice(0, 500) ?? "";
    return {
      status: "failed",
      actionPayload: { script, exitCode: result.status },
      error: `Script exited ${result.status ?? "null"}${stderr ? `: ${stderr}` : ""}`,
    };
  }

  const stdout = result.stdout?.trim().slice(0, 2_000) ?? "";
  return {
    status: "success",
    actionPayload: { script, exitCode: 0, ...(stdout ? { stdout } : {}) },
  };
}

async function executeQueueQuest(
  db: VaultDb,
  userId: string,
  plan: ForgeActionPlan,
): Promise<ForgeActionExecution> {
  const eventPayload = asRecord(plan.actionConfig.eventPayload);
  const questId =
    asString(plan.actionConfig.questId) ??
    asString(eventPayload?.questId) ??
    asString(plan.actionConfig.targetQuestId);

  if (!questId) {
    return {
      status: "skipped",
      actionPayload: { actionConfig: plan.actionConfig },
      error: "queue-quest requires actionConfig.questId.",
    };
  }

  const quest = await getQuestById(db, questId);
  if (!quest || quest.userId !== userId) {
    return {
      status: "failed",
      actionPayload: { questId },
      error: "Quest not found for user.",
    };
  }

  if (quest.status === "active") {
    return {
      status: "skipped",
      actionPayload: { questId, status: quest.status },
      error: "Quest already active.",
    };
  }

  if (quest.status === "completed") {
    return {
      status: "skipped",
      actionPayload: { questId, status: quest.status },
      error: "Quest already completed.",
    };
  }

  await updateQuestStatus(db, quest.id, userId, "active");
  return {
    status: "success",
    actionPayload: { questId: quest.id, status: "active" },
  };
}

async function executeLogToVault(
  db: VaultDb,
  userId: string,
  plan: ForgeActionPlan,
): Promise<ForgeActionExecution> {
  const eventPayload = asRecord(plan.actionConfig.eventPayload) ?? {};

  const activity = parseActivityType(plan.actionConfig.activityType);
  const durationMinutes = parsePositiveInt(plan.actionConfig.durationMinutes) ?? 15;
  const difficulty = parseDifficulty(plan.actionConfig.difficulty);
  const title = asString(plan.actionConfig.title) ?? `Auto log: ${activity} (${durationMinutes}m)`;

  const baseXp = ACTIVITY_BASE_XP[activity];
  const quest = await createQuest(db, {
    userId,
    title,
    type: "bounty",
    difficulty,
    skillTags: [activity],
    baseXp,
    metadata: {
      origin: "forge",
      triggerType: plan.triggerType,
    },
    objectives: [],
  });

  const proofType = proofTypeFromSignalSource(asString(eventPayload.source));
  const proofConfidence = parseConfidence(eventPayload.confidence);
  const result = await completeQuest(db, {
    userId,
    questId: quest.id,
    durationMinutes,
    proofType,
    ...(proofConfidence !== null ? { proofConfidence } : {}),
    proofData: {
      method: "forge-log",
      triggerType: plan.triggerType,
      ...eventPayload,
    },
  });

  return {
    status: "success",
    actionPayload: {
      questId: quest.id,
      activity,
      durationMinutes,
      xpEarned: result.xpEarned,
      proofType,
    },
  };
}

interface FileSignalTarget {
  path: string;
  fingerprint: string;
}

interface ProcessSignalTarget {
  match: string;
  matchMode: "contains" | "exact" | "regex";
  fingerprint: string;
}

interface SignalCollectorsPlan {
  git: boolean;
  files: FileSignalTarget[];
  processes: ProcessSignalTarget[];
}

async function collectSignalEvents(
  options: ForgeTickOptions,
  rules: ForgeRule[],
): Promise<ForgeEvent[]> {
  const cwd = options.cwd ?? process.cwd();
  const plan = buildSignalCollectorsPlan(rules, cwd);

  const events: ForgeEvent[] = [];

  if (plan.git) {
    const gitEvent = await collectGitSignalEvent(options.db, options.userId, cwd);
    if (gitEvent) events.push(gitEvent);
  }

  if (plan.files.length > 0) {
    const fileEvents = await collectFileSignalEvents(options.db, options.userId, plan.files);
    events.push(...fileEvents);
  }

  if (plan.processes.length > 0) {
    const processEvents = await collectProcessSignalEvents(
      options.db,
      options.userId,
      plan.processes,
    );
    events.push(...processEvents);
  }

  return events;
}

function buildSignalCollectorsPlan(rules: ForgeRule[], cwd: string): SignalCollectorsPlan {
  const files = new Map<string, FileSignalTarget>();
  const processes = new Map<string, ProcessSignalTarget>();
  let git = false;

  for (const rule of rules) {
    if (rule.triggerType !== "signal") continue;
    const source = asString(rule.triggerConfig.source);
    if (!source) continue;

    if (source === "git") {
      git = true;
      continue;
    }

    if (source === "file") {
      const rawPath =
        asString(rule.triggerConfig.path) ??
        asString(rule.triggerConfig.filePath) ??
        asString(rule.triggerConfig.targetPath);
      if (!rawPath) continue;

      const absolutePath = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
      const fingerprint = `file:${absolutePath}`;
      files.set(fingerprint, { path: absolutePath, fingerprint });
      continue;
    }

    if (source === "process") {
      const match =
        asString(rule.triggerConfig.processName) ??
        asString(rule.triggerConfig.name) ??
        asString(rule.triggerConfig.match);
      if (!match) continue;

      const matchMode = parseProcessMatchMode(rule.triggerConfig.matchMode);
      const fingerprint = `process:${matchMode}:${match}`;
      processes.set(fingerprint, { match, matchMode, fingerprint });
    }
  }

  return {
    git,
    files: [...files.values()],
    processes: [...processes.values()],
  };
}

async function collectGitSignalEvent(
  db: VaultDb,
  userId: string,
  cwd: string,
): Promise<ForgeEvent | null> {
  const inRepo = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  if (inRepo.status !== 0 || inRepo.stdout.trim() !== "true") {
    return null;
  }

  const latestCommit = spawnSync("git", ["log", "-1", "--pretty=format:%H %ct"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  if (latestCommit.status !== 0) return null;

  const [hash, secondsRaw] = latestCommit.stdout.trim().split(" ");
  if (!hash) return null;

  const detectedAt = Number.parseInt(secondsRaw ?? "", 10) * 1000 || Date.now();
  const fingerprint = `git:${cwd}`;
  const previous = await getLatestSignalByFingerprint(db, userId, "git", fingerprint);
  const previousHash = asString(previous?.payload.hash);
  if (previousHash === hash) return null;

  const signal = await recordSignal(db, {
    userId,
    source: "git",
    type: "completion",
    confidence: 0.95,
    payload: {
      fingerprint,
      signature: hash,
      hash,
      cwd,
      committedAt: detectedAt,
    },
    detectedAt,
  });

  return {
    type: "signal",
    payload: {
      source: "git",
      signalType: signal.type,
      signalId: signal.id,
      confidence: signal.confidence,
      hash,
      cwd,
    },
    at: detectedAt,
    dedupeKey: `git:${hash}`,
  };
}

async function collectFileSignalEvents(
  db: VaultDb,
  userId: string,
  targets: FileSignalTarget[],
): Promise<ForgeEvent[]> {
  const events: ForgeEvent[] = [];

  for (const target of targets) {
    const snapshot = readFileSnapshot(target.path);
    if (!snapshot) continue;

    const previous = await getLatestSignalByFingerprint(db, userId, "file", target.fingerprint);
    const previousSignature = asString(previous?.payload.signature);
    if (previousSignature === snapshot.signature) continue;
    if (!previousSignature && snapshot.state === "missing") continue;

    const signal = await recordSignal(db, {
      userId,
      source: "file",
      type: snapshot.state === "exists" ? "completion" : "drift",
      confidence: snapshot.state === "exists" ? 0.9 : 0.8,
      payload: {
        fingerprint: target.fingerprint,
        signature: snapshot.signature,
        path: target.path,
        state: snapshot.state,
        ...(snapshot.mtimeMs ? { mtimeMs: snapshot.mtimeMs } : {}),
        ...(snapshot.size ? { size: snapshot.size } : {}),
      },
      detectedAt: snapshot.detectedAt,
    });

    events.push({
      type: "signal",
      payload: {
        source: "file",
        signalType: signal.type,
        signalId: signal.id,
        confidence: signal.confidence,
        path: target.path,
        state: snapshot.state,
      },
      at: snapshot.detectedAt,
      dedupeKey: `file:${target.path}:${snapshot.signature}`,
    });
  }

  return events;
}

async function collectProcessSignalEvents(
  db: VaultDb,
  userId: string,
  targets: ProcessSignalTarget[],
): Promise<ForgeEvent[]> {
  const events: ForgeEvent[] = [];

  for (const target of targets) {
    const now = Date.now();
    const pids = findMatchingProcessPids(target.match, target.matchMode);
    const running = pids.length > 0;
    const signature = running ? `running:${pids.join(",")}` : "stopped";

    const previous = await getLatestSignalByFingerprint(db, userId, "process", target.fingerprint);
    const previousSignature = asString(previous?.payload.signature);
    if (previousSignature === signature) continue;
    if (!previousSignature && !running) continue;

    const signal = await recordSignal(db, {
      userId,
      source: "process",
      type: running ? "activity" : "drift",
      confidence: running ? 0.9 : 0.8,
      payload: {
        fingerprint: target.fingerprint,
        signature,
        processMatch: target.match,
        matchMode: target.matchMode,
        state: running ? "running" : "stopped",
        pids,
      },
      detectedAt: now,
    });

    events.push({
      type: "signal",
      payload: {
        source: "process",
        signalType: signal.type,
        signalId: signal.id,
        confidence: signal.confidence,
        processMatch: target.match,
        state: running ? "running" : "stopped",
        pids,
      },
      at: now,
      dedupeKey: `process:${target.matchMode}:${target.match}:${signature}`,
    });
  }

  return events;
}

function readFileSnapshot(path: string): {
  state: "exists" | "missing";
  signature: string;
  detectedAt: number;
  mtimeMs?: number;
  size?: number;
} | null {
  try {
    const stats = statSync(path);
    const mtimeMs = Math.trunc(stats.mtimeMs);
    const size = Number.isFinite(stats.size) ? stats.size : 0;
    return {
      state: "exists",
      signature: `exists:${mtimeMs}:${size}`,
      detectedAt: mtimeMs > 0 ? mtimeMs : Date.now(),
      mtimeMs,
      size,
    };
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? (error as { code?: unknown }).code
        : null;
    if (code === "ENOENT") {
      return {
        state: "missing",
        signature: "missing",
        detectedAt: Date.now(),
      };
    }
    return null;
  }
}

function parseProcessMatchMode(value: unknown): "contains" | "exact" | "regex" {
  if (value === "exact" || value === "regex" || value === "contains") {
    return value;
  }
  return "contains";
}

function findMatchingProcessPids(match: string, mode: "contains" | "exact" | "regex"): number[] {
  const viaPgrep = findProcessPidsViaPgrep(match, mode);
  if (viaPgrep !== null) return viaPgrep;
  return findProcessPidsViaPs(match, mode);
}

function findProcessPidsViaPgrep(
  match: string,
  mode: "contains" | "exact" | "regex",
): number[] | null {
  if (mode === "regex") return null;

  const args = mode === "exact" ? ["-x", match] : ["-f", match];
  const result = spawnSync("pgrep", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  if (result.error) return null;
  if (result.status === 1) return [];
  if (result.status !== 0) return null;

  return result.stdout
    .split("\n")
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((pid) => Number.isInteger(pid) && pid > 0)
    .sort((a, b) => a - b);
}

function findProcessPidsViaPs(match: string, mode: "contains" | "exact" | "regex"): number[] {
  const result = spawnSync("ps", ["-A", "-o", "pid=,command="], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  if (result.status !== 0) return [];

  const regex = mode === "regex" ? safeRegex(match) : null;
  const pids: number[] = [];

  for (const line of result.stdout.split("\n")) {
    const row = line.trim();
    if (!row) continue;

    const matchRow = row.match(/^(\d+)\s+(.+)$/);
    if (!matchRow) continue;
    const pid = Number.parseInt(matchRow[1] ?? "", 10);
    const command = matchRow[2] ?? "";
    if (!Number.isInteger(pid) || pid <= 0) continue;

    if (mode === "exact") {
      const executable = command.split(/\s+/)[0] ?? "";
      if (executable === match || command === match) pids.push(pid);
      continue;
    }

    if (mode === "contains") {
      if (command.includes(match)) pids.push(pid);
      continue;
    }

    if (regex && regex.test(command)) {
      pids.push(pid);
    }
  }

  return pids.sort((a, b) => a - b);
}

function safeRegex(value: string): RegExp | null {
  try {
    return new RegExp(value);
  } catch {
    return null;
  }
}

function parseActivityType(value: unknown): ActivityType {
  const parsed = activityTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : "coding";
}

function parseDifficulty(value: unknown): QuestDifficulty {
  const parsed = questDifficultySchema.safeParse(value);
  return parsed.success ? parsed.data : "easy";
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseConfidence(value: unknown): number | null {
  if (typeof value !== "number") return null;
  if (Number.isNaN(value) || value < 0 || value > 1) return null;
  return value;
}

async function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
