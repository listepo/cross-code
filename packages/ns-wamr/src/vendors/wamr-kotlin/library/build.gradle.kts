plugins {
    id("com.android.library")
}

android {
    namespace = "org.nativescript.wamr.ffi"
    compileSdk = 35

    defaultConfig {
        minSdk = 21
        aarMetadata { minCompileSdk = 1 }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }

    sourceSets {
        getByName("main") {
            // Generated UniFFI Kotlin bindings
            java.directories.addAll(listOf("src/main/kotlin"))
            // Pre-built native libraries per ABI
            jniLibs.directories.add("src/main/jniLibs")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_21)
        // NativeScript metadata generator compatibility (see AGENTS.md)
        freeCompilerArgs.add("-Xmetadata-version=2.3.0")
    }
}

dependencies {
    // JNA is required by the UniFFI-generated bindings
    api("net.java.dev.jna:jna:5.17.0@aar")
}
