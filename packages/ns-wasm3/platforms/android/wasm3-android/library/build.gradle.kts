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

tasks.register<Copy>("deployAar") {
    dependsOn("assembleRelease", deploySymbols)
    from(layout.buildDirectory.file("outputs/aar/library-release.aar"))
    into(rootProject.projectDir.parentFile)
    rename { "nativescript-wasm3.aar" }
}
