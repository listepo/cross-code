import os from 'node:os';
import { $ } from 'zx';

export function resolveBuck2(): string {
  if (process.env.BUCK2_PATH) return process.env.BUCK2_PATH;
  return 'buck2';
}

/** Thread count from os.cpus().length, with a minimum of 1. */
export function resolveNumThreads(): number {
  const fromCpus = os.cpus().length;
  return fromCpus > 0 ? fromCpus : 1;
}

/** Insert --num-threads after the buck2 subcommand unless already present. */
export function appendNumThreads(args: string[]): string[] {
  if (args.includes('--num-threads')) {
    return args;
  }
  const [subcommand, ...rest] = args;
  return [subcommand, '--num-threads', String(resolveNumThreads()), ...rest];
}

export async function runBuck2(
  args: string[],
  options: { cwd: string; env?: Record<string, string | undefined> },
): Promise<number> {
  const buck2 = resolveBuck2();
  const fullArgs = appendNumThreads(args);

  const result = await $({
    cwd: options.cwd,
    env: options.env,
    stdio: 'inherit',
    nothrow: true,
  })`${buck2} ${fullArgs}`;

  return result.exitCode ?? 1;
}
