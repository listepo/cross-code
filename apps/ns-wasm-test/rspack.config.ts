import { dirname } from 'node:path';
import rspack from '@nativescript/rspack';
import type { INativeScriptRspackEnv } from '@nativescript/rspack';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const configureNativeScriptRstest = require('@cross-code/ns-rstest/bundler');

// The fixture .wasm binaries are build outputs of @cross-code/ns-wasm-fixture
// (wasm-pack + the gen_globals binary). Copy them into the bundle so wasm3 and
// WAMR can load them from the app folder at runtime — see app/wasm/wasm-assets.ts.
// Resolve via the package's own exports so this stays correct if the fixture's
// internal folder layout changes.
const fixturePkgDir = dirname(
  require.resolve('@cross-code/ns-wasm-fixture/types.wasm'),
);

export default (env: INativeScriptRspackEnv) => {
  rspack.init(env);

  rspack.Utils.addCopyRule({
    from: 'test_types_bg.wasm',
    to: 'wasm/test_types.wasm',
    context: fixturePkgDir,
  });
  rspack.Utils.addCopyRule({
    from: 'globals.wasm',
    to: 'wasm/globals.wasm',
    context: fixturePkgDir,
  });

  // The fixture's `.wasm` imports its host functions from an "env" namespace;
  // point the wasm-loader at the module that implements them.
  rspack.chainRspack((config) => {
    config.module
      .rule('wasm')
      .use('wasm-loader')
      .options({ imports: { env: '~/wasm/fixture-env' } });
  });

  configureNativeScriptRstest(rspack, {
    entry: '_ns-rstest.ts',
  });

  return rspack.resolveConfig();
};
