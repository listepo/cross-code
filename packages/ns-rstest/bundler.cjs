const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

/**
 * Replaces the NativeScript application entry only for Rstest device runs and
 * aliases bare `@rstest/core` imports to the device-safe unit-test shim.
 *
 * Works with either bundler module: `@nativescript/rspack`
 * (`@cross-code/ns-rspack`, which exposes `chainRspack`) or the older
 * `@nativescript/webpack` (`chainWebpack`). The chain config is a
 * rspack-chain / webpack-chain instance, whose entry/alias/rule API is the
 * same in both.
 *
 * @param {typeof import('@nativescript/webpack')} bundler
 * @param {{ entry?: string }} [options]
 */
function configureNativeScriptRstest(bundler, options = {}) {
  const chain = bundler.chainRspack ?? bundler.chainWebpack;
  chain((config, env) => {
    if (!env.rstestNativeScript) return;

    const entryDirectory = bundler.Utils.platform.getEntryDirPath();
    const entryPath = resolve(entryDirectory, options.entry ?? 'ns-rstest.ts');
    if (!existsSync(entryPath)) {
      throw new Error(
        `NativeScript Rstest entry not found: ${entryPath}. ` +
          'Create it or pass { entry } to configureNativeScriptRstest().',
      );
    }

    const shimPath = resolve(__dirname, 'dist/runtime/shim.js');
    if (!existsSync(shimPath)) {
      throw new Error(
        'Build @cross-code/ns-rstest before running the NativeScript app.',
      );
    }

    const bundleEntry = config
      .entry('bundle')
      .clear()
      .add('@nativescript/core/globals/index.js')
      .add('@nativescript/core/bundle-entry-points')
      .add(entryPath);
    if (bundler.Utils.platform.getPlatformName() === 'android') {
      // NativeScript's static binding generator needs these modules in the
      // bundle to generate com.tns.NativeScriptActivity and its callbacks.
      bundleEntry
        .add('@nativescript/core/ui/frame')
        .add('@nativescript/core/ui/frame/activity');
    }
    // Rstest builds a fresh API per test file and publishes it on
    // `globalThis['@rstest/core']`; the shim forwards to the live one.
    config.resolve.alias.set('@rstest/core$', shimPath);

    if (env.rstestNativeScriptCoverage) {
      // NativeScript's device runtimes do not expose V8 coverage. Istanbul
      // instruments only the application bundle and writes its counters to the
      // `__coverage__` global the worker reports at the end of a slot's run.
      config.module
        .rule('rstest-istanbul')
        .enforce('post')
        .test(/\.[cm]?[jt]sx?$/)
        .include.add(entryDirectory)
        .end()
        .exclude.add(/[\\/]tests[\\/]/)
        .end()
        .exclude.add(/ns-rstest(?:\.worker)?\.[cm]?[jt]sx?$/)
        .end()
        .use('babel-istanbul')
        .loader(require.resolve('babel-loader'))
        .options({
          sourceMaps: true,
          plugins: [
            [
              require.resolve('babel-plugin-istanbul'),
              {
                coverageVariable: '__coverage__',
                coverageGlobalScope: 'globalThis',
                coverageGlobalScopeFunc: false,
              },
            ],
          ],
        });
    }
  });
}

module.exports = configureNativeScriptRstest;
module.exports.configureNativeScriptRstest = configureNativeScriptRstest;
