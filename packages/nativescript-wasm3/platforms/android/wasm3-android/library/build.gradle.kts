plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "org.nativescript.wasm3"
    compileSdk = 35

    defaultConfig {
        minSdk = 21
        consumerProguardFiles("consumer-rules.pro")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    sourceSets {
        getByName("main") {
            // JavaCPP presets + the bindings generated from wasm3.h
            java.srcDirs("src/javacpp", "build/generated/javacpp/java")
            // JNI libraries produced by build-native.sh
            jniLibs.srcDirs("build/generated/javacpp/jniLibs")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    api("org.bytedeco:javacpp:1.5.13")
}

// ---------------------------------------------------------------------------
// Native pipeline: fetch the JavaCPP tool jar, then generate bindings and
// cross-compile wasm3 + JNI glue for every Android ABI (see build-native.sh).
// ---------------------------------------------------------------------------

val javacppTool: Configuration by configurations.creating { isTransitive = false }

dependencies {
    javacppTool("org.bytedeco:javacpp:1.5.13")
}

val fetchJavacpp by tasks.registering(Copy::class) {
    from(javacppTool)
    into(layout.buildDirectory.dir("tools"))
    rename { "javacpp.jar" }
}

val pluginRoot: File = projectDir.parentFile.parentFile.parentFile.parentFile

// Generates + compiles the org.wasm3 Java bindings from wasm3.h.
val javacppParse by tasks.registering(Exec::class) {
    dependsOn(fetchJavacpp)
    workingDir = projectDir.parentFile
    commandLine("./build-native.sh", "parse")

    inputs.dir(pluginRoot.resolve("src/vendors/wasm3"))
    inputs.dir(pluginRoot.resolve("src/native/shim"))
    inputs.file(file("src/javacpp/org/wasm3/presets/wasm3.java"))
    inputs.file(projectDir.parentFile.resolve("build-native.sh"))
    outputs.dir(layout.buildDirectory.dir("generated/javacpp/java"))
    outputs.dir(layout.buildDirectory.dir("generated/javacpp/classes"))
}

// Cross-compiles wasm3 + the generated JNI glue for every Android ABI.
val buildNative by tasks.registering(Exec::class) {
    dependsOn(javacppParse)
    workingDir = projectDir.parentFile
    commandLine("./build-native.sh", "android")

    inputs.dir(pluginRoot.resolve("src/vendors/wasm3"))
    inputs.dir(pluginRoot.resolve("src/native/shim"))
    inputs.dir(layout.buildDirectory.dir("generated/javacpp/java"))
    inputs.file(projectDir.parentFile.resolve("build-native.sh"))
    outputs.dir(layout.buildDirectory.dir("generated/javacpp/jniLibs"))
}

tasks.named("preBuild") {
    dependsOn(buildNative)
}

// Copies the release AAR to where the NativeScript CLI picks it up
// (plugin platforms/android/*.aar).
val deployAar by tasks.registering(Copy::class) {
    dependsOn("assembleRelease")
    from(layout.buildDirectory.file("outputs/aar/library-release.aar"))
    into(rootProject.projectDir.parentFile)
    rename { "nativescript-wasm3.aar" }
}
