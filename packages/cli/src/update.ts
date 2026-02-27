import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import * as p from "@clack/prompts";
import { $ } from "bun";
import { getGrindHome, readGrindConfig } from "@grindxp/core";

import {
  INSTALL_SCRIPT_URL,
  NPM_PACKAGE,
  type InstallMethod,
  detectInstallDiagnostics,
} from "./install-diagnostics";

declare const GRINDXP_VERSION: string;

export const VERSION = typeof GRINDXP_VERSION === "string" ? GRINDXP_VERSION : "local";

const CLI_STATE_FILE = "cli-state.json";
const INSTALL_CONFLICT_WARN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

interface CliState {
  installConflictSignature?: string;
  installConflictWarnedAt?: number;
}

function getCliStatePath(): string {
  return join(getGrindHome(), CLI_STATE_FILE);
}

function readCliState(): CliState {
  try {
    const raw = readFileSync(getCliStatePath(), "utf8");
    const parsed = JSON.parse(raw) as {
      installConflictSignature?: unknown;
      installConflictWarnedAt?: unknown;
    };

    const state: CliState = {};
    if (typeof parsed.installConflictSignature === "string") {
      state.installConflictSignature = parsed.installConflictSignature;
    }
    if (
      typeof parsed.installConflictWarnedAt === "number" &&
      Number.isFinite(parsed.installConflictWarnedAt)
    ) {
      state.installConflictWarnedAt = parsed.installConflictWarnedAt;
    }

    return state;
  } catch {
    return {};
  }
}

function writeCliState(state: CliState): void {
  try {
    mkdirSync(getGrindHome(), { recursive: true, mode: 0o700 });
    writeFileSync(getCliStatePath(), JSON.stringify(state, null, 2));
  } catch {
    // ignore state-write failures
  }
}

function shouldWarnInstallConflict(signature: string): boolean {
  const state = readCliState();
  if (state.installConflictSignature !== signature) return true;
  if (!state.installConflictWarnedAt) return true;
  return Date.now() - state.installConflictWarnedAt >= INSTALL_CONFLICT_WARN_INTERVAL_MS;
}

function markInstallConflictWarning(signature: string): void {
  const state = readCliState();
  writeCliState({
    ...state,
    installConflictSignature: signature,
    installConflictWarnedAt: Date.now(),
  });
}

function getManualUpgradeCommand(method: InstallMethod, version: string): string {
  const pkg = `${NPM_PACKAGE}@${version}`;

  switch (method) {
    case "curl":
      return `GRIND_VERSION=${version} curl -fsSL ${INSTALL_SCRIPT_URL} | bash -s -- --no-init`;
    case "pnpm":
      return `pnpm install -g ${pkg}`;
    case "bun":
      return `bun install -g ${pkg}`;
    case "yarn":
      return `yarn global add ${pkg}`;
    case "npm":
    case "unknown":
    default:
      return `npm install -g ${pkg}`;
  }
}

async function fetchLatestVersion(): Promise<string> {
  const res = await fetch(`https://registry.npmjs.org/${NPM_PACKAGE}/latest`);
  if (!res.ok) throw new Error(res.statusText);
  const data = (await res.json()) as { version: string };
  return data.version;
}

async function runCommand(command: ReturnType<typeof $>): Promise<void> {
  const result = await command.quiet().throws(false);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString("utf8"));
  }
}

async function runUpgrade(method: InstallMethod, version: string): Promise<void> {
  const pkg = `${NPM_PACKAGE}@${version}`;

  switch (method) {
    case "curl":
      await runCommand(
        $`curl -fsSL ${INSTALL_SCRIPT_URL} | bash -s -- --no-init`.env({
          ...process.env,
          GRIND_VERSION: version,
        }),
      );
      return;
    case "npm":
      await runCommand($`npm install -g ${pkg}`);
      return;
    case "pnpm":
      await runCommand($`pnpm install -g ${pkg}`);
      return;
    case "bun":
      await runCommand($`bun install -g ${pkg}`);
      return;
    case "yarn":
      await runCommand($`yarn global add ${pkg}`);
      return;
    default:
      return;
  }
}

export async function checkAndUpdate(): Promise<void> {
  if (VERSION === "local") return;
  if (process.env.GRINDXP_DISABLE_AUTOUPDATE === "1") return;

  const config = (() => {
    try {
      return readGrindConfig();
    } catch {
      return null;
    }
  })();

  if (config?.autoupdate === false) return;

  let latest: string;
  try {
    latest = await fetchLatestVersion();
  } catch {
    return;
  }

  if (latest === VERSION) return;

  const diagnostics = await detectInstallDiagnostics();

  if (diagnostics.hasMultipleInstallations) {
    const signature = `${diagnostics.detectedMethods.join(",")}|${diagnostics.commandPaths.join("|")}`;
    if (shouldWarnInstallConflict(signature)) {
      p.log.warn(
        `Multiple grind CLI installs detected (${diagnostics.methodsSummary}). Auto-update is paused. Run \`grindxp doctor install\` to resolve it.`,
      );
      markInstallConflictWarning(signature);
    }

    if (config?.autoupdate === "notify") {
      p.log.info(
        `grindxp v${latest} is available — run \`grindxp doctor install\` before updating to avoid conflicts.`,
      );
    }
    return;
  }

  const method = diagnostics.activeMethod;
  const cmd = getManualUpgradeCommand(method, latest);

  if (config?.autoupdate === "notify") {
    p.log.info(`grindxp v${latest} is available — run \`${cmd}\` to update`);
    return;
  }

  if (method === "unknown") {
    p.log.info(`grindxp v${latest} is available — run \`${cmd}\` to update`);
    return;
  }

  try {
    await runUpgrade(method, latest);
    p.log.success(`Updated grindxp to v${latest}`);
  } catch {
    // silent — don't interrupt the user's command
  }
}
