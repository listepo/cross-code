/**
 * `@cross-code/ns-wasm-fixture/types.wasm` as `@cross-code/ns-rspack`'s
 * wasm-loader emits it: the binary's own exports, instantiated on first use
 * through the `WebAssembly` global a runtime plugin's polyfill installs.
 *
 * The bulk comes from wasm-pack, which rewrites `test_types_bg.wasm.d.ts`
 * from the binary on every `npm run build.wasm`. Corrected below are the two
 * entries it types for a browser — the DOM's `WebAssembly.Memory` and
 * `Table`, where the loader instantiates `@cross-code/ns-wasm-core`'s
 * polyfill classes — and the two globals it leaves out entirely: the binary
 * exports 67 entries, wasm-pack declares 65.
 *
 * Non-function exports are bound at instantiation, so reading `memory` before
 * any exported function has been called yields `undefined`. Declaring that
 * window would force a non-null assertion at every use site; the loader
 * documents the limitation instead (see ns-rspack's README).
 */
export * from './src/test-types/pkg/test_types_bg.wasm.js';

/** The module's linear memory, as `@cross-code/ns-wasm-core` exposes one. */
export const memory: {
  readonly byteLength: number;
  /** A snapshot copy — writes to it are discarded. Use `write`. */
  readonly buffer: ArrayBuffer;
  read(offset: number, length: number): Uint8Array;
  write(offset: number, bytes: Uint8Array | ArrayBuffer | number[]): void;
  /** Always throws: the native runtimes do not expose `memory.grow`. */
  grow(delta: number): never;
};

/** A JS-side stub, disconnected from the module's own table. */
export const __wbindgen_externrefs: {
  readonly length: number;
  grow(delta: number): number;
  get(index: number): unknown;
  set(index: number, value?: unknown): void;
};

// Both are i32 globals (the module's three globals are all i32, and nothing
// imports a global, so the exported indices are not shifted). `value` is not
// `readonly`: the polyfill's setter never checks mutability, and describing
// the runtime beats describing the spec.
export const __abort_handler: { value: number; valueOf(): number };
export const __instance_terminated: { value: number; valueOf(): number };
