package org.nativescript.wasm3

/**
 * JNI declarations for the wasm3 native library (libwasm3_jni.so).
 *
 * Replaces the JavaCPP-generated `org.wasm3.global.wasm3` class.  Every opaque
 * wasm3 handle is a `Long` (jlong).  Errors throw `NSCWasm3Exception`.
 */
object NativeWasm3 {
    init {
        System.loadLibrary("wasm3_jni")
    }

    // -- constants ----------------------------------------------------------
    @JvmStatic external fun version(): String
    @JvmStatic external fun cM3TypeI32(): Int
    @JvmStatic external fun cM3TypeI64(): Int
    @JvmStatic external fun cM3TypeF32(): Int
    @JvmStatic external fun cM3TypeF64(): Int

    // -- runtime lifecycle --------------------------------------------------
    @JvmStatic external fun newEnvironment(): Long
    @JvmStatic external fun newRuntime(envHandle: Long, stackSize: Int): Long
    @JvmStatic external fun freeRuntime(runtimeHandle: Long)
    @JvmStatic external fun freeEnvironment(envHandle: Long)

    // -- module -------------------------------------------------------------

    /** Parses WASM bytes, returns module handle or throws. */
    @JvmStatic external fun parseModule(envHandle: Long, wasmBytes: ByteArray): Long
    @JvmStatic external fun loadModule(runtimeHandle: Long, moduleHandle: Long): Boolean
    @JvmStatic external fun freeModule(moduleHandle: Long)
    @JvmStatic external fun moduleName(moduleHandle: Long): String

    // -- function -----------------------------------------------------------
    @JvmStatic external fun findFunction(runtimeHandle: Long, name: String): Long
    @JvmStatic external fun functionName(funcHandle: Long): String
    @JvmStatic external fun argCount(funcHandle: Long): Int
    @JvmStatic external fun retCount(funcHandle: Long): Int
    @JvmStatic external fun argType(funcHandle: Long, index: Int): Int
    @JvmStatic external fun retType(funcHandle: Long, index: Int): Int

    // -- calling ------------------------------------------------------------

    /** Returns null on success, or an error string. */
    @JvmStatic external fun call(funcHandle: Long, nArgs: Int, args: LongArray): String?
    /** Returns a LongArray of results, or null on error. */
    @JvmStatic external fun getResults(funcHandle: Long, nRets: Int): LongArray?

    // -- memory -------------------------------------------------------------
    @JvmStatic external fun memorySize(runtimeHandle: Long): Int
    /** Returns a direct ByteBuffer wrapping linear memory, or null. */
    @JvmStatic external fun getMemory(runtimeHandle: Long): java.nio.ByteBuffer?

    // -- host functions -----------------------------------------------------
    @JvmStatic external fun linkRawFunctionEx(
        moduleHandle: Long,
        moduleName: String,
        name: String,
        signature: String,
        callback: HostTrampoline,
    ): Boolean

    // -- globals ------------------------------------------------------------
    @JvmStatic external fun findGlobal(moduleHandle: Long, name: String): Long
    @JvmStatic external fun globalType(globalHandle: Long): Int
    /** Returns [type, bits] or null on error. */
    @JvmStatic external fun globalGet(globalHandle: Long): LongArray?
    @JvmStatic external fun globalSet(globalHandle: Long, typeCode: Int, bits: Long): Boolean

    // -- error info ---------------------------------------------------------
    @JvmStatic external fun getErrorInfo(runtimeHandle: Long): String
    @JvmStatic external fun resetErrorInfo(runtimeHandle: Long)
}
