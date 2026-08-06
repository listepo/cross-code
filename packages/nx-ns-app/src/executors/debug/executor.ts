import { type ExecutorContext, logger } from '@nx/devkit';
import { type NsDebugOptions, runNsCli } from '../../common';

export default async function debugExecutor(
  options: NsDebugOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  // Inject --debug-port into extra args if configured
  const extraArgs = [...(options.extraArgs ?? [])];
  if (options.debugPort !== undefined) {
    extraArgs.push('--debug-port', String(options.debugPort));
  }

  const mergedOptions = { ...options, extraArgs };
  const status = runNsCli('debug', options.platform, mergedOptions, context);

  if (status !== 0) {
    logger.error(`NativeScript debug failed with exit code ${status}`);
    return { success: false };
  }

  logger.info('✅ NativeScript debug succeeded');
  return { success: true };
}
