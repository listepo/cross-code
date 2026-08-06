package org.nativescript.wasm3.ffi

import kotlin.test.*
import uniffi.wasm3_ffi.*

class Wasm3FFITest {
    @Test
    fun `should report version`() {
        val config = RuntimeConfig(defaultStackSize = 64u * 1024u)
        val runtime = Wasm3Runtime(config)
        val version = runtime.version()
        assertTrue(version.isNotEmpty(), "version should not be empty")
        println("wasm3 version: $version")
    }

    @Test
    fun `should create and destroy runtime`() {
        val config = RuntimeConfig(defaultStackSize = 64u * 1024u)
        val runtime = Wasm3Runtime(config)
        val version = runtime.version()
        assertTrue(version.startsWith("v") || version.contains("."))
    }
}
