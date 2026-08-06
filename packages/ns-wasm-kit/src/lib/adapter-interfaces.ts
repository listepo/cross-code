// Native adapter interfaces shared by all WASM runtime plugins.
// Each plugin provides platform-specific implementations (iOS / Android)
// that conform to these interfaces.
//
// Wire protocol convention: i32 -> number, i64 -> decimal string, f32/f64 -> number.

import type { WasmValueType, WireValue } from '@cross-code/ns-wasm-core';

/** A platform-native callback that receives wire values and returns wire values. */
export type WireHostCallback = (args: WireValue[]) => WireValue[];

export interface NativeFunctionAdapter {
  name(): string;
  paramTypes(): WasmValueType[];
  returnTypes(): WasmValueType[];
  call(args: WireValue[]): WireValue[];
}

export interface NativeModuleAdapter {
  name(): string;
  linkHostFunction(module: string, name: string, signature: string, cb: WireHostCallback): void;
  getGlobal(name: string): WireValue;
  setGlobal(name: string, value: WireValue): void;
}

export interface NativeRuntimeAdapter {
  loadModuleFromBytes(bytes: Uint8Array): NativeModuleAdapter;
  loadModuleFromFile(path: string): NativeModuleAdapter;
  findFunction(name: string): NativeFunctionAdapter;
  memorySize(): number;
  readMemory(offset: number, length: number): Uint8Array;
  writeMemory(offset: number, bytes: Uint8Array): void;
  dispose(): void;
}
