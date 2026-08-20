import { NativeScriptConfig } from '@nativescript/core';

// The {N} CLI resolves `bundler: 'rspack'` to <app>/node_modules/@nativescript/rspack
// (aliased to @cross-code/ns-rspack) and runs its dist/bin/index.js.
// @nativescript/core 9.0's BundlerType is still 'webpack' | 'vite', hence the widening.
export default {
  id: 'org.nativescript.nativescriptwasmtest',
  appPath: 'app',
  appResourcesPath: 'App_Resources',
  bundler: 'rspack',
  bundlerConfigPath: 'rspack.config.ts',
  // Without this the CLI spawns the bundler with --preserve-symlinks, which
  // cannot resolve through pnpm's store (see packages/ns-rspack/README.md).
  cli: {
    packageManager: 'pnpm'
  },
  android: {
    v8Flags: '--expose_gc',
    markingMode: 'none'
  }
} as Omit<NativeScriptConfig, 'bundler'> & { bundler: string };
