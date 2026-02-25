import * as p from "@clack/prompts";

function note(content: string, title: string): void {
  p.note(content.trimEnd(), title);
}

function cmd(usage: string, desc: string, width = 30): string {
  return `  ${usage.padEnd(width)}${desc}`;
}

function flag(name: string, desc: string, width = 28): string {
  return `  ${name.padEnd(width)}${desc}`;
}

export function showCommandHelp(command: string | undefined, sub: string): void {
  switch (command) {
    case "quest":
      note(
        [
          "Usage: grindxp quest <subcommand>",
          "",
          cmd("create", "Commit to a new quest"),
          cmd("list, ls", "List all quests"),
          cmd("abandon <name>", "Abandon a quest (with XP consequences)"),
        ].join("\n"),
        "quest",
      );
      break;

    case "forge":
      note(
        [
          "Usage: grindxp forge <subcommand>",
          "",
          cmd("create", "Create an automation rule"),
          cmd("list, ls", "List rules and recent runs"),
          cmd("toggle <rule> [on|off]", "Enable or disable a rule"),
          cmd("run <rule>", "Run a rule immediately"),
          cmd("tick", "Execute one automation tick"),
          cmd("daemon", "Run the automation daemon loop"),
          "",
          "Flags:",
          flag("--dry-run", "Preview without side effects  (tick)"),
          flag("--interval <s>", "Tick interval in seconds        (daemon)"),
        ].join("\n"),
        "forge",
      );
      break;

    case "gateway":
      note(
        [
          "Usage: grindxp gateway <subcommand>",
          "",
          cmd("start", "Start gateway and enable autostart"),
          cmd("stop", "Stop the running gateway"),
          cmd("enable", "Enable autostart and start gateway"),
          cmd("disable", "Disable autostart and stop gateway"),
          cmd("restart", "Restart the managed gateway"),
          cmd("serve", "Run gateway in the foreground"),
          cmd("status", "Show gateway health and PID"),
          "",
          "Flags (start / enable / restart / serve):",
          flag("--host <host>", "Bind host"),
          flag("--port <port>", "Bind port"),
          flag("--token <token>", "Admin auth token"),
          flag("--telegram-bot-token", "Telegram bot token"),
          flag("--discord-public-key", "Discord app public key"),
          flag("--whatsapp-mode", "whatsapp-web | cloud-api"),
        ].join("\n"),
        "gateway",
      );
      break;

    case "companion":
      note(
        [
          "Usage: grindxp companion <subcommand>",
          "",
          cmd("(none)", "Show companion settings"),
          cmd("soul", "Edit companion personality in $EDITOR"),
          cmd("context [--refresh]", "View or refresh your user context"),
          cmd("memory, insights", "List stored insights"),
          cmd("memory add", "Add an insight"),
          cmd("memory edit [id]", "Edit an insight"),
          cmd("memory delete [id]", "Delete an insight"),
        ].join("\n"),
        "companion",
      );
      break;

    case "integrations":
    case "integration":
      note(
        [
          "Usage: grindxp integrations <subcommand>",
          "",
          cmd("(none)", "List configured integrations"),
          cmd("connect <target>", "Connect an integration"),
          cmd("disconnect <target>", "Remove an integration"),
          "",
          "Targets: google  telegram  discord  whatsapp",
        ].join("\n"),
        "integrations",
      );
      break;

    case "web":
      note(
        [
          "Usage: grindxp web <subcommand>",
          "",
          cmd("(none)", "Start web app and open in browser"),
          cmd("start", "Start as background daemon"),
          cmd("stop", "Stop the background daemon"),
          cmd("status", "Show daemon status and PID"),
          cmd("serve [--no-open]", "Run in the foreground"),
        ].join("\n"),
        "web",
      );
      break;

    case "chat":
      note(
        [
          "Usage: grindxp chat [flags]",
          "",
          "Talk to the GRIND agent.",
          "",
          "Flags:",
          flag("--new, -n", "Start a new conversation"),
          flag("--session, -s <id>", "Resume a specific session"),
        ].join("\n"),
        "chat",
      );
      break;

    case "uninstall":
      note(
        [
          "Usage: grindxp uninstall [flags]",
          "",
          "Remove GRIND data and managed services.",
          "",
          "Flags:",
          flag("--all", "Remove everything"),
          flag("--gateway", "Remove gateway service"),
          flag("--web", "Remove web daemon"),
          flag("--vault", "Delete ~/.grind vault and config"),
          flag("--yes, -y", "Skip confirmation prompts"),
          flag("--dry-run", "Preview without making changes"),
        ].join("\n"),
        "uninstall",
      );
      break;

    case "log":
      note(
        [
          "Usage: grindxp log [type] [minutes]",
          "",
          "Quickly log a completed activity.",
          "Creates a bounty quest and immediately completes it.",
          "",
          "  grindxp log                 Interactive",
          "  grindxp log workout 30      30 min workout",
          "  grindxp log reading 20      20 min reading",
        ].join("\n"),
        "log",
      );
      break;

    case "start":
      note(
        [
          "Usage: grindxp start [quest-name]",
          "",
          "Start a focus timer for a quest.",
          "Timed completions earn 1.5× XP vs self-report.",
          "",
          "  grindxp start               Select from active quests",
          "  grindxp start <name>        Match quest by name",
        ].join("\n"),
        "start",
      );
      break;

    case "stop":
      note(
        [
          "Usage: grindxp stop",
          "",
          "Stop the running timer and complete the quest.",
          "Awards 1.5× XP for timed sessions.",
        ].join("\n"),
        "stop",
      );
      break;

    case "complete":
    case "done":
      note(
        [
          "Usage: grindxp complete [quest-name]",
          "       grindxp done [quest-name]",
          "",
          "Self-report a quest as complete (1.0× XP).",
          "Use grindxp stop instead if a timer is running.",
        ].join("\n"),
        "complete",
      );
      break;

    case "status":
      note(
        [
          "Usage: grindxp status",
          "",
          "Show a compact snapshot: level, XP, active quests,",
          "quests completed today, and timer state.",
        ].join("\n"),
        "status",
      );
      break;

    case "init":
      note(
        [
          "Usage: grindxp init",
          "",
          "First-run setup wizard.",
          "Configure name, timezone, AI provider, companion,",
          "integrations, and gateway autostart.",
        ].join("\n"),
        "init",
      );
      break;

    case "setup":
      note(
        ["Usage: grindxp setup", "", "Reconfigure your AI provider, auth, and model."].join("\n"),
        "setup",
      );
      break;

    default:
      p.log.error(`Unknown command: ${command ?? "(none)"}`);
      p.log.info("Run grindxp --help to see all commands.");
      break;
  }
}
