# MEMORY.md

Read [AGENTS.md](AGENTS.md) first. This file is durable gotchas and decisions
that are easy to miss — not a second copy of the architecture guide.

Pointer files (`CLAUDE.md`, `GEMINI.md`, `CODEX.md`, `.cursorrules`) all lead
here via `AGENTS.md`.

## Where to read

| Path | What it is |
| ---- | ---------- |
| [AGENTS.md](AGENTS.md) | Canonical agent instructions (Nx, NativeScript, plugins, testing) |
| [README.md](README.md) | Human-facing overview and commands |
| `packages/<name>/AGENTS.md` | Package-specific workflow and invariants |
| [packages/ns-rspack/MEMORY.md](packages/ns-rspack/MEMORY.md) | Bundler decisions and pitfalls |
| [packages/ns-rspack/AGENTS.md](packages/ns-rspack/AGENTS.md) | Bundler layout, CLI/IPC contract, invariants |

## Cross-cutting

- Run NativeScript through `npx ns` from the app directory. Never a global `ns`.
- Sandboxed shells often lack `pnpm` on `PATH`. Put `~/.local/share/mise/shims`
  first, then `pnpm exec nx …`.
- `code-review-graph` MCP is **review-only** (registered at user scope). Ordinary
  “where does this live” work uses Grep/Glob/Read, not that graph.
- Do **not** run `nx run ns-rspack:format`. The installed oxfmt restyles the
  whole tree (semicolons, double quotes) away from the committed prettier
  `--no-semi --single-quote` style.
- `ns typings android` dumps under `packages/*/typings/android/` are not
  source-of-truth until curated and referenced from adapters. Generated files
  can contain invalid TypeScript and Kotlin-mangled parameter names — do not
  commit them raw.
- `ns-lynx` cannot currently finish a stock `ns build ios`: NativeScript’s
  metadata generator parses PrimJS public C++ headers as Objective-C. See
  `packages/ns-lynx/AGENTS.md`.
- Device rstest suites on iOS and Android share port **17878**. Run them
  serially.
- `apps/ns-lynx-app`, `apps/ns-wasm-test`, and `apps/ns-wry-app` each have their
  own pnpm lockfile. A new dependency in a workspace package needs `pnpm install`
  in the root **and** in every app that lists that package.
- NativeScript host apps must stay in the `@nx/js/typescript` plugin `exclude`
  list (`apps/ns-wasm-test/*`, `apps/ns-wry-app/*`, `apps/ns-lynx-app/*`). The
  plugin infers `tsc --build --emitDeclarationOnly`, which is wrong for a
  nested-lockfile NS app. `ns-lynx-app-lynx` (the rspeedy subproject) is a
  different folder and should keep plugin inference.
