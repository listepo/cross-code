import { relative } from 'node:path';
import type { Reporter, TestFileResult, TestResult } from '@rstest/core';

const GREEN = '\u001B[32m';
const RED = '\u001B[31m';
const YELLOW = '\u001B[33m';
const DIM = '\u001B[2m';
const RESET = '\u001B[0m';

function paint(code: string, text: string): string {
  return process.stdout.isTTY ? `${code}${text}${RESET}` : text;
}

function statusMark(status: TestResult['status']): string {
  switch (status) {
    case 'pass':
      return paint(GREEN, '✓');
    case 'fail':
      return paint(RED, '✗');
    default:
      return paint(YELLOW, '○');
  }
}

function fullName(result: TestResult): string {
  return [...(result.parentNames ?? []), result.name].join(' > ');
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}

/**
 * Console output for a device run. Rstest's own reporters are built for its
 * node/browser pools, so ns-rstest ships this one as the default; any reporter
 * implementing Rstest's public `Reporter` interface can replace it.
 */
export class NativeScriptConsoleReporter implements Reporter {
  private readonly failures: TestResult[] = [];
  private started = 0;

  constructor(private readonly rootPath: string) {}

  onTestRunStart(): void {
    this.started = Date.now();
  }

  onTestFileResult(file: TestFileResult): void {
    const path = relative(this.rootPath, file.testPath) || file.testPath;
    const duration =
      file.duration === undefined
        ? ''
        : paint(DIM, ` ${Math.round(file.duration)}ms`);
    this.write(
      `${statusMark(file.status)} ${path} ${paint(
        DIM,
        `(${file.results.length})`,
      )}${duration}`,
    );
    this.failures.push(
      ...file.results.filter((result) => result.status === 'fail'),
    );
  }

  onTestRunEnd({
    results,
    testResults,
  }: {
    results: TestFileResult[];
    testResults: TestResult[];
  }): void {
    for (const failure of this.failures) {
      const path =
        relative(this.rootPath, failure.testPath) || failure.testPath;
      this.write('');
      this.write(paint(RED, `FAIL ${fullName(failure)}`));
      this.write(`  ${path}`);
      for (const error of failure.errors ?? []) {
        this.write(`  ${error.message}`);
        if (error.stack) this.write(paint(DIM, indent(error.stack)));
      }
    }

    const passed = testResults.filter(
      (result) => result.status === 'pass',
    ).length;
    const failed = testResults.filter(
      (result) => result.status === 'fail',
    ).length;
    const skipped = testResults.length - passed - failed;
    const failedFiles = results.filter((file) => file.status === 'fail').length;
    const seconds = ((Date.now() - this.started) / 1000).toFixed(2);

    this.write('');
    this.write(` Test files  ${results.length} (${failedFiles} failed)`);
    this.write(
      `      Tests  ${paint(GREEN, `${passed} passed`)}  ${paint(
        failed > 0 ? RED : DIM,
        `${failed} failed`,
      )}  ${paint(DIM, `${skipped} skipped`)}`,
    );
    this.write(`   Duration  ${seconds}s`);
  }

  private write(line: string): void {
    process.stdout.write(`${line}\n`);
  }
}
