plugins {
    id("com.android.library")
}

android {
    namespace = "org.nativescript.wamr"
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
    // No JavaCPP dependency — native JNI is provided by libwamr_jni.so
    // built via cargo-ndk.
}

// ---------------------------------------------------------------------------
// Native pipeline: cargo-ndk cross-compiles the wamr-jni Rust crate for
// all Android ABIs, replacing the old JavaCPP + Node.js build.
// ---------------------------------------------------------------------------

val pluginRoot: File = projectDir.parentFile.parentFile.parentFile.parentFile
val rustWorkspace = pluginRoot.resolve("src/vendors/wamr-rust")

// Cross-compiles libwamr_jni.so for every Android ABI via cargo-ndk.
val buildNative = tasks.register<Exec>("buildNative") {
    workingDir = rustWorkspace

    // cargo ndk requires the NDK.  It detects $ANDROID_NDK_HOME or uses
    // $ANDROID_HOME/ndk/<version>.  The output .so files land in
    // <outDir>/<abi>/libwamr_jni.so.
    val outDir = layout.buildDirectory.dir("generated/native/jniLibs").get().asFile
    val ndkTargets = listOf(
        "arm64-v8a", "armeabi-v7a", "x86", "x86_64"
    )

    commandLine(
        "cargo", "ndk",
        "-t", "arm64-v8a",
        "-t", "armeabi-v7a",
        "-t", "x86",
        "-t", "x86_64",
        "-o", outDir.absolutePath,
        "build", "-p", "wamr-jni", "--release"
    )

    inputs.dir(pluginRoot.resolve("src/vendors/wamr"))
        .withPropertyName("wamrSources")
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

// Copies the release AAR to where the NativeScript CLI picks it up
// (plugin platforms/android/*.aar).
tasks.register<Copy>("deployAar") {
    dependsOn("assembleRelease")
    from(layout.buildDirectory.file("outputs/aar/library-release.aar"))
    into(rootProject.projectDir.parentFile)
    rename { "nativescript-wamr.aar" }
}
