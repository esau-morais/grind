import * as p from "@clack/prompts";
import { isInitialized } from "@grindxp/core";

import { showBanner } from "./brand";
import { checkAndUpdate, VERSION } from "./update";
import {
  companionContextCommand,
  companionMemoryAddCommand,
  companionMemoryDeleteCommand,
  companionMemoryEditCommand,
  companionMemoryListCommand,
  companionShowCommand,
  companionSoulCommand,
  companionTrustCommand,
} from "./commands/companion";
import { completeCommand } from "./commands/complete";
import { dashboardCommand } from "./commands/dashboard";
import { doctorCommand } from "./commands/doctor";
import {
  gatewayDisableCommand,
  gatewayEnableCommand,
  gatewayRestartCommand,
  gatewayServeCommand,
  gatewayStartCommand,
  gatewayStatusCommand,
  gatewayStopCommand,
} from "./commands/gateway";
import {
  integrationsConnectCommand,
  integrationsDisconnectCommand,
  integrationsListCommand,
  integrationsSetupCommand,
} from "./commands/integrations";
import {
  forgeCreateCommand,
  forgeDaemonCommand,
  forgeListCommand,
  forgeRunCommand,
  forgeTickCommand,
  forgeToggleCommand,
} from "./commands/forge";
import { initCommand } from "./commands/init";
import { logCommand } from "./commands/log";
import { questAbandonCommand, questCreateCommand, questListCommand } from "./commands/quest";
import { setupCommand } from "./commands/setup";
import { startCommand } from "./commands/start";
import { statusCommand } from "./commands/status";
import { stopCommand } from "./commands/stop";
import { uninstallCommand } from "./commands/uninstall";
import { webStartCommand, webStopCommand, webStatusCommand, webServeCommand } from "./commands/web";
import { showCommandHelp } from "./commands/help";
import { closeContext, loadContext } from "./context";

const argv = process.argv.slice(2);
const command = argv[0];
const sub = argv[1] ?? "";
const rest = argv.slice(2);

async function main(): Promise<void> {
  const hasHelp = argv.includes("--help") || argv.includes("-h");

  if (argv.includes("--version") || argv.includes("-v")) {
    p.intro(`grindxp v${VERSION}`);
    return;
  }

  if (
    command === "help" ||
    command === "--help" ||
    command === "-h" ||
    (hasHelp && command === undefined)
  ) {
    showHelp();
    return;
  }

  void checkAndUpdate().catch(() => {});

  if (hasHelp && command !== undefined) {
    showCommandHelp(command, sub);
    return;
  }

  if (command === "init") {
    await initCommand();
    return;
  }

  if (command === "setup") {
    await setupCommand();
    return;
  }

  if (command === "uninstall") {
    const uninstallOpts = {
      all: argv.includes("--all"),
      gateway: argv.includes("--gateway"),
      web: argv.includes("--web"),
      vault: argv.includes("--vault"),
      yes: argv.includes("--yes") || argv.includes("-y"),
      dryRun: argv.includes("--dry-run"),
    };
    await uninstallCommand(uninstallOpts);
    return;
  }

  if (command === "doctor") {
    await doctorCommand(sub);
    return;
  }

  if (!isInitialized()) {
    p.log.error("grind is not initialized. Run `grind init` first.");
    process.exit(1);
  }

  const ctx = await loadContext();

  try {
    switch (command) {
      case undefined:
        await dashboardCommand(ctx);
        break;

      case "status":
        await statusCommand(ctx);
        break;

      case "quest":
        switch (sub) {
          case "create":
          case "new":
            await questCreateCommand(ctx);
            break;
          case "list":
          case "ls":
            await questListCommand(ctx);
            break;
          case "abandon":
            await questAbandonCommand(ctx, rest[0] ?? "");
            break;
          default:
            await questListCommand(ctx);
            break;
        }
        break;

      case "start":
        await startCommand(ctx, sub);
        break;

      case "stop":
        await stopCommand(ctx);
        break;

      case "complete":
      case "done":
        await completeCommand(ctx, sub);
        break;

      case "log":
        await logCommand(ctx, [sub, ...rest].filter(Boolean));
        break;

      case "forge":
        switch (sub) {
          case "create":
          case "new":
            await forgeCreateCommand(ctx);
            break;
          case "list":
          case "ls":
            await forgeListCommand(ctx);
            break;
          case "toggle":
            await forgeToggleCommand(ctx, rest[0] ?? "", rest[1]);
            break;
          case "run":
            await forgeRunCommand(ctx, rest[0] ?? "");
            break;
          case "tick":
            await forgeTickCommand(ctx, rest);
            break;
          case "daemon":
            await forgeDaemonCommand(ctx, rest);
            break;
          default:
            await forgeListCommand(ctx);
            break;
        }
        break;

      case "gateway":
        switch (sub) {
          case "start":
            await gatewayStartCommand(ctx, rest);
            break;
          case "enable":
            await gatewayEnableCommand(ctx, rest);
            break;
          case "stop":
            await gatewayStopCommand();
            break;
          case "disable":
            await gatewayDisableCommand();
            break;
          case "restart":
            await gatewayRestartCommand(ctx, rest);
            break;
          case "status":
            await gatewayStatusCommand(ctx);
            break;
          case "serve":
            await gatewayServeCommand(ctx, rest);
            break;
          default:
            await gatewayStatusCommand(ctx);
            break;
        }
        break;

      case "companion":
        if (sub === "trust") {
          await companionTrustCommand(ctx, rest[0]);
        } else if (sub === "soul") {
          await companionSoulCommand(ctx);
        } else if (sub === "context") {
          await companionContextCommand(ctx, rest.includes("--refresh"));
        } else if (sub === "memory" || sub === "insights") {
          const action = rest[0] ?? "list";
          switch (action) {
            case "list":
            case "ls":
              await companionMemoryListCommand(ctx);
              break;
            case "add":
            case "new":
              await companionMemoryAddCommand(ctx);
              break;
            case "edit":
              await companionMemoryEditCommand(ctx, rest[1]);
              break;
            case "delete":
            case "rm":
              await companionMemoryDeleteCommand(ctx, rest[1]);
              break;
            default:
              p.log.error(`Unknown companion memory action: ${action}`);
              p.log.info("Use: grindxp companion memory [list|add|edit|delete]");
              process.exit(1);
          }
        } else {
          await companionShowCommand(ctx);
        }
        break;

      case "integrations":
      case "integration": {
        if (sub === "connect") {
          const connectFlags: { clientId?: string; clientSecret?: string; gmail?: boolean } = {};
          for (let i = 2; i < argv.length; i++) {
            if (argv[i] === "--gmail") connectFlags.gmail = true;
            const next = argv[i + 1];
            if (argv[i] === "--client-id" && next) {
              connectFlags.clientId = next;
              i++;
            }
            if (argv[i] === "--client-secret" && next) {
              connectFlags.clientSecret = next;
              i++;
            }
          }
          await integrationsConnectCommand(ctx, rest[0], connectFlags);
        } else if (sub === "disconnect") {
          await integrationsDisconnectCommand(ctx, rest[0]);
        } else if (sub === "setup") {
          await integrationsSetupCommand(ctx, rest[0]);
        } else {
          await integrationsListCommand(ctx);
        }
        break;
      }

      case "web":
        closeContext(ctx);
        switch (sub) {
          case "start":
            await webStartCommand();
            break;
          case "stop":
            await webStopCommand();
            break;
          case "status":
            await webStatusCommand();
            break;
          case "serve":
            await webServeCommand(rest);
            break;
          default:
            await webStartCommand();
            break;
        }
        return;

      case "chat": {
        closeContext(ctx);
        const chatFlags: { new?: boolean; session?: string } = {};
        for (let i = 1; i < argv.length; i++) {
          if (argv[i] === "--new" || argv[i] === "-n") chatFlags.new = true;
          const next = argv[i + 1];
          if ((argv[i] === "--session" || argv[i] === "-s") && next) {
            chatFlags.session = next;
            i++;
          }
        }
        const chatMod: {
          startChat: (flags?: { new?: boolean; session?: string }) => Promise<void>;
        } = await import("@grindxp/tui/chat");
        await chatMod.startChat(chatFlags);
        return;
      }

      default:
        p.log.error(`Unknown command: ${command}`);
        showHelp();
        process.exit(1);
    }
  } finally {
    closeContext(ctx);
  }
}

function showHelp(): void {
  p.log.message(showBanner());
  p.note(
    [
      "grindxp                         Dashboard (time-aware)",
      "grindxp init                    Setup wizard",
      "grindxp status                  Level, XP, active quests",
      "grindxp quest create            Commit to a new quest",
      "grindxp quest list              List all quests",
      "grindxp quest abandon <name>    Abandon (with consequences)",
      "grindxp start [quest]           Start timer (1.5x XP)",
      "grindxp stop                    Stop timer, complete quest",
      "grindxp complete [quest]        Complete via self-report (1.0x)",
      "grindxp done [quest]            Alias for complete",
      "grindxp log [type] [duration]   Quick activity log",
      "grindxp forge create            Create an automation rule",
      "grindxp forge list              List rules and recent runs",
      "grindxp forge toggle <rule>     Enable/disable a rule",
      "grindxp forge run <rule>        Run a rule immediately",
      "grindxp forge tick [--dry-run]  Execute one automation tick",
      "grindxp forge daemon            Run automation daemon loop",
      "grindxp integrations            Show configured integrations",
      "grindxp integrations setup      Configure integration credentials",
      "grindxp gateway start           Start gateway and enable autostart",
      "grindxp gateway enable          Enable autostart and start gateway",
      "grindxp gateway stop            Stop running gateway process",
      "grindxp gateway disable         Disable gateway autostart and stop",
      "grindxp gateway restart         Restart managed gateway process",
      "grindxp gateway status          Show gateway health and PID",
      "grindxp gateway serve           Run gateway in foreground",
      "grindxp companion               Show companion settings",
      "grindxp companion soul          Edit companion personality",
      "grindxp companion context       Edit user context for companion",
      "grindxp companion memory        List stored companion insights",
      "grindxp companion memory add    Add a companion insight",
      "grindxp companion memory edit   Edit an insight by selection or ID",
      "grindxp companion memory rm     Delete an insight by selection or ID",
      "grindxp web                     Start web app and open in browser",
      "grindxp web start               Start web app as background daemon",
      "grindxp web stop                Stop managed web app daemon",
      "grindxp web status              Show web app status and PID",
      "grindxp web serve               Run web app in foreground",
      "grindxp setup                   Configure AI provider",
      "grindxp chat                    Talk to the GRIND agent",
      "grindxp chat --new              Start a new conversation",
      "grindxp chat -s <id>            Resume a specific session",
      "grindxp uninstall               Remove Grind data and services",
      "grindxp doctor                  Diagnose install/path issues",
      "grindxp doctor install          Diagnose installation conflicts",
    ].join("\n"),
    "Commands",
  );
}

main().catch((err) => {
  p.log.error(String(err));
  process.exit(1);
});
