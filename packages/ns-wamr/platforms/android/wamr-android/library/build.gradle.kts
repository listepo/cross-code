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

// Strips DWARF from the shipped .so copies (keeps .dynsym for JNI + the
// symbol table) and retains the unstripped originals for ndk-stack/gdb.
val stripAndKeepSymbols = tasks.register("stripAndKeepSymbols") {
    dependsOn(buildNative)
    val ndkBin = (
        System.getenv("ANDROID_NDK_HOME")
            ?: (System.getenv("ANDROID_HOME") + "/ndk/29.0.14206865")
        ) + "/toolchains/llvm/prebuilt/" + (
        if (org.gradle.internal.os.OperatingSystem.current().isMacOsX) "darwin-x86_64" else "linux-x86_64"
        ) + "/bin"
    val jniLibs = layout.buildDirectory.dir("generated/native/jniLibs").get().asFile
    val symbolsDir = layout.buildDirectory.dir("generated/native/symbols").get().asFile
    doLast {
        jniLibs.listFiles()?.forEach { abiDir ->
            val abi = abiDir.name
            abiDir.listFiles { f -> f.name.endsWith(".so") }?.forEach { so ->
                // 1. Keep the unstripped original (full DWARF) for symbolication.
                val kept = File(symbolsDir, "$abi/${so.name}")
                kept.parentFile.mkdirs()
                runProc("cp", "-p", so.absolutePath, kept.absolutePath)
                // 2. Strip the shipped copy in place (keeps .dynsym + symtab).
                runProc("$ndkBin/llvm-strip", "--strip-debug", so.absolutePath)
            }
        }
    }
    outputs.dir(symbolsDir)
}

// Plain-Java process helper (avoids Gradle DSL exec scoping in doLast).
fun runProc(vararg cmd: String) {
    val p = ProcessBuilder(*cmd).inheritIO().start()
    check(p.waitFor() == 0) { "command failed: ${cmd.joinToString(" ")}" }
}

// Copies the unstripped .so files (full DWARF) next to the deployed AAR so
// crashes can be symbolized with ndk-stack.
val deploySymbols = tasks.register<Copy>("deploySymbols") {
    dependsOn(stripAndKeepSymbols)
    from(layout.buildDirectory.dir("generated/native/symbols"))
    into(rootProject.projectDir.parentFile.resolve("symbols"))
}

tasks.named("preBuild") {
    dependsOn(buildNative, stripAndKeepSymbols)
}

// Copies the release AAR to where the NativeScript CLI picks it up
// (plugin platforms/android/*.aar).
tasks.register<Copy>("deployAar") {
    dependsOn("assembleRelease", deploySymbols)
    from(layout.buildDirectory.file("outputs/aar/library-release.aar"))
    into(rootProject.projectDir.parentFile)
    rename { "nativescript-wamr.aar" }
}
