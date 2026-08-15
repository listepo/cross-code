import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import rspack from '@nativescript/rspack';
import type { INativeScriptRspackEnv } from '@nativescript/rspack';

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

  return rspack.resolveConfig();
};
