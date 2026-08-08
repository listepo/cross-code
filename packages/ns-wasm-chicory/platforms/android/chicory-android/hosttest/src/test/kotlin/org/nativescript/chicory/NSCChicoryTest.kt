package org.nativescript.chicory

import org.junit.jupiter.api.Test
import java.util.ArrayList
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class NSCChicoryTest {
    private fun fixture(name: String): ByteArray = javaClass.getResourceAsStream("/fixtures/$name.wasm")!!.readBytes()

    private fun withSuite(block: (NSCChicoryRuntime, NSCChicoryModule) -> Unit) {
        NSCChicoryRuntime(64 * 1024).use { runtime ->
            block(runtime, runtime.loadModuleFromBytes(fixture("suite")))
        }
    }

    @Test
    fun version() {
        val v = NSCChicoryRuntime.chicoryVersion()
        assertTrue(v.isNotEmpty(), "version should be non-empty")
    }

    @Test
    fun minimalAddModule() {
        NSCChicoryRuntime(64 * 1024).use { runtime ->
            val module = runtime.loadModuleFromBytes(fixture("add"))
            assertNotNull(module)
            val add = runtime.findFunction("add")
            assertEquals(listOf("i32", "i32"), add.paramTypes)
            assertEquals(listOf("i32"), add.returnTypes)
            assertEquals(listOf<Any>(42), call(add, 19, 23))
        }
    }

    @Test
    fun allValueTypes() = withSuite { runtime, _ ->
        val addI32 = runtime.findFunction("add_i32")
        assertEquals(listOf<Any>(42), call(addI32, 2, 40))
        assertEquals(listOf<Any>(-2), call(addI32, -1, -1))

        val addI64 = runtime.findFunction("add_i64")
        // i64 goes over the wire as decimal strings to stay lossless
        assertEquals(
            listOf<Any>("9007199254740995"),
            call(addI64, "9007199254740993", "2"),
        )
        assertEquals(
            listOf<Any>("-9223372036854775808"),
            call(addI64, "-9223372036854775807", "-1"),
        )

        val f32 = call(runtime.findFunction("mul_f32"), 1.5, 2.0)
        assertEquals(3.0, f32[0] as Double, 1e-6)

        assertEquals(
            listOf<Any>(0.125),
            call(runtime.findFunction("div_f64"), 1.0, 8.0),
        )
    }

    @Test
    fun multiValueReturn() = withSuite { runtime, _ ->
        val swap = runtime.findFunction("swap")
        assertEquals(listOf("i32", "i32"), swap.returnTypes)
        assertEquals(listOf<Any>(2, 1), call(swap, 1, 2))
    }

    @Test
    fun hostImports() = withSuite { runtime, module ->
        var loggedI64: String? = null
        module.linkHostFunction("env", "host_add", "i(ii)") { args ->
            (args[0] as Int) + (args[1] as Int)
        }
        module.linkHostFunction("env", "host_mul_f64", "F(FF)") { args ->
            (args[0] as Double) * (args[1] as Double)
        }
        module.linkHostFunction("env", "host_log_i64", "v(I)") { args ->
            loggedI64 = args[0] as String
            null
        }

        assertEquals(
            listOf<Any>(7),
            call(runtime.findFunction("call_host_add"), 3, 4),
        )
        assertEquals(
            listOf<Any>(10.0),
            call(runtime.findFunction("call_host_mul_f64"), 2.5, 4.0),
        )
        call(runtime.findFunction("call_host_log_i64"), "-1099511627776")
        assertEquals("-1099511627776", loggedI64)
    }

    @Test
    fun unlinkedImportFails() = withSuite { runtime, _ ->
        val error = assertFailsWith<NSCChicoryException> {
            call(runtime.findFunction("call_host_add"), 1, 2)
        }
        assertTrue(
            error.message!!.contains("import") ||
                error.message!!.contains("host") ||
                error.message!!.contains("instantiate"),
        )
    }

    @Test
    fun hostFunctionBadReturnTraps() = withSuite { runtime, module ->
        module.linkHostFunction("env", "host_add", "i(ii)") { _ -> "not a number" }
        assertFailsWith<NSCChicoryException> {
            call(runtime.findFunction("call_host_add"), 1, 2)
        }
    }

    @Test
    fun hostFunctionThrowTraps() = withSuite { runtime, module ->
        module.linkHostFunction("env", "host_add", "i(ii)") { _ ->
            throw IllegalStateException("boom")
        }
        assertFailsWith<NSCChicoryException> {
            call(runtime.findFunction("call_host_add"), 1, 2)
        }
    }

    @Test
    fun memoryAccess() = withSuite { runtime, _ ->
        assertTrue(runtime.memorySize() >= 64 * 1024)

        call(runtime.findFunction("poke"), 16, 0x12345678)
        assertEquals(
            listOf<Any>(0x12345678),
            call(runtime.findFunction("peek"), 16),
        )

        // native access sees what wasm wrote (little-endian)
        assertContentEquals(
            byteArrayOf(0x78, 0x56, 0x34, 0x12),
            runtime.readMemory(16, 4),
        )

        // wasm sees what native wrote
        runtime.writeMemory(32, byteArrayOf(-0x11, -0x42, -0x53, -0x22)) // EF BE AD DE
        assertEquals(
            listOf<Any>(0xDEADBEEF.toInt()),
            call(runtime.findFunction("peek"), 32),
        )
        assertFailsWith<NSCChicoryException> { runtime.readMemory(64 * 1024 - 2, 4) }
        assertFailsWith<NSCChicoryException> { runtime.writeMemory(64 * 1024, byteArrayOf(1)) }
    }

    @Test
    fun globals() = withSuite { runtime, module ->
        assertEquals(0, module.getGlobal("g_counter"))
        assertEquals(Math.PI, module.getGlobal("g_pi") as Double, 1e-15)
        assertEquals("72623859790382856", module.getGlobal("g_big"))

        // wasm mutates the global, native reads it back
        val bump = runtime.findFunction("bump")
        call(bump, 5)
        call(bump, 7)
        assertEquals(12, module.getGlobal("g_counter"))

        // native mutates, wasm reads
        module.setGlobal("g_counter", 100)
        assertEquals(listOf<Any>(101), call(bump, 1))

        module.setGlobal("g_big", "-9007199254740993")
        assertEquals("-9007199254740993", module.getGlobal("g_big"))

        assertFailsWith<NSCChicoryException> { module.getGlobal("nope") }
    }

    @Test
    fun argumentValidation() = withSuite { runtime, _ ->
        val add = runtime.findFunction("add_i32")
        assertFailsWith<NSCChicoryException> { add.call(arrayListOf(1)) }
        assertFailsWith<NSCChicoryException> { add.call(arrayListOf(Any(), 2)) }
    }

    @Test
    fun invalidModuleBytes() {
        NSCChicoryRuntime(64 * 1024).use { runtime ->
            assertFailsWith<NSCChicoryException> {
                runtime.loadModuleFromBytes(byteArrayOf(0, 1, 2, 3))
            }
        }
    }

    private fun call(fn: NSCChicoryFunction, vararg args: Any): ArrayList<Any> {
        val list = ArrayList<Any>()
        for (arg in args) list.add(arg)
        return fn.call(list)
    }
}
