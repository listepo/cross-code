import { nativeScriptUnitPlugin } from '@cross-code/vitest-nativescript';
import { defineConfig } from 'vitest/config';

const port = 17_878;

export default defineConfig({
  plugins: [
    nativeScriptUnitPlugin({
      platform: 'ios',
      appPath: '.',
      workers: 1,
      port,
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
        'app/vitest-nativescript.ts',
        'app/vitest-nativescript.worker.ts',
      ],
      all: false,
    },
  },
});
