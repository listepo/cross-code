package org.nativescript.wamr

import java.io.File

// NSCWamr — Kotlin wrapper around the WAMR native library (libwamr_jni.so),
// consumed by the NativeScript Android runtime.
//
// Opaque WAMR handles (runtime, module, function) are stored as `Long` and
// passed through to the JNI layer unchanged.
//
// Wire protocol (shared with iOS / TypeScript):
//   i32        -> Int
//   i64        -> String (decimal, signed)
//   f32 / f64  -> Double

class NSCWamrException(message: String) : RuntimeException(message)

/** Host import callback. Return null (void), a single value, or an array. */
fun interface NSCWamrHostFunction {
    fun invoke(args: Array<Any>): Any?
}

private object Wire {
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

private fun checkJniError(err: String?) {
    if (err != null) throw NSCWamrException(err)
}

// ---------------------------------------------------------------------------
// Host trampoline — Rust calls back into Kotlin via this JNI-callable object
// ---------------------------------------------------------------------------

/**
 * One trampoline instance per linked import.  The Rust JNI layer stores a
 * global reference to this object and invokes [invoke] via JNI when the
 * WASM module calls the import.
 *
 * WARNING: This object MUST NOT be garbage-collected while the runtime is
 * alive.  The [NSCWamrRuntime] keeps a strong reference in [hostTrampolines].
 */
class HostTrampoline(
    val callback: NSCWamrHostFunction,
    val paramTypes: IntArray,
    val returnTypes: IntArray,
) {
    /**
     * Called from Rust JNI (`wamr_jni_host_trampoline`) when WAMR invokes
     * the host import.
     *
     * @param argsRaw array of i64-encoded arguments (one per param)
     * @return array of i64-encoded results (one per return), or null on error
     */
    @Suppress("unused") // called from JNI
    fun invoke(argsRaw: LongArray): LongArray? {
        val args = Array(paramTypes.size) { i ->
            Wire.decode(paramTypes[i], argsRaw[i])
        }

        val result: Any? = try {
            callback.invoke(args)
        } catch (_: Throwable) {
            return null
        }

        val returned: List<Any?> = when (result) {
            null -> emptyList()
            is Array<*> -> result.toList()
            is List<*> -> result
            else -> listOf(result)
        }

        if (returned.size != returnTypes.size) return null
        val out = LongArray(returned.size)
        for (i in returned.indices) {
            val slot = Wire.encode(returnTypes[i], returned[i]) ?: return null
            out[i] = slot
        }
        return out
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

    internal var runtimeHandle: Long = 0
        private set

    // WAMR needs module bytes to stay alive.  The Kotlin wrapper copies them
    // into ByteArrays; they are held here for the runtime's lifetime.
    private val moduleBytes = mutableListOf<ByteArray>()
    internal val hostTrampolines = mutableListOf<HostTrampoline>()
    private var closed = false

    companion object {
        private var globalInitDone = false

        @JvmStatic
        fun wamrVersion(): String = NativeWamr.version()

        private fun ensureGlobalInit() {
            if (globalInitDone) return
            if (!NativeWamr.wamrInit()) {
                throw NSCWamrException("wasm_runtime_init failed")
            }
            globalInitDone = true
        }
    }

    init {
        ensureGlobalInit()
        runtimeHandle = NativeWamr.createRuntime(stackSizeInBytes)
        if (runtimeHandle == 0L) {
            throw NSCWamrException("failed to create WAMR runtime")
        }
    }

    /** Parses, loads and compiles-on-demand a WebAssembly binary. */
    fun loadModule(bytes: ByteArray): NSCWamrModule {
        // Copy the bytes — WAMR may retain a pointer to the buffer.
        val copy = bytes.copyOf()
        val moduleHandle = NativeWamr.loadModule(runtimeHandle, copy)
        if (moduleHandle == 0L) {
            throw NSCWamrException("failed to load module")
        }
        moduleBytes.add(copy)
        return NSCWamrModule(moduleHandle, this)
    }

    fun loadModuleFromFile(path: String): NSCWamrModule = loadModule(File(path).readBytes())

    /** Finds an exported function anywhere in the runtime. */
    fun findFunction(name: String): NSCWamrFunction {
        val funcHandle = NativeWamr.findFunction(runtimeHandle, name)
        if (funcHandle == 0L) {
            throw NSCWamrException("function not found: $name")
        }
        return NSCWamrFunction(funcHandle)
    }

    // ------------------------------------------------------------------ memory

    fun memorySize(): Int = NativeWamr.memorySize(runtimeHandle)

    fun readMemory(offset: Int, length: Int): ByteArray {
        val memory = NativeWamr.getMemory(runtimeHandle)
            ?: throw NSCWamrException("module has no linear memory")
        val size = NativeWamr.memorySize(runtimeHandle).toLong()
        if (offset < 0 || length < 0 || offset + length.toLong() > size) {
            throw NSCWamrException(
                "memory read out of bounds (offset $offset, length $length, size $size)"
            )
        }
        val data = ByteArray(length)
        memory.position(offset).get(data)
        return data
    }

    fun writeMemory(offset: Int, data: ByteArray) {
        val memory = NativeWamr.getMemory(runtimeHandle)
            ?: throw NSCWamrException("module has no linear memory")
        val size = NativeWamr.memorySize(runtimeHandle).toLong()
        if (offset < 0 || offset + data.size.toLong() > size) {
            throw NSCWamrException(
                "memory write out of bounds (offset $offset, length ${data.size}, size $size)"
            )
        }
        memory.position(offset).put(data)
    }

    override fun close() {
        if (closed) return
        closed = true
        if (runtimeHandle != 0L) {
            NativeWamr.destroyRuntime(runtimeHandle)
            runtimeHandle = 0
        }
        moduleBytes.clear()
        hostTrampolines.clear()
    }
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

class NSCWamrModule internal constructor(
    private val moduleHandle: Long,
    val runtime: NSCWamrRuntime,
) {
    private var instHandle: Long = 0

    val name: String
        get() = NativeWamr.moduleName(moduleHandle)

    /** Ensures the module is instantiated (lazy, on first use). */
    private fun ensureInstantiated() {
        if (instHandle != 0L) return
        instHandle = NativeWamr.instantiate(moduleHandle, runtime.runtimeHandle)
        if (instHandle == 0L) {
            throw NSCWamrException("failed to instantiate module")
        }
    }

    internal fun moduleInst(): Long {
        ensureInstantiated()
        return instHandle
    }

    fun findFunction(name: String): NSCWamrFunction = runtime.findFunction(name)

    /**
     * Links a callback as a WebAssembly import. `signature` uses wasm3
     * notation, e.g. "i(ii)", "F(FF)", "v(I)".
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
        runtime.hostTrampolines.add(trampoline)

        val ok = NativeWamr.linkHostFunction(
            instHandle, moduleName, name, signature, trampoline
        )
        if (!ok) {
            throw NSCWamrException("failed to link host function: $moduleName.$name")
        }
    }

    // ------------------------------------------------------------------ globals

    fun getGlobal(name: String): Any {
        ensureInstantiated()
        val result = NativeWamr.getGlobal(instHandle, name)
            ?: throw NSCWamrException("global not found: $name")
        val type = result[0].toInt()
        val bits = result[1]
        return Wire.decode(type, bits)
    }

    fun setGlobal(name: String, value: Any?) {
        ensureInstantiated()
        val globalType = NativeWamr.getGlobalType(instHandle, name)
        if (globalType < 0) {
            throw NSCWamrException("global not found: $name")
        }
        val bits = Wire.encode(globalType, value)
            ?: throw NSCWamrException(
                "cannot convert value to ${Wire.typeName(globalType)} for global: $name"
            )
        if (!NativeWamr.setGlobal(instHandle, name, globalType, bits)) {
            throw NSCWamrException("failed to set global: $name")
        }
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
    private val funcHandle: Long,
) {
    val name: String
        get() = NativeWamr.functionName(funcHandle)

    val paramTypes: Array<String>
        get() = Array(NativeWamr.functionArgCount(funcHandle)) {
            Wire.typeName(NativeWamr.functionArgType(funcHandle, it))
        }

    val returnTypes: Array<String>
        get() = Array(NativeWamr.functionRetCount(funcHandle)) {
            Wire.typeName(NativeWamr.functionRetType(funcHandle, it))
        }

    /** Calls the function. Returns one wire-encoded value per result. */
    fun call(args: Array<Any?>): Array<Any> {
        val nArgs = NativeWamr.functionArgCount(funcHandle)
        val nRets = NativeWamr.functionRetCount(funcHandle)
        if (args.size != nArgs) {
            throw NSCWamrException("expected $nArgs arguments, got ${args.size}")
        }

        // Encode arguments as i64
        val argSlots = LongArray(maxOf(1, nArgs))
        for (i in 0 until nArgs) {
            val type = NativeWamr.functionArgType(funcHandle, i)
            val bits = Wire.encode(type, args[i])
                ?: throw NSCWamrException(
                    "argument $i is not convertible to ${Wire.typeName(type)}"
                )
            argSlots[i] = bits
        }

        val err = NativeWamr.call(funcHandle, nArgs, argSlots)
        checkJniError(err)

        if (nRets == 0) return emptyArray()

        val results = NativeWamr.getResults(funcHandle, nRets)
            ?: throw NSCWamrException("failed to get results")

        return Array(nRets) { i ->
            Wire.decode(NativeWamr.functionRetType(funcHandle, i), results[i])
        }
    }
}
