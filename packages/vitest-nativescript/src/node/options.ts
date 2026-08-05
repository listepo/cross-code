import { availableParallelism } from 'node:os';
import { resolve } from 'node:path';
import { DEFAULT_NATIVE_SCRIPT_VITEST_PORT } from '../protocol.js';
import type { NativeScriptWorkerCount } from '../threading.js';
import { resolveNativeScriptWorkerCount } from '../threading.js';

export { DEFAULT_NATIVE_SCRIPT_VITEST_PORT } from '../protocol.js';

export type NativeScriptPlatform = 'android' | 'ios';

export interface NativeScriptLaunchCommand {
  command: string;
  args: string[];
}

export interface NativeScriptUnitPluginOptions {
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
}

export interface ResolvedNativeScriptUnitPluginOptions {
  platform: NativeScriptPlatform;
  appPath: string;
  workers: number;
  host: string;
  port: number;
  launch: boolean;
  launchCommand: NativeScriptLaunchCommand;
  connectTimeout: number;
  include: string[];
}

const DEFAULT_INCLUDE = [
  '**/*.native.test.ts',
  '**/*.native.spec.ts',
  '**/*.native.test.tsx',
  '**/*.native.spec.tsx',
];

export function resolveNativeScriptUnitPluginOptions(
  options: NativeScriptUnitPluginOptions,
  cwd = process.cwd(),
  parallelism = availableParallelism(),
): ResolvedNativeScriptUnitPluginOptions {
  const port = options.port ?? DEFAULT_NATIVE_SCRIPT_VITEST_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new RangeError(
      'NativeScript Vitest port must be between 1 and 65535',
    );
  }

  const appPath = resolve(cwd, options.appPath ?? '.');
  const defaultArgs = [
    'ns',
    'run',
    options.platform,
    '--no-hmr',
    '--env.vitestNativeScript',
    `--env.vitestNativeScriptPort=${port}`,
  ];
  if (options.device) defaultArgs.push('--device', options.device);

  return {
    platform: options.platform,
    appPath,
    workers: resolveNativeScriptWorkerCount(options.workers, parallelism),
    host: options.host ?? '0.0.0.0',
    port,
    launch: options.launch ?? true,
    launchCommand: options.launchCommand ?? {
      command: 'npx',
      args: defaultArgs,
    },
    connectTimeout: options.connectTimeout ?? 120_000,
    include: options.include ?? DEFAULT_INCLUDE,
  };
}
