// JVM test module: exercises the Kotlin wrapper against a host (macOS/Linux)
// build of wasm3, so the full stack is verified without an emulator.
plugins {
    id("org.jetbrains.kotlin.jvm")
    id("jacoco")
}

sourceSets {
    named("main") {
        kotlin.srcDirs("../library/src/main/kotlin")
    }
}

dependencies {
    // No JavaCPP dependency — the Kotlin wrapper uses NativeWasm3 (JNI).

    testImplementation(platform("org.junit:junit-bom:6.1.2"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
    testImplementation(kotlin("test"))
}

val pluginRoot = projectDir.parentFile.parentFile.parentFile.parentFile
val rustWorkspace = pluginRoot.resolve("src/vendors/wasm3-rust")

val buildNativeHost = tasks.register<Exec>("buildNativeHost") {
    workingDir = rustWorkspace
    commandLine(
        "cargo", "build", "--release", "-p", "wasm3-jni"
    )

    inputs.dir(pluginRoot.resolve("src/vendors/wasm3"))
        .withPropertyName("wasm3Sources")
    inputs.dir(pluginRoot.resolve("src/native/shim"))
        .withPropertyName("shimSources")
    inputs.dir(rustWorkspace)
        .withPropertyName("rustSources")

    outputs.dir(rustWorkspace.resolve("target/release"))
}

tasks.compileKotlin { dependsOn(buildNativeHost) }

tasks.test {
    useJUnitPlatform()
    systemProperty(
        "java.library.path",
        rustWorkspace.resolve("target/release").absolutePath,
    )
}

// JaCoCo coverage for the JVM host tests (the Kotlin wrapper + tests).
tasks.jacocoTestReport {
    dependsOn(tasks.test)
    reports {
        xml.required.set(true)
        html.required.set(true)
    }
}
