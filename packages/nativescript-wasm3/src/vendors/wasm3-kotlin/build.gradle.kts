// Gradle project for wasm3-kotlin: UniFFI-generated Kotlin bindings for wasm3.
// AGP 9 is required: Gradle 9.6 removed the internal Problems API that AGP 8.x relied on.
plugins {
    id("com.android.library") version "9.3.1" apply false
    id("org.jetbrains.kotlin.jvm") version "2.4.10" apply false
}
