import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getGrindHome } from "@grindxp/core";

export const WEB_PORT = 3000;
export const WEB_HOST = "127.0.0.1";

export interface WebProcessState {
  pid: number;
  startedAt: number;
  port: number;
}

export interface WebStatus {
  state: WebProcessState | null;
  running: boolean;
  reachable: boolean;
}

// ── State file ─────────────────────────────────────────────────────────────

function getWebStatePath(): string {
  return join(getGrindHome(), "web-state.json");
}

export function readWebProcessState(): WebProcessState | null {
  const path = getWebStatePath();
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    return parseWebProcessState(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeWebProcessState(state: WebProcessState): void {
  const path = getWebStatePath();
  writeFileSync(path, JSON.stringify(state, null, 2));
  chmodSync(path, 0o600);
}

export function clearWebProcessState(): void {
  const path = getWebStatePath();
  if (existsSync(path)) unlinkSync(path);
}

// ── Process helpers ────────────────────────────────────────────────────────

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await Bun.sleep(150);
  }
  return !isProcessAlive(pid);
}

async function probeWeb(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://${WEB_HOST}:${port}/`, {
      signal: AbortSignal.timeout(1_000),
    });
    return res.status > 0;
  } catch {
    return false;
  }
}

async function waitForWebReady(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeWeb(port)) return true;
    await Bun.sleep(300);
  }
  return false;
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function startManagedWeb(webDir: string): Promise<WebProcessState> {
  const child = Bun.spawn(["bun", "run", "start"], {
    cwd: webDir,
    env: process.env,
    stdio: ["ignore", "ignore", "ignore"],
    detached: true,
  });
  child.unref();

  const state: WebProcessState = {
    pid: child.pid,
    startedAt: Date.now(),
    port: WEB_PORT,
  };

  writeWebProcessState(state);

  const ready = await waitForWebReady(WEB_PORT, 30_000);
  if (!ready && !isProcessAlive(state.pid)) {
    clearWebProcessState();
    throw new Error("Web app failed to start (process exited early).");
  }

  return state;
}

export async function stopManagedWeb(): Promise<{
  stopped: boolean;
  pid?: number;
  forced?: boolean;
}> {
  const state = readWebProcessState();
  if (!state) return { stopped: false };

  const { pid } = state;

  if (!isProcessAlive(pid)) {
    clearWebProcessState();
    return { stopped: false, pid };
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    clearWebProcessState();
    return { stopped: false, pid };
  }

  const graceful = await waitForProcessExit(pid, 4_000);
  if (graceful) {
    clearWebProcessState();
    return { stopped: true, pid, forced: false };
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    clearWebProcessState();
    return { stopped: false, pid };
  }

  await waitForProcessExit(pid, 2_000);
  clearWebProcessState();
  return { stopped: true, pid, forced: true };
}

export async function getManagedWebStatus(): Promise<WebStatus> {
  const state = readWebProcessState();
  if (!state) return { state: null, running: false, reachable: false };

  const running = isProcessAlive(state.pid);
  if (!running) return { state, running: false, reachable: false };

  const reachable = await probeWeb(state.port);
  return { state, running, reachable };
}

// ── Parsing ────────────────────────────────────────────────────────────────

function parseWebProcessState(value: unknown): WebProcessState | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const pid = parseIntField(obj["pid"]);
  const startedAt = parseIntField(obj["startedAt"]);
  const port = parseIntField(obj["port"]);
  if (!pid || !startedAt || !port) return null;
  return { pid, startedAt, port };
}

function parseIntField(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}
