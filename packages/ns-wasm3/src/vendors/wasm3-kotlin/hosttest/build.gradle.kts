plugins {
    id("org.jetbrains.kotlin.jvm")
}

sourceSets {
    named("main") {
        kotlin.srcDirs("../library/src/main/kotlin")
    }
}

dependencies {
    implementation("net.java.dev.jna:jna:5.15.0")

    testImplementation(platform("org.junit:junit-bom:6.1.2"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
    testImplementation(kotlin("test"))
}

tasks.test {
    useJUnitPlatform()

    systemProperty(
        "java.library.path",
        file("../library/src/main/jniLibs/host").absolutePath,
    )
}
