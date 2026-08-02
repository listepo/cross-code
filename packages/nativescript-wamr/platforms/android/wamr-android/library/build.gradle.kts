plugins {
    // Kotlin support is built into AGP 9 — no separate Kotlin plugin here.
    id("com.android.library")
}

android {
    namespace = "org.nativescript.wamr"
    compileSdk = 35

    defaultConfig {
        minSdk = 21
        consumerProguardFiles("consumer-rules.pro")

        // AGP 9 defaults minCompileSdk to this library's compileSdk (35), which
        // would force every consuming app up to compileSdk 35. Nothing here
        // exposes API level 35 surface, so keep the pre-AGP-9 contract and let
        // NativeScript apps on an older compileSdk keep working.
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
            // JavaCPP presets + the bindings generated from wasm_export.h
            java.directories.addAll(listOf("src/javacpp", "build/generated/javacpp/java"))
            // JNI libraries produced by build-native.mjs
            jniLibs.directories.add("build/generated/javacpp/jniLibs")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        // NativeScript's metadata generator bundles kotlin-metadata-jvm with a
        // 2.3.0 ceiling, while AGP 9's built-in Kotlin compiler is 2.4.x and
        // writes 2.4.0 metadata — the generator then skips every class and JS
        // sees no org.nativescript.wamr.* (see AGENTS.md, "Kotlin metadata
        // version gates JS visibility"). Write 2.3.0 metadata so the classes
        // stay visible to NativeScript.
        freeCompilerArgs.add("-Xmetadata-version=2.3.0")
    }
}

dependencies {
    api("org.bytedeco:javacpp:1.5.13")
}

// ---------------------------------------------------------------------------
// Native pipeline: fetch the JavaCPP tool jar, then generate bindings and
// cross-compile WAMR + JNI glue for every Android ABI (see build-native.mjs).
// ---------------------------------------------------------------------------

val javacppTool: Configuration = configurations.create("javacppTool") {
    isTransitive = false
}

dependencies {
    javacppTool("org.bytedeco:javacpp:1.5.13")
}

val fetchJavacpp = tasks.register<Copy>("fetchJavacpp") {
    from(javacppTool)
    into(layout.buildDirectory.dir("tools"))
    rename { "javacpp.jar" }
}

val pluginRoot: File = projectDir.parentFile.parentFile.parentFile.parentFile

// Generates + compiles the org.wamr Java bindings from wasm_export.h.
val javacppParse = tasks.register<Exec>("javacppParse") {
    dependsOn(fetchJavacpp)
    workingDir = projectDir.parentFile
    commandLine("node", "build-native.mjs", "parse")

    inputs.dir(pluginRoot.resolve("src/vendors/wamr"))
    inputs.dir(pluginRoot.resolve("src/native/shim"))
    inputs.file(file("src/javacpp/org/wamr/presets/wamr.java"))
    inputs.file(projectDir.parentFile.resolve("build-native.mjs"))
    outputs.dir(layout.buildDirectory.dir("generated/javacpp/java"))
    outputs.dir(layout.buildDirectory.dir("generated/javacpp/classes"))
}

// Cross-compiles WAMR + the generated JNI glue for every Android ABI.
val buildNative = tasks.register<Exec>("buildNative") {
    dependsOn(javacppParse)
    workingDir = projectDir.parentFile
    commandLine("node", "build-native.mjs", "android")

    inputs.dir(pluginRoot.resolve("src/vendors/wamr"))
    inputs.dir(pluginRoot.resolve("src/native/shim"))
    inputs.dir(layout.buildDirectory.dir("generated/javacpp/java"))
    inputs.file(projectDir.parentFile.resolve("build-native.mjs"))
    outputs.dir(layout.buildDirectory.dir("generated/javacpp/jniLibs"))
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
