<!-- Agent instructions: this file is a pointer. All project guidance,
architecture, build/test commands, and tooling conventions live in
AGENTS.md — read it before working in this repo. -->
# CLAUDE.md

This project's canonical instructions for AI agents are in **`AGENTS.md`**
(the industry-standard agent guidance file; Claude Code reads it
automatically). This file exists only so older tools that look for
`CLAUDE.md` find a path to the same content.

**Read `AGENTS.md` before exploring, building, or editing anything.**
It covers: Nx task conventions, the NativeScript plugins (ns-wamr,
ns-wasm3, ns-wry), the vitest-ns device test pool, the shared wire
protocol, native build pipelines (prebuilt xcframeworks, cargo-ndk,
Buck2 via `nx-buck2`), testing layers, and the code-review-graph MCP
tools that should be used before Grep/Glob/Read.
