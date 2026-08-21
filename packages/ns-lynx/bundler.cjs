const { existsSync } = require('node:fs');
const { join } = require('node:path');

// rspeedy names a single string entry `main` and defaults the environment to
// `lynx`, so `rspeedy build` always emits `dist/main.lynx.bundle`.
const BUNDLE = 'main.lynx.bundle';

/**
 * Copies the rspeedy build output into the NativeScript app bundle, so
 * `<LynxView src="~/lynx/main.lynx.bundle">` resolves at runtime.
 *
 * Call it from the app's `rspack.config.ts` after `rspack.init(env)` and
 * before `rspack.resolveConfig()`: copy rules are collected when the flavor
 * config runs, which is inside `resolveConfig()`.
 *
 * The throw is the second half of a deliberate pair — a build-graph edge
 * (Nx, npm scripts) orders the rspeedy build ahead of a normal app build, and
 * this catches a direct `ns build` that skipped it.
 *
 * @param {typeof import('@nativescript/rspack')} bundler
 * @param {{ dist?: string }} [options] rspeedy output directory, relative to
 *   the app root. Defaults to `lynx/dist`.
 */
function configureNativeScriptLynx(bundler, options = {}) {
  // Never `__dirname`: under pnpm that points into the store, not the app.
  const context = bundler.Utils.project.getProjectFilePath(options.dist ?? 'lynx/dist');

  if (!existsSync(join(context, BUNDLE))) {
    throw new Error(
      `${join(context, BUNDLE)} is missing. Build the Lynx bundle ` +
        '(`rspeedy build`) before building the NativeScript app.',
    );
  }

  bundler.Utils.addCopyRule({ from: BUNDLE, to: `lynx/${BUNDLE}`, context });
}

module.exports = configureNativeScriptLynx;
module.exports.configureNativeScriptLynx = configureNativeScriptLynx;
