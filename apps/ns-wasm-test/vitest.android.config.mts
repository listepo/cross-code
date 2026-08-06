import { nativeScriptUnitPlugin } from '@cross-code/vitest-nativescript';
import { defineConfig } from 'vitest/config';

const port = 17_878;

export default defineConfig({
  plugins: [
    nativeScriptUnitPlugin({
      platform: 'android',
      appPath: '.',
      workers: 1,
      port,
      // A cold CI runner downloads Gradle, builds the app and boots the
      // emulator before the device worker can connect; that routinely
      // exceeds the 2m default.
      connectTimeout: 10 * 60_000,
      include: ['app/tests/**/*.spec.ts'],
      launchCommand: {
        command: 'npx',
        args: [
          'ns',
          'run',
          'android',
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
      reportsDirectory: './test-output/vitest/coverage/android',
      reporter: ['text', 'json-summary', 'lcov', 'html'],
      include: ['app/**/*.ts'],
      exclude: [
        'app/tests/**',
        'app/vitest-nativescript.ts',
        'app/vitest-nativescript.worker.ts',
      ],
      all: false,
    },
  },
});
