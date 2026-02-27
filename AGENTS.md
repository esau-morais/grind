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

## OpenTUI Gotchas

- `onContentChange` fires **asynchronously** — emitted by the Zig native layer and delivered to JS on the next native event loop tick, not inline during `textarea.setText()`. Never use a synchronous flag (e.g. `applyingHistoryRef`) set before and cleared after `setText()` as a guard inside `onContentChange` — the flag will always be reset before the callback fires.
- For state that must not reset on programmatic `setText()` calls (e.g. history navigation index): follow the opencode TUI pattern — never mutate that state from `onContentChange`. Only mutate it from explicit synchronous user-action points: `useKeyboard` (printable chars, backspace, delete), paste handlers, submit, and clear.
- `textarea.setText(text)` + `textarea.cursorOffset = n` is the correct way to programmatically replace content and position the cursor. `replaceText` preserves undo history; `setText` resets it.
- `cursorOffset === 0` is the reliable boundary check for "cursor at start" in the TUI (equivalent to the web's first-line `selectionStart` check).

## PR / Changelog Conventions

- PR body is used verbatim as the GitHub release body, which is then prepended to `docs/reference/changelog.mdx` by `sync-changelog.yml`. Keep PR bodies to a short sentence describing the change followed by a tight bullet list of what was added/fixed/changed. No tables, no implementation details, no "Root Cause" / "Why" sections — those belong in commit messages or code comments only.
- Always add a label to every PR after creating it (`gh pr edit <number> --add-label "<label>"`). Available labels are defined in `.github/release.yml`: `breaking-change`, `feature`, `enhancement`, `bug`, `documentation`.
