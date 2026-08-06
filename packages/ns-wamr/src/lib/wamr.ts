// ns-wamr — WAMR (WebAssembly Micro Runtime) plugin for NativeScript.
// The Runtime / Module / Function classes are thin engine-named wrappers
// around the generic base classes in @cross-code/ns-wasm-kit.

import type { WasmValue } from '@cross-code/ns-wasm-core';
import {
  WasmRuntime,
  WasmModule,
  WasmFunction,
  type NativeRuntimeAdapter,
} from '@cross-code/ns-wasm-kit';
import { WamrError } from './wire.js';
import { IosRuntime } from './wamr-ios.js';
import { AndroidRuntime } from './wamr-android.js';

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

export type WamrHostFunction = (
  ...args: WasmValue[]
) => WasmValue | WasmValue[] | void;

export type WamrModuleSource = string | ArrayBuffer | Uint8Array | number[];

export interface WamrImports {
  [module: string]: {
    [name: string]: { signature: string; fn: WamrHostFunction };
  };
}

/**
 * WAMR execution tiers — numeric codes that cross the native bridge.
 *
 * Note: a regular `enum` (not `const enum`) because the workspace builds
 * with `isolatedModules: true`.
 */
export enum WamrExecutionTier {
  /** Portable interpreter (default). Works everywhere. */
  Interpreter = 0,
  /** WAMR Fast JIT compiler. Good balance of speed and portability. */
  FastJIT = 1,
  /** WAMR LLVM JIT compiler. Highest peak performance; needs LLVM built in. */
  LLVMJIT = 2,
  /** Ahead-of-time compiled module. Loads pre-compiled .aot files. */
  AOT = 3,
}

export interface WamrRuntimeOptions {
  /** WAMR interpreter stack size, in bytes. Default 64 KiB. */
  stackSizeInBytes?: number;
  /** Enable WASI support. Default true. */
  wasiEnabled?: boolean;
  /** Execution tier. Defaults to WamrExecutionTier.Interpreter. */
  executionTier?: WamrExecutionTier;
}

const DEFAULT_OPTIONS = {
  stackSizeInBytes: 64 * 1024,
  wasiEnabled: true,
  executionTier: WamrExecutionTier.Interpreter,
} as const;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function createAdapter(options: {
  stackSizeInBytes: number;
  wasiEnabled: boolean;
  executionTier: number;
}): NativeRuntimeAdapter {
  const g = globalThis as any;
  if (typeof g.NSCWamrRuntime !== 'undefined' && g.NSCWamrRuntime !== null) {
    return new IosRuntime(options);
  }
  if (g.org?.nativescript?.wamr?.NSCWamrRuntime) {
    return new AndroidRuntime(options);
  }
  throw new WamrError(
    'ns-wamr native runtime not found — is the plugin installed and the app rebuilt?',
  );
}

function wamrVersionNative(): string {
  const g = globalThis as any;
  if (typeof g.NSCWamrRuntime !== 'undefined' && g.NSCWamrRuntime !== null) {
    return String(g.NSCWamrRuntime.wamrVersion());
  }
  if (g.org?.nativescript?.wamr?.NSCWamrRuntime) {
    return String(g.org.nativescript.wamr.NSCWamrRuntime.wamrVersion());
  }
  throw new WamrError('ns-wamr native runtime not found');
}

// ---------------------------------------------------------------------------
// Public classes
// ---------------------------------------------------------------------------

export class WamrFunction extends WasmFunction {}
export class WamrModule extends WasmModule {}

export class WamrRuntime extends WasmRuntime {
  constructor(options?: WamrRuntimeOptions) {
    super(createAdapter({
      stackSizeInBytes: options?.stackSizeInBytes ?? DEFAULT_OPTIONS.stackSizeInBytes,
      wasiEnabled: options?.wasiEnabled ?? DEFAULT_OPTIONS.wasiEnabled,
      executionTier: options?.executionTier ?? DEFAULT_OPTIONS.executionTier,
    }), {
      moduleCtor: WamrModule,
      functionCtor: WamrFunction,
    });
  }

  /** The WAMR version, e.g. "2.1.0". */
  static version(): string {
    return wamrVersionNative();
  }

  // Narrow return types so consumers get WamrModule / WamrFunction.
  // The base-class factory uses the constructors we passed to super(),
  // so the runtime values are already correct — we only cast for the types.
  override loadModule(source: WamrModuleSource, imports?: WamrImports): WamrModule {
    return super.loadModule(source, imports) as unknown as WamrModule;
  }

  override findFunction(name: string): WamrFunction {
    return super.findFunction(name) as unknown as WamrFunction;
  }
}
