import { defineConfig } from 'vitest/config';

// The specs run the fixture WebAssembly module through the plugin's public
// TypeScript API on Node — no device, no NativeScript runtime. See
// tests/support/native-fake.ts for how the native layer is stood in for.
export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/nativescript-wasm-test',
  test: {
    name: 'nativescript-wasm-test',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
      include: ['app/wasm/**/*.ts'],
    },
  },
}));
