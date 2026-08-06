// ns-wasm-kit-runtime — WasmKit (https://github.com/swiftwasm/WasmKit)
// runtime plugin for NativeScript. Wraps the WasmKit Swift interpreter.
//
// The Runtime / Module / Function classes extend the generic base classes
// from @cross-code/ns-wasm-core (which includes the merged ns-wasm-kit).

import type { WasmValue } from '@cross-code/ns-wasm-core';
import {
  WasmRuntime,
  WasmModule,
  WasmFunction,
  type NativeRuntimeAdapter,
} from '@cross-code/ns-wasm-core';
import { WasmKitError } from './wire.js';
import { IosRuntime } from './wasmkit-ios.js';
import { AndroidRuntime } from './wasmkit-android.js';

// ---------------------------------------------------------------------------
// Re-exports (adapter interfaces — backward-compat with core)
// ---------------------------------------------------------------------------

export {
  type WireHostCallback,
  type NativeFunctionAdapter,
  type NativeModuleAdapter,
  type NativeRuntimeAdapter,
} from '@cross-code/ns-wasm-core';

// ---------------------------------------------------------------------------
// Engine-specific types
// ---------------------------------------------------------------------------

export type WasmKitHostFunction = (
  ...args: WasmValue[]
) => WasmValue | WasmValue[] | void;

export type WasmKitModuleSource = string | ArrayBuffer | Uint8Array | number[];

export interface WasmKitImports {
  [module: string]: {
    [name: string]: { signature: string; fn: WasmKitHostFunction };
  };
}

export interface WasmKitRuntimeOptions {
  /** WasmKit stack size, in bytes. Default 64 KiB. */
  stackSizeInBytes?: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function createAdapter(stackSizeInBytes: number): NativeRuntimeAdapter {
  const g = globalThis as any;
  // iOS: WasmKit runs natively via SwiftPM.
  if (typeof g.NSWasmKitRuntime !== 'undefined' && g.NSWasmKitRuntime !== null) {
    return new IosRuntime(stackSizeInBytes);
  }
  // Android: WasmKit is not available (Swift-only runtime).
  if (g.org?.nativescript?.wasmkit?.NSWasmKitRuntime) {
    return new AndroidRuntime(stackSizeInBytes);
  }
  throw new WasmKitError(
    'ns-wasm-kit-runtime native runtime not found — is the plugin installed and the app rebuilt?',
  );
}

function wasmkitVersionNative(): string {
  const g = globalThis as any;
  if (typeof g.NSWasmKitRuntime !== 'undefined' && g.NSWasmKitRuntime !== null) {
    return String(g.NSWasmKitRuntime.wasmkitVersion());
  }
  if (g.org?.nativescript?.wasmkit?.NSWasmKitRuntime) {
    return String(g.org.nativescript.wasmkit.NSWasmKitRuntime.wasmkitVersion());
  }
  throw new WasmKitError('ns-wasm-kit-runtime native runtime not found');
}

// ---------------------------------------------------------------------------
// Public classes
// ---------------------------------------------------------------------------

export class WasmKitFunction extends WasmFunction {}
export class WasmKitModule extends WasmModule {}

export class WasmKitRuntime extends WasmRuntime {
  constructor(options?: WasmKitRuntimeOptions) {
    super(createAdapter(options?.stackSizeInBytes ?? 64 * 1024), {
      moduleCtor: WasmKitModule,
      functionCtor: WasmKitFunction,
    });
  }

  /** The WasmKit interpreter version. */
  static version(): string {
    return wasmkitVersionNative();
  }

  // Narrow return types so consumers get WasmKitModule / WasmKitFunction.
  override loadModule(source: WasmKitModuleSource, imports?: WasmKitImports): WasmKitModule {
    return super.loadModule(source, imports) as unknown as WasmKitModule;
  }

  override findFunction(name: string): WasmKitFunction {
    return super.findFunction(name) as unknown as WasmKitFunction;
  }
}
