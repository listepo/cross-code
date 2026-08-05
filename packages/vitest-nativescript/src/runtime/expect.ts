import * as chaiModule from 'chai';
import * as vitestExpectModule from '@vitest/expect';

type ChaiPlugin = (chai: unknown, utils: unknown) => void;

interface ChaiRuntime {
  config: { useProxy: boolean };
  use(plugin: ChaiPlugin): void;
  expect: NativeScriptExpect & {
    extend(expect: unknown, matchers: Record<string, unknown>): void;
  };
}

interface VitestExpectRuntime {
  JestChaiExpect: ChaiPlugin;
  JestAsymmetricMatchers: ChaiPlugin;
  JestExtend: ChaiPlugin;
  GLOBAL_EXPECT: symbol;
  JEST_MATCHERS_OBJECT: symbol;
  ASYMMETRIC_MATCHERS_OBJECT: symbol;
  getState(expect: unknown): Record<string, unknown>;
  setState(state: Record<string, unknown>, expect: unknown): void;
}

export interface NativeScriptExpect {
  (actual: unknown, message?: string): unknown;
  getState(): Record<string, unknown>;
  setState(state: Record<string, unknown>): void;
  extend(matchers: Record<string, unknown>): void;
  [key: string]: unknown;
}

const chai = chaiModule as unknown as ChaiRuntime;
const vitestExpect = vitestExpectModule as unknown as VitestExpectRuntime;
let currentExpect: NativeScriptExpect | undefined;

export function setupNativeScriptExpect(): NativeScriptExpect {
  if (currentExpect) return currentExpect;

  const symbolGlobals = globalThis as unknown as Record<symbol, unknown>;
  if (!symbolGlobals[vitestExpect.JEST_MATCHERS_OBJECT]) {
    symbolGlobals[vitestExpect.JEST_MATCHERS_OBJECT] = {
      matchers: {},
      state: new WeakMap<object, unknown>(),
    };
  }
  if (!symbolGlobals[vitestExpect.ASYMMETRIC_MATCHERS_OBJECT]) {
    symbolGlobals[vitestExpect.ASYMMETRIC_MATCHERS_OBJECT] = {};
  }

  chai.config.useProxy = false;
  chai.use(vitestExpect.JestChaiExpect);
  chai.use(vitestExpect.JestAsymmetricMatchers);
  chai.use(vitestExpect.JestExtend);

  const expect = ((actual: unknown, message?: string): unknown => {
    const state = vitestExpect.getState(expect);
    const assertionCalls = Number(state.assertionCalls ?? 0);
    vitestExpect.setState({ assertionCalls: assertionCalls + 1 }, expect);
    return chai.expect(actual, message);
  }) as NativeScriptExpect;

  Object.assign(expect, chai.expect);
  Object.assign(
    expect,
    symbolGlobals[vitestExpect.ASYMMETRIC_MATCHERS_OBJECT] as object,
  );
  expect.getState = () => vitestExpect.getState(expect);
  expect.setState = (state) => vitestExpect.setState(state, expect);
  expect.extend = (matchers) => chai.expect.extend(expect, matchers);
  vitestExpect.setState(
    {
      assertionCalls: 0,
      isExpectingAssertions: false,
      isExpectingAssertionsError: null,
      expectedAssertionsNumber: null,
      expectedAssertionsNumberErrorGen: null,
    },
    expect,
  );

  symbolGlobals[vitestExpect.GLOBAL_EXPECT] = expect;
  (globalThis as unknown as { expect?: NativeScriptExpect }).expect = expect;
  currentExpect = expect;
  return expect;
}

export function getNativeScriptExpect(): NativeScriptExpect {
  return currentExpect ?? setupNativeScriptExpect();
}
