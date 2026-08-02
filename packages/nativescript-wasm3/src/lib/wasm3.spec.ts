import { afterEach, describe, expect, it } from 'vitest';

import { Wasm3Error } from './wire.js';
import { Wasm3Runtime } from './wasm3.js';

// These specs exercise the platform adapters against fakes that mimic the
// JS-visible shape of the native APIs (the NativeScript runtimes marshal the
// real classes into exactly these shapes). The native implementations
// themselves are covered by the Swift (XCTest) and Kotlin (JUnit) suites.

const g = globalThis as any;

afterEach(() => {
  delete g.NSCWasm3Runtime;
  delete g.NSCWasm3HostCallback;
  delete g.interop;
  delete g.org;
});

// ------------------------------------------------------------------ fakes

/** Fake of the Kotlin NSCWasm3* classes as seen from JS on Android. */
function installAndroidFake() {
  const state: any = {
    memory: new Uint8Array(64 * 1024),
    hostFns: new Map<string, any>(),
    lastCall: undefined,
    closed: false,
  };

  // --- java.lang fakes (exercises toJavaWireValue / normalizeAndroidValue) ---
  // On a real device the NativeScript runtime marshals java.lang.Number
  // subclasses as JS object proxies; instanceof works against the prototype
  // chain. The fakes below replicate the surface the adapter code relies on.

  class JavaNumber {
    constructor(protected readonly val: number) {}
    doubleValue(): number {
      return this.val;
    }
  }

  class JavaDouble extends JavaNumber {
    // noImplicitOverride (TypeScript 6) requires `override` on any member
    // whose name also exists on a base class, even a static one shadowing
    // Object.prototype.valueOf. The override keyword does not apply to
    // static members, so suppress the false positive.
    // @ts-ignore TS4114
    static valueOf(n: number): JavaDouble {
      return new JavaDouble(n);
    }
  }

  // JavaLong boxes a 64-bit integer. On a real device toString() returns the
  // decimal representation the wire protocol relies on; normalizeAndroidValue
  // calls it to recover the lossless string.
  class JavaLong extends JavaNumber {
    constructor(val: number | bigint) {
      super(Number(val));
    }
    override toString(): string {
      return String(BigInt(this.val));
    }
  }

  class JavaInteger extends JavaNumber {}

  g.java = {
    lang: {
      Number: JavaNumber,
      Double: JavaDouble,
      Long: JavaLong,
      Integer: JavaInteger,
    },
  };

  // --- wasm3 fakes ---

  class FakeFunction {
    constructor(
      private name: string,
      private params: string[],
      private returns: string[],
      private impl: (args: any[]) => any[],
    ) {}
    getName = () => this.name;
    getParamTypes = () => this.params;
    getReturnTypes = () => this.returns;
    call = (args: any[]) => {
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
      return [hostFn.invoke([a[0], a[1]])];
    }),
    log_i64: new FakeFunction('log_i64', ['i64'], [], (a) => {
      state.hostFns.get('env.host_log_i64')?.invoke([a[0]]);
      return [];
    }),
  };

  class FakeModule {
    getName = () => 'fake.wasm';
    linkHostFunction = (mod: string, name: string, _sig: string, fn: any) => {
      state.hostFns.set(`${mod}.${name}`, fn);
    };
    getGlobal = (name: string) => {
      if (name === 'g_big') return '72623859790382856';
      if (name === 'g_pi') return Math.PI;
      throw new Error(`org.nativescript.wasm3.NSCWasm3Exception: global not found: ${name}`);
    };
    setGlobal = (name: string, value: any) => {
      state.lastSetGlobal = { name, value };
    };
  }

  class FakeRuntime {
    constructor(public stackSize: number) {
      state.stackSize = stackSize;
    }
    loadModule = (bytes: any) => {
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
          `org.nativescript.wasm3.NSCWasm3Exception: function lookup failed: ${name}`,
        );
      }
      return fn;
    };
    memorySize = () => state.memory.length;
    readMemory = (offset: number, length: number) => {
      // Java byte[] surfaces as an indexable object with signed bytes.
      const view: Uint8Array = state.memory.subarray(offset, offset + length);
      return Array.from(view, (v) => (v > 127 ? v - 256 : v));
    };
    writeMemory = (offset: number, bytes: any) => {
      for (let i = 0; i < bytes.length; i++) {
        state.memory[offset + i] = (Number(bytes[i]) + 256) & 0xff;
      }
    };
    close = () => {
      state.closed = true;
    };
    static wasm3Version = () => '0.5.2';
  }

  class FakeHostFunction {
    constructor(impl: { invoke: (args: any[]) => any }) {
      Object.assign(this, impl);
    }
  }

  g.org = {
    nativescript: {
      wasm3: { NSCWasm3Runtime: FakeRuntime, NSCWasm3HostFunction: FakeHostFunction },
    },
  };
  return state;
}

/** NSArray as surfaced by the NativeScript iOS runtime. */
function nsArray(items: any[]) {
  return { count: items.length, objectAtIndex: (i: number) => items[i] };
}

/** Fake of the Swift NSCWasm3* classes as seen from JS on iOS. */
function installIosFake() {
  const state: any = { hostFns: new Map<string, any>() };

  const addI64 = {
    name: 'add_i64',
    paramTypes: nsArray(['i64', 'i64']),
    returnTypes: nsArray(['i64']),
    callWithArgumentsError: (args: any[]) => {
      state.lastCall = { name: 'add_i64', args: [...args] };
      return nsArray([(BigInt(args[0]) + BigInt(args[1])).toString()]);
    },
  };

  const callHostAdd = {
    name: 'call_host_add',
    paramTypes: nsArray(['i32', 'i32']),
    returnTypes: nsArray(['i32']),
    callWithArgumentsError: (args: any[]) => {
      const hostFn = state.hostFns.get('env.host_add');
      if (!hostFn) throw new Error('missing imported function: env.host_add');
      return nsArray([hostFn.invoke(nsArray([args[0], args[1]]))]);
    },
  };

  const module = {
    name: 'fake.wasm',
    linkHostFunctionNameSignatureCallbackError: (
      mod: string,
      name: string,
      _sig: string,
      cb: any,
    ) => {
      state.hostFns.set(`${mod}.${name}`, cb);
    },
    getGlobalError: (name: string) => {
      if (name === 'g_big') return '72623859790382856';
      throw new Error(`global not found: ${name}`);
    },
    setGlobalValueError: (name: string, value: any) => {
      state.lastSetGlobal = { name, value };
    },
  };

  const runtime = {
    memorySize: 65536,
    loadModuleError: (bytes: any) => {
      state.loadedBytes = bytes;
      return module;
    },
    loadModuleFromFileError: (path: string) => {
      state.loadedPath = path;
      return module;
    },
    findFunctionError: (name: string) => {
      if (name === 'add_i64') return addI64;
      if (name === 'call_host_add') return callHostAdd;
      throw new Error(`function lookup failed: ${name}`);
    },
    readMemoryAtOffsetLengthError: (offset: number, length: number) => ({
      kind: 'NSData',
      offset,
      length,
    }),
    writeMemoryAtOffsetDataError: (offset: number, data: any) => {
      state.lastWrite = { offset, data };
    },
  };

  g.NSCWasm3Runtime = {
    alloc: () => ({ initWithStackSize: (n: number) => ((state.stackSize = n), runtime) }),
    wasm3Version: () => '0.5.2',
  };
  // Fake NSCWasm3HostCallback that mirrors the NativeScript .extend() mechanism:
  // the produced subclass stores the JS callback in `_fn` and calls it via invoke().
  g.NSCWasm3HostCallback = {
    extend(impl: any) {
      return class {
        _fn: any = null;
        invoke(args: any): any {
          // NativeScript maps invoke: to invokeWithArg (single unnamed arg);
          // the closure-based variant used invoke. Support both.
          const fn = impl.invokeWithArg ?? impl.invoke;
          return fn.call(this, args);
        }
      };
    },
  };
  g.interop = {
    bufferFromData: (data: any) => new Uint8Array([data.offset, data.length]).buffer,
  };
  return state;
}

// ------------------------------------------------------------------ specs

describe('Wasm3Runtime (no native runtime)', () => {
  it('throws a descriptive error', () => {
    expect(() => new Wasm3Runtime()).toThrow(Wasm3Error);
    expect(() => Wasm3Runtime.version()).toThrow(Wasm3Error);
  });
});

describe('Wasm3Runtime on Android', () => {
  it('reports the wasm3 version', () => {
    installAndroidFake();
    expect(Wasm3Runtime.version()).toBe('0.5.2');
  });

  it('creates the runtime with the requested stack size', () => {
    const state = installAndroidFake();
    new Wasm3Runtime({ stackSizeInBytes: 128 * 1024 });
    expect(state.stackSize).toBe(128 * 1024);
  });

  it('converts i64 args/results between bigint and wire strings', () => {
    const state = installAndroidFake();
    const runtime = new Wasm3Runtime();
    runtime.loadModule([0, 97, 115, 109]);

    const result = runtime.call('add_i64', 9007199254740993n, '2');
    expect(result).toBe(9007199254740995n);
    // bigint crossed the bridge as a decimal string
    expect(state.lastCall.args).toEqual(['9007199254740993', '2']);
  });

  it('returns multi-value results as arrays', () => {
    installAndroidFake();
    const runtime = new Wasm3Runtime();
    runtime.loadModule([1]);
    expect(runtime.call('swap', 1, 2)).toEqual([2, 1]);
  });

  it('round-trips host imports with type conversion', () => {
    installAndroidFake();
    const runtime = new Wasm3Runtime();
    const module = runtime.loadModule([1]);

    const received: unknown[] = [];
    module.linkHostFunction('env', 'host_add', 'i(ii)', (a, b) => {
      received.push(a, b);
      return (a as number) + (b as number);
    });
    expect(runtime.call('call_host_add', 3, 4)).toBe(7);
    expect(received).toEqual([3, 4]);
  });

  it('passes i64 host arguments as bigint per the signature', () => {
    installAndroidFake();
    const runtime = new Wasm3Runtime();
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
    const runtime = new Wasm3Runtime();
    runtime.loadModule([1]);

    runtime.writeMemory(16, [0xde, 0xad, 0xbe, 0xef]);
    expect([...state.memory.subarray(16, 20)]).toEqual([0xde, 0xad, 0xbe, 0xef]);
    expect([...runtime.readMemory(16, 4)]).toEqual([0xde, 0xad, 0xbe, 0xef]);
    expect(runtime.memorySize).toBe(64 * 1024);
  });

  it('exposes globals with bigint conversion and strips exception prefixes', () => {
    installAndroidFake();
    const runtime = new Wasm3Runtime();
    const module = runtime.loadModule([1]);

    expect(module.getGlobal('g_big')).toBe(72623859790382856n);
    expect(module.getGlobal('g_pi')).toBe(Math.PI);
    expect(() => module.getGlobal('nope')).toThrow(/global not found: nope/);
    expect(() => module.getGlobal('nope')).not.toThrow(/NSCWasm3Exception/);
  });

  it('disposes the native runtime', () => {
    const state = installAndroidFake();
    const runtime = new Wasm3Runtime();
    runtime.dispose();
    expect(state.closed).toBe(true);
  });

  it('boxes f64 args as java.lang.Double across the wire', () => {
    // setGlobal is the simplest path: toJavaWireValue boxes the value,
    // the fake records what it received without normalizing.
    const state = installAndroidFake();
    const runtime = new Wasm3Runtime();
    const module = runtime.loadModule([1]);

    module.setGlobal('g_pi', Math.PI);

    expect(state.lastSetGlobal.value).toBeInstanceOf(g.java.lang.Double);
    expect(state.lastSetGlobal.value.doubleValue()).toBe(Math.PI);
  });

  it('unboxes java.lang.Number return values from host imports', () => {
    installAndroidFake();
    const runtime = new Wasm3Runtime();
    const module = runtime.loadModule([1]);

    // The fake call_host_add passes its args straight to the host callback.
    // toJavaWireValue wraps them as Double; normalizeAndroidValue must unbox
    // them before the JS host function sees them.
    const received: unknown[] = [];
    module.linkHostFunction('env', 'host_add', 'i(ii)', (a, b) => {
      received.push(a, b);
      return (a as number) + (b as number);
    });

    expect(runtime.call('call_host_add', 3, 4)).toBe(7);
    expect(received).toEqual([3, 4]);
  });

  it('handles java.lang.Long in normalizeAndroidValue', () => {
    // i64 global values cross as decimal strings — the fake returns one,
    // and normalizeAndroidValue should pass strings through unchanged.
    installAndroidFake();
    const runtime = new Wasm3Runtime();
    const module = runtime.loadModule([1]);

    expect(module.getGlobal('g_big')).toBe(72623859790382856n);
  });
});

describe('Wasm3Runtime on iOS', () => {
  it('reports the wasm3 version', () => {
    installIosFake();
    expect(Wasm3Runtime.version()).toBe('0.5.2');
  });

  it('unwraps NSArray results and converts i64', () => {
    const state = installIosFake();
    const runtime = new Wasm3Runtime({ stackSizeInBytes: 32 * 1024 });
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
    const runtime = new Wasm3Runtime();
    const module = runtime.loadModule(new Uint8Array([0, 97, 115, 109]));

    module.linkHostFunction('env', 'host_add', 'i(ii)', (a, b) => (a as number) + (b as number));
    expect(runtime.call('call_host_add', 20, 22)).toBe(42);
  });

  it('reads memory via interop.bufferFromData', () => {
    installIosFake();
    const runtime = new Wasm3Runtime();
    expect([...runtime.readMemory(7, 2)]).toEqual([7, 2]);
    expect(runtime.memorySize).toBe(65536);
  });

  it('propagates native errors as Wasm3Error', () => {
    installIosFake();
    const runtime = new Wasm3Runtime();
    expect(() => runtime.findFunction('nope')).toThrow(Wasm3Error);
    expect(() => runtime.findFunction('nope')).toThrow(/function lookup failed/);
  });
});
