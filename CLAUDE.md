<!-- Agent instructions: this file is a pointer. All project guidance,
architecture, build/test commands, and tooling conventions live in
AGENTS.md — read it before working in this repo. -->
# CLAUDE.md

This project's canonical instructions for AI agents are in **`AGENTS.md`**
(the industry-standard agent guidance file; Claude Code reads it
automatically). Durable gotchas live in **`MEMORY.md`**. This file exists
only so older tools that look for `CLAUDE.md` find a path to the same
content.

**Read `AGENTS.md` and `MEMORY.md` before exploring, building, or editing
anything.** They cover: Nx task conventions, the NativeScript plugins
(ns-wamr, ns-wasm3, ns-wry), the ns-rstest device test runner, the
ns-rspack bundler, the shared wire protocol, native build pipelines
(prebuilt xcframeworks, cargo-ndk, Buck2 via `nx-buck2`), testing layers,
and the code-review-graph MCP tools (review-only).
