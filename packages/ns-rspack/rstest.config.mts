import { defineConfig } from '@rstest/core'

// Rstest has no nested `test` block — every option vitest kept under `test.*`
// lives at the top level. `watch` and `cacheDir` have no equivalent: watch is
// the `rstest run` vs `rstest watch` command, and Rsbuild owns the build cache.
export default defineConfig({
    root: import.meta.dirname,
    name: '@cross-code/ns-rspack',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    testEnvironment: 'node',
    globals: true,
    reporters: ['default'],
    coverage: {
        provider: 'v8',
        reportsDirectory: './test-output/rstest/coverage',
    },
})
