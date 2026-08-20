import { type ExecutorContext, logger } from '@nx/devkit';
import { runBuck2 } from '../../lib/buck2-cmd';

export interface Buck2TestOptions {
  target?: string;
  configuration?: 'debug' | 'release';
}

export default async function testExecutor(
  options: Buck2TestOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const target =
    options.target ?? `//packages/${context.projectName}:test`;
  const configuration = options.configuration ?? 'debug';

  logger.info(`🧪 Buck2 test: ${target} [${configuration}]`);

  const exitCode = await runBuck2(
    ['test', target, '--modifier', configuration],
    {
      cwd: context.root,
      env: {
        ...process.env,
        HOME: process.env.BUCK2_HOME ?? '/tmp/buck2-tmphome',
        BUCK2_MODIFIER: configuration,
      },
    },
  );

  if (exitCode !== 0) {
    logger.error(`Buck2 test failed with exit code ${exitCode}`);
    return { success: false };
  }

  logger.info(`✅ Buck2 test passed: ${target}`);
  return { success: true };
}
