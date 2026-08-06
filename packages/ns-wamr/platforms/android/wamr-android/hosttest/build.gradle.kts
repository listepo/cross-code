// JVM test module: exercises the Kotlin wrapper against a host (macOS/Linux)
// build of WAMR, so the full stack is verified without an emulator.
//
// The native library is built via `cargo build` for the host target (no NDK).
plugins {
    id("org.jetbrains.kotlin.jvm")
}

sourceSets {
    named("main") {
        // The Kotlin wrapper lives in the library module.
        kotlin.srcDirs("../library/src/main/kotlin")
    }
}

dependencies {
    // No JavaCPP dependency — the Kotlin wrapper uses NativeWamr (JNI).
    // On the test host, libwamr_jni.so/dylib is loaded from the cargo build dir.

    // JUnit 6 (Jupiter)
    testImplementation(platform("org.junit:junit-bom:6.1.2"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
    testImplementation(kotlin("test"))
}

val pluginRoot = projectDir.parentFile.parentFile.parentFile.parentFile
val rustWorkspace = pluginRoot.resolve("src/vendors/wamr-rust")

// Build the native library for the host platform (macOS/Linux) via cargo.
val buildNativeHost = tasks.register<Exec>("buildNativeHost") {
    workingDir = rustWorkspace
    commandLine(
        "cargo", "build", "--release", "-p", "wamr-jni"
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

    // cargo outputs to target/release/libwamr_jni.{dylib|so}
    outputs.dir(rustWorkspace.resolve("target/release"))
}

tasks.compileKotlin { dependsOn(buildNativeHost) }

tasks.test {
    useJUnitPlatform()

    // Skip when WAMR sources are not available.
    val wamrSources = pluginRoot.resolve("src/vendors/wamr")
    onlyIf("WAMR C sources are available") {
        wamrSources.isDirectory &&
            wamrSources.resolve("core").isDirectory
    }

    // Point java.library.path at the cargo release output so System.loadLibrary
    // finds libwamr_jni.
    systemProperty(
        "java.library.path",
        rustWorkspace.resolve("target/release").absolutePath,
    )
}
