# ns-wry-app

NativeScript test app driving `@cross-code/ns-wry` end-to-end on a device.

On launch it displays a **WebView** loading `google.com` and shows the
`WryRuntime.version()` in the status bar — proving the Rust + UniFFI → NS
plugin pipeline works on both platforms.

## Quick start

```bash
# install (in this directory)
pnpm install

# run on a simulator / emulator
ns run ios --emulator
ns run android --emulator
```

## Nx

```bash
# from the workspace root — type-check the app (auto-builds ns-wry first)
pnpm exec nx run ns-wry-app:typecheck
```

See the top-level [README](../../README.md) for monorepo-level commands.
