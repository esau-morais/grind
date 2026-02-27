import { homedir } from "node:os";

import * as p from "@clack/prompts";

import { NPM_PACKAGE, type InstallMethod, detectInstallDiagnostics } from "../install-diagnostics";
import { VERSION } from "../update";

function shortPath(value: string): string {
  const home = homedir();
  if (value.startsWith(home)) {
    return `~${value.slice(home.length)}`;
  }
  return value;
}

function getCleanupCommands(methods: InstallMethod[]): string[] {
  const commands: string[] = [];

  if (methods.includes("curl")) {
    commands.push("rm -f ~/.grind/bin/grind");
  }
  if (methods.includes("npm")) {
    commands.push(`npm uninstall -g ${NPM_PACKAGE}`);
  }
  if (methods.includes("pnpm")) {
    commands.push(`pnpm remove -g ${NPM_PACKAGE}`);
  }
  if (methods.includes("bun")) {
    commands.push(`bun remove -g ${NPM_PACKAGE}`);
  }
  if (methods.includes("yarn")) {
    commands.push(`yarn global remove ${NPM_PACKAGE}`);
  }

  return commands;
}

export async function doctorCommand(section: string): Promise<void> {
  const target = section.length > 0 ? section : "install";
  if (target !== "install") {
    p.log.error(`Unknown doctor target: ${target}`);
    p.log.info("Use: grindxp doctor [install]");
    return;
  }

  p.intro("grindxp doctor");

  const diagnostics = await detectInstallDiagnostics();

  p.log.step("Install");
  p.log.message(`Version: v${VERSION}`);
  p.log.message(`Runtime: ${shortPath(diagnostics.activeExecutablePath)}`);
  p.log.message(`Detected methods: ${diagnostics.methodsSummary}`);

  if (diagnostics.commandPaths.length > 0) {
    const paths = diagnostics.commandPaths.map((path) => shortPath(path)).join(" | ");
    p.log.message(`CLI paths on PATH: ${paths}`);
  }

  if (diagnostics.hasMultipleInstallations) {
    p.log.warn(
      "Multiple installations detected. Keep one install source to avoid update confusion.",
    );

    const cleanupCommands = getCleanupCommands(diagnostics.detectedMethods);
    if (cleanupCommands.length > 0) {
      p.note(cleanupCommands.map((cmd) => `- ${cmd}`).join("\n"), "Cleanup commands");
    }
  } else {
    p.log.success("No conflicting installations detected.");
  }

  p.log.step("PATH");
  if (diagnostics.activeDirectoryOnPath) {
    p.log.success(
      `Active bin directory is on PATH: ${shortPath(diagnostics.preferredBinDirectory)}`,
    );
  } else {
    p.log.warn(
      `Active bin directory is not on PATH: ${shortPath(diagnostics.preferredBinDirectory)}`,
    );
  }

  if (process.platform !== "win32" && diagnostics.detectedMethods.includes("curl")) {
    const persistedProfiles = diagnostics.shellProfiles.filter((profile) => profile.hasPathEntry);

    if (persistedProfiles.length > 0) {
      const profileList = persistedProfiles.map((profile) => shortPath(profile.path)).join(", ");
      p.log.success(`PATH is persisted in: ${profileList}`);
    } else {
      p.log.warn("No persistent PATH entry found in ~/.zshrc, ~/.bashrc, or ~/.profile.");
      p.log.info(
        `Add this line to your shell profile: export PATH=\"${diagnostics.preferredBinDirectory}:$PATH\"`,
      );
    }
  }

  if (process.platform === "win32") {
    p.log.info("Open a new terminal after install to refresh PATH changes.");
  }

  p.outro("Doctor complete.");
}
