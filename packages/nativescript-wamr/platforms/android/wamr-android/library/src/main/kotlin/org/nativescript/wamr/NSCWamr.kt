package org.nativescript.wamr

import java.io.File
import org.bytedeco.javacpp.BytePointer
import org.bytedeco.javacpp.IntPointer
import org.bytedeco.javacpp.LongPointer
import org.bytedeco.javacpp.Pointer
import org.bytedeco.javacpp.PointerPointer
import org.wamr.RuntimeInitArgs
import org.wamr.WasmExecEnv
import org.wamr.WasmFunctionInst
import org.wamr.WasmModule
import org.wamr.WasmModuleInst
import org.wamr.WasmRawCall
import org.wamr.WasmRuntime
import org.wamr.global.wamr as wamr

// NSCWamr — Kotlin wrapper around the JavaCPP-generated WAMR bindings,
// consumed by the NativeScript Android runtime.
//
// Wire protocol shared with the iOS implementation (see the plugin's
// TypeScript layer):
//   i32        -> Int
//   i64        -> String (decimal, signed) on output; Number or String in
//   f32 / f64  -> Double

class NSCWamrException(message: String) : RuntimeException(message)

/** Host import callback. Return null (void), a single value, or an array. */
fun interface NSCWamrHostFunction {
    fun invoke(args: Array<Any>): Any?
}

private object Wire {
    // WAMR type-kind constants (mirrors the C definitions in nsc_wamr_shim.h).
    const val WASM_I32 = 0
    const val WASM_I64 = 1
    const val WASM_F32 = 2
    const val WASM_F64 = 3

    fun typeName(type: Int): String = when (type) {
        WASM_I32 -> "i32"
        WASM_I64 -> "i64"
        WASM_F32 -> "f32"
        WASM_F64 -> "f64"
        else -> "unknown"
    }

    /** Decodes a raw 64-bit slot into the wire value for `type`. */
    fun decode(type: Int, bits: Long): Any = when (type) {
        WASM_I32 -> bits.toInt()
        WASM_I64 -> bits.toString()
        WASM_F32 -> Float.fromBits(bits.toInt()).toDouble()
        WASM_F64 -> Double.fromBits(bits)
        else -> throw NSCWamrException("unsupported wasm value type: $type")
    }

    /** Encodes a JS-provided value into a raw 64-bit slot, or null if not coercible. */
    fun encode(type: Int, value: Any?): Long? = when (type) {
        WASM_I32 -> asLong(value)?.let { it.toInt().toLong() and 0xFFFF_FFFFL }
        WASM_I64 -> asLong(value)
        WASM_F32 -> asDouble(value)?.let { it.toFloat().toRawBits().toLong() and 0xFFFF_FFFFL }
        WASM_F64 -> asDouble(value)?.toRawBits()
        else -> null
    }

    private fun asLong(value: Any?): Long? = when (value) {
        is Number -> value.toLong()
        is String -> value.toLongOrNull() ?: value.toULongOrNull()?.toLong()
        else -> null
    }

    private fun asDouble(value: Any?): Double? = when (value) {
        is Number -> value.toDouble()
        is String -> value.toDoubleOrNull()
        else -> null
    }
}

private fun checkResult(result: BytePointer?, runtime: NSCWamrRuntime?) {
    if (result == null || result.isNull) return
    var message = result.string
    throw NSCWamrException(message)
}

// ---------------------------------------------------------------------------
// Host trampoline
// ---------------------------------------------------------------------------

/** One trampoline instance per linked import; WAMR dispatches back here. */
private class HostTrampoline(
    private val callback: NSCWamrHostFunction,
    private val paramTypes: IntArray,
    private val returnTypes: IntArray,
) : WasmRawCall() {
    companion object {
        // Trap messages must outlive the call — allocated once, never freed.
        private val TRAP_BAD_RETURN = BytePointer("NSCWamr: host function returned invalid values")
        private val TRAP_THREW = BytePointer("NSCWamr: host function threw an exception")
    }

    override fun call(
        execEnv: WasmExecEnv?,
        argsPtr: LongPointer?,
        nArgs: Int,
        resultsPtr: LongPointer?,
        nRets: Int,
    ): Pointer? {
        val args = Array<Any>(nArgs) { i ->
            Wire.decode(paramTypes[i], argsPtr!!.get(i.toLong()))
        }

        val result = try {
            callback.invoke(args)
        } catch (t: Throwable) {
            return TRAP_THREW
        }

        val returned: List<Any?> = when (result) {
            null -> emptyList()
            is Array<*> -> result.toList()
            is List<*> -> result
            else -> listOf(result)
        }
        if (returned.size != nRets) return TRAP_BAD_RETURN
        for (i in 0 until nRets) {
            val slot = Wire.encode(returnTypes[i], returned[i]) ?: return TRAP_BAD_RETURN
            resultsPtr!!.put(i.toLong(), slot)
        }
        return null
    }
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

class NSCWamrRuntime
@JvmOverloads
constructor(
    stackSizeInBytes: Int = 64 * 1024,
    wasiEnabled: Boolean = true,
    executionTier: String = "interpreter",
) : AutoCloseable {

    internal val runtime: WasmRuntime

    // WAMR references module bytes for the lifetime of the module, and the
    // callback thunks for the lifetime of the runtime — both are owned here.
    private val moduleBytes = mutableListOf<BytePointer>()
    internal val hostFunctions = mutableListOf<WasmRawCall>()
    private var closed = false

    companion object {
        private var globalInitDone = false

        @JvmStatic
        fun wamrVersion(): String = wamr.nsc_wamr_version()?.string ?: "unknown"

        private fun ensureGlobalInit() {
            if (globalInitDone) return
            val args = RuntimeInitArgs()
            try {
                args.mem_alloc_type(0)      // pool
                    .mem_alloc_option(0)    // default
                    .max_thread_num(1)
                if (!wamr.wasm_runtime_full_init(args)) {
                    throw NSCWamrException("wasm_runtime_full_init failed")
                }
                globalInitDone = true
            } finally {
                args.deallocate()
            }
        }
    }

    init {
        ensureGlobalInit()
        val errPtr = BytePointer(256)
        try {
            this.runtime = wamr.nsc_wamr_create_runtime(stackSizeInBytes, errPtr)
                ?: throw NSCWamrException(errPtr.string ?: "failed to create WAMR runtime")
        } finally {
            errPtr.deallocate()
        }
    }

    /** Parses, loads and compiles-on-demand a WebAssembly binary. */
    fun loadModule(bytes: ByteArray): NSCWamrModule {
        // Copy into native memory that outlives the call — WAMR may reference
        // the binary for the module's lifetime.
        val buffer = BytePointer(*bytes)
        val errPtr = BytePointer(256)
        try {
            val module = wamr.nsc_wamr_load_module(runtime, buffer, bytes.size, errPtr)
            if (module == null || module.isNull) {
                buffer.deallocate()
                throw NSCWamrException(errPtr.string ?: "failed to load module")
            }
            moduleBytes.add(buffer)
            return NSCWamrModule(module, this)
        } finally {
            errPtr.deallocate()
        }
    }

    fun loadModuleFromFile(path: String): NSCWamrModule = loadModule(File(path).readBytes())

    /** Finds an exported function anywhere in the runtime. */
    fun findFunction(name: String): NSCWamrFunction {
        val errPtr = BytePointer(256)
        try {
            val func = wamr.nsc_wamr_find_function(runtime, name, errPtr)
            if (func == null || func.isNull) {
                throw NSCWamrException(errPtr.string ?: "function not found: $name")
            }
            return NSCWamrFunction(func)
        } finally {
            errPtr.deallocate()
        }
    }

    // ------------------------------------------------------------------ memory

    fun memorySize(): Int = wamr.nsc_wamr_memory_size(runtime)

    fun readMemory(offset: Int, length: Int): ByteArray {
        val memory = memoryPointer()
        val size = memorySize().toLong()
        if (offset < 0 || length < 0 || offset + length.toLong() > size) {
            throw NSCWamrException("memory read out of bounds (offset $offset, length $length, size $size)")
        }
        val data = ByteArray(length)
        memory.position(offset.toLong()).get(data, 0, length)
        return data
    }

    fun writeMemory(offset: Int, data: ByteArray) {
        val memory = memoryPointer()
        val size = memorySize().toLong()
        if (offset < 0 || offset + data.size.toLong() > size) {
            throw NSCWamrException("memory write out of bounds (offset $offset, length ${data.size}, size $size)")
        }
        memory.position(offset.toLong()).put(data, 0, data.size)
    }

    private fun memoryPointer(): BytePointer {
        return wamr.nsc_wamr_get_memory(runtime)
            ?: throw NSCWamrException("module has no linear memory")
    }

    override fun close() {
        if (closed) return
        closed = true
        wamr.nsc_wamr_destroy_runtime(runtime)
        moduleBytes.forEach { it.deallocate() }
        moduleBytes.clear()
        hostFunctions.forEach { it.deallocate() }
        hostFunctions.clear()
    }
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

class NSCWamrModule internal constructor(
    private val module: WasmModule,
    val runtime: NSCWamrRuntime,
) {
    private var inst: WasmModuleInst? = null

    val name: String
        get() = wamr.nsc_wamr_module_name(module)?.string ?: ""

    /** Ensures the module is instantiated (lazy, on first use). */
    private fun ensureInstantiated() {
        if (inst != null) return
        val errPtr = BytePointer(256)
        try {
            inst = wamr.nsc_wamr_instantiate(module, runtime.runtime, errPtr)
                ?: throw NSCWamrException(errPtr.string ?: "failed to instantiate module")
        } finally {
            errPtr.deallocate()
        }
    }

    internal fun moduleInst(): WasmModuleInst {
        ensureInstantiated()
        return inst!!
    }

    fun findFunction(name: String): NSCWamrFunction = runtime.findFunction(name)

    /**
     * Links a callback as a WebAssembly import. `signature` uses wasm3
     * notation, e.g. "i(ii)", "F(FF)", "v(I)" — i:i32 I:i64 f:f32 F:f64 v:void.
     */
    fun linkHostFunction(
        moduleName: String,
        name: String,
        signature: String,
        callback: NSCWamrHostFunction,
    ) {
        ensureInstantiated()
        val (paramTypes, returnTypes) = parseSignature(signature)
        val trampoline = HostTrampoline(callback, paramTypes, returnTypes)
        checkResult(
            wamr.nsc_wamr_link_host_function(inst, moduleName, name, signature, trampoline),
            runtime,
        )
        runtime.hostFunctions.add(trampoline)
    }

    // ------------------------------------------------------------------ globals

    fun getGlobal(name: String): Any {
        ensureInstantiated()
        val typeOut = IntPointer(1)
        val bitsOut = LongPointer(1)
        try {
            checkResult(wamr.nsc_wamr_get_global(inst, name, typeOut, bitsOut), runtime)
            return Wire.decode(typeOut.get(), bitsOut.get())
        } finally {
            typeOut.deallocate()
            bitsOut.deallocate()
        }
    }

    fun setGlobal(name: String, value: Any?) {
        ensureInstantiated()
        val globalType = wamr.nsc_wamr_get_global_type(inst, name)
        val bits = Wire.encode(globalType, value)
            ?: throw NSCWamrException("cannot convert value to ${Wire.typeName(globalType)} for global: $name")
        checkResult(wamr.nsc_wamr_set_global(inst, name, globalType, bits), runtime)
    }

    private companion object {
        /** Parses a wasm3-style signature into type-kind arrays. */
        fun parseSignature(signature: String): Pair<IntArray, IntArray> {
            val compact = signature.replace("\\s+".toRegex(), "")
            val match = Regex("^([vifIF]*)\\(([vifIF]*)\\)\$").find(compact)
                ?: throw NSCWamrException("invalid wasm signature: \"$signature\"")
            val toTypes: (String) -> IntArray = { chars ->
                chars.filter { it != 'v' }.map { c ->
                    when (c) {
                        'i' -> Wire.WASM_I32
                        'I' -> Wire.WASM_I64
                        'f' -> Wire.WASM_F32
                        'F' -> Wire.WASM_F64
                        else -> throw NSCWamrException("invalid signature character: $c")
                    }
                }.toIntArray()
            }
            return Pair(toTypes(match.groupValues[2]), toTypes(match.groupValues[1]))
        }
    }
}

// ---------------------------------------------------------------------------
// Function
// ---------------------------------------------------------------------------

class NSCWamrFunction internal constructor(
    private val function: WasmFunctionInst,
) {
    val name: String
        get() = wamr.nsc_wamr_function_name(function)?.string ?: ""

    val paramTypes: Array<String>
        get() = Array(wamr.nsc_wamr_function_arg_count(function)) {
            Wire.typeName(wamr.nsc_wamr_function_arg_type(function, it))
        }

    val returnTypes: Array<String>
        get() = Array(wamr.nsc_wamr_function_ret_count(function)) {
            Wire.typeName(wamr.nsc_wamr_function_ret_type(function, it))
        }

    /** Calls the function. Returns one wire-encoded value per result. */
    fun call(args: Array<Any?>): Array<Any> {
        val nArgs = wamr.nsc_wamr_function_arg_count(function)
        val nRets = wamr.nsc_wamr_function_ret_count(function)
        if (args.size != nArgs) {
            throw NSCWamrException("expected $nArgs arguments, got ${args.size}")
        }

        val slots = LongPointer(maxOf(1, nArgs).toLong())
        val argPtrs = PointerPointer<Pointer>(maxOf(1, nArgs).toLong())
        val retSlots = LongPointer(maxOf(1, nRets).toLong())
        val retPtrs = PointerPointer<Pointer>(maxOf(1, nRets).toLong())
        try {
            for (i in 0 until nArgs) {
                val type = wamr.nsc_wamr_function_arg_type(function, i)
                val bits = Wire.encode(type, args[i])
                    ?: throw NSCWamrException("argument $i is not convertible to ${Wire.typeName(type)}")
                slots.put(i.toLong(), bits)
                argPtrs.put(i.toLong(), slots.getPointer(i.toLong()))
            }
            checkResult(wamr.nsc_wamr_call(function, nArgs, argPtrs), null)

            if (nRets == 0) return emptyArray()
            for (i in 0 until nRets) {
                retPtrs.put(i.toLong(), retSlots.getPointer(i.toLong()))
            }
            checkResult(wamr.nsc_wamr_get_results(function, nRets, retPtrs), null)
            return Array(nRets) { i ->
                Wire.decode(
                    wamr.nsc_wamr_function_ret_type(function, i),
                    retSlots.get(i.toLong()),
                )
            }
        } finally {
            slots.deallocate()
            argPtrs.deallocate()
            retSlots.deallocate()
            retPtrs.deallocate()
        }
    }
}
