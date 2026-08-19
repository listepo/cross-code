import { runNativeScriptTests } from '@cross-code/ns-rstest';

const port = 17_878;

const summary = await runNativeScriptTests({
  platform: 'ios',
  appPath: '.',
  workers: 1,
  port,
  // A cold runner resolves the Lynx pods and builds the app before the device
  // worker can connect; that routinely exceeds the 2m default.
  connectTimeout: 10 * 60_000,
  include: ['app/tests/**/*.spec.ts'],
  coverage: {
    enabled: process.argv.includes('--coverage'),
    reportsDirectory: 'test-output/rstest/coverage/ios',
  },
  launchCommand: {
    command: 'npx',
    args: [
      'ns',
      'run',
      'ios',
      '--emulator',
      '--no-hmr',
      '--env.rstestNativeScript',
      `--env.rstestNativeScriptPort=${port}`,
    ],
  },
});

process.exitCode = summary.exitCode;
