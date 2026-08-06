import { type ExecutorContext, logger } from '@nx/devkit';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { type NsRunOptions, runNsCli } from '../../common';

export default async function runExecutor(
  options: NsRunOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  if (options.forceClean && options.platform) {
    const platformDir = join(context.root, 'platforms', options.platform);
    logger.info(`🧹 Force-cleaning: ${platformDir}`);
    rmSync(platformDir, { recursive: true, force: true });
  }

  const status = runNsCli('run', options.platform, options, context);

  if (status !== 0) {
    logger.error(`NativeScript run failed with exit code ${status}`);
    return { success: false };
  }

  logger.info('✅ NativeScript run succeeded');
  return { success: true };
}
