import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { getGrindHome } from "@grindxp/core";

export type GatewayServiceManager = "launchd" | "systemd-user" | "schtasks" | "none";

export interface GatewayServiceStatus {
  manager: GatewayServiceManager;
  supported: boolean;
  available: boolean;
  installed: boolean;
  enabled: boolean;
  running: boolean;
  detail?: string;
}

interface GatewayLaunchSpec {
  executable: string;
  entrypoint: string;
  args: string[];
}

interface CommandResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
  error?: string;
}

const SYSTEMD_UNIT_NAME = "grind-gateway.service";
const LAUNCHD_LABEL = "com.grind.gateway";
const WINDOWS_TASK_NAME = "Grind Gateway";

export async function getGatewayServiceStatus(): Promise<GatewayServiceStatus> {
  switch (process.platform) {
    case "darwin":
      return getLaunchdStatus();
    case "linux":
      return getSystemdStatus();
    case "win32":
      return getWindowsTaskStatus();
    default:
      return {
        manager: "none",
        supported: false,
        available: false,
        installed: false,
        enabled: false,
        running: false,
        detail: `Unsupported platform: ${process.platform}`,
      };
  }
}

export async function ensureGatewayServiceRunning(): Promise<GatewayServiceStatus> {
  const launchSpec = resolveGatewayLaunchSpec();
  switch (process.platform) {
    case "darwin":
      await installLaunchdAgent(launchSpec);
      await enableLaunchdAgent();
      await startLaunchdAgent();
      return getLaunchdStatus();
    case "linux":
      await installSystemdService(launchSpec);
      await runSystemdCommand(["enable", "--now", SYSTEMD_UNIT_NAME]);
      return getSystemdStatus();
    case "win32":
      await installWindowsTask(launchSpec);
      await runWindowsTaskCommand(["/Change", "/TN", WINDOWS_TASK_NAME, "/ENABLE"]);
      await runWindowsTaskCommand(["/Run", "/TN", WINDOWS_TASK_NAME]);
      return getWindowsTaskStatus();
    default:
      return {
        manager: "none",
        supported: false,
        available: false,
        installed: false,
        enabled: false,
        running: false,
      };
  }
}

export async function startGatewayServiceIfInstalled(): Promise<boolean> {
  switch (process.platform) {
    case "darwin": {
      const status = await getLaunchdStatus();
      if (!status.installed || !status.available) return false;
      await startLaunchdAgent();
      return true;
    }
    case "linux": {
      const status = await getSystemdStatus();
      if (!status.installed || !status.available) return false;
      await runSystemdCommand(["start", SYSTEMD_UNIT_NAME]);
      return true;
    }
    case "win32": {
      const status = await getWindowsTaskStatus();
      if (!status.installed || !status.available) return false;
      await runWindowsTaskCommand(["/Run", "/TN", WINDOWS_TASK_NAME]);
      return true;
    }
    default:
      return false;
  }
}

export async function stopGatewayServiceIfInstalled(): Promise<boolean> {
  switch (process.platform) {
    case "darwin": {
      const status = await getLaunchdStatus();
      if (!status.installed || !status.available) return false;
      await stopLaunchdAgent();
      return true;
    }
    case "linux": {
      const status = await getSystemdStatus();
      if (!status.installed || !status.available) return false;
      await runSystemdCommand(["stop", SYSTEMD_UNIT_NAME]);
      return true;
    }
    case "win32": {
      const status = await getWindowsTaskStatus();
      if (!status.installed || !status.available) return false;
      await runWindowsTaskCommand(["/End", "/TN", WINDOWS_TASK_NAME], {
        ignoreError: true,
      });
      return true;
    }
    default:
      return false;
  }
}

export async function disableGatewayService(): Promise<boolean> {
  switch (process.platform) {
    case "darwin": {
      const status = await getLaunchdStatus();
      if (!status.installed || !status.available) return false;
      await disableLaunchdAgent();
      await stopLaunchdAgent();
      return true;
    }
    case "linux": {
      const status = await getSystemdStatus();
      if (!status.installed || !status.available) return false;
      await runSystemdCommand(["disable", "--now", SYSTEMD_UNIT_NAME]);
      return true;
    }
    case "win32": {
      const status = await getWindowsTaskStatus();
      if (!status.installed || !status.available) return false;
      await runWindowsTaskCommand(["/Change", "/TN", WINDOWS_TASK_NAME, "/DISABLE"]);
      await runWindowsTaskCommand(["/End", "/TN", WINDOWS_TASK_NAME], {
        ignoreError: true,
      });
      return true;
    }
    default:
      return false;
  }
}

function resolveGatewayLaunchSpec(): GatewayLaunchSpec {
  const entrypoint = process.argv[1];
  if (!entrypoint) {
    throw new Error("Unable to resolve CLI entrypoint for gateway service.");
  }

  return {
    executable: process.execPath,
    entrypoint: resolve(entrypoint),
    args: ["gateway", "serve"],
  };
}

async function getSystemdStatus(): Promise<GatewayServiceStatus> {
  const unitPath = getSystemdUnitPath();
  const installed = existsSync(unitPath);

  const managerCheck = await runCommand(["systemctl", "--user", "--version"]);
  if (!managerCheck.ok) {
    return {
      manager: "systemd-user",
      supported: true,
      available: false,
      installed,
      enabled: false,
      running: false,
      ...(managerCheck.error ? { detail: managerCheck.error } : {}),
    };
  }

  const enabledCheck = await runSystemdCommand(["is-enabled", SYSTEMD_UNIT_NAME], {
    ignoreError: true,
  });
  const activeCheck = await runSystemdCommand(["is-active", SYSTEMD_UNIT_NAME], {
    ignoreError: true,
  });

  const busError = firstNonEmpty([enabledCheck.stderr, activeCheck.stderr]).includes(
    "Failed to connect to bus",
  );

  const enabled = enabledCheck.ok && enabledCheck.stdout.trim() === "enabled";
  const running = activeCheck.ok && activeCheck.stdout.trim() === "active";

  return {
    manager: "systemd-user",
    supported: true,
    available: !busError,
    installed,
    enabled,
    running,
    ...(busError ? { detail: firstNonEmpty([enabledCheck.stderr, activeCheck.stderr]) } : {}),
  };
}

async function installSystemdService(launchSpec: GatewayLaunchSpec): Promise<void> {
  const unitPath = getSystemdUnitPath();
  mkdirSync(getSystemdUnitDir(), { recursive: true });
  writeFileSync(unitPath, buildSystemdUnit(launchSpec));
  await runSystemdCommand(["daemon-reload"]);
}

function buildSystemdUnit(launchSpec: GatewayLaunchSpec): string {
  const exec = [launchSpec.executable, launchSpec.entrypoint, ...launchSpec.args]
    .map(systemdQuote)
    .join(" ");

  return [
    "[Unit]",
    "Description=GRIND Gateway",
    "After=network.target",
    "",
    "[Service]",
    "Type=exec",
    `ExecStart=${exec}`,

    "Restart=always",
    "RestartSec=5",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

async function runSystemdCommand(
  args: string[],
  options?: { ignoreError?: boolean },
): Promise<CommandResult> {
  return runCommand(["systemctl", "--user", ...args], options);
}

function getSystemdUnitDir(): string {
  return join(homedir(), ".config", "systemd", "user");
}

function getSystemdUnitPath(): string {
  return join(getSystemdUnitDir(), SYSTEMD_UNIT_NAME);
}

async function getLaunchdStatus(): Promise<GatewayServiceStatus> {
  const plistPath = getLaunchdPlistPath();
  const installed = existsSync(plistPath);
  const domain = launchdDomain();
  if (!domain) {
    return {
      manager: "launchd",
      supported: true,
      available: false,
      installed,
      enabled: false,
      running: false,
      detail: "Unable to resolve current user id for launchd domain.",
    };
  }

  const printResult = await runCommand(["launchctl", "print", launchdJob(domain)], {
    ignoreError: true,
  });
  const disabledResult = await runCommand(["launchctl", "print-disabled", domain], {
    ignoreError: true,
  });

  const available = !Boolean(printResult.error || disabledResult.error);
  const running = printResult.ok && /(state = running|pid = \d+)/.test(printResult.stdout);

  const isDisabled = disabledResult.ok ? parseLaunchdDisabled(disabledResult.stdout) : false;
  const enabled = installed && !isDisabled;

  return {
    manager: "launchd",
    supported: true,
    available,
    installed,
    enabled,
    running,
    ...(!available
      ? {
          detail: firstNonEmpty([printResult.error, disabledResult.error]),
        }
      : {}),
  };
}

async function installLaunchdAgent(launchSpec: GatewayLaunchSpec): Promise<void> {
  const plistPath = getLaunchdPlistPath();
  mkdirSync(getLaunchdDir(), { recursive: true });
  writeFileSync(plistPath, buildLaunchdPlist(launchSpec));
}

async function enableLaunchdAgent(): Promise<void> {
  const domain = launchdDomain();
  if (!domain) throw new Error("Unable to resolve launchd domain.");
  const service = launchdJob(domain);
  await runCommand(["launchctl", "enable", service], { ignoreError: true });
}

async function disableLaunchdAgent(): Promise<void> {
  const domain = launchdDomain();
  if (!domain) throw new Error("Unable to resolve launchd domain.");
  await runCommand(["launchctl", "disable", launchdJob(domain)], {
    ignoreError: true,
  });
}

async function startLaunchdAgent(): Promise<void> {
  const domain = launchdDomain();
  if (!domain) throw new Error("Unable to resolve launchd domain.");
  const plistPath = getLaunchdPlistPath();
  const service = launchdJob(domain);

  const bootstrap = await runCommand(["launchctl", "bootstrap", domain, plistPath], {
    ignoreError: true,
  });

  if (!bootstrap.ok && !isLaunchdAlreadyLoadedError(bootstrap.stderr)) {
    throw new Error(
      firstNonEmpty([bootstrap.stderr, bootstrap.error, "Failed to bootstrap launchd agent."]),
    );
  }

  const kickstart = await runCommand(["launchctl", "kickstart", "-k", service]);
  if (!kickstart.ok) {
    throw new Error(
      firstNonEmpty([kickstart.stderr, kickstart.error, "Failed to start launchd agent."]),
    );
  }
}

async function stopLaunchdAgent(): Promise<void> {
  const domain = launchdDomain();
  if (!domain) throw new Error("Unable to resolve launchd domain.");
  const service = launchdJob(domain);

  await runCommand(["launchctl", "kill", "SIGTERM", service], {
    ignoreError: true,
  });

  await runCommand(["launchctl", "bootout", service], {
    ignoreError: true,
  });
}

function buildLaunchdPlist(launchSpec: GatewayLaunchSpec): string {
  const grindHome = xmlEscape(getGrindHome());
  const argumentsXml = [launchSpec.executable, launchSpec.entrypoint, ...launchSpec.args]
    .map((value) => `    <string>${xmlEscape(value)}</string>`)
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  <string>${LAUNCHD_LABEL}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    argumentsXml,
    "  </array>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <true/>",
    "  <key>EnvironmentVariables</key>",
    "  <dict>",
    "  </dict>",
    "  <key>StandardOutPath</key>",
    `  <string>${grindHome}/gateway.log</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${grindHome}/gateway.log</string>`,
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

function getLaunchdDir(): string {
  return join(homedir(), "Library", "LaunchAgents");
}

function getLaunchdPlistPath(): string {
  return join(getLaunchdDir(), `${LAUNCHD_LABEL}.plist`);
}

function launchdDomain(): string | null {
  if (typeof process.getuid !== "function") return null;
  return `gui/${process.getuid()}`;
}

function launchdJob(domain: string): string {
  return `${domain}/${LAUNCHD_LABEL}`;
}

function parseLaunchdDisabled(raw: string): boolean {
  const pattern = new RegExp(`\\"${escapeRegExp(LAUNCHD_LABEL)}\\"\\s*=>\\s*(true|false)`);
  const match = raw.match(pattern);
  if (!match) return false;
  return match[1] === "true";
}

function isLaunchdAlreadyLoadedError(stderr: string): boolean {
  return stderr.includes("Service is already loaded") || stderr.includes("already bootstrapped");
}

async function getWindowsTaskStatus(): Promise<GatewayServiceStatus> {
  const query = await runWindowsTaskCommand(
    ["/Query", "/TN", WINDOWS_TASK_NAME, "/FO", "LIST", "/V"],
    {
      ignoreError: true,
    },
  );

  if (!query.ok) {
    const missingTask = query.stderr.includes("ERROR: The system cannot find the file specified.");
    if (missingTask) {
      return {
        manager: "schtasks",
        supported: true,
        available: true,
        installed: false,
        enabled: false,
        running: false,
      };
    }

    return {
      manager: "schtasks",
      supported: true,
      available: false,
      installed: false,
      enabled: false,
      running: false,
      detail: firstNonEmpty([query.stderr, query.error]),
    };
  }

  const state = readListField(query.stdout, "Scheduled Task State");
  const status = readListField(query.stdout, "Status");

  const enabled = state ? state.toLowerCase() !== "disabled" : true;
  const running = status ? status.toLowerCase() === "running" : false;

  return {
    manager: "schtasks",
    supported: true,
    available: true,
    installed: true,
    enabled,
    running,
  };
}

async function installWindowsTask(launchSpec: GatewayLaunchSpec): Promise<void> {
  const taskRun = toWindowsTaskRun([
    launchSpec.executable,
    launchSpec.entrypoint,
    ...launchSpec.args,
  ]);
  await runWindowsTaskCommand([
    "/Create",
    "/TN",
    WINDOWS_TASK_NAME,
    "/SC",
    "ONLOGON",
    "/TR",
    taskRun,
    "/F",
  ]);
}

async function runWindowsTaskCommand(
  args: string[],
  options?: { ignoreError?: boolean },
): Promise<CommandResult> {
  return runCommand(["schtasks", ...args], options);
}

function toWindowsTaskRun(parts: string[]): string {
  return parts.map((part) => `"${part.replaceAll('"', '""')}"`).join(" ");
}

function systemdQuote(value: string): string {
  const escaped = value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `"${escaped}"`;
}

async function runCommand(
  command: string[],
  options?: { ignoreError?: boolean },
): Promise<CommandResult> {
  try {
    const proc = Bun.spawn(command, {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([
      proc.exited,
      proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(""),
      proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(""),
    ]);

    const ok = code === 0;
    if (!ok && !options?.ignoreError) {
      throw new Error(
        firstNonEmpty([stderr.trim(), stdout.trim(), `Command failed: ${command.join(" ")}`]),
      );
    }

    return { ok, code, stdout, stderr };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!options?.ignoreError) {
      throw error;
    }
    return {
      ok: false,
      code: 1,
      stdout: "",
      stderr: "",
      error: message,
    };
  }
}

function firstNonEmpty(values: Array<string | undefined | null>): string {
  for (const value of values) {
    if (value && value.trim().length > 0) return value.trim();
  }
  return "";
}

function readListField(raw: string, key: string): string | null {
  const pattern = new RegExp(`^${escapeRegExp(key)}:\\s*(.+)$`, "im");
  const match = raw.match(pattern);
  const value = match?.[1];
  return value ? value.trim() : null;
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function removeGatewayServiceArtifacts(): void {
  if (process.platform === "linux") {
    const unitPath = getSystemdUnitPath();
    if (existsSync(unitPath)) {
      unlinkSync(unitPath);
    }
    return;
  }

  if (process.platform === "darwin") {
    const plistPath = getLaunchdPlistPath();
    if (existsSync(plistPath)) {
      unlinkSync(plistPath);
    }
  }
}
