import { defineConfig } from '@lynx-js/rspeedy';
import { pluginReactLynx } from '@lynx-js/react-rsbuild-plugin';

// The bundle is embedded in a NativeScript app rather than opened in
// LynxExplorer, so there is no QR-code plugin here. `rspeedy build` emits
// dist/main.lynx.bundle; the host's rspack.config.ts copies it into the
// NativeScript app folder as lynx/main.lynx.bundle.
export default defineConfig({
  // `engineVersion` is the *minimum* Lynx engine the bundle requires (it
  // defaults to '3.2'), not the engine it is built against — so it must be
  // <= the SDK packages/ns-lynx pins, never equal to it. '3.9' is the ceiling
  // of the encoder this rspeedy toolchain ships: '4.0' fails the build with
  // "current compiler only support lynx version [1.0, 3.9]". Re-check when
  // bumping @lynx-js/react-rsbuild-plugin.
  plugins: [pluginReactLynx({ engineVersion: '3.9' })],
  source: {
    entry: './src/index.tsx',
  },
});
