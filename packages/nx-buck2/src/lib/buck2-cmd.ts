import * as os from 'node:os';
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

/**
 * Executors override HOME for buck2's own daemon-dir writability, but
 * rustup resolves its default toolchain from $HOME/.rustup — an overridden
 * HOME makes every cargo/gradle process a genrule spawns downstream fail
 * with "no default is configured", even though the same command works fine
 * outside buck2. Pin RUSTUP_HOME/CARGO_HOME from the *real* HOME whenever a
 * caller overrides it, so the override is transparent to rustup. `??=`
 * leaves an explicitly-set RUSTUP_HOME/CARGO_HOME (e.g. CI's) untouched.
 */
function withRustupHomeFix(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  if (!env.HOME || env.HOME === process.env.HOME) {
    return env;
  }
  return {
    RUSTUP_HOME: `${process.env.HOME}/.rustup`,
    CARGO_HOME: `${process.env.HOME}/.cargo`,
    ...env,
  };
}

export async function runBuck2(
  args: string[],
  options: { cwd: string; env?: Record<string, string | undefined> },
): Promise<number> {
  const buck2 = resolveBuck2();
  const fullArgs = appendNumThreads(args);

  const result = await $({
    cwd: options.cwd,
    env: options.env && withRustupHomeFix(options.env),
    stdio: 'inherit',
    nothrow: true,
  })`${buck2} ${fullArgs}`;

  return result.exitCode ?? 1;
}
