import { type ExecutorContext, logger } from '@nx/devkit';
import { type NsBuildOptions, runNsCli } from '../../common';

export default async function buildExecutor(
  options: NsBuildOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const command = options.prepareOnly ? 'prepare' : 'build';
  const status = runNsCli(command, options.platform, options, context);

  if (status !== 0) {
    logger.error(`NativeScript ${command} failed with exit code ${status}`);
    return { success: false };
  }

  logger.info(`✅ NativeScript ${command} succeeded`);
  return { success: true };
}
