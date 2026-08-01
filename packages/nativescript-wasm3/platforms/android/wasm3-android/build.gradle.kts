// AGP 9 is required: Gradle 9.6 removed the internal Problems API that AGP 8.x
// relied on (see the Gradle 9 upgrade guide, "agp_8x_incompatible").
plugins {
    // AGP 9 has built-in Kotlin support, so :library needs no Kotlin plugin —
    // only the pure-JVM :hosttest module does.
    id("com.android.library") version "9.3.1" apply false
    id("org.jetbrains.kotlin.jvm") version "2.4.10" apply false
}
