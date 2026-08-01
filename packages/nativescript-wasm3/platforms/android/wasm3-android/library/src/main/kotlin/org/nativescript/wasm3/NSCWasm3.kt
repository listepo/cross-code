package org.nativescript.wasm3

import java.io.File
import org.bytedeco.javacpp.BytePointer
import org.bytedeco.javacpp.IntPointer
import org.bytedeco.javacpp.LongPointer
import org.bytedeco.javacpp.Pointer
import org.bytedeco.javacpp.PointerPointer
import org.wasm3.M3ErrorInfo
import org.wasm3.M3Function
import org.wasm3.M3ImportContext
import org.wasm3.M3Module
import org.wasm3.M3RawCall
import org.wasm3.M3Runtime
import org.wasm3.global.wasm3 as m3

// NSCWasm3 — Kotlin wrapper around the JavaCPP-generated wasm3 bindings,
// consumed by the NativeScript Android runtime.
//
// Wire protocol shared with the iOS implementation (see the plugin's
// TypeScript layer):
//   i32        -> Int
//   i64        -> String (decimal, signed) on output; Number or String in
//   f32 / f64  -> Double

class NSCWasm3Exception(message: String) : RuntimeException(message)

/** Host import callback. Return null (void), a single value, or an array. */
fun interface NSCWasm3HostFunction {
    fun invoke(args: Array<Any>): Any?
}

private object Wire {
    fun typeName(type: Int): String = when (type) {
        m3.c_m3Type_i32 -> "i32"
        m3.c_m3Type_i64 -> "i64"
        m3.c_m3Type_f32 -> "f32"
        m3.c_m3Type_f64 -> "f64"
        else -> "unknown"
    }

    /** Decodes a raw 64-bit wasm3 slot into the wire value for `type`. */
    fun decode(type: Int, bits: Long): Any = when (type) {
        m3.c_m3Type_i32 -> bits.toInt()
        m3.c_m3Type_i64 -> bits.toString()
        m3.c_m3Type_f32 -> Float.fromBits(bits.toInt()).toDouble()
        m3.c_m3Type_f64 -> Double.fromBits(bits)
        else -> throw NSCWasm3Exception("unsupported wasm value type: $type")
    }

    /** Encodes a JS-provided value into a raw 64-bit slot, or null if not coercible. */
    fun encode(type: Int, value: Any?): Long? = when (type) {
        m3.c_m3Type_i32 -> asLong(value)?.let { it.toInt().toLong() and 0xFFFF_FFFFL }
        m3.c_m3Type_i64 -> asLong(value)
        m3.c_m3Type_f32 -> asDouble(value)?.let { it.toFloat().toRawBits().toLong() and 0xFFFF_FFFFL }
        m3.c_m3Type_f64 -> asDouble(value)?.toRawBits()
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

private fun checkResult(result: BytePointer?, runtime: NSCWasm3Runtime?) {
    if (result == null || result.isNull) return
    var message = result.string
    if (runtime != null) {
        val info = M3ErrorInfo()
        try {
            m3.m3_GetErrorInfo(runtime.runtime, info)
            val detailPtr = info.message()
            val detail = if (detailPtr != null && !detailPtr.isNull) detailPtr.string else null
            if (!detail.isNullOrEmpty() && detail != message) message += ": $detail"
            m3.m3_ResetErrorInfo(runtime.runtime)
        } finally {
            info.deallocate()
        }
    }
    throw NSCWasm3Exception(message)
}

/** One trampoline instance per linked import; wasm3 dispatches back here. */
private class HostTrampoline(private val callback: NSCWasm3HostFunction) : M3RawCall() {
    companion object {
        // Trap messages must outlive the call — allocated once, never freed.
        private val TRAP_BAD_RETURN = BytePointer("NSCWasm3: host function returned invalid values")
        private val TRAP_THREW = BytePointer("NSCWasm3: host function threw an exception")
    }

    override fun call(
        runtime: M3Runtime?,
        ctx: M3ImportContext?,
        sp: LongPointer?,
        mem: Pointer?,
    ): Pointer? {
        val function = ctx?.function() ?: return TRAP_BAD_RETURN
        val nArgs = m3.m3_GetArgCount(function)
        val nRets = m3.m3_GetRetCount(function)

        val args = Array<Any>(nArgs) { i ->
            Wire.decode(m3.m3_GetArgType(function, i), sp!!.get((nRets + i).toLong()))
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
            val slot = Wire.encode(m3.m3_GetRetType(function, i), returned[i])
                ?: return TRAP_BAD_RETURN
            sp!!.put(i.toLong(), slot)
        }
        return null
    }
}

class NSCWasm3Runtime @JvmOverloads constructor(stackSizeInBytes: Int = 64 * 1024) : AutoCloseable {
    internal val environment: org.wasm3.M3Environment =
        m3.m3_NewEnvironment() ?: throw NSCWasm3Exception("failed to create wasm3 environment")
    internal val runtime: M3Runtime =
        m3.m3_NewRuntime(environment, stackSizeInBytes, null)
            ?: throw NSCWasm3Exception("failed to create wasm3 runtime")

    // wasm3 references module bytes for the lifetime of the module, and the
    // callback thunks for the lifetime of the runtime — both are owned here.
    private val moduleBytes = mutableListOf<BytePointer>()
    internal val hostFunctions = mutableListOf<M3RawCall>()
    private var closed = false

    companion object {
        @JvmStatic
        fun wasm3Version(): String = m3.M3_VERSION
    }

    /** Parses, loads and compiles-on-demand a WebAssembly binary. */
    fun loadModule(bytes: ByteArray): NSCWasm3Module {
        // Copy into native memory that outlives the call — wasm3 references
        // the binary for the module's lifetime.
        val buffer = BytePointer(*bytes)
        val out = PointerPointer<M3Module>(1)
        try {
            val parseResult = m3.m3_ParseModule(environment, out, buffer, bytes.size)
            if (parseResult != null && !parseResult.isNull) {
                buffer.deallocate()
                checkResult(parseResult, null)
            }
            val module = M3Module(out.get(0))
            val loadResult = m3.m3_LoadModule(runtime, module)
            if (loadResult != null && !loadResult.isNull) {
                m3.m3_FreeModule(module)
                buffer.deallocate()
                checkResult(loadResult, this)
            }
            moduleBytes.add(buffer)
            return NSCWasm3Module(module, this)
        } finally {
            out.deallocate()
        }
    }

    fun loadModuleFromFile(path: String): NSCWasm3Module = loadModule(File(path).readBytes())

    /** Finds an exported function anywhere in the runtime. */
    fun findFunction(name: String): NSCWasm3Function {
        val out = PointerPointer<M3Function>(1)
        try {
            checkResult(m3.m3_FindFunction(out, runtime, name), this)
            return NSCWasm3Function(M3Function(out.get(0)), this)
        } finally {
            out.deallocate()
        }
    }

    // ------------------------------------------------------------------ memory

    fun memorySize(): Int = m3.m3_GetMemorySize(runtime)

    fun readMemory(offset: Int, length: Int): ByteArray {
        val memory = memoryPointer()
        val size = memorySize().toLong()
        if (offset < 0 || length < 0 || offset + length.toLong() > size) {
            throw NSCWasm3Exception("memory read out of bounds (offset $offset, length $length, size $size)")
        }
        val data = ByteArray(length)
        memory.position(offset.toLong()).get(data, 0, length)
        return data
    }

    fun writeMemory(offset: Int, data: ByteArray) {
        val memory = memoryPointer()
        val size = memorySize().toLong()
        if (offset < 0 || offset + data.size.toLong() > size) {
            throw NSCWasm3Exception("memory write out of bounds (offset $offset, length ${data.size}, size $size)")
        }
        memory.position(offset.toLong()).put(data, 0, data.size)
    }

    private fun memoryPointer(): BytePointer {
        val sizeOut = IntPointer(1)
        try {
            return m3.m3_GetMemory(runtime, sizeOut, 0)
                ?: throw NSCWasm3Exception("module has no linear memory")
        } finally {
            sizeOut.deallocate()
        }
    }

    override fun close() {
        if (closed) return
        closed = true
        m3.m3_FreeRuntime(runtime)
        m3.m3_FreeEnvironment(environment)
        moduleBytes.forEach { it.deallocate() }
        moduleBytes.clear()
        hostFunctions.forEach { it.deallocate() }
        hostFunctions.clear()
    }
}

class NSCWasm3Module internal constructor(
    private val module: M3Module,
    val runtime: NSCWasm3Runtime,
) {
    val name: String
        get() = m3.m3_GetModuleName(module)?.string ?: ""

    fun findFunction(name: String): NSCWasm3Function = runtime.findFunction(name)

    /**
     * Links a callback as a WebAssembly import. `signature` uses wasm3
     * notation, e.g. "i(ii)", "F(FF)", "v(I)" — i:i32 I:i64 f:f32 F:f64 v:void.
     */
    fun linkHostFunction(
        moduleName: String,
        name: String,
        signature: String,
        callback: NSCWasm3HostFunction,
    ) {
        val trampoline = HostTrampoline(callback)
        checkResult(
            m3.m3_LinkRawFunctionEx(module, moduleName, name, signature, trampoline, null),
            runtime,
        )
        runtime.hostFunctions.add(trampoline)
    }

    // ------------------------------------------------------------------ globals

    fun getGlobal(name: String): Any {
        val global = m3.m3_FindGlobal(module, name)
        if (global == null || global.isNull) throw NSCWasm3Exception("global not found: $name")
        val typeOut = IntPointer(1)
        val bitsOut = LongPointer(1)
        try {
            checkResult(m3.nsc_global_get(global, typeOut, bitsOut), runtime)
            return Wire.decode(typeOut.get(), bitsOut.get())
        } finally {
            typeOut.deallocate()
            bitsOut.deallocate()
        }
    }

    fun setGlobal(name: String, value: Any?) {
        val global = m3.m3_FindGlobal(module, name)
        if (global == null || global.isNull) throw NSCWasm3Exception("global not found: $name")
        val type = m3.m3_GetGlobalType(global)
        val bits = Wire.encode(type, value)
            ?: throw NSCWasm3Exception("cannot convert value to ${Wire.typeName(type)} for global: $name")
        checkResult(m3.nsc_global_set(global, type, bits), runtime)
    }
}

class NSCWasm3Function internal constructor(
    private val function: M3Function,
    private val runtime: NSCWasm3Runtime,
) {
    val name: String
        get() = m3.m3_GetFunctionName(function)?.string ?: ""

    val paramTypes: Array<String>
        get() = Array(m3.m3_GetArgCount(function)) { Wire.typeName(m3.m3_GetArgType(function, it)) }

    val returnTypes: Array<String>
        get() = Array(m3.m3_GetRetCount(function)) { Wire.typeName(m3.m3_GetRetType(function, it)) }

    /** Calls the function. Returns one wire-encoded value per result. */
    fun call(args: Array<Any?>): Array<Any> {
        val nArgs = m3.m3_GetArgCount(function)
        val nRets = m3.m3_GetRetCount(function)
        if (args.size != nArgs) {
            throw NSCWasm3Exception("expected $nArgs arguments, got ${args.size}")
        }

        val slots = LongPointer(maxOf(1, nArgs).toLong())
        val argPtrs = PointerPointer<Pointer>(maxOf(1, nArgs).toLong())
        val retSlots = LongPointer(maxOf(1, nRets).toLong())
        val retPtrs = PointerPointer<Pointer>(maxOf(1, nRets).toLong())
        try {
            for (i in 0 until nArgs) {
                val type = m3.m3_GetArgType(function, i)
                val bits = Wire.encode(type, args[i])
                    ?: throw NSCWasm3Exception("argument $i is not convertible to ${Wire.typeName(type)}")
                slots.put(i.toLong(), bits)
                argPtrs.put(i.toLong(), slots.getPointer(i.toLong()))
            }
            checkResult(m3.m3_Call(function, nArgs, argPtrs), runtime)

            if (nRets == 0) return emptyArray()
            for (i in 0 until nRets) {
                retPtrs.put(i.toLong(), retSlots.getPointer(i.toLong()))
            }
            checkResult(m3.m3_GetResults(function, nRets, retPtrs), runtime)
            return Array(nRets) { i ->
                Wire.decode(m3.m3_GetRetType(function, i), retSlots.get(i.toLong()))
            }
        } finally {
            slots.deallocate()
            argPtrs.deallocate()
            retSlots.deallocate()
            retPtrs.deallocate()
        }
    }
}
