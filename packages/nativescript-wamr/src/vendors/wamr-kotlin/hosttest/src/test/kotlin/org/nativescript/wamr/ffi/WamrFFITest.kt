package org.nativescript.wamr.ffi

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*
import uniffi.wamr_ffi.*

class WamrFFITest {
    @Test
    fun testCreateRuntime() {
        val config = RuntimeConfig(
            executionTier = ExecutionTier.INTERPRETER,
            defaultStackSize = 64u * 1024u,
            maxMemoryPages = 256u,
            wasiEnabled = true
        )
        val runtime = WamrRuntime(config)
        assertNotNull(runtime)
        assertTrue(runtime.version().isNotEmpty())
        runtime.close()
    }

    @Test
    fun testLoadModuleRejectsEmptyBytes() {
        val config = RuntimeConfig(
            executionTier = ExecutionTier.INTERPRETER,
            defaultStackSize = 64u * 1024u,
            maxMemoryPages = 256u,
            wasiEnabled = false
        )
        val runtime = WamrRuntime(config)

        val ex = assertThrows(WamrException.ModuleLoadFailed::class.java) {
            runtime.loadModule(emptyList())
        }
        assertTrue(ex.message?.contains("Empty") == true)
        runtime.close()
    }
}
