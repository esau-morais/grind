import {
  type CreateForgeRuleInput,
  type ForgeRule,
  type ForgeTriggerType,
  createForgeRuleInputSchema,
  forgeRuleSchema,
} from "../schema";

export interface ForgeEvent {
  type: ForgeTriggerType;
  payload: Record<string, unknown>;
  at: number;
  dedupeKey?: string;
}

export interface ForgeActionPlan {
  ruleId: string;
  triggerType: ForgeTriggerType;
  actionType: ForgeRule["actionType"];
  actionConfig: ForgeRule["actionConfig"];
  queuedAt: number;
  eventAt: number;
  dedupeKey: string;
}

export function createForgeRule(input: CreateForgeRuleInput): ForgeRule {
  const valid = createForgeRuleInputSchema.parse(input);
  const now = Date.now();

  return forgeRuleSchema.parse({
    ...valid,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  });
}

export function toggleForgeRule(rule: ForgeRule, enabled?: boolean): ForgeRule {
  return forgeRuleSchema.parse({
    ...rule,
    enabled: enabled ?? !rule.enabled,
    updatedAt: Date.now(),
  });
}

export function shouldTriggerForgeRule(rule: ForgeRule, event: ForgeEvent): boolean {
  if (!rule.enabled || rule.triggerType !== event.type) {
    return false;
  }

  if (rule.triggerType === "cron") {
    const cronExpr = asString(rule.triggerConfig.cron);
    if (!cronExpr) return false;
    return cronMatchesAt(cronExpr, event.at);
  }

  return matchesTriggerConfig(rule.triggerConfig, event.payload);
}

export function buildForgeActionPlan(rule: ForgeRule, event: ForgeEvent): ForgeActionPlan | null {
  if (!shouldTriggerForgeRule(rule, event)) {
    return null;
  }

  return {
    ruleId: rule.id,
    triggerType: rule.triggerType,
    actionType: rule.actionType,
    actionConfig: {
      ...rule.actionConfig,
      eventPayload: event.payload,
      eventAt: event.at,
    },
    queuedAt: Date.now(),
    eventAt: event.at,
    dedupeKey: event.dedupeKey ?? buildForgeDedupeKey(rule, event),
  };
}

export function buildForgeDedupeKey(rule: ForgeRule, event: ForgeEvent): string {
  if (event.dedupeKey) return event.dedupeKey;

  if (event.type === "cron") {
    return `cron:${Math.floor(event.at / 60_000)}`;
  }

  const eventId = asString(event.payload.eventId) ?? asString(event.payload.id);
  if (eventId) return `${event.type}:${eventId}`;

  const payloadSig = JSON.stringify(event.payload);
  const bucket = Math.floor(event.at / 60_000);
  return `${event.type}:${bucket}:${payloadSig}`;
}

function matchesTriggerConfig(
  triggerConfig: Record<string, unknown>,
  payload: Record<string, unknown>,
): boolean {
  const entries = Object.entries(triggerConfig).filter(
    ([key]) => key !== "cron" && key !== "timezone",
  );
  if (entries.length === 0) return true;

  return entries.every(([key, expected]) => {
    const actual = payload[key];
    if (actual === undefined) return false;
    return isDeepEqual(actual, expected);
  });
}

function isDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

const CRON_FIELD_REGEX = /^[\d*/,\-]+$/;

export function cronMatchesAt(expression: string, at: number): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const [minField, hourField, dayField, monthField, weekDayField] = fields;
  if (!minField || !hourField || !dayField || !monthField || !weekDayField) return false;

  const date = new Date(at);
  const minute = date.getUTCMinutes();
  const hour = date.getUTCHours();
  const day = date.getUTCDate();
  const month = date.getUTCMonth() + 1;
  const weekDay = date.getUTCDay();

  return (
    cronFieldMatches(minField, minute, 0, 59) &&
    cronFieldMatches(hourField, hour, 0, 23) &&
    cronFieldMatches(dayField, day, 1, 31) &&
    cronFieldMatches(monthField, month, 1, 12) &&
    cronFieldMatches(weekDayField, normalizeWeekday(weekDay), 0, 6, true)
  );
}

function cronFieldMatches(
  field: string,
  value: number,
  min: number,
  max: number,
  isWeekday = false,
): boolean {
  if (!CRON_FIELD_REGEX.test(field)) return false;

  const chunks = field.split(",");
  for (const chunk of chunks) {
    if (chunk === "*") return true;

    const [rangeRaw, stepRaw] = chunk.split("/");
    if (!rangeRaw) continue;

    const step = stepRaw ? Number.parseInt(stepRaw, 10) : 1;
    if (!Number.isInteger(step) || step <= 0) continue;

    const [start, end] = parseRange(rangeRaw, min, max, isWeekday);
    if (start === null || end === null) continue;

    if (value < start || value > end) continue;
    if ((value - start) % step === 0) return true;
  }

  return false;
}

function parseRange(
  raw: string,
  min: number,
  max: number,
  isWeekday: boolean,
): [number | null, number | null] {
  if (raw === "*") return [min, max];

  if (raw.includes("-")) {
    const [startRaw, endRaw] = raw.split("-");
    const start = parseCronNumber(startRaw, min, max, isWeekday);
    const end = parseCronNumber(endRaw, min, max, isWeekday);
    if (start === null || end === null || start > end) return [null, null];
    return [start, end];
  }

  const value = parseCronNumber(raw, min, max, isWeekday);
  return [value, value];
}

function parseCronNumber(
  raw: string | undefined,
  min: number,
  max: number,
  isWeekday: boolean,
): number | null {
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed)) return null;

  const normalized = isWeekday ? normalizeWeekday(parsed) : parsed;
  if (normalized < min || normalized > max) return null;
  return normalized;
}

function normalizeWeekday(day: number): number {
  return day === 7 ? 0 : day;
}
