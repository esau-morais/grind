# Agent Memory

- Consult official docs (opentui.com, sdk.vercel.ai, etc.) before each implementation. Don't duplicate what docs already cover — only record gotchas and project-specific discoveries here.

## Grind Architecture

- Monorepo: `packages/core` (domain), `packages/cli` (Clack-based), `packages/tui` (OpenTUI React), `packages/web` (Tanstack Start)
- `exactOptionalPropertyTypes: true` — use spread conditionals, never assign `undefined` to optional props

## Gotchas / Discoveries

- Never read `node_modules` to understand APIs — always consult official docs and official codebases first (react.dev, opentui.com, sdk.vercel.ai, drizzle docs). Do not rely on node_modules for API exploration under any circumstances.
- Always use `gh api` / `gh search code` to explore external codebases (anomalyco/opencode, openclaw/openclaw, etc.) — never try to clone or browse URLs directly.
- Never touch code you did not write. Never fix pre-existing type errors or bugs you did not introduce.
- TanStack Router `routeTree.gen.ts` is auto-generated — never edit it manually. Create the route files and run `bun run dev` (or the build) in `packages/web` to trigger regeneration.
- Spinner: use `spinner()` from `packages/cli/src/spinner.ts` — never `p.spinner()` from clack. Clack's spinner flickers due to erase-then-write; the custom one overwrites in place with `\r` + trailing spaces and hides the cursor. API: `start(msg)`, `stop(msg)`, `cancel(msg)`, `error(msg)`, `message(msg)`. Symbols and frames match clack exactly (`◒◐◓◑`, `◇` green / `■` red / `▲` red).
- Tailwind: `apps/web` does not use `rounded-full` in sidebar/nav components — use `rounded-sm` or `rounded-md`. For inline badge dots, `span` is inline by default; always add `block` when relying on explicit `h-*`/`w-*` dimensions.
