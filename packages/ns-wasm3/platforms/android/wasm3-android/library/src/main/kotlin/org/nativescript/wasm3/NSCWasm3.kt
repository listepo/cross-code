package org.nativescript.wasm3

import java.io.File

/** Masks a raw slot down to its low 32 bits (i32/f32 values). */
private const val UINT32_MASK = 0xFFFF_FFFFL

/** Default wasm3 stack size per runtime (64 KiB). */
private const val DEFAULT_STACK_SIZE = 64 * 1024

// NSCWasm3 — Kotlin wrapper around the wasm3 native library (libwasm3_jni.so),
// consumed by the NativeScript Android runtime.
//
// Opaque wasm3 handles (IM3Runtime, IM3Module, IM3Function, IM3Global) are
// stored as `Long` and passed through to the JNI layer unchanged.
//
// Wire protocol (shared with iOS / TypeScript):
//   i32        -> Int
//   i64        -> String (decimal, signed)
//   f32 / f64  -> Double

class NSCWasm3Exception(message: String) : RuntimeException(message)

/** Host import callback. Return null (void), a single value, or an array. */
fun interface NSCWasm3HostFunction {
    fun invoke(args: Array<Any>): Any?
}

private object Wire {
    fun typeName(type: Int): String = when (type) {
        NativeWasm3.cM3TypeI32() -> "i32"
        NativeWasm3.cM3TypeI64() -> "i64"
        NativeWasm3.cM3TypeF32() -> "f32"
        NativeWasm3.cM3TypeF64() -> "f64"
        else -> "unknown"
    }

    /** Decodes a raw 64-bit wasm3 slot into the wire value for `type`. */
    fun decode(type: Int, bits: Long): Any = when (type) {
        NativeWasm3.cM3TypeI32() -> bits.toInt()
        NativeWasm3.cM3TypeI64() -> bits.toString()
        NativeWasm3.cM3TypeF32() -> Float.fromBits(bits.toInt()).toDouble()
        NativeWasm3.cM3TypeF64() -> Double.fromBits(bits)
        else -> throw NSCWasm3Exception("unsupported wasm value type: $type")
    }

    /** Encodes a JS-provided value into a raw 64-bit slot, or null if not coercible. */
    fun encode(type: Int, value: Any?): Long? = when (type) {
        NativeWasm3.cM3TypeI32() -> asLong(value)?.let { it.toInt().toLong() and UINT32_MASK }
        NativeWasm3.cM3TypeI64() -> asLong(value)
        NativeWasm3.cM3TypeF32() -> asDouble(value)?.let { it.toFloat().toRawBits().toLong() and UINT32_MASK }
        NativeWasm3.cM3TypeF64() -> asDouble(value)?.toRawBits()
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
    if (err != null) throw NSCWasm3Exception(err)
}

/** One trampoline instance per linked import; wasm3 dispatches back here via JNI. */
class HostTrampoline(
    private val callback: NSCWasm3HostFunction,
    private val paramTypes: IntArray,
    private val returnTypes: IntArray,
) {
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

class NSCWasm3Runtime @JvmOverloads constructor(stackSizeInBytes: Int = DEFAULT_STACK_SIZE) : AutoCloseable {
    internal var envHandle: Long = 0
        private set
    internal var runtimeHandle: Long = 0
        private set

    // wasm3 references module bytes for the lifetime of the module.
    private val moduleBytes = mutableListOf<ByteArray>()
    internal val hostTrampolines = mutableListOf<HostTrampoline>()
    private var closed = false

    companion object {
        @JvmStatic
        fun wasm3Version(): String = NativeWasm3.version()
    }

    init {
        envHandle = NativeWasm3.newEnvironment()
        if (envHandle == 0L) throw NSCWasm3Exception("failed to create wasm3 environment")
        runtimeHandle = NativeWasm3.newRuntime(envHandle, stackSizeInBytes)
        if (runtimeHandle == 0L) throw NSCWasm3Exception("failed to create wasm3 runtime")
    }

    /** Parses, loads and compiles-on-demand a WebAssembly binary. */
    fun loadModule(bytes: ByteArray): NSCWasm3Module {
        val copy = bytes.copyOf()
        val moduleHandle = NativeWasm3.parseModule(envHandle, copy)
        if (moduleHandle == 0L) {
            throw NSCWasm3Exception("failed to parse module")
        }
        if (!NativeWasm3.loadModule(runtimeHandle, moduleHandle)) {
            NativeWasm3.freeModule(moduleHandle)
            throw NSCWasm3Exception("failed to load module")
        }
        moduleBytes.add(copy)
        return NSCWasm3Module(moduleHandle, this)
    }

    fun loadModuleFromFile(path: String): NSCWasm3Module = loadModule(File(path).readBytes())

    /** Finds an exported function anywhere in the runtime. */
    fun findFunction(name: String): NSCWasm3Function {
        val funcHandle = NativeWasm3.findFunction(runtimeHandle, name)
        if (funcHandle == 0L) {
            throw NSCWasm3Exception("function not found: $name")
        }
        return NSCWasm3Function(funcHandle, this)
    }

    // ------------------------------------------------------------------ memory

    fun memorySize(): Int = NativeWasm3.memorySize(runtimeHandle)

    fun readMemory(offset: Int, length: Int): ByteArray {
        val memory = NativeWasm3.getMemory(runtimeHandle)
            ?: throw NSCWasm3Exception("module has no linear memory")
        val size = NativeWasm3.memorySize(runtimeHandle).toLong()
        if (offset < 0 || length < 0 || offset + length.toLong() > size) {
            throw NSCWasm3Exception("memory read out of bounds (offset $offset, length $length, size $size)")
        }
        val data = ByteArray(length)
        memory.position(offset)
        memory.get(data)
        return data
    }

    fun writeMemory(offset: Int, data: ByteArray) {
        val memory = NativeWasm3.getMemory(runtimeHandle)
            ?: throw NSCWasm3Exception("module has no linear memory")
        val size = NativeWasm3.memorySize(runtimeHandle).toLong()
        if (offset < 0 || offset + data.size.toLong() > size) {
            throw NSCWasm3Exception("memory write out of bounds (offset $offset, length ${data.size}, size $size)")
        }
        memory.position(offset)
        memory.put(data)
    }

    override fun close() {
        if (closed) return
        closed = true
        if (runtimeHandle != 0L) {
            NativeWasm3.freeRuntime(runtimeHandle)
            runtimeHandle = 0
        }
        if (envHandle != 0L) {
            NativeWasm3.freeEnvironment(envHandle)
            envHandle = 0
        }
        moduleBytes.clear()
        hostTrampolines.clear()
    }
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

class NSCWasm3Module internal constructor(private val moduleHandle: Long, val runtime: NSCWasm3Runtime) {
    val name: String
        get() = NativeWasm3.moduleName(moduleHandle)

    fun findFunction(name: String): NSCWasm3Function = runtime.findFunction(name)

    fun linkHostFunction(moduleName: String, name: String, signature: String, callback: NSCWasm3HostFunction) {
        val (paramTypes, returnTypes) = parseSignature(signature)
        val trampoline = HostTrampoline(callback, paramTypes, returnTypes)
        val ok = NativeWasm3.linkRawFunctionEx(
            moduleHandle,
            moduleName,
            name,
            signature,
            trampoline,
        )
        if (!ok) {
            throw NSCWasm3Exception("failed to link host function: $moduleName.$name")
        }
        runtime.hostTrampolines.add(trampoline)
    }

    // ------------------------------------------------------------------ globals

    fun getGlobal(name: String): Any {
        val globalHandle = NativeWasm3.findGlobal(moduleHandle, name)
        if (globalHandle == 0L) throw NSCWasm3Exception("global not found: $name")
        val result = NativeWasm3.globalGet(globalHandle)
            ?: throw NSCWasm3Exception("failed to read global: $name")
        val type = result[0].toInt()
        val bits = result[1]
        return Wire.decode(type, bits)
    }

    fun setGlobal(name: String, value: Any?) {
        val globalHandle = NativeWasm3.findGlobal(moduleHandle, name)
        if (globalHandle == 0L) throw NSCWasm3Exception("global not found: $name")
        val type = NativeWasm3.globalType(globalHandle)
        val bits = Wire.encode(type, value)
            ?: throw NSCWasm3Exception("cannot convert value to ${Wire.typeName(type)} for global: $name")
        if (!NativeWasm3.globalSet(globalHandle, type, bits)) {
            throw NSCWasm3Exception("failed to set global: $name")
        }
    }

    private companion object {
        /** Parses a wasm3-style signature into type-kind arrays. */
        fun parseSignature(signature: String): Pair<IntArray, IntArray> {
            val compact = signature.replace("\\s+".toRegex(), "")
            val match = Regex("^([vifIF]*)\\(([vifIF]*)\\)\$").find(compact)
                ?: throw NSCWasm3Exception("invalid wasm signature: \"$signature\"")
            val toTypes: (String) -> IntArray = { chars ->
                chars
                    .filter { it != 'v' }
                    .map { c ->
                        when (c) {
                            'i' -> NativeWasm3.cM3TypeI32()
                            'I' -> NativeWasm3.cM3TypeI64()
                            'f' -> NativeWasm3.cM3TypeF32()
                            'F' -> NativeWasm3.cM3TypeF64()
                            else -> throw NSCWasm3Exception("invalid signature character: $c")
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

class NSCWasm3Function internal constructor(private val funcHandle: Long, private val runtime: NSCWasm3Runtime) {
    val name: String
        get() = NativeWasm3.functionName(funcHandle)

    val paramTypes: Array<String>
        get() = Array(NativeWasm3.argCount(funcHandle)) {
            Wire.typeName(NativeWasm3.argType(funcHandle, it))
        }

    val returnTypes: Array<String>
        get() = Array(NativeWasm3.retCount(funcHandle)) {
            Wire.typeName(NativeWasm3.retType(funcHandle, it))
        }

    /** Calls the function. Returns one wire-encoded value per result. */
    fun call(args: Array<Any?>): Array<Any> {
        val nArgs = NativeWasm3.argCount(funcHandle)
        val nRets = NativeWasm3.retCount(funcHandle)
        if (args.size != nArgs) {
            throw NSCWasm3Exception("expected $nArgs arguments, got ${args.size}")
        }

        val slots = LongArray(maxOf(1, nArgs))
        for (i in 0 until nArgs) {
            val type = NativeWasm3.argType(funcHandle, i)
            val bits = Wire.encode(type, args[i])
                ?: throw NSCWasm3Exception("argument $i is not convertible to ${Wire.typeName(type)}")
            slots[i] = bits
        }

        val err = NativeWasm3.call(funcHandle, nArgs, slots)
        checkJniError(err)

        if (nRets == 0) return emptyArray()

        val results = NativeWasm3.getResults(funcHandle, nRets)
            ?: throw NSCWasm3Exception("failed to get results")

        return Array(nRets) { i ->
            Wire.decode(NativeWasm3.retType(funcHandle, i), results[i])
        }
    }
}
