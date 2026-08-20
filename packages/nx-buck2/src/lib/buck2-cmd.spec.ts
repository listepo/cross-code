import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import {
  appendNumThreads,
  resolveBuck2,
  resolveNumThreads,
  runBuck2,
} from './buck2-cmd';

const mockExec = vi.fn();
vi.mock('zx', () => ({
  $: Object.assign(
    (opts?: object) => {
      return (parts: TemplateStringsArray, ...exprs: unknown[]) =>
        mockExec(opts, parts, exprs);
    },
    { stdio: undefined },
  ),
}));

// A namespace import (`import * as os`) is required in buck2-cmd.ts itself
// (Nx's swc-node executor loading doesn't apply tsc's default-import CJS
// interop — see the nx-local-plugin-executor-loading memory note), which
// makes `os.cpus` a non-configurable ESM binding `vi.spyOn` can't redefine.
// Mock the whole module instead.
vi.mock('node:os', () => ({ cpus: vi.fn() }));

describe('resolveBuck2', () => {
  it('uses BUCK2_PATH when set', () => {
    const original = process.env.BUCK2_PATH;
    process.env.BUCK2_PATH = '/custom/buck2';
    try {
      expect(resolveBuck2()).toBe('/custom/buck2');
    } finally {
      if (original === undefined) {
        delete process.env.BUCK2_PATH;
      } else {
        process.env.BUCK2_PATH = original;
      }
    }
  });

  it('defaults to buck2 when BUCK2_PATH is unset', () => {
    const original = process.env.BUCK2_PATH;
    delete process.env.BUCK2_PATH;
    try {
      expect(resolveBuck2()).toBe('buck2');
    } finally {
      if (original === undefined) {
        delete process.env.BUCK2_PATH;
      } else {
        process.env.BUCK2_PATH = original;
      }
    }
  });
});

describe('resolveNumThreads', () => {
  beforeEach(() => {
    vi.mocked(os.cpus).mockReturnValue(
      Array.from({ length: 8 }, () => ({}) as os.CpuInfo),
    );
  });

  it('uses os.cpus().length', () => {
    expect(resolveNumThreads()).toBe(8);
  });

  it('falls back to 1 when os.cpus() is empty', () => {
    vi.mocked(os.cpus).mockReturnValue([]);
    expect(resolveNumThreads()).toBe(1);
  });
});

describe('appendNumThreads', () => {
  it('inserts --num-threads after the subcommand', () => {
    const result = appendNumThreads(['build', '//pkg:target']);
    expect(result[0]).toBe('build');
    expect(result[1]).toBe('--num-threads');
    expect(result[2]).toBe(String(resolveNumThreads()));
    expect(result[3]).toBe('//pkg:target');
  });

  it('does not duplicate when --num-threads is already present', () => {
    const args = ['build', '--num-threads', '8', '//pkg:target'];
    expect(appendNumThreads(args)).toBe(args);
  });
});

describe('runBuck2', () => {
  const originalBuck2Path = process.env.BUCK2_PATH;

  beforeEach(() => {
    mockExec.mockReset();
    mockExec.mockResolvedValue({ exitCode: 0 });
    delete process.env.BUCK2_PATH;
  });

  afterEach(() => {
    if (originalBuck2Path === undefined) {
      delete process.env.BUCK2_PATH;
    } else {
      process.env.BUCK2_PATH = originalBuck2Path;
    }
  });

  it('invokes zx with buck2, num-threads, and cwd', async () => {
    const exitCode = await runBuck2(['build', '//pkg:target'], {
      cwd: '/workspace',
      env: { BUCK2_MODIFIER: 'release' },
    });

    expect(exitCode).toBe(0);
    const [opts, , exprs] = mockExec.mock.calls[0] as [
      Record<string, unknown>,
      TemplateStringsArray,
      unknown[],
    ];
    expect(opts).toMatchObject({
      cwd: '/workspace',
      env: { BUCK2_MODIFIER: 'release' },
      stdio: 'inherit',
      nothrow: true,
    });
    expect(exprs[0]).toBe('buck2');
    expect(exprs[1]).toEqual([
      'build',
      '--num-threads',
      String(resolveNumThreads()),
      '//pkg:target',
    ]);
  });

  it('uses BUCK2_PATH when set', async () => {
    process.env.BUCK2_PATH = '/custom/buck2';
    await runBuck2(['test', '//pkg:test'], { cwd: '/workspace' });
    const [, , exprs] = mockExec.mock.calls[0] as [unknown, unknown, unknown[]];
    expect(exprs[0]).toBe('/custom/buck2');
    expect(exprs[1]).toEqual([
      'test',
      '--num-threads',
      String(resolveNumThreads()),
      '//pkg:test',
    ]);
  });

  it('returns non-zero exit codes from zx', async () => {
    mockExec.mockResolvedValue({ exitCode: 3 });
    const exitCode = await runBuck2(['test', '//pkg:test'], {
      cwd: '/workspace',
    });
    expect(exitCode).toBe(3);
  });

  it('pins RUSTUP_HOME/CARGO_HOME from the real HOME when the caller overrides HOME', async () => {
    const originalHome = process.env.HOME;
    process.env.HOME = '/Users/real';
    try {
      await runBuck2(['build', '//pkg:target'], {
        cwd: '/workspace',
        env: { HOME: '/tmp/buck2-tmphome' },
      });
      const [opts] = mockExec.mock.calls[0] as [Record<string, unknown>];
      expect(opts.env).toMatchObject({
        HOME: '/tmp/buck2-tmphome',
        RUSTUP_HOME: '/Users/real/.rustup',
        CARGO_HOME: '/Users/real/.cargo',
      });
    } finally {
      process.env.HOME = originalHome;
    }
  });

  it('leaves an explicitly-set RUSTUP_HOME/CARGO_HOME untouched', async () => {
    const originalHome = process.env.HOME;
    process.env.HOME = '/Users/real';
    try {
      await runBuck2(['build', '//pkg:target'], {
        cwd: '/workspace',
        env: {
          HOME: '/tmp/buck2-tmphome',
          RUSTUP_HOME: '/ci/.rustup',
          CARGO_HOME: '/ci/.cargo',
        },
      });
      const [opts] = mockExec.mock.calls[0] as [Record<string, unknown>];
      expect(opts.env).toMatchObject({
        RUSTUP_HOME: '/ci/.rustup',
        CARGO_HOME: '/ci/.cargo',
      });
    } finally {
      process.env.HOME = originalHome;
    }
  });

  it('does not touch env when HOME is not overridden', async () => {
    await runBuck2(['build', '//pkg:target'], {
      cwd: '/workspace',
      env: { BUCK2_MODIFIER: 'release' },
    });
    const [opts] = mockExec.mock.calls[0] as [Record<string, unknown>];
    expect(opts.env).toEqual({ BUCK2_MODIFIER: 'release' });
  });
});
