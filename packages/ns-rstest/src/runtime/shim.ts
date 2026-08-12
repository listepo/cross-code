import { RSTEST_API_GLOBAL_KEY } from '@rstest/core/internal/browser-runtime';
// Type-only: the shim must not pull the runtime into every test file's graph.
import type { createRstestRuntime } from '@rstest/core/internal/browser-runtime';

/** Rstest declares its API type internally; recover it from the runtime. */
export type RstestApi = Awaited<ReturnType<typeof createRstestRuntime>>['api'];

/**
 * Rstest builds a fresh API object for every test file, publishing it on
 * `globalThis['@rstest/core']` (`@rstest/browser` keeps user imports external
 * against the same global). A bundled NativeScript worker resolves each import
 * once and caches it, so every export here forwards to the *current* runtime
 * instead of capturing the first one.
 */
function api(): RstestApi {
  const value = (globalThis as Record<string, unknown>)[RSTEST_API_GLOBAL_KEY];
  if (!value) {
    throw new Error(
      'The Rstest API is only available while a NativeScript Rstest run is active.',
    );
  }
  return value as RstestApi;
}

function forward<Key extends keyof RstestApi>(key: Key): RstestApi[Key] {
  const target = function rstestApiForwarder(): void {
    /* every operation is answered by the traps below */
  };
  return new Proxy(target, {
    apply: (_target, thisArgument, argumentList) =>
      Reflect.apply(
        api()[key] as (...args: unknown[]) => unknown,
        thisArgument,
        argumentList,
      ),
    get: (_target, property) =>
      (api()[key] as unknown as Record<PropertyKey, unknown>)[property],
    has: (_target, property) => property in (api()[key] as unknown as object),
  }) as unknown as RstestApi[Key];
}

export const describe: RstestApi['describe'] = forward('describe');
export const it: RstestApi['it'] = forward('it');
export const test: RstestApi['test'] = forward('test');
export const beforeAll: RstestApi['beforeAll'] = forward('beforeAll');
export const afterAll: RstestApi['afterAll'] = forward('afterAll');
export const beforeEach: RstestApi['beforeEach'] = forward('beforeEach');
export const afterEach: RstestApi['afterEach'] = forward('afterEach');
export const onTestFailed: RstestApi['onTestFailed'] = forward('onTestFailed');
export const onTestFinished: RstestApi['onTestFinished'] =
  forward('onTestFinished');
export const expect: RstestApi['expect'] = forward('expect');
export const assert: RstestApi['assert'] = forward('assert');
export const rstest: RstestApi['rstest'] = forward('rstest');
export const rs: RstestApi['rs'] = forward('rs');
