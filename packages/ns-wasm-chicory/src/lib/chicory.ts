// ns-wasm-chicory — Chicory (https://github.com/dylibso/chicory)
// pure-Java WebAssembly runtime plugin for NativeScript (Android-only).
import type { WasmValue } from '@cross-code/ns-wasm-core';
import { WasmRuntime, WasmModule, WasmFunction, type NativeRuntimeAdapter } from '@cross-code/ns-wasm-core';
import { ChicoryError } from './wire.js';
import { IosRuntime } from './chicory-ios.js';
import { AndroidRuntime } from './chicory-android.js';
export { type WireHostCallback, type NativeFunctionAdapter, type NativeModuleAdapter, type NativeRuntimeAdapter } from '@cross-code/ns-wasm-core';
export type ChicoryHostFunction = (...args: WasmValue[]) => WasmValue | WasmValue[] | void;
export type ChicoryModuleSource = string | ArrayBuffer | Uint8Array | number[];
export interface ChicoryImports { [module: string]: { [name: string]: { signature: string; fn: ChicoryHostFunction } } }
export interface ChicoryRuntimeOptions { stackSizeInBytes?: number }

function createAdapter(stackSizeInBytes: number): NativeRuntimeAdapter {
  const g = globalThis as any;
  if (g.org?.nativescript?.chicory?.NSCChicoryRuntime) return new AndroidRuntime(stackSizeInBytes);
  if (typeof g.NSCChicoryRuntime !== 'undefined' && g.NSCChicoryRuntime !== null) return new IosRuntime(stackSizeInBytes);
  throw new ChicoryError('ns-wasm-chicory native runtime not found');
}
function chicoryVersionNative(): string {
  const g = globalThis as any;
  if (g.org?.nativescript?.chicory?.NSCChicoryRuntime) return String(g.org.nativescript.chicory.NSCChicoryRuntime.chicoryVersion());
  if (typeof g.NSCChicoryRuntime !== 'undefined' && g.NSCChicoryRuntime !== null) return String(g.NSCChicoryRuntime.chicoryVersion());
  throw new ChicoryError('ns-wasm-chicory native runtime not found');
}
export class ChicoryFunction extends WasmFunction {}
export class ChicoryModule extends WasmModule {}
export class ChicoryRuntime extends WasmRuntime {
  constructor(options?: ChicoryRuntimeOptions) { super(createAdapter(options?.stackSizeInBytes ?? 64 * 1024), { moduleCtor: ChicoryModule, functionCtor: ChicoryFunction }); }
  static version(): string { return chicoryVersionNative(); }
  override loadModule(source: ChicoryModuleSource, imports?: ChicoryImports): ChicoryModule { return super.loadModule(source, imports) as unknown as ChicoryModule; }
  override findFunction(name: string): ChicoryFunction { return super.findFunction(name) as unknown as ChicoryFunction; }
}
