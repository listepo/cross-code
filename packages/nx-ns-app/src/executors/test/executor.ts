import { type ExecutorContext, logger } from '@nx/devkit';
import { type NsTestOptions, buildNsArgs, buildNsEnv, resolveNsCli } from '../../common';
import { spawnSync } from 'node:child_process';

export default async function testExecutor(
  options: NsTestOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const nsBin = resolveNsCli(context);
  const args = buildNsArgs('test', options.platform, options);
  const env = buildNsEnv(options);

  if (options.coverage) args.push('--coverage');

  logger.info(`🧪 NativeScript test: npx ${args.join(' ')}`);

  const result = spawnSync(nsBin, args, {
    cwd: context.root,
    env,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    logger.error(`NativeScript test failed with exit code ${result.status}`);
    return { success: false };
  }

  logger.info('✅ NativeScript test passed');
  return { success: true };
}
