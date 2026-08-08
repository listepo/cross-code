// JVM test module: exercises the Kotlin wrapper against the real Chicory
// runtime on the host (macOS/Linux). Chicory is a pure-Java WASM runtime, so
// no native build or NDK is needed — the runtime comes from Maven.
plugins {
    id("org.jetbrains.kotlin.jvm")
    id("jacoco")
}

sourceSets {
    named("main") {
        // The Kotlin wrapper lives in the library module.
        kotlin.srcDirs("../library/src/main/kotlin")
    }
}

dependencies {
    // JUnit 6 (Jupiter)
    testImplementation(platform("org.junit:junit-bom:6.1.2"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
    testImplementation(kotlin("test"))

    // The wrapper binds to the Chicory runtime classes.
    implementation("com.dylibso.chicory:runtime:1.7.5")
}

tasks.test {
    useJUnitPlatform()
}

// JaCoCo coverage for the JVM host tests (the Kotlin wrapper + tests).
tasks.jacocoTestReport {
    dependsOn(tasks.test)
    reports {
        xml.required.set(true)
        html.required.set(true)
    }
}
