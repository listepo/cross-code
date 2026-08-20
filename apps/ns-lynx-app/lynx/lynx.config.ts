import { defineConfig } from '@lynx-js/rspeedy';
import { pluginReactLynx } from '@lynx-js/react-rsbuild-plugin';

// The bundle is embedded in a NativeScript app rather than opened in
// LynxExplorer, so there is no QR-code plugin here. `rspeedy build` emits
// dist/main.lynx.bundle; the host's rspack.config.ts copies it into the
// NativeScript app folder as lynx/main.lynx.bundle.
export default defineConfig({
  // `engineVersion` defaults to '3.2' and must match the Lynx SDK the plugin
  // pins (packages/ns-lynx/platforms/*), or the bundle is compiled against an
  // older element API than the engine loading it.
  plugins: [pluginReactLynx({ engineVersion: '3.9' })],
  source: {
    entry: './src/index.tsx',
  },
});
