# Contributing

[GitHub](https://github.com/esau-morais/grind) · [Docs](https://docs.grindxp.app) · [Discord](https://discord.gg/C92ZJmMq7e)

## Setup

```bash
git clone https://github.com/esau-morais/grind
cd grind
bun install
cp .env.example .env
bun cli init
```

Bun is required. npm/yarn/pnpm won't work for this monorepo.

## Commands

| Command               | Description                          |
| --------------------- | ------------------------------------ |
| `bun cli <cmd>`       | Run the CLI                          |
| `bun tui`             | Launch the TUI                       |
| `bun web`             | Start the web dev server             |
| `bun run typecheck`   | TypeScript type check (all packages) |
| `bun run lint`        | OXC lint                             |
| `bun run format`      | OXC format                           |
| `bun run db:generate` | Generate a Drizzle migration         |
| `bun run db:migrate`  | Apply migrations locally             |

## How to Contribute

- **Bugs and small fixes** -- open a PR directly
- **New features or architecture changes** -- open a discussion first
- **Questions** -- ask on [Discord](https://discord.gg/C92ZJmMq7e)

AI-assisted PRs are welcome. Just mark them in the PR description and note the level of testing.

## Code Style

OXC (`oxfmt` for formatting, `oxlint` for linting). Run `bun run format` before committing.

Key TypeScript rules:

- `exactOptionalPropertyTypes: true` -- never assign `undefined` to optional props; use spread conditionals
- `noUncheckedIndexedAccess: true` -- always null-check array access
- `verbatimModuleSyntax: true` -- use `import type` for type-only imports

For full conventions, adding CLI commands, agent tools, and DB tables: [Development docs](https://docs.grindxp.app/reference/contributing)
