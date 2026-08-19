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
        // Istanbul, not v8: it instruments the source, so the numbers do not
        // depend on the engine running the tests. It is also what the device
        // suites in @cross-code/ns-rstest have to use — the {N} runtimes expose
        // no V8 coverage — so both halves of this repo report the same way.
        provider: 'istanbul',
        reportsDirectory: './test-output/rstest/coverage',
    },
})
