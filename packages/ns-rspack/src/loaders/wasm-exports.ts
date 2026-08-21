import type { ExternKind, ModuleExportDescriptor, WasmModuleInfo } from '@cross-code/ns-wasm-core'

/** A name that can be written bare, rather than quoted, in an export clause. */
export const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** An export the loader binds as a value: everything that is not a function. */
export type ValueExportDescriptor = ModuleExportDescriptor & {
    kind: Exclude<ExternKind, 'function'>
}

/**
 * Whether the loader binds this export as a value rather than as a
 * call-through wrapper.
 *
 * `wasm-loader` emits these as live bindings filled in when the module
 * instantiates, and `wasm-declaration` types exactly the same set as the
 * polyfill's classes. The rule lives here once so the emitted module and the
 * emitted declaration cannot disagree about which exports it covers.
 */
export function isValueExport(entry: ModuleExportDescriptor): entry is ValueExportDescriptor {
    return entry.kind !== 'function'
}

/** Every value export of a module, in export-table order. */
export function valueExports(info: WasmModuleInfo): ValueExportDescriptor[] {
    return info.exports.filter(isValueExport)
}

/**
 * The `@cross-code/ns-wasm-core` class the polyfill hands back for each kind
 * of value export — what `instance.exports.memory` and friends actually are
 * on device, as opposed to the DOM types wasm-pack declares.
 */
export const POLYFILL_CLASS: Record<Exclude<ExternKind, 'function'>, string> = {
    memory: 'WebAssemblyMemory',
    global: 'WebAssemblyGlobal',
    table: 'WebAssemblyTable',
}
