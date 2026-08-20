import { type ExecutorContext, logger } from '@nx/devkit';
import { runBuck2 } from '../../lib/buck2-cmd';

export interface Buck2RunOptions {
  target: string;
  configuration?: 'debug' | 'release';
  args?: string[];
}

export default async function runExecutor(
  options: Buck2RunOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const config = options.configuration ?? 'debug';

  logger.info(`🚀 Buck2 run: ${options.target} [${config}]`);

  const args = ['run', options.target, '--modifier', config];
  if (options.args) args.push('--', ...options.args);

  const exitCode = await runBuck2(args, {
    cwd: context.root,
    env: {
      ...process.env,
      HOME: process.env.BUCK2_HOME ?? '/tmp/buck2-tmphome',
      BUCK2_MODIFIER: config,
    },
  });

  return { success: exitCode === 0 };
}
