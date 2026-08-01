import { Observable } from '@nativescript/core'
import { Wasm3Runtime } from '@org/nativescript-wasm3'

import {
  createHostImports,
  runFixtureChecks,
  runGlobalsChecks,
  summarize,
  type Check,
  type HostCall,
} from './wasm/fixture-suite'
import { appWasmPath, FIXTURE_WASM, GLOBALS_WASM } from './wasm/wasm-assets'

/**
 * Runs the fixture suite on the device's wasm3 runtime. The checks themselves
 * live in `wasm/fixture-suite.ts`, which the vitest specs run against Node's
 * WebAssembly engine — same expectations, two engines.
 */
export class WasmDemoModel extends Observable {
  private _status: string
  private _report: string

  constructor() {
    super()

    this._status = 'Tap RUN to execute the fixture suite'
    this._report = ''
  }

  get status(): string {
    return this._status
  }

  set status(value: string) {
    if (this._status !== value) {
      this._status = value
      this.notifyPropertyChange('status', value)
    }
  }

  get report(): string {
    return this._report
  }

  set report(value: string) {
    if (this._report !== value) {
      this._report = value
      this.notifyPropertyChange('report', value)
    }
  }

  onRun() {
    try {
      const version = Wasm3Runtime.version()
      const checks = [...this.runFixture(), ...this.runGlobals()]
      const summary = summarize(checks)

      this.status =
        summary.failed === 0
          ? `wasm3 ${version} — ${summary.passed}/${summary.total} checks passed`
          : `wasm3 ${version} — ${summary.failed} of ${summary.total} checks FAILED`
      this.report = checks.map(formatCheck).join('\n')
    } catch (error) {
      this.status = 'Failed'
      this.report = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    }
  }

  private runFixture(): Check[] {
    const runtime = new Wasm3Runtime()
    try {
      const log: HostCall[] = []
      const module = runtime.loadModule(appWasmPath(FIXTURE_WASM), createHostImports(log))
      return runFixtureChecks(module, log)
    } finally {
      runtime.dispose()
    }
  }

  private runGlobals(): Check[] {
    const runtime = new Wasm3Runtime()
    try {
      return runGlobalsChecks(runtime.loadModule(appWasmPath(GLOBALS_WASM)))
    } finally {
      runtime.dispose()
    }
  }
}

function formatCheck(check: Check): string {
  return check.ok
    ? `✓ ${check.name}`
    : `✗ ${check.name} — expected ${check.expected}, got ${check.actual}`
}
