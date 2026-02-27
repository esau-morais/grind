import { existsSync, readFileSync, statSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { $ } from "bun";

export const NPM_PACKAGE = "@grindxp/cli";
export const LEGACY_NPM_PACKAGE = "grindxp";
export const INSTALL_SCRIPT_URL = "https://grindxp.app/install.sh";

export type InstallMethod = "curl" | "npm" | "pnpm" | "bun" | "yarn" | "unknown";

export interface ShellProfileCheck {
  path: string;
  exists: boolean;
  hasPathEntry: boolean;
}

export interface InstallDiagnostics {
  activeMethod: InstallMethod;
  detectedMethods: Array<Exclude<InstallMethod, "unknown">>;
  hasMultipleInstallations: boolean;
  methodsSummary: string;
  commandPaths: string[];
  activeExecutablePath: string;
  preferredBinDirectory: string;
  activeDirectoryOnPath: boolean;
  shellProfiles: ShellProfileCheck[];
}

const METHOD_PRIORITY: Array<Exclude<InstallMethod, "unknown">> = [
  "curl",
  "npm",
  "pnpm",
  "bun",
  "yarn",
];

function normalizePath(value: string): string {
  return resolve(value);
}

function normalizePathForCompare(value: string): string {
  const normalized = normalizePath(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function toRealPath(value: string): string {
  try {
    return realpathSync(value);
  } catch {
    return normalizePath(value);
  }
}

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths) {
    const normalized = normalizePathForCompare(path);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(path);
  }
  return out;
}

function splitPathEnv(pathEnv: string | undefined): string[] {
  if (!pathEnv) return [];
  const separator = process.platform === "win32" ? ";" : ":";
  return pathEnv
    .split(separator)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function isPathInEnv(targetDir: string): boolean {
  const target = normalizePathForCompare(targetDir);
  return splitPathEnv(process.env.PATH).some((entry) => normalizePathForCompare(entry) === target);
}

export function isCurlPath(execPath: string): boolean {
  const normalized = execPath.replaceAll("\\", "/").toLowerCase();
  return normalized.includes("/.grind/bin/");
}

async function listCommandPaths(command: string): Promise<string[]> {
  const entries = splitPathEnv(process.env.PATH);
  const candidates: string[] = [];

  const windowsExtensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
          .split(";")
          .map((ext) => ext.trim())
          .filter((ext) => ext.length > 0)
      : [];

  for (const entry of entries) {
    if (!existsSync(entry)) continue;

    const names =
      process.platform === "win32"
        ? command.includes(".")
          ? [command]
          : [command, ...windowsExtensions.map((ext) => `${command}${ext.toLowerCase()}`)]
        : [command];

    for (const name of names) {
      const candidate = join(entry, name);
      if (!existsSync(candidate)) continue;

      try {
        const stat = statSync(candidate);
        if (!stat.isFile()) continue;
      } catch {
        continue;
      }

      candidates.push(normalizePath(candidate));
    }
  }

  return dedupePaths(candidates.map((path) => toRealPath(path)));
}

async function detectPackageManagerInstalls(): Promise<Array<Exclude<InstallMethod, "curl" | "unknown">>> {
  const checks: Array<{ name: Exclude<InstallMethod, "curl" | "unknown">; cmd: () => Promise<string> }> = [
    { name: "npm", cmd: () => $`npm list -g --depth=0`.throws(false).quiet().text() },
    { name: "pnpm", cmd: () => $`pnpm list -g --depth=0`.throws(false).quiet().text() },
    { name: "bun", cmd: () => $`bun pm ls -g`.throws(false).quiet().text() },
    { name: "yarn", cmd: () => $`yarn global list`.throws(false).quiet().text() },
  ];

  const results = await Promise.all(
    checks.map(async (check) => ({
      name: check.name,
      output: await check.cmd().catch(() => ""),
    })),
  );

  return results
    .filter(
      (result) =>
        result.output.includes(NPM_PACKAGE) || result.output.includes(`${LEGACY_NPM_PACKAGE}@`),
    )
    .map((result) => result.name);
}

function detectActiveMethod(
  execPath: string,
  detected: Set<Exclude<InstallMethod, "unknown">>,
): InstallMethod {
  if (process.platform !== "win32" && isCurlPath(execPath)) {
    return "curl";
  }

  const loweredExec = execPath.toLowerCase();
  if (loweredExec.includes("pnpm") && detected.has("pnpm")) return "pnpm";
  if (loweredExec.includes("yarn") && detected.has("yarn")) return "yarn";
  if (loweredExec.includes("bun") && detected.has("bun")) return "bun";
  if (loweredExec.includes("npm") && detected.has("npm")) return "npm";

  if (detected.size === 1) {
    const first = detected.values().next().value;
    if (first) return first;
  }

  return "unknown";
}

function readShellProfileChecks(preferredBinDirectory: string): ShellProfileCheck[] {
  if (process.platform === "win32") return [];

  const home = homedir();
  const profiles = [join(home, ".zshrc"), join(home, ".bashrc"), join(home, ".profile")];
  const normalizedDir = preferredBinDirectory.replaceAll("\\", "/");

  return profiles.map((profilePath) => {
    if (!existsSync(profilePath)) {
      return {
        path: profilePath,
        exists: false,
        hasPathEntry: false,
      };
    }

    const content = readFileSync(profilePath, "utf8");
    const hasPathEntry = content.includes(normalizedDir) || content.includes(".grind/bin");

    return {
      path: profilePath,
      exists: true,
      hasPathEntry,
    };
  });
}

function summarizeMethods(methods: Array<Exclude<InstallMethod, "unknown">>): string {
  if (methods.length === 0) return "unknown";
  return methods.join(", ");
}

export async function detectInstallDiagnostics(): Promise<InstallDiagnostics> {
  const execPath = toRealPath(process.execPath);
  const [grindPaths, grindxpPaths, managerMethods] = await Promise.all([
    listCommandPaths("grind"),
    listCommandPaths("grindxp"),
    detectPackageManagerInstalls(),
  ]);

  const commandPaths = dedupePaths([...grindPaths, ...grindxpPaths]);

  const methods = new Set<Exclude<InstallMethod, "unknown">>(managerMethods);

  const curlCommandPath = commandPaths.find((path) => isCurlPath(path));
  const hasCurl = (process.platform !== "win32" && isCurlPath(execPath)) || Boolean(curlCommandPath);
  if (hasCurl) methods.add("curl");

  const orderedMethods = METHOD_PRIORITY.filter((method) => methods.has(method));
  const activeMethod = detectActiveMethod(execPath, methods);

  const primaryCommandPath = commandPaths[0];
  const preferredBinDirectory =
    activeMethod === "curl"
      ? dirname(curlCommandPath ?? execPath)
      : (primaryCommandPath ? dirname(primaryCommandPath) : dirname(execPath));

  const activeDirectoryOnPath = isPathInEnv(preferredBinDirectory);
  const shellProfiles = readShellProfileChecks(preferredBinDirectory);

  const hasMultipleInstallations = orderedMethods.length > 1 || commandPaths.length > 1;

  return {
    activeMethod,
    detectedMethods: orderedMethods,
    hasMultipleInstallations,
    methodsSummary: summarizeMethods(orderedMethods),
    commandPaths,
    activeExecutablePath: execPath,
    preferredBinDirectory,
    activeDirectoryOnPath,
    shellProfiles,
  };
}
