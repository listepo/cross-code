import { type ExecutorContext, logger } from '@nx/devkit';
import { spawnSync } from 'node:child_process';

export interface Buck2BuildOptions {
  /** Build profile: debug (-O0 -g3) or release (-Oz -flto, stripped). */
  configuration?: 'debug' | 'release';
  /** Buck2 target label, e.g. //packages/ns-wamr:wamr-c. Defaults to //packages/<project>:all. */
  target?: string;
  /** Target architecture. */
  arch?:
    | 'arm64'
    | 'x86_64'
    | 'arm64-v8a'
    | 'armeabi-v7a'
    | 'x86';
  /** Target platform. */
  platform?: 'ios' | 'ios-sim' | 'android' | 'macos';
  /** Extra CLI args forwarded to buck2 build. */
  extraArgs?: string[];
}

function resolveBuck2(): string {
  if (process.env.BUCK2_PATH) return process.env.BUCK2_PATH;
  return 'buck2';
}

function resolveTarget(
  options: Buck2BuildOptions,
  context: ExecutorContext,
): string {
  if (options.target) return options.target;
  const projectName = context.projectName ?? 'root';
  return `//packages/${projectName}:all`;
}

export default async function buildExecutor(
  options: Buck2BuildOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const configuration = options.configuration ?? 'release';
  const target = resolveTarget(options, context);

  logger.info(
    `🔨 Buck2 build: ${target} [${configuration}] platform=${options.platform ?? 'auto'} arch=${options.arch ?? 'auto'}`,
  );

  const buck2 = resolveBuck2();
  const args: string[] = [
    'build',
    target,
    '--modifier', configuration,
    '--show-output',
  ];

  if (options.platform) {
    args.push(
      '--target-platforms',
      `toolchains//:${options.platform}-${options.arch ?? 'arm64'}`,
    );
  }

  if (options.extraArgs?.length) {
    args.push(...options.extraArgs);
  }

  logger.debug(`Running: ${buck2} ${args.join(' ')}`);

  const result = spawnSync(buck2, args, {
    stdio: 'inherit',
    cwd: context.root,
    env: {
      ...process.env,
      // Buck2 uses HOME for daemon dir; ensure it's writable.
      HOME: process.env.BUCK2_HOME ?? '/tmp/buck2-tmphome',
      // Pass through build mode to genrule scripts.
      BUCK2_MODIFIER: configuration,
    },
  });

  if (result.status !== 0) {
    logger.error(`Buck2 build failed with exit code ${result.status}`);
    return { success: false };
  }

  logger.info(`✅ Buck2 build succeeded: ${target}`);
  return { success: true };
}
