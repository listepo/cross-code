import { afterEach, describe, expect, it } from 'vitest';

import type { JavaNumberBox } from '@cross-code/ns-wasm-core';
import { WamrError } from './wire.js';
import { WamrExecutionTier, WamrRuntime } from './wamr.js';

// These specs exercise the platform adapters against fakes that mimic the
// JS-visible shape of the native APIs (the NativeScript runtimes marshal the
// real classes into exactly these shapes). The native implementations
// themselves are covered by the Swift (XCTest) and Kotlin (JUnit) suites.

/** A value as it crosses the native wire: i32/f32/f64 numbers, i64 strings. */
type WireVal = number | string;

/** A host import as the fakes hand it back to the adapter. */
interface FakeHostImport {
  invoke(args: unknown): unknown;
}

/** What each fake records for the assertions to read back. */
interface FakeState {
  memory: Uint8Array;
  hostFns: Map<string, FakeHostImport>;
  lastCall?: { name: string; args: WireVal[] };
  lastSetGlobal?: { name: string; value: unknown };
  lastWrite?: { offset: number; data: unknown };
  stackSize?: number;
  wasiEnabled?: boolean;
  executionTier?: number | string;
  loadedBytes?: unknown;
  loadedPath?: string;
  closed: boolean;
}

/**
 * The fakes stand in for classes the NativeScript bridge installs, so they
 * match the declared shape structurally but not nominally — one cast per
 * global, at the assignment, keeps the rest of the file typed.
 */
function installGlobal(name: string, value: unknown): void {
  (globalThis as Record<string, unknown>)[name] = value;
}

afterEach(() => {
  for (const name of [
    'NSCWamrRuntime',
    'NSCWamrHostCallback',
    'NSMutableArray',
    'interop',
    'org',
    'java',
  ]) {
    delete (globalThis as Record<string, unknown>)[name];
  }
});

// ------------------------------------------------------------------ fakes

/** Fake of the Kotlin NSCWamr* classes as seen from JS on Android. */
function installAndroidFake() {
  const state: FakeState = {
    memory: new Uint8Array(64 * 1024),
    hostFns: new Map<string, FakeHostImport>(),
    lastCall: undefined,
    closed: false,
  };

  // --- java.lang fakes (exercises toJavaWireValue / normalizeAndroidValue) ---

  class JavaNumber {
    constructor(protected readonly val: number) {}
    doubleValue(): number {
      return this.val;
    }
  }

  class JavaDouble extends JavaNumber {
    // @ts-ignore TS4114
    static valueOf(n: number): JavaDouble {
      return new JavaDouble(n);
    }
  }

  class JavaLong extends JavaNumber {
    constructor(val: number | bigint) {
      super(Number(val));
    }
    override toString(): string {
      return String(BigInt(this.val));
    }
  }

  class JavaInteger extends JavaNumber {}

  installGlobal('java', {
    lang: {
      Number: JavaNumber,
      Double: JavaDouble,
      Long: JavaLong,
      Integer: JavaInteger,
    },
  });

  // --- WAMR fakes ---

  class FakeFunction {
    constructor(
      private name: string,
      private params: string[],
      private returns: string[],
      private impl: (args: WireVal[]) => WireVal[],
    ) {}
    getName = () => this.name;
    getParamTypes = () => this.params;
    getReturnTypes = () => this.returns;
    call = (args: WireVal[]) => {
      state.lastCall = { name: this.name, args: [...args] };
      return this.impl(args);
    };
  }

  const functions: Record<string, FakeFunction> = {
    add_i64: new FakeFunction('add_i64', ['i64', 'i64'], ['i64'], (a) =>
      [(BigInt(a[0]) + BigInt(a[1])).toString()],
    ),
    swap: new FakeFunction('swap', ['i32', 'i32'], ['i32', 'i32'], (a) => [a[1], a[0]]),
    call_host_add: new FakeFunction('call_host_add', ['i32', 'i32'], ['i32'], (a) => {
      const hostFn = state.hostFns.get('env.host_add');
      if (!hostFn) throw new Error('missing imported function: env.host_add');
      return [hostFn.invoke([a[0], a[1]]) as WireVal];
    }),
    log_i64: new FakeFunction('log_i64', ['i64'], [], (a) => {
      state.hostFns.get('env.host_log_i64')?.invoke([a[0]]);
      return [];
    }),
  };

  class FakeModule {
    getName = () => 'fake.wasm';
    linkHostFunction = (mod: string, name: string, _sig: string, fn: FakeHostImport) => {
      state.hostFns.set(`${mod}.${name}`, fn);
    };
    getGlobal = (name: string) => {
      if (name === 'g_big') return '72623859790382856';
      if (name === 'g_pi') return Math.PI;
      throw new Error(`org.nativescript.wamr.NSCWamrException: global not found: ${name}`);
    };
    setGlobal = (name: string, value: unknown) => {
      state.lastSetGlobal = { name, value };
    };
  }

  class FakeRuntime {
    constructor(public stackSize: number, wasiEnabled: number, public executionTier: number) {
      state.stackSize = stackSize;
      state.wasiEnabled = wasiEnabled !== 0;
      state.executionTier = executionTier;
    }
    loadModule = (bytes: unknown) => {
      state.loadedBytes = bytes;
      return new FakeModule();
    };
    loadModuleFromFile = (path: string) => {
      state.loadedPath = path;
      return new FakeModule();
    };
    findFunction = (name: string) => {
      const fn = functions[name];
      if (!fn) {
        throw new Error(
          `org.nativescript.wamr.NSCWamrException: function lookup failed: ${name}`,
        );
      }
      return fn;
    };
    memorySize = () => state.memory.length;
    readMemory = (offset: number, length: number) => {
      const view: Uint8Array = state.memory.subarray(offset, offset + length);
      return Array.from(view, (v) => (v > 127 ? v - 256 : v));
    };
    writeMemory = (offset: number, bytes: ArrayLike<number>) => {
      for (let i = 0; i < bytes.length; i++) {
        state.memory[offset + i] = (Number(bytes[i]) + 256) & 0xff;
      }
    };
    close = () => {
      state.closed = true;
    };
    static wamrVersion = () => '2.1.0';
  }

  class FakeHostFunction {
    constructor(impl: FakeHostImport) {
      Object.assign(this, impl);
    }
  }

  installGlobal('org', {
    nativescript: {
      wamr: { NSCWamrRuntime: FakeRuntime, NSCWamrHostFunction: FakeHostFunction },
    },
  });
  return state;
}

/** NSArray as surfaced by the NativeScript iOS runtime. */
function nsArray(items: readonly unknown[]) {
  return { count: items.length, objectAtIndex: (i: number) => items[i] };
}

/**
 * How a throwing Swift method fails on iOS: the bridge does not raise, it
 * returns null and fills in the NSError reference the caller appended to the
 * arguments. A caller that passes no reference sees only the null.
 */
function iosFailure(errorRef: { value?: unknown } | undefined, message: string): null {
  if (errorRef) errorRef.value = { localizedDescription: message };
  return null;
}

/** Fake of the Swift NSCWamr* classes as seen from JS on iOS. */
function installIosFake() {
  const state: FakeState = {
    memory: new Uint8Array(0),
    hostFns: new Map<string, FakeHostImport>(),
    closed: false,
  };

  const addI64 = {
    name: 'add_i64',
    paramTypes: nsArray(['i64', 'i64']),
    returnTypes: nsArray(['i64']),
    callWithArgumentsError: (args: WireVal[]) => {
      state.lastCall = { name: 'add_i64', args: [...args] };
      return nsArray([(BigInt(args[0]) + BigInt(args[1])).toString()]);
    },
  };

  const callHostAdd = {
    name: 'call_host_add',
    paramTypes: nsArray(['i32', 'i32']),
    returnTypes: nsArray(['i32']),
    callWithArgumentsError: (args: WireVal[], errorRef?: { value?: unknown }) => {
      const hostFn = state.hostFns.get('env.host_add');
      if (!hostFn) return iosFailure(errorRef, "missing imported function: 'env.host_add'");
      const results = hostFn.invoke(nsArray([args[0], args[1]])) as
        | { objectAtIndex?(i: number): unknown }
        | undefined;
      if (typeof results?.objectAtIndex !== 'function') return undefined;
      return nsArray([results.objectAtIndex(0)]);
    },
  };

  const module = {
    name: 'fake.wasm',
    linkHostFunctionNameSignatureCallbackError: (
      mod: string,
      name: string,
      _sig: string,
      cb: FakeHostImport,
    ) => {
      state.hostFns.set(`${mod}.${name}`, cb);
    },
    getGlobalError: (name: string, errorRef?: { value?: unknown }) => {
      if (name === 'g_big') return '72623859790382856';
      return iosFailure(errorRef, `global not found: ${name}`);
    },
    setGlobalValueError: (name: string, value: unknown) => {
      state.lastSetGlobal = { name, value };
    },
  };

  const runtime = {
    memorySize: 65536,
    loadModuleError: (bytes: unknown) => {
      state.loadedBytes = bytes;
      return module;
    },
    loadModuleFromFileError: (path: string) => {
      state.loadedPath = path;
      return module;
    },
    findFunctionError: (name: string, errorRef?: { value?: unknown }) => {
      if (name === 'add_i64') return addI64;
      if (name === 'call_host_add') return callHostAdd;
      return iosFailure(errorRef, `function lookup failed: '${name}'`);
    },
    readMemoryAtOffsetLengthError: (offset: number, length: number) => ({
      kind: 'NSData',
      offset,
      length,
    }),
    writeMemoryAtOffsetDataError: (offset: number, data: unknown) => {
      state.lastWrite = { offset, data };
    },
  };

  installGlobal('NSCWamrRuntime', {
    alloc: () => ({
      initWithStackSizeWasiEnabledExecutionTier: (
        stackSize: number,
        wasi: boolean,
        tier: string,
      ) => ((state.stackSize = stackSize), (state.wasiEnabled = wasi), (state.executionTier = tier), runtime),
    }),
    wamrVersion: () => '2.1.0',
  });
  // Fake NSCWamrHostCallback mirroring NativeScript's .extend(): the ObjC
  // selector `invoke:` surfaces in JS as `invoke`, and only that key overrides
  // the native method.
  installGlobal('NSCWamrHostCallback', {
    extend(impl: Partial<FakeHostImport>) {
      return class {
        invoke(args: unknown): unknown {
          return typeof impl.invoke === 'function' ? impl.invoke.call(this, args) : null;
        }
      };
    },
  });
  installGlobal('NSMutableArray', {
    alloc: () => ({
      init: () => {
        const items: unknown[] = [];
        return {
          get count() {
            return items.length;
          },
          addObject: (value: unknown) => items.push(value),
          objectAtIndex: (i: number) => items[i],
        };
      },
    }),
  });
  installGlobal('interop', {
    Reference: class {
      value: unknown = null;
    },
    bufferFromData: (data: { offset: number; length: number }) =>
      new Uint8Array([data.offset, data.length]).buffer,
  });
  return state;
}

// ------------------------------------------------------------------ specs

describe('WamrRuntime (no native runtime)', () => {
  it('throws a descriptive error', () => {
    expect(() => new WamrRuntime()).toThrow(WamrError);
    expect(() => WamrRuntime.version()).toThrow(WamrError);
  });
});

describe('WamrRuntime on Android', () => {
  it('reports the WAMR version', () => {
    installAndroidFake();
    expect(WamrRuntime.version()).toBe('2.1.0');
  });

  it('creates the runtime with the requested stack size, WASI flag, and execution tier', () => {
    const state = installAndroidFake();
    new WamrRuntime({
      stackSizeInBytes: 256 * 1024,
      wasiEnabled: false,
      executionTier: WamrExecutionTier.FastJIT,
    });
    expect(state.stackSize).toBe(256 * 1024);
    expect(state.wasiEnabled).toBe(false);
    expect(state.executionTier).toBe(WamrExecutionTier.FastJIT);
  });

  it('defaults WASI to enabled and execution tier to interpreter', () => {
    const state = installAndroidFake();
    new WamrRuntime();
    expect(state.wasiEnabled).toBe(true);
    expect(state.executionTier).toBe(WamrExecutionTier.Interpreter);
  });

  it.each([
    ['Interpreter', WamrExecutionTier.Interpreter],
    ['FastJIT', WamrExecutionTier.FastJIT],
    ['LLVMJIT', WamrExecutionTier.LLVMJIT],
    ['AOT', WamrExecutionTier.AOT],
  ])('passes the %s execution tier to the native runtime', (_name, tier) => {
    const state = installAndroidFake();
    new WamrRuntime({ executionTier: tier });
    expect(state.executionTier).toBe(tier);
  });

  it('converts i64 args/results between bigint and wire strings', () => {
    const state = installAndroidFake();
    const runtime = new WamrRuntime();
    runtime.loadModule([0, 97, 115, 109]);

    const result = runtime.call('add_i64', 9007199254740993n, '2');
    expect(result).toBe(9007199254740995n);
    // bigint crossed the bridge as a decimal string
    expect(state.lastCall?.args).toEqual(['9007199254740993', '2']);
  });

  it('returns multi-value results as arrays', () => {
    installAndroidFake();
    const runtime = new WamrRuntime();
    runtime.loadModule([1]);
    expect(runtime.call('swap', 1, 2)).toEqual([2, 1]);
  });

  it('round-trips host imports with type conversion', () => {
    installAndroidFake();
    const runtime = new WamrRuntime();
    const module = runtime.loadModule([1]);

    const received: unknown[] = [];
    module.linkHostFunction('env', 'host_add', 'i(ii)', (args) => {
      received.push(...args);
      return [(args[0] as number) + (args[1] as number)];
    });
    expect(runtime.call('call_host_add', 3, 4)).toBe(7);
    expect(received).toEqual([3, 4]);
  });

  it('passes i64 host arguments as bigint per the signature', () => {
    installAndroidFake();
    const runtime = new WamrRuntime();
    const module = runtime.loadModule([1]);

    let logged: unknown;
    module.linkImports({
      env: { host_log_i64: { signature: 'v(I)', fn: (v) => void (logged = v) } },
    });
    runtime.call('log_i64', -1099511627776n);
    expect(logged).toBe(-1099511627776n);
  });

  it('reads and writes memory through java byte arrays', () => {
    const state = installAndroidFake();
    const runtime = new WamrRuntime();
    runtime.loadModule([1]);

    runtime.writeMemory(16, [0xde, 0xad, 0xbe, 0xef]);
    expect([...state.memory.subarray(16, 20)]).toEqual([0xde, 0xad, 0xbe, 0xef]);
    expect([...runtime.readMemory(16, 4)]).toEqual([0xde, 0xad, 0xbe, 0xef]);
    expect(runtime.memorySize).toBe(64 * 1024);
  });

  it('exposes globals with bigint conversion and strips exception prefixes', () => {
    installAndroidFake();
    const runtime = new WamrRuntime();
    const module = runtime.loadModule([1]);

    expect(module.getGlobal('g_big')).toBe(72623859790382856n);
    expect(module.getGlobal('g_pi')).toBe(Math.PI);
    expect(() => module.getGlobal('nope')).toThrow(/global not found: nope/);
    expect(() => module.getGlobal('nope')).not.toThrow(/NSCWamrException/);
  });

  it('disposes the native runtime', () => {
    const state = installAndroidFake();
    const runtime = new WamrRuntime();
    runtime.dispose();
    expect(state.closed).toBe(true);
  });

  it('boxes f64 args as java.lang.Double across the wire', () => {
    const state = installAndroidFake();
    const runtime = new WamrRuntime();
    const module = runtime.loadModule([1]);

    module.setGlobal('g_pi', Math.PI);

    const boxed = state.lastSetGlobal?.value as JavaNumberBox | undefined;
    expect(boxed).toBeInstanceOf(globalThis.java?.lang?.Double);
    expect(boxed?.doubleValue()).toBe(Math.PI);
  });

  it('unboxes java.lang.Number return values from host imports', () => {
    installAndroidFake();
    const runtime = new WamrRuntime();
    const module = runtime.loadModule([1]);

    const received: unknown[] = [];
    module.linkHostFunction('env', 'host_add', 'i(ii)', (args) => {
      received.push(...args);
      return [(args[0] as number) + (args[1] as number)];
    });

    expect(runtime.call('call_host_add', 3, 4)).toBe(7);
    expect(received).toEqual([3, 4]);
  });

  it('handles java.lang.Long in normalizeAndroidValue', () => {
    installAndroidFake();
    const runtime = new WamrRuntime();
    const module = runtime.loadModule([1]);

    expect(module.getGlobal('g_big')).toBe(72623859790382856n);
  });
});

describe('WamrRuntime on iOS', () => {
  it('reports the WAMR version', () => {
    installIosFake();
    expect(WamrRuntime.version()).toBe('2.1.0');
  });

  it('creates the runtime with stack size, WASI, and execution tier', () => {
    const state = installIosFake();
    new WamrRuntime({
      stackSizeInBytes: 32 * 1024,
      wasiEnabled: false,
      executionTier: WamrExecutionTier.LLVMJIT,
    });

    expect(state.stackSize).toBe(32 * 1024);
    expect(state.wasiEnabled).toBe(false);
    expect(state.executionTier).toBe(String(WamrExecutionTier.LLVMJIT));
  });

  it('unwraps NSArray results and converts i64', () => {
    const state = installIosFake();
    const runtime = new WamrRuntime({ stackSizeInBytes: 32 * 1024 });
    runtime.loadModule('/tmp/fake.wasm');

    expect(state.stackSize).toBe(32 * 1024);
    expect(state.loadedPath).toBe('/tmp/fake.wasm');
    expect(runtime.call('add_i64', 1n, 2n)).toBe(3n);

    const fn = runtime.findFunction('add_i64');
    expect(fn.paramTypes).toEqual(['i64', 'i64']);
    expect(fn.returnTypes).toEqual(['i64']);
  });

  it('round-trips host imports through NSArray arguments', () => {
    installIosFake();
    const runtime = new WamrRuntime();
    const module = runtime.loadModule(new Uint8Array([0, 97, 115, 109]));

    module.linkHostFunction('env', 'host_add', 'i(ii)', (args) => [
      (args[0] as number) + (args[1] as number),
    ]);
    expect(runtime.call('call_host_add', 20, 22)).toBe(42);
  });

  it('reads memory via interop.bufferFromData', () => {
    installIosFake();
    const runtime = new WamrRuntime();
    expect([...runtime.readMemory(7, 2)]).toEqual([7, 2]);
    expect(runtime.memorySize).toBe(65536);
  });

  it('propagates native errors as WamrError', () => {
    installIosFake();
    const runtime = new WamrRuntime();
    expect(() => runtime.findFunction('nope')).toThrow(WamrError);
    expect(() => runtime.findFunction('nope')).toThrow(/function lookup failed/);
  });

  // The bridge reports failure by filling an NSError reference rather than
  // raising, so the WAMR message reaches JS only if the adapter passes one.
  it('reads the WAMR message out of the NSError reference', () => {
    installIosFake();
    const runtime = new WamrRuntime();
    const module = runtime.loadModule('/tmp/fake.wasm');

    expect(() => runtime.findFunction('nope')).toThrow(/function lookup failed: 'nope'/);
    expect(() => module.getGlobal('nope')).toThrow(/global not found: nope/);
    // An import that was never linked traps on call, not on load.
    expect(() => runtime.call('call_host_add', 1, 2)).toThrow(
      /missing imported function: 'env\.host_add'/,
    );
  });
});
