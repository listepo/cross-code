/**
 * A `.wasm` import goes through `@cross-code/ns-rspack`'s wasm-loader: it emits
 * an ES module whose exports are the binary's own, instantiated on first use
 * through the `WebAssembly` global a runtime plugin's polyfill installs.
 *
 * The fixture binary exports what wasm-pack generated glue for, plus the
 * linear memory and the table the glue keeps for itself.
 */
declare module '@cross-code/ns-wasm-fixture/types.wasm' {
  export * from '@cross-code/ns-wasm-fixture/types';

  /** The module's linear memory, as `@cross-code/ns-wasm-core` exposes one. */
  export const memory: {
    readonly byteLength: number;
    readonly buffer: ArrayBuffer;
    read(offset: number, length: number): Uint8Array;
    write(offset: number, bytes: Uint8Array | ArrayBuffer | number[]): void;
  };
}
