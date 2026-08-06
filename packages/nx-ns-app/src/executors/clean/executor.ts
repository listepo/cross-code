import { type ExecutorContext, logger } from '@nx/devkit';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { type NsCleanOptions } from '../../common';

export default async function cleanExecutor(
  options: NsCleanOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const platformsDir = join(context.root, 'platforms');

  if (options.platform) {
    const targetDir = join(platformsDir, options.platform);
    logger.info(`🧹 Cleaning platform: ${targetDir}`);
    rmSync(targetDir, { recursive: true, force: true });
  } else {
    logger.info(`🧹 Cleaning all platforms: ${platformsDir}`);
    rmSync(platformsDir, { recursive: true, force: true });
  }

  if (options.all) {
    const nodeModulesDir = join(context.root, 'node_modules');
    logger.info(`🧹 Removing node_modules: ${nodeModulesDir}`);
    rmSync(nodeModulesDir, { recursive: true, force: true });
  }

  logger.info('✅ Clean completed');
  return { success: true };
}
