plugins {
    id("com.android.library")
}

android {
    namespace = "org.nativescript.chicory"
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
            java.directories.addAll(listOf("src/main/kotlin"))
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
    implementation("com.dylibso.chicory:runtime:1.7.5")
}

val pluginRoot: File = projectDir.parentFile.parentFile.parentFile.parentFile

// Copies the release AAR to where the NativeScript CLI picks it up
// (plugin platforms/android/*.aar).
tasks.register<Copy>("deployAar") {
    dependsOn("assembleRelease")
    from(layout.buildDirectory.file("outputs/aar/library-release.aar"))
    into(rootProject.projectDir.parentFile)
    rename { "nativescript-chicory.aar" }
}
