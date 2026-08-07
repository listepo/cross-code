package org.nativescript.wry

class NSCWryException(message: String) : RuntimeException(message)

// NSCWry — Kotlin wrapper around the wry native library (libwry_jni.so),
// consumed by the NativeScript Android runtime.

class NSCWryRuntime @JvmOverloads constructor(
    @Suppress("UnusedPrivateProperty") stackSizeInBytes: Int = 65536,
) : AutoCloseable {
    internal var handle: Long = 0
        private set
    private var closed = false

    companion object {
        @JvmStatic
        fun wryVersion(): String = NativeWry.version()
    }

    init {
        handle = 1L // non-zero handle = created
        val err = NativeWry.init()
        if (err != 0) throw NSCWryException("failed to initialize wry runtime")
    }

    fun eval(script: String): String {
        checkNotClosed()
        return NativeWry.eval(handle, script)
    }

    fun loadUrl(url: String) {
        checkNotClosed()
        val err = NativeWry.loadUrl(handle, url)
        if (err != 0) throw NSCWryException("failed to load URL: $url")
    }

    fun setHtml(html: String) {
        checkNotClosed()
        val err = NativeWry.setHtml(handle, html)
        if (err != 0) throw NSCWryException("failed to set HTML content")
    }

    fun isLoaded(): Boolean = !closed

    fun call(
        @Suppress("UnusedParameter") withArgs: Array<Any>,
    ): Any? {
        checkNotClosed()
        // Stub: a real implementation would dispatch a call to the WebView.
        return null
    }

    override fun close() {
        if (closed) return
        closed = true
        if (handle != 0L) {
            NativeWry.dispose(handle)
            handle = 0
        }
    }

    private fun checkNotClosed() {
        if (closed) throw NSCWryException("runtime is closed")
    }
}
