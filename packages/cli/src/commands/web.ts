import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import * as p from "@clack/prompts";
import { spinner } from "../spinner";
import {
  clearWebProcessState,
  getManagedWebStatus,
  startManagedWeb,
  stopManagedWeb,
  WEB_HOST,
  WEB_PORT,
} from "../web/service";

const URL = `http://${WEB_HOST}:${WEB_PORT}`;

export async function webStartCommand(): Promise<void> {
  const status = await getManagedWebStatus();

  if (status.running && status.reachable) {
    p.log.success(`Web app already running at ${URL} (pid ${status.state!.pid})`);
    await openBrowser(URL);
    return;
  }

  // Stale state: process died but state file remains
  if (status.state && !status.running) {
    clearWebProcessState();
  }

  const web = resolveWeb();
  if (!web.ok) {
    p.log.error(
      web.reason === "not-installed"
        ? "@grindxp/web is not installed. Run `bun add @grindxp/web`."
        : "@grindxp/web is installed but not built. Run `bun run build` in apps/web.",
    );
    process.exit(1);
  }

  const spin = spinner();
  spin.start("Starting web app…");

  try {
    const state = await startManagedWeb(web.serverEntry);
    spin.stop(`Web app started (pid ${state.pid}) at ${URL}`);
  } catch (err) {
    spin.error("Failed to start web app.");
    p.log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const opened = await openBrowser(URL);
  if (!opened) p.log.info(`Open in your browser: ${URL}`);
}

export async function webStopCommand(): Promise<void> {
  const result = await stopManagedWeb();

  if (!result.pid) {
    p.log.info("Web app is not running.");
    return;
  }

  if (!result.stopped) {
    p.log.warn(`Web process ${result.pid} was already stopped.`);
    return;
  }

  const suffix = result.forced ? " (forced)" : "";
  p.log.success(`Web app stopped (pid ${result.pid})${suffix}.`);
}

export async function webStatusCommand(): Promise<void> {
  const status = await getManagedWebStatus();

  if (!status.state) {
    p.log.step("Web app: stopped");
    p.log.message("No managed web process found. Run `grind web start`.");
    return;
  }

  p.log.step(`Web app: ${status.running ? "running" : "stopped"}`);
  p.log.message(`PID:     ${status.state.pid}`);
  p.log.message(`Started: ${new Date(status.state.startedAt).toLocaleString()}`);
  p.log.message(`URL:     ${URL}`);
  p.log.message(`Status:  ${status.reachable ? "reachable" : "not reachable"}`);
}

export async function webServeCommand(args: string[]): Promise<void> {
  const noOpen = args.includes("--no-open");

  if (await isPortReachable(WEB_PORT)) {
    p.log.success(`Web app already running at ${URL}`);
    if (!noOpen) await openBrowser(URL);
    else p.log.info(`Open in your browser: ${URL}`);
    return;
  }

  const web = resolveWeb();
  if (!web.ok) {
    p.log.error(
      web.reason === "not-installed"
        ? "@grindxp/web is not installed. Run `bun add @grindxp/web`."
        : "@grindxp/web is installed but not built. Run `bun run build` in apps/web.",
    );
    process.exit(1);
  }

  p.log.step(`Starting web app…`);

  const proc = Bun.spawn(["bun", web.serverEntry], {
    env: { ...process.env, PORT: String(WEB_PORT) },
    stdout: "ignore",
    stderr: "pipe",
  });

  const ready = await waitForPort(WEB_PORT, 30_000);

  if (!ready) {
    proc.kill();
    p.log.error("Web app failed to start within 30 seconds.");
    process.exit(1);
  }

  p.log.success(`Web app running at ${URL}`);

  if (!noOpen) {
    const opened = await openBrowser(URL);
    if (!opened) p.log.info(`Open in your browser: ${URL}`);
  } else {
    p.log.info(`Open in your browser: ${URL}`);
  }

  p.log.message("Press Ctrl+C to stop.");

  await new Promise<void>((resolve) => {
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
      proc.kill();
      p.log.info("Web app stopped.");
      resolve();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────

type WebResolution =
  | { ok: true; serverEntry: string }
  | { ok: false; reason: "not-installed" | "not-built" };

function resolveWeb(): WebResolution {
  // Production: embedded in CLI dist at build time
  const embedded = join(import.meta.dir, "web", "server", "server.js");
  if (existsSync(embedded)) {
    return { ok: true, serverEntry: embedded };
  }

  // Dev: workspace resolution
  try {
    const pkgJson = Bun.resolveSync("@grindxp/web/package.json", import.meta.dir);
    const webDir = dirname(pkgJson);
    const serverEntry = join(webDir, "dist", "server", "server.js");
    if (!existsSync(serverEntry)) {
      return { ok: false, reason: "not-built" };
    }
    return { ok: true, serverEntry };
  } catch {
    return { ok: false, reason: "not-built" };
  }
}

async function isPortReachable(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://${WEB_HOST}:${port}/`, {
      signal: AbortSignal.timeout(500),
    });
    return res.status > 0;
  } catch {
    return false;
  }
}

async function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortReachable(port)) return true;
    await Bun.sleep(500);
  }
  return false;
}

async function openBrowser(url: string): Promise<boolean> {
  const platform = process.platform;
  const hasDisplay = Boolean(process.env["DISPLAY"] || process.env["WAYLAND_DISPLAY"]);
  const isSsh = Boolean(
    process.env["SSH_CLIENT"] || process.env["SSH_TTY"] || process.env["SSH_CONNECTION"],
  );

  if (isSsh && !hasDisplay && platform !== "win32") return false;

  try {
    if (platform === "darwin") {
      Bun.spawn(["open", url]);
      return true;
    }
    if (platform === "linux" && hasDisplay) {
      Bun.spawn(["xdg-open", url]);
      return true;
    }
    if (platform === "win32") {
      Bun.spawn(["cmd", "/c", "start", "", url]);
      return true;
    }
  } catch {
    // caller falls back to printing URL
  }
  return false;
}
