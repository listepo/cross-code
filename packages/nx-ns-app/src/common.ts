import { type ExecutorContext, logger } from '@nx/devkit';
import { spawnSync } from 'node:child_process';

export interface NsPlatformOptions {
  /** Target platform. */
  platform?: 'ios' | 'android';
  /** Device identifier or 'emulator'. */
  device?: string;
  /** Build configuration. */
  configuration?: 'debug' | 'release';
  /** Remove platforms/<platform> before building. */
  clean?: boolean;
  /** Disable Hot Module Replacement. */
  noHmr?: boolean;
  /** Forward additional arguments to the ns CLI. */
  extraArgs?: string[];
}

export interface NsBuildOptions extends NsPlatformOptions {
  /** Only prepare, don't build. */
  prepareOnly?: boolean;
  /** Pass environment variables to the app. */
  env?: Record<string, string>;
}

export interface NsTestOptions extends NsPlatformOptions {
  /** Generate coverage reports. */
  coverage?: boolean;
  /** Use vitest-ns pool (default: true for apps that have it). */
  vitest?: boolean;
}

export interface NsRunOptions extends NsPlatformOptions {
  /** Force clean before running. */
  forceClean?: boolean;
}

export interface NsDebugOptions extends NsPlatformOptions {
  /** Debug port for the Chrome DevTools inspector. */
  debugPort?: number;
}

export interface NsCleanOptions {
  /** Specific platform to clean. Omitting cleans both. */
  platform?: 'ios' | 'android';
  /** Also remove node_modules. */
  all?: boolean;
}

export interface NsPrepareOptions {
  platform: 'ios' | 'android';
  /** Pass environment variables. */
  env?: Record<string, string>;
}

/** Resolve the 'ns' CLI — prefers the project-local install, falls back to npx. */
export function resolveNsCli(context: ExecutorContext): string {
  // Prefer NS_CLI_PATH env var for custom installs
  if (process.env.NS_CLI_PATH) return process.env.NS_CLI_PATH;
  return 'npx';
}

/** Build the argument list for `ns <command>`. */
export function buildNsArgs(
  command: string,
  platform: string | undefined,
  options: NsPlatformOptions,
): string[] {
  const args: string[] = ['ns', command];

  if (platform) args.push(platform);

  if (options.device) {
    if (options.device === 'emulator') {
      args.push('--emulator');
    } else {
      args.push('--device', options.device);
    }
  }

  if (options.configuration) {
    args.push(`--${options.configuration}`);
  }

  if (options.noHmr) {
    args.push('--no-hmr');
  }

  if (options.extraArgs?.length) {
    args.push(...options.extraArgs);
  }

  return args;
}

/** Build ns CLI env vars. */
export function buildNsEnv(
  options: NsBuildOptions,
): Record<string, string> {
  const env: Record<string, string> = { ...process.env as Record<string, string> };
  // NativeScript's CocoaPods check needs UTF-8 locale
  if (!env.LANG) env.LANG = 'en_US.UTF-8';

  if (options.env) {
    for (const [key, value] of Object.entries(options.env)) {
      env[`--env.${key}`] = value;
    }
  }

  return env;
}

/** Run a NativeScript CLI command. Returns exit code 0 on success. */
export function runNsCli(
  command: string,
  platform: string | undefined,
  options: NsPlatformOptions & { env?: Record<string, string> },
  context: ExecutorContext,
): number {
  const nsBin = resolveNsCli(context);
  const args = buildNsArgs(command, platform, options);
  const env = buildNsEnv(options);

  logger.info(`📱 NativeScript ${command}: npx ${args.join(' ')}`);

  if (options.clean && platform) {
    const cleanArgs = ['ns', 'clean'];
    logger.info(`🧹 Cleaning platform: npx ${cleanArgs.join(' ')}`);
    spawnSync(nsBin, cleanArgs, {
      cwd: context.root,
      env,
      stdio: 'inherit',
    });
  }

  const result = spawnSync(nsBin, args, {
    cwd: context.root,
    env,
    stdio: 'inherit',
  });

  return result.status ?? 1;
}
