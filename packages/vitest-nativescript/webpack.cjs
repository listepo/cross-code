const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

/**
 * Replaces the NativeScript application entry only for Vitest device runs and
 * aliases bare `vitest` imports to the device-safe unit-test shim.
 *
 * @param {typeof import('@nativescript/webpack')} webpack
 * @param {{ entry?: string }} [options]
 */
function configureNativeScriptVitestWebpack(webpack, options = {}) {
  webpack.chainWebpack((config, env) => {
    if (!env.vitestNativeScript) return;

    const entryDirectory = webpack.Utils.platform.getEntryDirPath();
    const entryPath = resolve(
      entryDirectory,
      options.entry ?? 'vitest-nativescript.ts',
    );
    if (!existsSync(entryPath)) {
      throw new Error(
        `NativeScript Vitest entry not found: ${entryPath}. ` +
          'Create it or pass { entry } to configureNativeScriptVitestWebpack().',
      );
    }

    const shimPath = resolve(__dirname, 'dist/runtime/shim.js');
    if (!existsSync(shimPath)) {
      throw new Error(
        'Build @cross-code/vitest-nativescript before running the NativeScript app.',
      );
    }

    const bundleEntry = config
      .entry('bundle')
      .clear()
      .add('@nativescript/core/globals/index.js')
      .add('@nativescript/core/bundle-entry-points')
      .add(entryPath);
    if (webpack.Utils.platform.getPlatformName() === 'android') {
      // NativeScript's static binding generator needs these modules in the
      // bundle to generate com.tns.NativeScriptActivity and its callbacks.
      bundleEntry
        .add('@nativescript/core/ui/frame')
        .add('@nativescript/core/ui/frame/activity');
    }
    config.resolve.alias.set('vitest$', shimPath);

    if (env.vitestNativeScriptCoverage) {
      // NativeScript's device runtimes do not expose V8 coverage. Istanbul
      // instruments only the application bundle and writes its counters to
      // the global read by @vitest/coverage-istanbul in the worker.
      config.module
        .rule('vitest-istanbul')
        .enforce('post')
        .test(/\.[cm]?[jt]sx?$/)
        .include.add(entryDirectory)
        .end()
        .exclude.add(/[\\/]tests[\\/]/)
        .end()
        .exclude.add(/vitest-nativescript(?:\.worker)?\.[cm]?[jt]sx?$/)
        .end()
        .use('babel-istanbul')
        .loader(require.resolve('babel-loader'))
        .options({
          sourceMaps: true,
          plugins: [
            [
              require.resolve('babel-plugin-istanbul'),
              {
                coverageVariable: '__VITEST_COVERAGE__',
                coverageGlobalScope: 'globalThis',
                coverageGlobalScopeFunc: false,
              },
            ],
          ],
        });
    }
  });
}

module.exports = configureNativeScriptVitestWebpack;
module.exports.configureNativeScriptVitestWebpack =
  configureNativeScriptVitestWebpack;
