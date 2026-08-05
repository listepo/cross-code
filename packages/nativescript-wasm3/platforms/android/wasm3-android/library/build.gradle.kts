plugins {
    id("com.android.library")
}

android {
    namespace = "org.nativescript.wasm3"
    compileSdk = 35

    defaultConfig {
        minSdk = 21
        consumerProguardFiles("consumer-rules.pro")

        aarMetadata {
            minCompileSdk = 1
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    sourceSets {
        getByName("main") {
            // Kotlin source lives under src/main/kotlin
            // JNI libraries produced by cargo-ndk
            jniLibs.directories.add("build/generated/native/jniLibs")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        freeCompilerArgs.add("-Xmetadata-version=2.3.0")
    }
}

dependencies {
    // No JavaCPP dependency — native JNI is provided by libwasm3_jni.so
}

// ---------------------------------------------------------------------------
// Native pipeline: cargo-ndk cross-compiles the wasm3-jni Rust crate for
// all Android ABIs.
// ---------------------------------------------------------------------------

val pluginRoot: File = projectDir.parentFile.parentFile.parentFile.parentFile
val rustWorkspace = pluginRoot.resolve("src/vendors/wasm3-rust")

val buildNative = tasks.register<Exec>("buildNative") {
    workingDir = rustWorkspace

    val outDir = layout.buildDirectory.dir("generated/native/jniLibs").get().asFile

    commandLine(
        "cargo", "ndk",
        "-t", "arm64-v8a",
        "-t", "armeabi-v7a",
        "-t", "x86",
        "-t", "x86_64",
        "-o", outDir.absolutePath,
        "build", "-p", "wasm3-jni", "--release"
    )

    inputs.dir(pluginRoot.resolve("src/vendors/wasm3"))
        .withPropertyName("wasm3Sources")
        .withPathSensitivity(PathSensitivity.RELATIVE)
    inputs.dir(pluginRoot.resolve("src/native/shim"))
        .withPropertyName("shimSources")
        .withPathSensitivity(PathSensitivity.RELATIVE)
    inputs.dir(rustWorkspace)
        .withPropertyName("rustSources")
        .withPathSensitivity(PathSensitivity.RELATIVE)

    outputs.dir(outDir)
}

tasks.named("preBuild") {
    dependsOn(buildNative)
}

tasks.register<Copy>("deployAar") {
    dependsOn("assembleRelease")
    from(layout.buildDirectory.file("outputs/aar/library-release.aar"))
    into(rootProject.projectDir.parentFile)
    rename { "nativescript-wasm3.aar" }
}
