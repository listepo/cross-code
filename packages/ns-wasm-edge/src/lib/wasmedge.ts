// ns-wasm-edge — WasmEdge (https://github.com/WasmEdge/WasmEdge)
// high-performance WebAssembly runtime plugin for NativeScript.
import type { WasmValue } from '@cross-code/ns-wasm-core';
import { WasmRuntime, WasmModule, WasmFunction, type NativeRuntimeAdapter } from '@cross-code/ns-wasm-core';
import { WasmEdgeError } from './wire.js';
import { IosRuntime } from './wasmedge-ios.js';
import { AndroidRuntime } from './wasmedge-android.js';

export { type WireHostCallback, type NativeFunctionAdapter, type NativeModuleAdapter, type NativeRuntimeAdapter } from '@cross-code/ns-wasm-core';

export type WasmEdgeHostFunction = (...args: WasmValue[]) => WasmValue | WasmValue[] | void;
export type WasmEdgeModuleSource = string | ArrayBuffer | Uint8Array | number[];
export interface WasmEdgeImports { [module: string]: { [name: string]: { signature: string; fn: WasmEdgeHostFunction } } }
export interface WasmEdgeRuntimeOptions { stackSizeInBytes?: number }

function createAdapter(stackSizeInBytes: number): NativeRuntimeAdapter {
  const g = globalThis as any;
  if (typeof g.NSCWasmEdgeRuntime !== 'undefined' && g.NSCWasmEdgeRuntime !== null) return new IosRuntime(stackSizeInBytes);
  if (g.org?.nativescript?.wasmedge?.NSCWasmEdgeRuntime) return new AndroidRuntime(stackSizeInBytes);
  throw new WasmEdgeError('ns-wasm-edge native runtime not found — is the plugin installed and the app rebuilt?');
}
function wasmEdgeVersionNative(): string {
  const g = globalThis as any;
  if (typeof g.NSCWasmEdgeRuntime !== 'undefined' && g.NSCWasmEdgeRuntime !== null) return String(g.NSCWasmEdgeRuntime.wasmedgeVersion());
  if (g.org?.nativescript?.wasmedge?.NSCWasmEdgeRuntime) return String(g.org.nativescript.wasmedge.NSCWasmEdgeRuntime.wasmedgeVersion());
  throw new WasmEdgeError('ns-wasm-edge native runtime not found');
}

export class WasmEdgeFunction extends WasmFunction {}
export class WasmEdgeModule extends WasmModule {}

export class WasmEdgeRuntime extends WasmRuntime {
  constructor(options?: WasmEdgeRuntimeOptions) {
    super(createAdapter(options?.stackSizeInBytes ?? 64 * 1024), { moduleCtor: WasmEdgeModule, functionCtor: WasmEdgeFunction });
  }
  static version(): string { return wasmEdgeVersionNative(); }
  override loadModule(source: WasmEdgeModuleSource, imports?: WasmEdgeImports): WasmEdgeModule { return super.loadModule(source, imports) as unknown as WasmEdgeModule; }
  override findFunction(name: string): WasmEdgeFunction { return super.findFunction(name) as unknown as WasmEdgeFunction; }
}
