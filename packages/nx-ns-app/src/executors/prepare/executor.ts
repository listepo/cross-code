import { type ExecutorContext, logger } from '@nx/devkit';
import { type NsPrepareOptions, runNsCli } from '../../common';

export default async function prepareExecutor(
  options: NsPrepareOptions & { extraArgs?: string[] },
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const status = runNsCli('prepare', options.platform, options, context);

  if (status !== 0) {
    logger.error(`NativeScript prepare failed with exit code ${status}`);
    return { success: false };
  }

  logger.info('✅ NativeScript prepare succeeded');
  return { success: true };
}
