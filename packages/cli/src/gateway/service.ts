import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { type GatewayConfig, type GrindConfig, getGrindHome } from "@grindxp/core";

import {
  disableGatewayService,
  ensureGatewayServiceRunning,
  getGatewayServiceStatus,
  type GatewayServiceStatus,
  stopGatewayServiceIfInstalled,
} from "./autostart";

export interface GatewayProcessState {
  pid: number;
  startedAt: number;
  host: string;
  port: number;
  userId: string;
}

export interface GatewayResolvedConfig {
  host: string;
  port: number;
  token: string;
  telegramBotToken?: string;
  whatsAppMode?: "qr-link" | "cloud-api";
  whatsAppLinkedAt?: number;
  whatsAppPairingMethod?: "qr" | "pairing-code";
  whatsAppPairingPhone?: string;
  telegramWebhookSecret?: string;
  telegramWebhookPath?: string;
  discordPublicKey?: string;
  discordWebhookPath?: string;
  whatsAppWebhookPath?: string;
  whatsAppVerifyToken?: string;
  whatsAppAppSecret?: string;
}

export interface GatewayStartOptions {
  host?: string;
  port?: number;
  token?: string;
  telegramBotToken?: string;
  whatsAppMode?: "qr-link" | "cloud-api";
  whatsAppLinkedAt?: number;
  whatsAppPairingMethod?: "qr" | "pairing-code";
  whatsAppPairingPhone?: string;
  telegramWebhookSecret?: string;
  telegramWebhookPath?: string;
  discordPublicKey?: string;
  discordWebhookPath?: string;
  whatsAppWebhookPath?: string;
  whatsAppVerifyToken?: string;
  whatsAppAppSecret?: string;
}

export interface GatewayStartResult {
  host: string;
  port: number;
  managedByService: boolean;
  pid?: number;
}

export interface GatewayStatus {
  state: GatewayProcessState | null;
  running: boolean;
  healthOk: boolean;
  healthError?: string;
  autostart: GatewayServiceStatus;
}

export const DEFAULT_GATEWAY_PORT = 5174;

export function resolveGatewayConfig(
  config: GrindConfig,
  overrides?: GatewayStartOptions,
): GatewayResolvedConfig | null {
  const base: GatewayConfig | undefined = config.gateway;

  const host = overrides?.host ?? base?.host ?? "127.0.0.1";
  const port = overrides?.port ?? base?.port ?? DEFAULT_GATEWAY_PORT;
  const token = overrides?.token ?? base?.token;
  if (!token) return null;

  return {
    host,
    port,
    token,
    ...(overrides?.whatsAppMode
      ? { whatsAppMode: overrides.whatsAppMode }
      : base?.whatsAppMode
        ? { whatsAppMode: base.whatsAppMode }
        : {}),
    ...(overrides?.whatsAppLinkedAt
      ? { whatsAppLinkedAt: overrides.whatsAppLinkedAt }
      : base?.whatsAppLinkedAt
        ? { whatsAppLinkedAt: base.whatsAppLinkedAt }
        : {}),
    ...(overrides?.whatsAppPairingMethod
      ? { whatsAppPairingMethod: overrides.whatsAppPairingMethod }
      : base?.whatsAppPairingMethod
        ? { whatsAppPairingMethod: base.whatsAppPairingMethod }
        : {}),
    ...(overrides?.whatsAppPairingPhone
      ? { whatsAppPairingPhone: overrides.whatsAppPairingPhone }
      : base?.whatsAppPairingPhone
        ? { whatsAppPairingPhone: base.whatsAppPairingPhone }
        : {}),
    ...(overrides?.telegramBotToken
      ? { telegramBotToken: overrides.telegramBotToken }
      : base?.telegramBotToken
        ? { telegramBotToken: base.telegramBotToken }
        : {}),
    ...(overrides?.telegramWebhookSecret
      ? { telegramWebhookSecret: overrides.telegramWebhookSecret }
      : base?.telegramWebhookSecret
        ? { telegramWebhookSecret: base.telegramWebhookSecret }
        : {}),
    ...(overrides?.telegramWebhookPath
      ? { telegramWebhookPath: overrides.telegramWebhookPath }
      : base?.telegramWebhookPath
        ? { telegramWebhookPath: base.telegramWebhookPath }
        : {}),
    ...(overrides?.discordPublicKey
      ? { discordPublicKey: overrides.discordPublicKey }
      : base?.discordPublicKey
        ? { discordPublicKey: base.discordPublicKey }
        : {}),
    ...(overrides?.discordWebhookPath
      ? { discordWebhookPath: overrides.discordWebhookPath }
      : base?.discordWebhookPath
        ? { discordWebhookPath: base.discordWebhookPath }
        : {}),

    ...(overrides?.whatsAppWebhookPath
      ? { whatsAppWebhookPath: overrides.whatsAppWebhookPath }
      : base?.whatsAppWebhookPath
        ? { whatsAppWebhookPath: base.whatsAppWebhookPath }
        : {}),
    ...(overrides?.whatsAppVerifyToken
      ? { whatsAppVerifyToken: overrides.whatsAppVerifyToken }
      : base?.whatsAppVerifyToken
        ? { whatsAppVerifyToken: base.whatsAppVerifyToken }
        : {}),
    ...(overrides?.whatsAppAppSecret
      ? { whatsAppAppSecret: overrides.whatsAppAppSecret }
      : base?.whatsAppAppSecret
        ? { whatsAppAppSecret: base.whatsAppAppSecret }
        : {}),
  };
}

export async function startManagedGateway(
  config: GrindConfig,
  overrides?: GatewayStartOptions,
): Promise<GatewayStartResult> {
  const resolved = resolveGatewayConfig(config, overrides);
  if (!resolved) {
    throw new Error(
      "Gateway token is missing. Re-run `grind init` or set gateway token in config.",
    );
  }

  const existing = readGatewayProcessState();
  if (existing && isProcessAlive(existing.pid)) {
    throw new Error(`Gateway already running (pid ${existing.pid}).`);
  }
  if (existing) {
    clearGatewayProcessState();
  }

  if (!hasGatewayOverrides(overrides)) {
    const autostart = await safeGetGatewayServiceStatus();
    if (autostart.supported && autostart.available) {
      await ensureGatewayServiceRunning();
      const state = await waitForGatewayState(8_000);
      const host = state?.host ?? resolved.host;
      const port = state?.port ?? resolved.port;

      const healthy = await waitForGatewayHealth(host, port, 8_000);
      if (!healthy) {
        throw new Error("Gateway service started but health check did not pass.");
      }

      return {
        host,
        port,
        managedByService: true,
        ...(state ? { pid: state.pid } : {}),
      };
    }
  }

  return startDetachedGateway(config, resolved);
}

export async function stopManagedGateway(): Promise<{
  stopped: boolean;
  pid?: number;
  forced?: boolean;
  managedByService: boolean;
}> {
  const autostart = await safeGetGatewayServiceStatus();
  const stateBefore = readGatewayProcessState();

  if (autostart.supported && autostart.available && autostart.installed) {
    await stopGatewayServiceIfInstalled();

    const pid = stateBefore?.pid;
    if (pid && isProcessAlive(pid)) {
      const graceful = await waitForProcessExit(pid, 4_000);
      if (!graceful) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          clearGatewayProcessState();
          return { stopped: false, pid, managedByService: true };
        }
        await waitForProcessExit(pid, 2_000);
        clearGatewayProcessState();
        return { stopped: true, pid, forced: true, managedByService: true };
      }
    }

    clearGatewayProcessState();
    return {
      stopped: Boolean(autostart.running || pidOrUndefined(stateBefore)),
      ...(stateBefore ? { pid: stateBefore.pid } : {}),
      managedByService: true,
      ...(autostart.running ? { forced: false } : {}),
    };
  }

  const result = await stopDetachedGateway();
  return {
    ...result,
    managedByService: false,
  };
}

export async function disableManagedGatewayAutostart(): Promise<{
  disabled: boolean;
  manager: GatewayServiceStatus["manager"];
}> {
  const autostart = await safeGetGatewayServiceStatus();
  if (!(autostart.supported && autostart.available && autostart.installed)) {
    return {
      disabled: false,
      manager: autostart.manager,
    };
  }

  await disableGatewayService();
  clearGatewayProcessState();
  return {
    disabled: true,
    manager: autostart.manager,
  };
}

export async function getManagedGatewayStatus(config: GrindConfig): Promise<GatewayStatus> {
  const autostart = await safeGetGatewayServiceStatus();
  const state = readGatewayProcessState();
  const running = state ? isProcessAlive(state.pid) : autostart.running;

  const resolved = resolveGatewayConfig(config) ?? {
    host: "127.0.0.1",
    port: DEFAULT_GATEWAY_PORT,
  };
  const host = state?.host ?? resolved.host;
  const port = state?.port ?? resolved.port;

  if (!running) {
    return {
      state,
      running: false,
      healthOk: false,
      healthError: state ? "Gateway process not running." : "No gateway state file.",
      autostart,
    };
  }

  const health = await probeGatewayHealth(host, port);

  return {
    state,
    running,
    healthOk: health.ok,
    ...(health.ok ? {} : { healthError: health.error }),
    autostart,
  };
}

export async function chooseAvailableGatewayPort(
  host: string,
  preferredPort: number,
  maxProbeCount = 20,
): Promise<{ port: number; shifted: boolean }> {
  if (await isPortAvailable(host, preferredPort)) {
    return { port: preferredPort, shifted: false };
  }

  if (
    preferredPort !== DEFAULT_GATEWAY_PORT &&
    (await isPortAvailable(host, DEFAULT_GATEWAY_PORT))
  ) {
    return { port: DEFAULT_GATEWAY_PORT, shifted: true };
  }

  for (let offset = 1; offset <= maxProbeCount; offset += 1) {
    const candidate = preferredPort + offset;
    if (candidate > 65_535) break;
    if (await isPortAvailable(host, candidate)) {
      return { port: candidate, shifted: true };
    }
  }

  throw new Error(
    `No available port found near ${preferredPort}. Set a free port with --port or GRIND_GATEWAY_PORT.`,
  );
}

export function readGatewayProcessState(): GatewayProcessState | null {
  const statePath = getGatewayStatePath();
  if (!existsSync(statePath)) return null;

  try {
    const raw = readFileSync(statePath, "utf-8");
    return parseGatewayProcessState(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearGatewayProcessState(): void {
  const statePath = getGatewayStatePath();
  if (existsSync(statePath)) {
    unlinkSync(statePath);
  }
}

export function writeGatewayProcessState(state: GatewayProcessState): void {
  const statePath = getGatewayStatePath();
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  chmodSync(statePath, 0o600);
}

function getGatewayStatePath(): string {
  return join(getGrindHome(), "gateway-state.json");
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function startDetachedGateway(
  config: GrindConfig,
  resolved: GatewayResolvedConfig,
): Promise<GatewayStartResult> {
  const current = readGatewayProcessState();
  if (current && isProcessAlive(current.pid)) {
    throw new Error(`Gateway already running (pid ${current.pid}).`);
  }

  if (current) {
    clearGatewayProcessState();
  }

  const entrypoint = process.argv[1];
  if (!entrypoint) {
    throw new Error("Unable to resolve CLI entrypoint for gateway process.");
  }

  const selectedPort = await chooseAvailableGatewayPort(resolved.host, resolved.port);

  const args = [
    entrypoint,
    "gateway",
    "serve",
    "--host",
    resolved.host,
    "--port",
    String(selectedPort.port),
    "--token",
    resolved.token,
  ];

  if (resolved.telegramWebhookSecret) {
    args.push("--telegram-secret", resolved.telegramWebhookSecret);
  }
  if (resolved.telegramWebhookPath) {
    args.push("--telegram-path", resolved.telegramWebhookPath);
  }
  if (resolved.discordPublicKey) {
    args.push("--discord-public-key", resolved.discordPublicKey);
  }
  if (resolved.discordWebhookPath) {
    args.push("--discord-path", resolved.discordWebhookPath);
  }
  if (resolved.telegramBotToken) {
    args.push("--telegram-bot-token", resolved.telegramBotToken);
  }
  if (resolved.whatsAppWebhookPath) {
    args.push("--whatsapp-path", resolved.whatsAppWebhookPath);
  }
  if (resolved.whatsAppMode) {
    args.push("--whatsapp-mode", resolved.whatsAppMode);
  }
  if (resolved.whatsAppLinkedAt) {
    args.push("--whatsapp-linked-at", String(resolved.whatsAppLinkedAt));
  }
  if (resolved.whatsAppPairingMethod) {
    args.push("--whatsapp-pairing-method", resolved.whatsAppPairingMethod);
  }
  if (resolved.whatsAppPairingPhone) {
    args.push("--whatsapp-pairing-phone", resolved.whatsAppPairingPhone);
  }
  if (resolved.whatsAppVerifyToken) {
    args.push("--whatsapp-verify-token", resolved.whatsAppVerifyToken);
  }
  if (resolved.whatsAppAppSecret) {
    args.push("--whatsapp-app-secret", resolved.whatsAppAppSecret);
  }

  const child = Bun.spawn([process.execPath, ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "ignore", "ignore"],
    detached: true,
  });
  child.unref();

  const state: GatewayProcessState = {
    pid: child.pid,
    startedAt: Date.now(),
    host: resolved.host,
    port: selectedPort.port,
    userId: config.userId,
  };

  writeGatewayProcessState(state);

  const healthy = await waitForGatewayHealth(resolved.host, selectedPort.port, 6_000);
  if (!healthy) {
    if (!isProcessAlive(state.pid)) {
      clearGatewayProcessState();
      throw new Error("Gateway failed to start (process exited early).");
    }
  }

  return {
    host: resolved.host,
    port: selectedPort.port,
    pid: state.pid,
    managedByService: false,
  };
}

async function stopDetachedGateway(): Promise<{
  stopped: boolean;
  pid?: number;
  forced?: boolean;
}> {
  const state = readGatewayProcessState();
  if (!state) return { stopped: false };

  const pid = state.pid;
  if (!isProcessAlive(pid)) {
    clearGatewayProcessState();
    return { stopped: false, pid };
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    clearGatewayProcessState();
    return { stopped: false, pid };
  }

  const graceful = await waitForProcessExit(pid, 4_000);
  if (graceful) {
    clearGatewayProcessState();
    return { stopped: true, pid, forced: false };
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    clearGatewayProcessState();
    return { stopped: false, pid };
  }

  await waitForProcessExit(pid, 2_000);
  clearGatewayProcessState();
  return { stopped: true, pid, forced: true };
}

async function isPortAvailable(host: string, port: number): Promise<boolean> {
  try {
    const probe = Bun.serve({
      hostname: host,
      port,
      fetch: () => new Response("ok"),
    });
    probe.stop(true);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessAlive(pid)) return true;
    await Bun.sleep(150);
  }
  return !isProcessAlive(pid);
}

async function waitForGatewayHealth(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const health = await probeGatewayHealth(host, port);
    if (health.ok) return true;
    await Bun.sleep(200);
  }
  return false;
}

async function waitForGatewayState(timeoutMs: number): Promise<GatewayProcessState | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = readGatewayProcessState();
    if (state && isProcessAlive(state.pid)) {
      return state;
    }
    await Bun.sleep(200);
  }
  return readGatewayProcessState();
}

async function probeGatewayHealth(
  host: string,
  port: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch(`http://${host}:${port}/health`, {
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function parseGatewayProcessState(value: unknown): GatewayProcessState | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;

  const pid = parseIntField(obj.pid);
  const startedAt = parseIntField(obj.startedAt);
  const host = typeof obj.host === "string" && obj.host.length > 0 ? obj.host : null;
  const port = parseIntField(obj.port);
  const userId = typeof obj.userId === "string" && obj.userId.length > 0 ? obj.userId : null;

  if (!pid || !startedAt || !host || !port || !userId) return null;
  if (port < 1 || port > 65_535) return null;

  return { pid, startedAt, host, port, userId };
}

function parseIntField(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function hasGatewayOverrides(overrides?: GatewayStartOptions): boolean {
  if (!overrides) return false;
  return Object.keys(overrides).length > 0;
}

async function safeGetGatewayServiceStatus(): Promise<GatewayServiceStatus> {
  try {
    return await getGatewayServiceStatus();
  } catch (error) {
    return {
      manager:
        process.platform === "darwin"
          ? "launchd"
          : process.platform === "linux"
            ? "systemd-user"
            : process.platform === "win32"
              ? "schtasks"
              : "none",
      supported:
        process.platform === "darwin" ||
        process.platform === "linux" ||
        process.platform === "win32",
      available: false,
      installed: false,
      enabled: false,
      running: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function pidOrUndefined(state: GatewayProcessState | null): number | undefined {
  return state ? state.pid : undefined;
}
