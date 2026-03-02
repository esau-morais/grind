import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import * as p from "@clack/prompts";
import { spinner } from "../spinner";
import { getGrindHome } from "@grindxp/core";

import { disableManagedGatewayAutostart, stopManagedGateway } from "../gateway/service";
import { stopManagedWeb } from "../web/service";

type UninstallScope = "gateway" | "web" | "vault";

export interface UninstallOptions {
  all?: boolean;
  gateway?: boolean;
  web?: boolean;
  vault?: boolean;
  yes?: boolean;
  dryRun?: boolean;
}

function stripInstallerPathEntries(): void {
  const home = homedir();
  const rcFiles = [join(home, ".zshrc"), join(home, ".bashrc"), join(home, ".profile")];
  const zdotdir = process.env.ZDOTDIR;
  if (zdotdir && zdotdir !== home) {
    rcFiles.push(join(zdotdir, ".zshrc"));
  }

  for (const rcFile of rcFiles) {
    if (!existsSync(rcFile)) continue;
    const original = readFileSync(rcFile, "utf8");
    const lines = original.split("\n");
    const kept: string[] = [];
    let i = 0;
    while (i < lines.length) {
      if (
        lines[i] === "# Added by Grind installer" &&
        (lines[i + 1] ?? "").includes(".grind/bin")
      ) {
        // skip the comment line and the export PATH line
        i += 2;
        // also drop the blank line that preceded it if we added one
        if (kept.length > 0 && kept[kept.length - 1] === "") {
          kept.pop();
        }
      } else {
        kept.push(lines[i]!);
        i++;
      }
    }
    const stripped = kept.join("\n");
    if (stripped !== original) {
      writeFileSync(rcFile, stripped, "utf8");
      p.log.info(`Removed installer PATH entry from ${rcFile}`);
    }
  }
}

function buildScopes(opts: UninstallOptions): Set<UninstallScope> {
  const scopes = new Set<UninstallScope>();
  if (opts.all || opts.gateway) scopes.add("gateway");
  if (opts.all || opts.web) scopes.add("web");
  if (opts.all || opts.vault) scopes.add("vault");
  return scopes;
}

export async function uninstallCommand(opts: UninstallOptions): Promise<void> {
  p.intro("grindxp uninstall");

  const hadExplicit = Boolean(opts.all || opts.gateway || opts.web || opts.vault);
  const scopes = buildScopes(opts);

  if (!hadExplicit) {
    const selection = await p.multiselect<UninstallScope>({
      message: "Uninstall which components?",
      options: [
        { value: "gateway", label: "Gateway service", hint: "stop process + remove autostart" },
        { value: "web", label: "Web app process", hint: "stop background web daemon" },
        { value: "vault", label: "Vault + config", hint: `${getGrindHome()} — irreversible` },
      ],
      initialValues: ["gateway", "web"],
    });

    if (p.isCancel(selection)) {
      p.cancel("Uninstall cancelled.");
      process.exit(0);
    }

    for (const value of selection) {
      scopes.add(value);
    }
  }

  if (scopes.size === 0) {
    p.outro("Nothing selected.");
    return;
  }

  if (!opts.yes) {
    const ok = await p.confirm({ message: "Proceed with uninstall?" });
    if (p.isCancel(ok) || !ok) {
      p.cancel("Uninstall cancelled.");
      process.exit(0);
    }
  }

  const dryRun = Boolean(opts.dryRun);

  if (scopes.has("gateway")) {
    if (dryRun) {
      p.log.info("[dry-run] stop gateway process and remove autostart service");
    } else {
      const s = spinner();
      s.start("Stopping gateway…");
      try {
        await stopManagedGateway();
        await disableManagedGatewayAutostart();
        s.stop("Gateway stopped and autostart removed.");
      } catch (err) {
        s.error("Gateway stop failed (may not have been running).");
        p.log.warn(String(err));
      }
    }
  }

  if (scopes.has("web")) {
    if (dryRun) {
      p.log.info("[dry-run] stop web app process");
    } else {
      const s = spinner();
      s.start("Stopping web app…");
      try {
        await stopManagedWeb();
        s.stop("Web app stopped.");
      } catch (err) {
        s.error("Web app stop failed (may not have been running).");
        p.log.warn(String(err));
      }
    }
  }

  const grindInstallDir = process.env.GRIND_INSTALL_DIR ?? join(homedir(), ".grind", "bin");

  if (scopes.has("vault")) {
    const grindHome = getGrindHome();
    if (dryRun) {
      p.log.info(`[dry-run] remove ${grindHome}`);
      p.log.info("[dry-run] strip installer PATH entries from shell rc files");
    } else {
      const s = spinner();
      s.start(`Removing ${grindHome}…`);
      try {
        rmSync(grindHome, { recursive: true, force: true });
        s.stop(`${grindHome} removed.`);
      } catch (err) {
        s.error(`Failed to remove ${grindHome}.`);
        p.log.error(String(err));
      }
      stripInstallerPathEntries();
    }
  }

  const outroLines = [dryRun ? "Dry run complete — no changes made." : "Done."];
  if (scopes.has("vault")) {
    outroLines.push("CLI binary and PATH entries removed.");
  } else {
    outroLines.push(
      "The CLI binary is still installed. To remove it:",
      `  Installer script:  rm -rf ${grindInstallDir}`,
      "  npm:               npm remove -g grindxp",
      "  bun:               bun remove -g grindxp",
    );
  }
  p.outro(outroLines.join("\n"));
}
