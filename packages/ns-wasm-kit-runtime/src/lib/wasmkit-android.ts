// Android platform adapter for WasmKit.
// WasmKit is a Swift-only runtime (https://github.com/swiftwasm/WasmKit)
// and does not support Android at this time. The adapter throws a clear
// message instead of silently failing.

import { WasmKitError } from './wire.js';
import type { NativeRuntimeAdapter, NativeModuleAdapter, NativeFunctionAdapter } from '@cross-code/ns-wasm-core';

export class AndroidRuntime implements NativeRuntimeAdapter {
  constructor(_stackSizeInBytes: number) {
    throw new WasmKitError(
      'WasmKit does not support Android — use ns-wasm3 or ns-wamr for Android targets',
    );
  }

  loadModuleFromBytes(_bytes: Uint8Array): NativeModuleAdapter {
    throw new WasmKitError('WasmKit: Android is not supported');
  }
  loadModuleFromFile(_path: string): NativeModuleAdapter {
    throw new WasmKitError('WasmKit: Android is not supported');
  }
  findFunction(_name: string): NativeFunctionAdapter {
    throw new WasmKitError('WasmKit: Android is not supported');
  }
  memorySize(): number { throw new WasmKitError('WasmKit: Android not supported'); }
  readMemory(_offset: number, _length: number): Uint8Array {
    throw new WasmKitError('WasmKit: Android not supported');
  }
  writeMemory(_offset: number, _bytes: Uint8Array): void {
    throw new WasmKitError('WasmKit: Android not supported');
  }
  dispose(): void {}
}
