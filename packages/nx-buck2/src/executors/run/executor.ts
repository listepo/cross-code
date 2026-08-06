import { type ExecutorContext, logger } from '@nx/devkit';
import { spawnSync } from 'node:child_process';

export interface Buck2RunOptions {
  target: string;
  configuration?: 'debug' | 'release';
  args?: string[];
}

export default async function runExecutor(
  options: Buck2RunOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const buck2 = process.env.BUCK2_PATH ?? 'buck2';
  const config = options.configuration ?? 'debug';

  logger.info(`🚀 Buck2 run: ${options.target} [${config}]`);

  const cmdArgs = ['run', options.target, '--mode', config];
  if (options.args) cmdArgs.push('--', ...options.args);

  const result = spawnSync(buck2, cmdArgs, {
    stdio: 'inherit',
    cwd: context.root,
    env: { ...process.env },
  });

  return { success: result.status === 0 };
}
