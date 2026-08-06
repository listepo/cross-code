package org.nativescript.wamr

/**
 * JNI declarations for the WAMR native library (libwamr_jni.so).
 *
 * Replaces the JavaCPP-generated `org.wamr.global.wamr` class.  Every opaque
 * WAMR handle (`wasm_runtime_t*`, `wasm_module_t*`, etc.) is a `Long` (jlong).
 * Errors throw `NSCWamrException` from the native layer.
 *
 * The library is built with `cargo-ndk` via `wamr-jni` (Rust crate).
 */
object NativeWamr {
    init {
        System.loadLibrary("wamr_jni")
    }

    // -- version ------------------------------------------------------------
    @JvmStatic external fun version(): String

    // -- global init --------------------------------------------------------
    @JvmStatic external fun wamrInit(): Boolean

    // -- runtime lifecycle --------------------------------------------------
    /** Returns a runtime handle (opaque jlong), or throws. */
    @JvmStatic external fun createRuntime(stackSize: Int): Long

    @JvmStatic external fun destroyRuntime(runtimeHandle: Long)

    // -- module loading / instantiation -------------------------------------
    @JvmStatic external fun loadModule(runtimeHandle: Long, wasmBytes: ByteArray): Long

    @JvmStatic external fun instantiate(moduleHandle: Long, runtimeHandle: Long): Long

    @JvmStatic external fun moduleName(moduleHandle: Long): String

    // -- function lookup / inspection ---------------------------------------
    @JvmStatic external fun findFunction(runtimeHandle: Long, name: String): Long

    @JvmStatic external fun functionName(funcHandle: Long): String

    @JvmStatic external fun functionArgCount(funcHandle: Long): Int

    /** Returns one of the WASM_I32..WASM_F64 type codes, or -1. */
    @JvmStatic external fun functionArgType(funcHandle: Long, index: Int): Int

    @JvmStatic external fun functionRetCount(funcHandle: Long): Int

    /** Returns one of the WASM_I32..WASM_F64 type codes, or -1. */
    @JvmStatic external fun functionRetType(funcHandle: Long, index: Int): Int

    // -- calling (two-phase: call + getResults) -----------------------------
    /**
     * Calls a WASM function.  `args` is an array of i64-encoded arguments
     * (one per parameter; i32/f32 in low 32 bits, i64/f64 as full 64 bits).
     * Returns null on success, or an error message string.
     */
    @JvmStatic external fun call(funcHandle: Long, nArgs: Int, args: LongArray): String?

    /**
     * Retrieves results from the last [call].  Returns a LongArray with one
     * i64-encoded value per result, or null on error.
     */
    @JvmStatic external fun getResults(funcHandle: Long, nRets: Int): LongArray?

    // -- memory -------------------------------------------------------------
    @JvmStatic external fun memorySize(runtimeHandle: Long): Int

    /**
     * Returns a direct `java.nio.ByteBuffer` wrapping the default linear memory,
     * or null if no memory is available.  Use [memorySize] to get the capacity.
     */
    @JvmStatic external fun getMemory(runtimeHandle: Long): java.nio.ByteBuffer?

    // -- host function linking ----------------------------------------------
    /**
     * Links a host import.  `trampoline` is a [HostTrampoline] instance that
     * the Rust JNI layer stores a global reference to and calls back via JNI
     * when the WASM module invokes the import.
     * Returns true on success, false on error (throws NSCWamrException).
     */
    @JvmStatic external fun linkHostFunction(
        runtimeHandle: Long,
        moduleName: String,
        name: String,
        signature: String,
        trampoline: HostTrampoline,
    ): Boolean

    // -- globals ------------------------------------------------------------
    /**
     * Reads a global.  Returns a LongArray of [type, bits] or null on error.
     * `bits` holds the raw value: i32/f32 in low 32 bits; i64/f64 is the full
     * 64-bit value.
     */
    @JvmStatic external fun getGlobal(instHandle: Long, name: String): LongArray?

    /** Returns the simplified type code for a named global, or -1. */
    @JvmStatic external fun getGlobalType(instHandle: Long, name: String): Int

    /**
     * Writes a global.  `bits` is the raw 64-bit value (i32/f32 in low 32).
     * Returns true on success, false on error (throws NSCWamrException).
     */
    @JvmStatic external fun setGlobal(
        instHandle: Long,
        name: String,
        typeCode: Int,
        bits: Long,
    ): Boolean

    // -- unload -------------------------------------------------------------
    @JvmStatic external fun unloadModule(moduleHandle: Long, runtimeHandle: Long)
}
