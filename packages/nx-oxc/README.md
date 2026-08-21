# @cross-code/nx-oxc

Nx inference plugin for the [oxc](https://oxc.rs) toolchain. It attaches two
cached targets to **every workspace package** (anything with a named
`package.json`), so no project has to declare them:

| Target   | Runs                                                   |
| -------- | ------------------------------------------------------ |
| `lint`   | `oxlint --config <root>/.oxlintrc.json --deny-warnings` |
| `format` | `oxfmt`                                                 |

Both are registered separately in `nx.json`, so either can be dropped on its own:

```jsonc
{
  "plugins": [
    { "plugin": "@cross-code/nx-oxc/oxlint" },
    { "plugin": "@cross-code/nx-oxc/oxfmt" },
  ],
}
```

The workspace root itself and `pkg/` directories (wasm-pack output) are skipped.
A project that defines its own `lint` / `format` target in `project.json` wins:
Nx merges explicit configuration over inferred targets.

## Why the entry points are TypeScript

`exports` maps `./oxlint` and `./oxfmt` straight at `src/*.ts`. Nx registers a
TS transpiler before loading plugins, and an inference plugin has to load
*while the project graph is being constructed* — before any build target could
have produced a `dist/`. A compiled entry point would make a fresh clone
unable to construct its own graph.

## Development

```sh
nx test nx-oxc        # vitest
nx typecheck nx-oxc   # tsc --noEmit
```
