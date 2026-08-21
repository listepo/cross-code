import { createRequire } from 'node:module';
import rspack from '@nativescript/rspack';
import type { INativeScriptRspackEnv } from '@nativescript/rspack';

const require = createRequire(import.meta.url);
const configureNativeScriptLynx = require('@cross-code/ns-lynx/bundler');
const configureNativeScriptRstest = require('@cross-code/ns-rstest/bundler');

export default (env: INativeScriptRspackEnv) => {
  rspack.init(env);

  // Copies lynx/dist/main.lynx.bundle in as ~/lynx/main.lynx.bundle, and
  // throws if the rspeedy build has not run.
  configureNativeScriptLynx(rspack);

  // Swaps the application entry for the Rstest coordinator, but only for
  // `--env.rstestNativeScript` runs; a normal build is untouched.
  configureNativeScriptRstest(rspack, {
    entry: '_ns-rstest.ts',
  });

  return rspack.resolveConfig();
};
