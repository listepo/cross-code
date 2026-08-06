import { Observable } from '@nativescript/core';
import { WamrExecutionTier, WamrRuntime } from '@cross-code/ns-wamr';
import { Wasm3Runtime } from '@cross-code/ns-wasm3';
import { WasmKitRuntime } from '@cross-code/ns-wasm-kit-runtime';
import { EndiveRuntime } from '@cross-code/ns-endive';
import { WasmEdgeRuntime } from '@cross-code/ns-wasm-edge';
import { ChicoryRuntime } from '@cross-code/ns-wasm-chicory';

import {
  createHostImports,
  runFixtureChecks,
  runGlobalsChecks,
  summarize,
  type Check,
  type HostCall,
  type HostImports,
  type WasmModuleLike,
} from './wasm/fixture-suite';
import { appWasmPath, FIXTURE_WASM, GLOBALS_WASM } from './wasm/wasm-assets';

/**
 * Runs the fixture suite on both of the device's runtimes — wasm3 and WAMR —
 * so the demo page shows the same module behaving identically on each. The
 * checks themselves live in `wasm/fixture-suite.ts`; the Vitest specs in
 * `app/tests/wasm3/` and `app/tests/wamr/` assert on the same list under
 * the `vitest-ns` worker.
 *
 * WAMR runs on its Interpreter tier here, the one tier available in every
 * build; the specs cover Fast JIT, LLVM JIT and AOT where they are compiled in.
 */
export class WasmDemoModel extends Observable {
  private _status: string;
  private _report: string;

  constructor() {
    super();

    this._status = 'Tap RUN to execute the fixture suite';
    this._report = '';
  }

  get status(): string {
    return this._status;
  }

  set status(value: string) {
    if (this._status !== value) {
      this._status = value;
      this.notifyPropertyChange('status', value);
    }
  }

  get report(): string {
    return this._report;
  }

  set report(value: string) {
    if (this._report !== value) {
      this._report = value;
      this.notifyPropertyChange('report', value);
    }
  }

  onRun() {
    const sections = [runWasm3(), runWamr(), runWasmEdge()];
    // WasmKit is Swift-native — only include it on iOS.
    if ((globalThis as any).isIOS) {
      sections.push(runWasmKit());
    }
    // Endive is Java-native — only include it on Android.
    if ((globalThis as any).isAndroid) {
      sections.push(runEndive());
      // Chicory is also pure-Java, Android-only.
      sections.push(runChicory());
    }
    const checks = sections.flatMap((s) => s.checks);
    const summary = summarize(checks);

    this.status =
      summary.failed === 0
        ? `${summary.passed}/${summary.total} checks passed on all runtimes`
        : `${summary.failed} of ${summary.total} checks FAILED`;
    this.report = sections
      .map((s) => [s.title, ...s.checks.map(formatCheck)].join('\n'))
      .join('\n\n');
  }
}

interface Section {
  title: string;
  checks: Check[];
}

/**
 * What the demo needs of a runtime to load the fixtures. `Wasm3Runtime` and
 * `WamrRuntime` both satisfy it — the same trick `fixture-suite.ts` uses to
 * stay runtime-agnostic.
 */
interface LoaderLike {
  loadModule(source: string, imports?: HostImports): WasmModuleLike;
  dispose(): void;
}

/**
 * Runs both fixture modules on one runtime. Each section is guarded on its own
 * so a runtime whose native layer is missing reports as a failure instead of
 * hiding the other runtime's results.
 */
function runSection(
  label: string,
  version: () => string,
  create: () => LoaderLike,
): Section {
  let title = label;
  const checks: Check[] = [];

  try {
    title = `── ${label} ${version()} ──`;

    const fixture = create();
    try {
      const log: HostCall[] = [];
      const module = fixture.loadModule(
        appWasmPath(FIXTURE_WASM),
        createHostImports(log),
      );
      checks.push(...runFixtureChecks(module, log));
    } finally {
      fixture.dispose();
    }

    const globals = create();
    try {
      checks.push(
        ...runGlobalsChecks(globals.loadModule(appWasmPath(GLOBALS_WASM))),
      );
    } finally {
      globals.dispose();
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);
    checks.push({
      name: `${label} runtime`,
      expected: 'ran',
      actual: message,
      ok: false,
    });
  }

  return { title, checks };
}

function runWasm3(): Section {
  return runSection(
    'wasm3',
    () => Wasm3Runtime.version(),
    () => new Wasm3Runtime(),
  );
}

function runWasmEdge(): Section {
  return runSection(
    'WasmEdge',
    () => WasmEdgeRuntime.version(),
    () => new WasmEdgeRuntime(),
  );
}

function runWasmKit(): Section {
  return runSection(
    'WasmKit',
    () => WasmKitRuntime.version(),
    () => new WasmKitRuntime(),
  );
}

function runEndive(): Section {
  return runSection(
    'Endive',
    () => EndiveRuntime.version(),
    () => new EndiveRuntime(),
  );
}

function runChicory(): Section {
  return runSection(
    'Chicory',
    () => ChicoryRuntime.version(),
    () => new ChicoryRuntime(),
  );
}

function runWamr(): Section {
  return runSection(
    `WAMR (${WamrExecutionTier[WamrExecutionTier.Interpreter]})`,
    () => WamrRuntime.version(),
    () =>
      new WamrRuntime({
        stackSizeInBytes: 128 * 1024,
        wasiEnabled: false,
        executionTier: WamrExecutionTier.Interpreter,
      }),
  );
}

function formatCheck(check: Check): string {
  return check.ok
    ? `✓ ${check.name}`
    : `✗ ${check.name} — expected ${check.expected}, got ${check.actual}`;
}
