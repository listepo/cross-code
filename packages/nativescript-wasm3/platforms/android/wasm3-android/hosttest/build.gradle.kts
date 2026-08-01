// JVM test module: exercises the Kotlin wrapper and the JavaCPP-generated
// bindings against a host (macOS/Linux) build of wasm3, so the full stack is
// verified without an emulator. Run `node ../build-native.mjs host` first (the test
// task does it automatically via the dependency below).
plugins {
    id("org.jetbrains.kotlin.jvm")
}

sourceSets {
    named("main") {
        java.srcDirs(
            "../library/src/javacpp",
            "../library/build/generated/javacpp/java",
        )
        kotlin.srcDirs("../library/src/main/kotlin")
    }
}

dependencies {
    implementation("org.bytedeco:javacpp:1.5.13")

    // JUnit 6 (Jupiter). kotlin("test") resolves to its junit5 variant, whose
    // Jupiter dependency the BOM aligns up to 6.x — the org.junit.jupiter.api
    // surface it uses is unchanged in 6.
    testImplementation(platform("org.junit:junit-bom:6.1.2"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
    testImplementation(kotlin("test"))
}

val buildNativeHost = tasks.register<Exec>("buildNativeHost") {
    // The parse step owns the shared bindings dir; host mode only compiles
    // the native library for the host platform.
    dependsOn(":library:javacppParse")
    workingDir = projectDir.parentFile
    commandLine("node", "build-native.mjs", "host")

    val pluginRoot = projectDir.parentFile.parentFile.parentFile.parentFile
    inputs.dir(pluginRoot.resolve("src/vendors/wasm3"))
    inputs.dir(pluginRoot.resolve("src/native/shim"))
    inputs.file(file("../library/src/javacpp/org/wasm3/presets/wasm3.java"))
    outputs.dir(file("../library/build/generated/javacpp/host"))
}

tasks.compileJava { dependsOn(buildNativeHost) }
tasks.compileKotlin { dependsOn(buildNativeHost) }

tasks.test {
    useJUnitPlatform()
    // JavaCPP's Loader falls back to System.loadLibrary for libjniwasm3.
    systemProperty(
        "java.library.path",
        file("../library/build/generated/javacpp/host").absolutePath,
    )
}
