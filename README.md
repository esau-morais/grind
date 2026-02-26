<h1 align="center">
  <!-- <img src="docs/assets/logo.svg" alt="Grind" width="120" height="120"><br> -->
  Grind
</h1>

<p align="center">
  <strong>Your Life Is The Game. Level Up For Real.</strong>
</p>

<p align="center">
  <a href="https://github.com/esau-morais/grind/actions/workflows/ci.yml?branch=main"><img src="https://img.shields.io/github/actions/workflow/status/esau-morais/grind/ci.yml?branch=main&style=flat-square" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@grindxp/cli"><img src="https://img.shields.io/npm/v/@grindxp/cli?style=flat-square" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" alt="MIT License"></a>
  <a href="https://discord.gg/C92ZJmMq7e"><img src="https://img.shields.io/discord/1476332412471476285?label=Discord&logo=discord&logoColor=white&color=5865F2&style=flat-square" alt="Discord"></a>
</p>

<p align="center">
  <a href="https://grindxp.app">Website</a> ·
  <a href="https://docs.grindxp.app">Docs</a> ·
  <a href="https://www.npmjs.com/package/@grindxp/cli">npm</a> ·
  <a href="https://discord.gg/C92ZJmMq7e">Discord</a>
</p>

---

A local-first, privacy-first, gamified personal operating system. Turn real-life activities into quests that earn XP, build streaks, and progress skill trees. AI companion optional.

## Quick Start

```bash
npm i -g @grindxp/cli
grindxp init
grindxp quest create
grindxp status
```

See the [Getting Started guide](https://docs.grindxp.app/get-started/quickstart) for a full walkthrough.

## Packages

| Package                          | Description                                                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [`packages/core`](packages/core) | Domain engine — quests, XP, skills, streaks, vault, forge, companion, agent                               |
| [`packages/cli`](packages/cli)   | CLI interface (Clack prompts) — published as [`@grindxp/cli`](https://www.npmjs.com/package/@grindxp/cli) |
| [`packages/tui`](packages/tui)   | Terminal UI (OpenTUI + React)                                                                             |
| [`apps/web`](apps/web)           | Web dashboard (TanStack Start + shadcn/ui)                                                                |
| [`apps/landing`](apps/landing)   | Marketing site (Astro)                                                                                    |

## Development

```bash
git clone https://github.com/esau-morais/grind
cd grind
bun install
cp .env.example .env
bun cli init
```

See [Contributing](CONTRIBUTING.md) and the [development docs](https://docs.grindxp.app/reference/contributing) for commands and conventions.

## Security

See [SECURITY.md](SECURITY.md) and the [security docs](https://docs.grindxp.app/reference/security).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
