package org.nativescript.chicory

import com.dylibso.chicory.runtime.ExportFunction
import com.dylibso.chicory.runtime.HostFunction
import com.dylibso.chicory.runtime.Instance
import com.dylibso.chicory.runtime.Memory
import com.dylibso.chicory.runtime.Store
import com.dylibso.chicory.wasm.Parser
import com.dylibso.chicory.wasm.types.FunctionType
import com.dylibso.chicory.wasm.types.MutabilityType
import com.dylibso.chicory.wasm.types.ValType
import com.dylibso.chicory.wasm.types.Value
import java.io.ByteArrayInputStream
import java.io.File

class NSCChicoryException(message: String) : RuntimeException(message)

/** Host import callback. */
fun interface NSCChicoryHostFunction {
    fun invoke(args: Array<Any>): Any?
}

// ---------------------------------------------------------------------------
// Wire protocol helpers (mirrors the TypeScript wire.ts)
// ---------------------------------------------------------------------------

private object Wire {
    /** Decodes a raw Chicory `long` into the wire value for `typeName`. */
    fun decode(typeName: String, raw: Long): Any = when (typeName) {
        "i32" -> raw.toInt()
        "i64" -> raw.toString()
        "f32" -> Float.fromBits(raw.toInt()).toDouble()
        "f64" -> Double.fromBits(raw)
        else -> raw
    }

    /** Encodes a JS-provided value into the wire format for `typeName`. */
    fun encode(typeName: String, value: Any?): Long = when (typeName) {
        "i32" -> asLong(value)!!.toInt().toLong()
        "i64" -> asLong(value)!!
        "f32" -> asDouble(value)!!.toFloat().toRawBits().toLong()
        "f64" -> asDouble(value)!!.toRawBits()
        else -> asLong(value) ?: 0L
    }

    private fun asLong(value: Any?): Long? = when (value) {
        is Number -> {
            value.toLong()
        }

        is String -> {
            try {
                value.toLong()
            } catch (_: NumberFormatException) {
                try {
                    java.math.BigInteger(value).toLong()
                } catch (_: NumberFormatException) {
                    null
                }
            }
        }

        else -> {
            null
        }
    }

    private fun asDouble(value: Any?): Double? = when (value) {
        is Number -> value.toDouble()
        is String -> value.toDoubleOrNull()
        else -> null
    }
}

// ---------------------------------------------------------------------------
// Host trampoline — Chicory calls back into Kotlin via this object
// ---------------------------------------------------------------------------

/**
 * One trampoline per linked import.  The [NSCChicoryRuntime] keeps a strong
 * reference so it is not garbage-collected while the runtime lives.
 */
class HostTrampoline(
    val callback: NSCChicoryHostFunction,
    private val paramTypeNames: Array<String>,
    private val returnTypeNames: Array<String>,
) {
    /**
     * Called by Chicory when the WASM module invokes the import.
     * Chicory passes parameters as `long...` following its raw calling convention.
     */
    @Suppress("unused") // called from Chicory
    fun apply(instance: Instance, args: LongArray): LongArray? {
        val jsArgs = Array(paramTypeNames.size) { i ->
            Wire.decode(paramTypeNames[i], args[i])
        }

        val result: Any? = try {
            callback.invoke(jsArgs)
        } catch (_: Throwable) {
            return null
        }

        val returned: List<Any?> = when (result) {
            null -> emptyList()
            is Array<*> -> result.toList()
            is List<*> -> result
            else -> listOf(result)
        }

        if (returned.size != returnTypeNames.size) return null
        val out = LongArray(returned.size)
        for (i in returned.indices) {
            out[i] = Wire.encode(returnTypeNames[i], returned[i])
        }
        return out
    }
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

class NSCChicoryRuntime(
    @Suppress("UnusedPrivateProperty") stackSizeInBytes: Int,
) : AutoCloseable {
    private val store = Store()
    private val moduleBytes = mutableListOf<ByteArray>()
    internal val hostTrampolines = mutableListOf<HostTrampoline>()
    private val modules = mutableListOf<NSCChicoryModule>()
    private var closed = false

    companion object {
        private const val CHICORY_VERSION = "chicory"

        @JvmStatic
        fun chicoryVersion(): String = CHICORY_VERSION
    }

    fun loadModuleFromBytes(bytes: ByteArray): NSCChicoryModule {
        val copy = bytes.copyOf()
        val wasmModule = Parser.parse(ByteArrayInputStream(copy))
        val module = NSCChicoryModule(wasmModule, this)
        moduleBytes.add(copy)
        modules.add(module)
        return module
    }

    fun loadModuleFromFile(path: String): NSCChicoryModule {
        val bytes = File(path).readBytes()
        return loadModuleFromBytes(bytes)
    }

    fun findFunction(name: String): NSCChicoryFunction {
        ensureInstantiated()
        for (module in modules) {
            try {
                return module.findExportedFunction(name)
            } catch (_: Exception) {
                // not in this module, try the next
            }
        }
        throw NSCChicoryException("function not found: $name")
    }

    // ------------------------------------------------------------------ memory

    fun memorySize(): Int {
        ensureInstantiated()
        val inst = currentInstance() ?: return 0
        val mem = inst.memory() ?: return 0
        return mem.pages() * Memory.PAGE_SIZE
    }

    fun readMemory(offset: Int, length: Int): ByteArray {
        ensureInstantiated()
        val inst = currentInstance() ?: throw NSCChicoryException("no memory")
        val mem = inst.memory() ?: throw NSCChicoryException("no memory")
        return mem.readBytes(offset, length)
    }

    fun writeMemory(offset: Int, data: ByteArray) {
        ensureInstantiated()
        val inst = currentInstance() ?: throw NSCChicoryException("no memory")
        val mem = inst.memory() ?: throw NSCChicoryException("no memory")
        mem.write(offset, data)
    }

    fun dispose() {
        if (closed) return
        closed = true
        moduleBytes.clear()
        hostTrampolines.clear()
    }

    override fun close() = dispose()

    // ------------------------------------------------------------------ internal

    internal fun store(): Store = store

    internal fun ensureInstantiated() {
        for (module in modules) module.ensureInstantiated()
    }

    internal fun currentInstance(): Instance? {
        for (module in modules) {
            val inst = module.instance()
            if (inst != null) return inst
        }
        return null
    }
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

class NSCChicoryModule internal constructor(
    private val wasmModule: com.dylibso.chicory.wasm.WasmModule,
    private val runtime: NSCChicoryRuntime,
) {
    private var instance: Instance? = null
    private val linkedFunctions = mutableListOf<HostFunction>()

    val name: String
        get() {
            val nameSection = wasmModule.nameSection()
            return nameSection?.moduleName()?.orElse(null) ?: "module"
        }

    fun linkHostFunction(moduleName: String, name: String, signature: String, callback: NSCChicoryHostFunction) {
        val (paramTypeNames, returnTypeNames) = parseSignature(signature)
        val trampoline = HostTrampoline(callback, paramTypeNames, returnTypeNames)
        runtime.hostTrampolines.add(trampoline)

        val paramValTypes = paramTypeNames.map { it.toValType() }
        val returnValTypes = returnTypeNames.map { it.toValType() }

        val hostFunc = HostFunction(
            moduleName,
            name,
            FunctionType.of(paramValTypes, returnValTypes),
            com.dylibso.chicory.runtime.WasmFunctionHandle { inst, args ->
                trampoline.apply(inst, args) ?: longArrayOf()
            },
        )
        linkedFunctions.add(hostFunc)
    }

    fun ensureInstantiated() {
        if (instance != null) return
        val store = runtime.store()
        for (hf in linkedFunctions) {
            store.addFunction(hf)
        }
        instance = store.instantiate(name, wasmModule)
    }

    fun instance(): Instance? = instance

    fun findExportedFunction(name: String): NSCChicoryFunction {
        ensureInstantiated()
        val inst = instance!!
        val exportFunc = inst.export(name)
        val exportType = inst.exportType(name)
        val params = exportType.params().map { it.toTypeString() }
        val returns = exportType.returns().map { it.toTypeString() }
        return NSCChicoryFunction(name, exportFunc, params, returns)
    }

    // ------------------------------------------------------------------ globals

    fun getGlobal(name: String): Any {
        ensureInstantiated()
        val inst = instance!!
        val globalInst = inst.exports().global(name)
        val typeName = globalInst.type.toTypeString()
        return Wire.decode(typeName, globalInst.value)
    }

    fun setGlobal(name: String, value: Any?) {
        ensureInstantiated()
        val inst = instance!!
        val globalInst = inst.exports().global(name)
        val typeName = globalInst.type.toTypeString()
        globalInst.setValue(Wire.encode(typeName, value))
    }

    private fun parseSignature(signature: String): Pair<Array<String>, Array<String>> {
        val compact = signature.replace("\\s+".toRegex(), "")
        val match = Regex("^([vifIF]*)\\(([vifIF]*)\\)$").find(compact)
            ?: throw NSCChicoryException("invalid wasm signature: \"$signature\"")
        fun toTypes(chars: String): Array<String> = chars
            .filter { it != 'v' }
            .map { c ->
                when (c) {
                    'i' -> "i32"
                    'I' -> "i64"
                    'f' -> "f32"
                    'F' -> "f64"
                    else -> throw NSCChicoryException("invalid signature character: $c")
                }
            }.toTypedArray()
        return Pair(toTypes(match.groupValues[2]), toTypes(match.groupValues[1]))
    }
}

// ---------------------------------------------------------------------------
// Function
// ---------------------------------------------------------------------------

class NSCChicoryFunction internal constructor(
    val name: String,
    private val exportFunction: ExportFunction,
    val paramTypes: List<String>,
    val returnTypes: List<String>,
) {
    /** Calls the function.  Accepts a Java ArrayList from NativeScript. */
    @Suppress("SpreadOperator") // Chicory's ExportFunction.apply() requires varargs
    fun call(args: ArrayList<Any>): ArrayList<Any> {
        val longArgs = LongArray(paramTypes.size) { i ->
            Wire.encode(paramTypes[i], args[i])
        }

        val results = exportFunction.apply(*longArgs)

        val out = ArrayList<Any>(returnTypes.size)
        for (i in returnTypes.indices) {
            if (i < results.size) {
                out.add(Wire.decode(returnTypes[i], results[i]))
            } else {
                out.add(0)
            }
        }
        return out
    }
}

// ---------------------------------------------------------------------------
// ValType helpers
// ---------------------------------------------------------------------------

private fun ValType.toTypeString(): String = when (this) {
    ValType.I32 -> "i32"
    ValType.I64 -> "i64"
    ValType.F32 -> "f32"
    ValType.F64 -> "f64"
    else -> "i32"
}

private fun String.toValType(): ValType = when (this) {
    "i32" -> ValType.I32

    "i64" -> ValType.I64

    "f32" -> ValType.F32

    "f64" -> ValType.F64

    "v" -> ValType.BOT

    // void is represented as Bot in Chicory
    else -> throw NSCChicoryException("unsupported wasm value type: $this")
}
