import { glob, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Reporter, TestFileResult, TestResult } from '@rstest/core';
import type { NativeScriptTestEvent } from '../protocol.js';
import type {
  NativeScriptRstestOptions,
  ResolvedNativeScriptRstestOptions,
} from './options.js';
import { resolveNativeScriptRstestOptions } from './options.js';
import { NativeScriptConsoleReporter } from './reporter.js';
import { NativeScriptRstestSession } from './session.js';

export interface NativeScriptRunSummary {
  /** Process exit code: 0 when every test passed and no worker failed. */
  exitCode: number;
  files: TestFileResult[];
  tests: TestResult[];
  errors: string[];
}

/** Istanbul's per-file counters, as the device's `__coverage__` global holds them. */
type CoverageMap = Record<string, Record<string, unknown>>;

async function findTestFiles(
  options: ResolvedNativeScriptRstestOptions,
): Promise<string[]> {
  const files: string[] = [];
  for await (const match of glob(options.include, { cwd: options.appPath })) {
    files.push(resolve(options.appPath, match));
  }
  return [...new Set(files)].sort();
}

/** Round-robin so every device worker slot gets work as early as possible. */
function assignSlots(files: string[], workers: number): string[][] {
  const slots: string[][] = Array.from({ length: workers }, () => []);
  files.forEach((file, index) => slots[index % workers].push(file));
  return slots;
}

/**
 * Sum Istanbul counters across worker slots. Slots instrument the same bundle,
 * so their maps overlap and the numeric arrays/records have to be added rather
 * than overwritten.
 */
function mergeCoverage(target: CoverageMap, source: CoverageMap): CoverageMap {
  for (const [file, coverage] of Object.entries(source)) {
    const existing = target[file];
    if (!existing) {
      target[file] = coverage;
      continue;
    }
    for (const key of ['s', 'f'] as const) {
      const left = existing[key] as Record<string, number> | undefined;
      const right = coverage[key] as Record<string, number> | undefined;
      if (!left || !right) continue;
      for (const [id, hits] of Object.entries(right)) {
        left[id] = (left[id] ?? 0) + hits;
      }
    }
    const leftBranches = existing.b as Record<string, number[]> | undefined;
    const rightBranches = coverage.b as Record<string, number[]> | undefined;
    if (leftBranches && rightBranches) {
      for (const [id, hits] of Object.entries(rightBranches)) {
        const left = leftBranches[id];
        if (!left) {
          leftBranches[id] = hits;
          continue;
        }
        hits.forEach((count, index) => {
          left[index] = (left[index] ?? 0) + count;
        });
      }
    }
  }
  return target;
}

/**
 * Build, launch and drive a NativeScript device run, then report through
 * Rstest's `Reporter` interface. Resolves once the device has finished; the
 * caller owns `process.exitCode`.
 */
export async function runNativeScriptTests(
  userOptions: NativeScriptRstestOptions,
): Promise<NativeScriptRunSummary> {
  const options = resolveNativeScriptRstestOptions(userOptions);
  const reporters: Reporter[] = userOptions.reporters ?? [
    new NativeScriptConsoleReporter(options.appPath),
  ];

  const files = await findTestFiles(options);
  if (files.length === 0) {
    throw new Error(
      `No NativeScript test files matched ${options.include.join(', ')} in ${options.appPath}`,
    );
  }

  const workers = Math.min(options.workers, files.length);
  const assignments = assignSlots(files, workers);
  const session = new NativeScriptRstestSession({ ...options, workers });

  const fileResults: TestFileResult[] = [];
  const testResults: TestResult[] = [];
  const errors: string[] = [];
  const coverage: CoverageMap = {};
  const pending = new Set(assignments.map((_, slot) => slot));
  let settle: () => void = () => undefined;
  const finished = new Promise<void>((onFinished) => {
    settle = onFinished;
  });

  type ReporterHook = {
    [Method in keyof Reporter]-?: NonNullable<Reporter[Method]> extends (
      ...args: infer Args
    ) => unknown
      ? { method: Method; args: Args }
      : never;
  }[keyof Reporter];

  const notify = <Hook extends ReporterHook>(
    method: Hook['method'],
    ...args: Hook['args']
  ): void => {
    for (const reporter of reporters) {
      const handler = reporter[method] as
        | ((...handlerArgs: unknown[]) => unknown)
        | undefined;
      void handler?.apply(reporter, args);
    }
  };

  const onEvent = (event: NativeScriptTestEvent): void => {
    switch (event.type) {
      case 'file-start':
        notify('onTestFileStart', {
          testId: event.testPath,
          testPath: event.testPath,
          project: 'nativescript',
          tests: [],
        });
        return;
      case 'case-start':
        notify('onTestCaseStart', event.test);
        return;
      case 'case-result':
        testResults.push(event.result);
        notify('onTestCaseResult', event.result);
        return;
      case 'file-result':
        fileResults.push(event.result);
        notify('onTestFileResult', event.result);
        return;
      case 'worker-error':
        errors.push(event.message);
        return;
      case 'run-finished':
        if (event.coverage) mergeCoverage(coverage, event.coverage as CoverageMap);
        pending.delete(event.worker);
        if (pending.size === 0) settle();
        return;
      default:
        return;
    }
  };

  const startedAt = Date.now();
  notify('onTestRunStart');

  session.onEvent((_slot, event) => onEvent(event));

  try {
    await session.start();
    await session.waitForDevice();
    session.configure(options.appPath, options.runtime);
    await Promise.all(
      assignments.map((_, slot) => session.waitForWorker(slot)),
    );
    assignments.forEach((slotFiles, slot) => session.run(slot, slotFiles));
    // A crashed device never sends `run-finished`, so let a session failure
    // (socket drop, CLI exit) end the wait instead of hanging the host.
    await Promise.race([finished, session.whenFailed()]);
  } finally {
    await session.close();
  }

  if (options.coverage.enabled && Object.keys(coverage).length > 0) {
    const output = join(
      options.appPath,
      options.coverage.reportsDirectory,
      'coverage-final.json',
    );
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(coverage), 'utf8');
  }

  const duration = Date.now() - startedAt;
  notify('onTestRunEnd', {
    results: fileResults,
    testResults,
    duration: { totalTime: duration, buildTime: 0, testTime: duration },
    getSourcemap: async () => null,
    snapshotSummary: {
      added: 0,
      didUpdate: false,
      failure: false,
      filesAdded: 0,
      filesRemoved: 0,
      filesRemovedList: [],
      filesUnmatched: 0,
      filesUpdated: 0,
      matched: 0,
      total: 0,
      unchecked: 0,
      uncheckedKeysByFile: [],
      unmatched: 0,
      updated: 0,
    },
  });

  const failed =
    errors.length > 0 ||
    fileResults.some((file) => file.status === 'fail') ||
    testResults.some((test) => test.status === 'fail');

  for (const error of errors) process.stderr.write(`${error}\n`);

  return {
    exitCode: failed ? 1 : 0,
    files: fileResults,
    tests: testResults,
    errors,
  };
}
