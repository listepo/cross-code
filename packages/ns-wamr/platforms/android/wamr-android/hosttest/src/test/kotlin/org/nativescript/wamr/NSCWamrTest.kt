package org.nativescript.wamr

import org.junit.jupiter.api.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class NSCWamrTest {
    private fun fixture(name: String): ByteArray = javaClass.getResourceAsStream("/fixtures/$name.wasm")!!.readBytes()

    private fun withSuite(block: (NSCWamrRuntime, NSCWamrModule) -> Unit) {
        NSCWamrRuntime().use { runtime ->
            block(runtime, runtime.loadModule(fixture("suite")))
        }
    }

    @Test
    fun version() {
        val v = NSCWamrRuntime.wamrVersion()
        // WAMR returns its version string; just ensure it's non-empty.
        assertTrue(v.isNotEmpty(), "version should be non-empty")
    }

    @Test
    fun minimalAddModule() {
        NSCWamrRuntime().use { runtime ->
            runtime.loadModule(fixture("add"))
            val add = runtime.findFunction("add")
            assertContentEquals(arrayOf("i32", "i32"), add.paramTypes)
            assertContentEquals(arrayOf("i32"), add.returnTypes)
            assertContentEquals(arrayOf<Any>(42), add.call(arrayOf(19, 23)))
        }
    }

    @Test
    fun allValueTypes() = withSuite { runtime, _ ->
        val addI32 = runtime.findFunction("add_i32")
        assertContentEquals(arrayOf<Any>(42), addI32.call(arrayOf(2, 40)))
        assertContentEquals(arrayOf<Any>(-2), addI32.call(arrayOf(-1, -1)))

        val addI64 = runtime.findFunction("add_i64")
        // i64 goes over the wire as decimal strings to stay lossless
        assertContentEquals(
            arrayOf<Any>("9007199254740995"),
            addI64.call(arrayOf("9007199254740993", "2")),
        )
        assertContentEquals(
            arrayOf<Any>("-9223372036854775808"),
            addI64.call(arrayOf("-9223372036854775807", "-1")),
        )

        val f32 = runtime.findFunction("mul_f32").call(arrayOf(1.5, 2.0))
        assertEquals(3.0, f32[0] as Double, 1e-6)

        assertContentEquals(
            arrayOf<Any>(0.125),
            runtime.findFunction("div_f64").call(arrayOf(1.0, 8.0)),
        )
    }

    @Test
    fun multiValueReturn() = withSuite { runtime, _ ->
        val swap = runtime.findFunction("swap")
        assertContentEquals(arrayOf("i32", "i32"), swap.returnTypes)
        assertContentEquals(arrayOf<Any>(2, 1), swap.call(arrayOf(1, 2)))
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

        assertContentEquals(
            arrayOf<Any>(7),
            runtime.findFunction("call_host_add").call(arrayOf(3, 4)),
        )
        assertContentEquals(
            arrayOf<Any>(10.0),
            runtime.findFunction("call_host_mul_f64").call(arrayOf(2.5, 4.0)),
        )
        runtime.findFunction("call_host_log_i64").call(arrayOf("-1099511627776"))
        assertEquals("-1099511627776", loggedI64)
    }

    @Test
    fun unlinkedImportFails() = withSuite { runtime, _ ->
        // WAMR detects the missing import at instantiation time, which
        // loadModule triggers.  For modules that are already loaded the
        // findFunction may succeed but calling traps.  The wasm3 behaviour
        // is to fail at findFunction; WAMR may fail earlier or later.
        val error = assertFailsWith<NSCWamrException> {
            val f = runtime.findFunction("call_host_add")
            f.call(arrayOf(1, 2))
        }
        assertTrue(
            error.message!!.contains("missing") ||
                error.message!!.contains("import") ||
                error.message!!.contains("trapped") ||
                error.message!!.contains("exception"),
        )
    }

    @Test
    fun hostFunctionBadReturnTraps() = withSuite { runtime, module ->
        module.linkHostFunction("env", "host_add", "i(ii)") { _ -> "not a number" }
        val error = assertFailsWith<NSCWamrException> {
            runtime.findFunction("call_host_add").call(arrayOf(1, 2))
        }
        assertTrue(error.message!!.contains("host function"))
    }

    @Test
    fun hostFunctionThrowTraps() = withSuite { runtime, module ->
        module.linkHostFunction("env", "host_add", "i(ii)") { _ ->
            throw IllegalStateException("boom")
        }
        val error = assertFailsWith<NSCWamrException> {
            runtime.findFunction("call_host_add").call(arrayOf(1, 2))
        }
        assertTrue(error.message!!.contains("host function"))
    }

    @Test
    fun memoryAccess() = withSuite { runtime, _ ->
        assertTrue(runtime.memorySize() >= 64 * 1024)

        runtime.findFunction("poke").call(arrayOf(16, 0x12345678))
        assertContentEquals(
            arrayOf<Any>(0x12345678),
            runtime.findFunction("peek").call(arrayOf(16)),
        )

        // native access sees what wasm wrote (little-endian)
        assertContentEquals(
            byteArrayOf(0x78, 0x56, 0x34, 0x12),
            runtime.readMemory(16, 4),
        )

        // wasm sees what native wrote
        runtime.writeMemory(32, byteArrayOf(-0x11, -0x42, -0x53, -0x22)) // EF BE AD DE
        assertContentEquals(
            arrayOf<Any>(0xDEADBEEF.toInt()),
            runtime.findFunction("peek").call(arrayOf(32)),
        )

        assertFailsWith<NSCWamrException> { runtime.readMemory(64 * 1024 - 2, 4) }
        assertFailsWith<NSCWamrException> { runtime.writeMemory(64 * 1024, byteArrayOf(1)) }
    }

    @Test
    fun globals() = withSuite { runtime, module ->
        assertEquals(0, module.getGlobal("g_counter"))
        assertEquals(Math.PI, module.getGlobal("g_pi") as Double, 1e-15)
        assertEquals("72623859790382856", module.getGlobal("g_big"))

        // wasm mutates the global, native reads it back
        val bump = runtime.findFunction("bump")
        bump.call(arrayOf(5))
        bump.call(arrayOf(7))
        assertEquals(12, module.getGlobal("g_counter"))

        // native mutates, wasm reads
        module.setGlobal("g_counter", 100)
        assertContentEquals(arrayOf<Any>(101), bump.call(arrayOf(1)))

        module.setGlobal("g_big", "-9007199254740993")
        assertEquals("-9007199254740993", module.getGlobal("g_big"))

        assertFailsWith<NSCWamrException> { module.getGlobal("nope") }
    }

    @Test
    fun argumentValidation() = withSuite { runtime, _ ->
        val add = runtime.findFunction("add_i32")
        assertFailsWith<NSCWamrException> { add.call(arrayOf(1)) }
        assertFailsWith<NSCWamrException> { add.call(arrayOf(Any(), 2)) }
    }

    @Test
    fun invalidModuleBytes() {
        NSCWamrRuntime().use { runtime ->
            assertFailsWith<NSCWamrException> {
                runtime.loadModule(byteArrayOf(0, 1, 2, 3))
            }
        }
    }
}
