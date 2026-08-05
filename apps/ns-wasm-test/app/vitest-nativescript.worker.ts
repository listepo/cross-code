import '@nativescript/core/globals';
import {
  createWebpackTestRegistry,
  registerNativeScriptVitestWorker,
  type WebpackRequireContext,
} from '@cross-code/vitest-nativescript/runtime';

declare const require: {
  context(
    path: string,
    recursive: boolean,
    pattern: RegExp,
  ): WebpackRequireContext;
};

const tests = require.context('./tests', true, /\.spec\.ts$/);

registerNativeScriptVitestWorker({
  registry: createWebpackTestRegistry(tests),
});
