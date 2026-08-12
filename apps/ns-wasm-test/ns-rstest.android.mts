import { runNativeScriptTests } from '@cross-code/ns-rstest';

const port = 17_878;

const summary = await runNativeScriptTests({
  platform: 'android',
  appPath: '.',
  workers: 1,
  port,
  // A cold CI runner downloads Gradle, builds the app and boots the
  // emulator before the device worker can connect; that routinely exceeds
  // the 2m default.
  connectTimeout: 10 * 60_000,
  include: ['app/tests/**/*.spec.ts'],
  coverage: {
    enabled: process.argv.includes('--coverage'),
    reportsDirectory: 'test-output/rstest/coverage/android',
  },
  launchCommand: {
    command: 'npx',
    args: [
      'ns',
      'run',
      'android',
      '--emulator',
      '--no-hmr',
      '--env.rstestNativeScript',
      `--env.rstestNativeScriptPort=${port}`,
    ],
  },
});

process.exitCode = summary.exitCode;
