import { nativeScriptUnitPlugin } from '@cross-code/vitest-ns';
import { defineConfig } from 'vitest/config';

const port = 17_878;

export default defineConfig({
  plugins: [
    nativeScriptUnitPlugin({
      platform: 'ios',
      appPath: '.',
      workers: 1,
      port,
      // A cold CI runner resolves SwiftPM packages and builds the app before
      // the device worker can connect; that routinely exceeds the 2m default.
      connectTimeout: 10 * 60_000,
      include: ['app/tests/**/*.spec.ts'],
      launchCommand: {
        command: 'npx',
        args: [
          'ns',
          'run',
          'ios',
          '--emulator',
          '--no-hmr',
          '--env.vitestNativeScript',
          `--env.vitestNativeScriptPort=${port}`,
        ],
      },
    }),
  ],
  test: {
    include: ['app/tests/**/*.spec.ts'],
    coverage: {
      provider: 'istanbul',
      reportsDirectory: './test-output/vitest/coverage/ios',
      reporter: ['text', 'json-summary', 'lcov', 'html'],
      include: ['app/**/*.ts'],
      exclude: [
        'app/tests/**',
        'app/vitest-ns.ts',
        'app/vitest-ns.worker.ts',
      ],
      all: false,
    },
  },
});
