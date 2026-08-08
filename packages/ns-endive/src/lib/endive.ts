// ns-endive — Endive (https://github.com/bytecodealliance/endive)
// Java-based WebAssembly runtime plugin for NativeScript.
//
// Endive runs on the JVM, so the Android adapter is the real one and iOS
// throws a clear unsupported error. The Runtime / Module / Function classes
// extend the generic base classes from @cross-code/ns-wasm-core.

import type { WasmValue } from '@cross-code/ns-wasm-core';
import {
  WasmRuntime,
  WasmModule,
  WasmFunction,
  type NativeRuntimeAdapter,
} from '@cross-code/ns-wasm-core';
import { EndiveError } from './wire.js';
import { IosRuntime } from './endive-ios.js';
import { AndroidRuntime } from './endive-android.js';

// ---------------------------------------------------------------------------
// Re-exports (adapter interfaces)
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

export type EndiveHostFunction = (
  ...args: WasmValue[]
) => WasmValue | WasmValue[] | void;

export type EndiveModuleSource = string | ArrayBuffer | Uint8Array | number[];

export interface EndiveImports {
  [module: string]: {
    [name: string]: { signature: string; fn: EndiveHostFunction };
  };
}

export interface EndiveRuntimeOptions {
  /** Endive stack size, in bytes. Default 64 KiB. */
  stackSizeInBytes?: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function createAdapter(stackSizeInBytes: number): NativeRuntimeAdapter {
  const g = globalThis as any;
  // Android: Endive runs on the JVM.
  if (g.org?.nativescript?.endive?.NSCEndiveRuntime) {
    return new AndroidRuntime(stackSizeInBytes);
  }
  // iOS: Endive is Java-based; falls through to unsupported.
  if (typeof g.NSCEndiveRuntime !== 'undefined' && g.NSCEndiveRuntime !== null) {
    return new IosRuntime(stackSizeInBytes);
  }
  throw new EndiveError(
    'ns-endive native runtime not found — is the plugin installed and the app rebuilt?',
  );
}

function endiveVersionNative(): string {
  const g = globalThis as any;
  if (g.org?.nativescript?.endive?.NSCEndiveRuntime) {
    return String(g.org.nativescript.endive.NSCEndiveRuntime.endiveVersion());
  }
  if (typeof g.NSCEndiveRuntime !== 'undefined' && g.NSCEndiveRuntime !== null) {
    return String(g.NSCEndiveRuntime.endiveVersion());
  }
  throw new EndiveError('ns-endive native runtime not found');
}

// ---------------------------------------------------------------------------
// Public classes
// ---------------------------------------------------------------------------

export class EndiveFunction extends WasmFunction {}
export class EndiveModule extends WasmModule {}

export class EndiveRuntime extends WasmRuntime {
  constructor(options?: EndiveRuntimeOptions) {
    super(createAdapter(options?.stackSizeInBytes ?? 64 * 1024), {
      moduleCtor: EndiveModule,
      functionCtor: EndiveFunction,
    });
  }

  /** The Endive interpreter version. */
  static version(): string {
    return endiveVersionNative();
  }

  override loadModule(source: EndiveModuleSource, imports?: EndiveImports): EndiveModule {
    return super.loadModule(source, imports) as unknown as EndiveModule;
  }

  override findFunction(name: string): EndiveFunction {
    return super.findFunction(name) as unknown as EndiveFunction;
  }
}
