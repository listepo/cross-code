import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import rspack from '@nativescript/rspack';
import type { INativeScriptRspackEnv } from '@nativescript/rspack';

const require = createRequire(import.meta.url);
const configureNativeScriptRstest = require('@cross-code/ns-rstest/bundler');

const appRoot = dirname(fileURLToPath(import.meta.url));
const lynxDist = join(appRoot, 'lynx', 'dist');

export default (env: INativeScriptRspackEnv) => {
  rspack.init(env);

  // The Lynx bundle is a build output of the `lynx/` rspeedy project, not a
  // source asset, so it is copied in rather than committed. `<LynxView>` then
  // reads it as ~/lynx/main.lynx.bundle at runtime.
  if (!existsSync(join(lynxDist, 'main.lynx.bundle'))) {
    throw new Error(
      'lynx/dist/main.lynx.bundle is missing. Run `pnpm build.lynx` before building the app.',
    );
  }
  rspack.Utils.addCopyRule({
    from: 'main.lynx.bundle',
    to: 'lynx/main.lynx.bundle',
    context: lynxDist,
  });

  // Swaps the application entry for the Rstest coordinator, but only for
  // `--env.rstestNativeScript` runs; a normal build is untouched.
  configureNativeScriptRstest(rspack, {
    entry: '_ns-rstest.ts',
  });

  return rspack.resolveConfig();
};
