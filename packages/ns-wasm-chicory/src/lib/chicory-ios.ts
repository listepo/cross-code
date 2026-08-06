// iOS platform adapter for Chicory — pure-Java runtime, not supported on iOS.
import { ChicoryError } from './wire.js';
import type { NativeRuntimeAdapter, NativeModuleAdapter, NativeFunctionAdapter } from '@cross-code/ns-wasm-core';
export class IosRuntime implements NativeRuntimeAdapter {
  constructor(_s: number) { throw new ChicoryError('Chicory is pure-Java and does not support iOS — use ns-wasm3, ns-wamr or ns-wasm-kit-runtime for iOS targets'); }
  loadModuleFromBytes(_b: Uint8Array): NativeModuleAdapter { throw new ChicoryError('Chicory: iOS not supported'); }
  loadModuleFromFile(_p: string): NativeModuleAdapter { throw new ChicoryError('Chicory: iOS not supported'); }
  findFunction(_n: string): NativeFunctionAdapter { throw new ChicoryError('Chicory: iOS not supported'); }
  memorySize(): number { throw new ChicoryError('Chicory: iOS not supported'); }
  readMemory(): Uint8Array { throw new ChicoryError('Chicory: iOS not supported'); }
  writeMemory(): void { throw new ChicoryError('Chicory: iOS not supported'); }
  dispose(): void {}
}
