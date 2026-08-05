plugins {
    id("org.jetbrains.kotlin.jvm")
}

sourceSets {
    named("main") {
        kotlin.srcDirs("../library/src/main/kotlin")
    }
}

dependencies {
    implementation("net.java.dev.jna:jna:5.17.0")

    testImplementation(platform("org.junit:junit-bom:6.1.2"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
    testImplementation(kotlin("test"))
}

tasks.test {
    useJUnitPlatform()

    systemProperty(
        "jna.library.path",
        file("../library/src/main/jniLibs/host").absolutePath
    )
    systemProperty(
        "uniffi.component.wamr_ffi.libraryOverride",
        "wamr_ffi"
    )
}
