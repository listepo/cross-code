import { availableParallelism } from 'node:os';
import { resolve } from 'node:path';
import type { Reporter } from '@rstest/core';
import { DEFAULT_NS_RSTEST_PORT } from '../protocol.js';
import type { NativeScriptRuntimeOverrides } from '../protocol.js';
import type { NativeScriptWorkerCount } from '../threading.js';
import { resolveNativeScriptWorkerCount } from '../threading.js';

export { DEFAULT_NS_RSTEST_PORT } from '../protocol.js';

export type NativeScriptPlatform = 'android' | 'ios';

export interface NativeScriptLaunchCommand {
  command: string;
  args: string[];
}

export interface NativeScriptCoverageOptions {
  enabled?: boolean;
  /** Directory for `coverage-final.json`, relative to `appPath`. */
  reportsDirectory?: string;
}

export interface NativeScriptRstestOptions extends NativeScriptRuntimeOverrides {
  platform: NativeScriptPlatform;
  appPath?: string;
  workers?: NativeScriptWorkerCount;
  host?: string;
  port?: number;
  device?: string;
  launch?: boolean;
  launchCommand?: NativeScriptLaunchCommand;
  connectTimeout?: number;
  include?: string[];
  /** Rstest reporters. Defaults to the bundled console reporter. */
  reporters?: Reporter[];
  coverage?: NativeScriptCoverageOptions;
}

export interface ResolvedNativeScriptRstestOptions {
  platform: NativeScriptPlatform;
  appPath: string;
  workers: number;
  host: string;
  port: number;
  launch: boolean;
  launchCommand: NativeScriptLaunchCommand;
  connectTimeout: number;
  include: string[];
  runtime: NativeScriptRuntimeOverrides;
  coverage: Required<NativeScriptCoverageOptions>;
}

const DEFAULT_INCLUDE = [
  '**/*.native.test.ts',
  '**/*.native.spec.ts',
  '**/*.native.test.tsx',
  '**/*.native.spec.tsx',
];

export const COVERAGE_ENVIRONMENT_FLAG = '--env.rstestNativeScriptCoverage';

export function withNativeScriptCoverageLaunchCommand(
  launchCommand: NativeScriptLaunchCommand,
): NativeScriptLaunchCommand {
  if (launchCommand.args.includes(COVERAGE_ENVIRONMENT_FLAG)) {
    return launchCommand;
  }

  return {
    ...launchCommand,
    args: [...launchCommand.args, COVERAGE_ENVIRONMENT_FLAG],
  };
}

export function resolveNativeScriptRstestOptions(
  options: NativeScriptRstestOptions,
  cwd = process.cwd(),
  parallelism = availableParallelism(),
): ResolvedNativeScriptRstestOptions {
  const port = options.port ?? DEFAULT_NS_RSTEST_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new RangeError('NativeScript Rstest port must be between 1 and 65535');
  }

  const appPath = resolve(cwd, options.appPath ?? '.');
  const coverageEnabled = options.coverage?.enabled ?? false;
  const defaultArgs = [
    'ns',
    'run',
    options.platform,
    '--no-hmr',
    '--env.rstestNativeScript',
    `--env.rstestNativeScriptPort=${port}`,
  ];
  if (options.device) defaultArgs.push('--device', options.device);

  const launchCommand = options.launchCommand ?? {
    command: 'npx',
    args: defaultArgs,
  };

  return {
    platform: options.platform,
    appPath,
    workers: resolveNativeScriptWorkerCount(options.workers, parallelism),
    host: options.host ?? '0.0.0.0',
    port,
    launch: options.launch ?? true,
    launchCommand: coverageEnabled
      ? withNativeScriptCoverageLaunchCommand(launchCommand)
      : launchCommand,
    connectTimeout: options.connectTimeout ?? 120_000,
    include: options.include ?? DEFAULT_INCLUDE,
    runtime: {
      testTimeout: options.testTimeout,
      hookTimeout: options.hookTimeout,
      retry: options.retry,
      maxConcurrency: options.maxConcurrency,
      testNamePattern: options.testNamePattern,
      bail: options.bail,
      includeTaskLocation: options.includeTaskLocation,
    },
    coverage: {
      enabled: coverageEnabled,
      reportsDirectory:
        options.coverage?.reportsDirectory ?? 'test-output/rstest/coverage',
    },
  };
}
