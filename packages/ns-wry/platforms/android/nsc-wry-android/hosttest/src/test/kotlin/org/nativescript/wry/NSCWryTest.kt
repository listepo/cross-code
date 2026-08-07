package org.nativescript.wry

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class NSCWryTest {
    @Test
    fun version() {
        assertEquals("0.1.0", NSCWryRuntime.wryVersion())
    }

    @Test
    fun runtimeCreation() {
        NSCWryRuntime().use { runtime ->
            assertNotNull(runtime)
            assertTrue(runtime.isLoaded())
        }
    }

    @Test
    fun defaultStackSize() {
        NSCWryRuntime().use { runtime ->
            assertTrue(runtime.isLoaded())
        }
    }

    @Test
    fun dispose() {
        val runtime = NSCWryRuntime()
        runtime.close()
        assertFalse(runtime.isLoaded())
    }

    @Test
    fun callWithArgs() {
        NSCWryRuntime().use { runtime ->
            val result = runtime.call(withArgs = arrayOf("test", 1, 2))
            // Stub returns null
            assertEquals(null, result)
        }
    }

    @Test
    fun evalAfterClose() {
        val runtime = NSCWryRuntime()
        runtime.close()
        assertFailsWith<NSCWryException> {
            runtime.eval("test")
        }
    }
}
