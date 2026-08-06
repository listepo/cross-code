import { type ExecutorContext, logger } from '@nx/devkit';
import { spawnSync } from 'node:child_process';

export interface Buck2TestOptions {
  target?: string;
  configuration?: 'debug' | 'release';
}

function resolveBuck2(): string {
  if (process.env.BUCK2_PATH) return process.env.BUCK2_PATH;
  return 'buck2';
}

export default async function testExecutor(
  options: Buck2TestOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const target =
    options.target ?? `//packages/${context.projectName}:test`;
  const configuration = options.configuration ?? 'debug';

  logger.info(`🧪 Buck2 test: ${target} [${configuration}]`);

  const buck2 = resolveBuck2();
  const args = ['test', target, '--mode', configuration];

  const result = spawnSync(buck2, args, {
    stdio: 'inherit',
    cwd: context.root,
    env: { ...process.env },
  });

  if (result.status !== 0) {
    logger.error(`Buck2 test failed with exit code ${result.status}`);
    return { success: false };
  }

  logger.info(`✅ Buck2 test passed: ${target}`);
  return { success: true };
}
