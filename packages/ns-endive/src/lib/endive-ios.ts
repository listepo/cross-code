// iOS platform adapter for Endive.
// Endive is a Java-based WebAssembly runtime (JVM/JNI) and does not support
// iOS. The adapter throws a clear message instead of silently failing.

import { EndiveError } from './wire.js';
import type {
  NativeRuntimeAdapter,
  NativeModuleAdapter,
  NativeFunctionAdapter,
} from '@cross-code/ns-wasm-core';

export class IosRuntime implements NativeRuntimeAdapter {
  constructor(_stackSizeInBytes: number) {
    throw new EndiveError(
      'Endive is a Java-based runtime and does not support iOS — use ns-wasm3, ns-wamr or ns-wasm-kit-runtime for iOS targets',
    );
  }

  loadModuleFromBytes(_bytes: Uint8Array): NativeModuleAdapter {
    throw new EndiveError('Endive: iOS is not supported');
  }
  loadModuleFromFile(_path: string): NativeModuleAdapter {
    throw new EndiveError('Endive: iOS is not supported');
  }
  findFunction(_name: string): NativeFunctionAdapter {
    throw new EndiveError('Endive: iOS is not supported');
  }
  memorySize(): number { throw new EndiveError('Endive: iOS not supported'); }
  readMemory(_offset: number, _length: number): Uint8Array {
    throw new EndiveError('Endive: iOS not supported');
  }
  writeMemory(_offset: number, _bytes: Uint8Array): void {
    throw new EndiveError('Endive: iOS not supported');
  }
  dispose(): void {}
}
