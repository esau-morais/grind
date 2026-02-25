import { rmSync } from "node:fs";

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

  if (scopes.has("vault")) {
    const grindHome = getGrindHome();
    if (dryRun) {
      p.log.info(`[dry-run] remove ${grindHome}`);
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
    }
  }

  p.outro(
    [
      dryRun ? "Dry run complete — no changes made." : "Done.",
      "The CLI binary is still installed. To remove it:",
      "  Installer script:  rm -rf ~/.grind/bin/",
      "  Bun global:        bun remove -g grind-cli",
      "  From source:       remove your shell alias",
    ].join("\n"),
  );
}
