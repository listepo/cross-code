import '@nativescript/core/globals';
import {
  createBundlerTestRegistry,
  registerNativeScriptRstestWorker,
  type BundlerRequireContext,
} from '@cross-code/ns-rstest/runtime';

declare const require: {
  context(
    path: string,
    recursive: boolean,
    pattern: RegExp,
  ): BundlerRequireContext;
};

const tests = require.context('./tests', true, /\.spec\.ts$/);

registerNativeScriptRstestWorker({
  registry: createBundlerTestRegistry(tests),
});
