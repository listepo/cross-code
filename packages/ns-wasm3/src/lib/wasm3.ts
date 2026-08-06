// ns-wasm3 — wasm3 interpreter plugin for NativeScript.
// The Runtime / Module / Function classes are thin engine-named wrappers
// around the generic base classes in @cross-code/ns-wasm-kit.

import type { WasmValue } from '@cross-code/ns-wasm-core';
import {
  WasmRuntime,
  WasmModule,
  WasmFunction,
  type NativeRuntimeAdapter,
} from '@cross-code/ns-wasm-kit';
import { Wasm3Error } from './wire.js';
import { IosRuntime } from './wasm3-ios.js';
import { AndroidRuntime } from './wasm3-android.js';

// ---------------------------------------------------------------------------
// Re-exports (adapter interfaces — backward-compat)
// ---------------------------------------------------------------------------

export {
  type WireHostCallback,
  type NativeFunctionAdapter,
  type NativeModuleAdapter,
  type NativeRuntimeAdapter,
} from '@cross-code/ns-wasm-kit';

// ---------------------------------------------------------------------------
// Engine-specific types
// ---------------------------------------------------------------------------

export type Wasm3HostFunction = (
  ...args: WasmValue[]
) => WasmValue | WasmValue[] | void;

export type Wasm3ModuleSource = string | ArrayBuffer | Uint8Array | number[];

export interface Wasm3Imports {
  [module: string]: {
    [name: string]: { signature: string; fn: Wasm3HostFunction };
  };
}

export interface Wasm3RuntimeOptions {
  /** wasm3 interpreter stack size, in bytes. Default 64 KiB. */
  stackSizeInBytes?: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function createAdapter(stackSizeInBytes: number): NativeRuntimeAdapter {
  const g = globalThis as any;
  if (typeof g.NSCWasm3Runtime !== 'undefined' && g.NSCWasm3Runtime !== null) {
    return new IosRuntime(stackSizeInBytes);
  }
  if (g.org?.nativescript?.wasm3?.NSCWasm3Runtime) {
    return new AndroidRuntime(stackSizeInBytes);
  }
  throw new Wasm3Error(
    'ns-wasm3 native runtime not found — is the plugin installed and the app rebuilt?',
  );
}

function wasm3VersionNative(): string {
  const g = globalThis as any;
  if (typeof g.NSCWasm3Runtime !== 'undefined' && g.NSCWasm3Runtime !== null) {
    return String(g.NSCWasm3Runtime.wasm3Version());
  }
  if (g.org?.nativescript?.wasm3?.NSCWasm3Runtime) {
    return String(g.org.nativescript.wasm3.NSCWasm3Runtime.wasm3Version());
  }
  throw new Wasm3Error('ns-wasm3 native runtime not found');
}

// ---------------------------------------------------------------------------
// Public classes
// ---------------------------------------------------------------------------

export class Wasm3Function extends WasmFunction {}
export class Wasm3Module extends WasmModule {}

export class Wasm3Runtime extends WasmRuntime {
  constructor(options?: Wasm3RuntimeOptions) {
    super(createAdapter(options?.stackSizeInBytes ?? 64 * 1024), {
      moduleCtor: Wasm3Module,
      functionCtor: Wasm3Function,
    });
  }

  /** The wasm3 interpreter version, e.g. "0.5.2". */
  static version(): string {
    return wasm3VersionNative();
  }

  // Narrow return types so consumers get Wasm3Module / Wasm3Function.
  // The base-class factory uses the constructors we passed to super(),
  // so the runtime values are already correct — we only cast for the types.
  override loadModule(source: Wasm3ModuleSource, imports?: Wasm3Imports): Wasm3Module {
    return super.loadModule(source, imports) as unknown as Wasm3Module;
  }

  override findFunction(name: string): Wasm3Function {
    return super.findFunction(name) as unknown as Wasm3Function;
  }
}
