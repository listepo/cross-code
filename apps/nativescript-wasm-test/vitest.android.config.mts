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
  },
});
