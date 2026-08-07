package org.nativescript.wry

/**
 * JNI declarations for the wry native library (libwry_jni.so).
 *
 * Every opaque wry handle is a Long (jlong). Errors throw NSCWryException.
 */
object NativeWry {
    init {
        System.loadLibrary("wry_jni")
    }

    @JvmStatic external fun version(): String
    @JvmStatic external fun init(): Int
    @JvmStatic external fun isInitialized(): Boolean
    @JvmStatic external fun eval(handle: Long, script: String): String
    @JvmStatic external fun loadUrl(handle: Long, url: String): Int
    @JvmStatic external fun setHtml(handle: Long, html: String): Int
    @JvmStatic external fun dispose(handle: Long)
}
