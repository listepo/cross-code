<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->

## NativeScript

- Docs: https://docs.nativescript.org (append .md to any URL for markdown)
- Docs index: https://docs.nativescript.org/llms.txt
- MCP server: https://docs.nativescript.org/mcp
- Verify current API signatures via the API reference before writing code:
  https://docs.nativescript.org/api/
- The `ns` CLI is installed locally as a devDependency. Always run it with
  `npx ns` (not a bare `ns`), e.g. `npx ns test ios --emulator`.
  `npx ns` automatically resolves to the project-local `node_modules/.bin/ns`
  and never hits a broken global install or macOS permission walls on
  `~/.local/share/.nativescript-cli`.

## NativeScript plugins in this repo

Two sibling plugins live under `packages/`:

- **`nativescript-wasm3`** (`@org/nativescript-wasm3`) — mature plugin binding
  the wasm3 interpreter (Swift Package on iOS, Kotlin + JavaCPP on Android).
  See `packages/nativescript-wasm3/AGENTS.md`.
- **`nativescript-wamr`** (`@org/nativescript-wamr`) — newer plugin binding
  WAMR (WebAssembly Micro Runtime) with four execution tiers (Interpreter,
  Fast JIT, LLVM JIT, AOT), WASI support, and the same wire protocol as wasm3.
  See `packages/nativescript-wamr/AGENTS.md`.

Both plugins share the same architecture and conventions: a platform-agnostic
wire protocol (`wire.ts`), per-platform adapter files, Swift @objc classes on
iOS, Kotlin + JavaCPP on Android, and Nx targets declared via `package.json`.

**Important (wamr)**: `packages/nativescript-wamr/src/vendors/wamr/` is
intentionally **empty** (only a README) until the WAMR C source tree is
populated. CI jobs for the native suites detect the absence and **skip
gracefully** (see `.github/workflows/ci.yml`, "Check for WAMR C sources"
steps) rather than fail. When working on wamr, do not rely on CI native
steps passing until sources are added.

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes_tool` or `query_graph_tool` instead of Grep
- **Understanding impact**: `get_impact_radius_tool` instead of manually tracing imports
- **Code review**: `detect_changes_tool` + `get_review_context_tool` instead of reading entire files
- **Finding relationships**: `query_graph_tool` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview_tool` + `list_communities_tool`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
| ------ | ---------- |
| `detect_changes_tool` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context_tool` | Need source snippets for review — token-efficient |
| `get_impact_radius_tool` | Understanding blast radius of a change |
| `get_affected_flows_tool` | Finding which execution paths are impacted |
| `query_graph_tool` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes_tool` | Finding functions/classes by name or keyword |
| `get_architecture_overview_tool` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes_tool` for code review.
3. Use `get_affected_flows_tool` to understand impact.
4. Use `query_graph_tool` pattern="tests_for" to check coverage.
