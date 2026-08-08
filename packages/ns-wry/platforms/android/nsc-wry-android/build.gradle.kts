// AGP 9 is required: Gradle 9.6 removed the internal Problems API that AGP 8.x
// relied on (see the Gradle 9 upgrade guide, "agp_8x_incompatible").
plugins {
    // AGP 9 has built-in Kotlin support, so :library needs no Kotlin plugin —
    // only the pure-JVM :hosttest module does.
    id("com.android.library") version "9.3.1" apply false
    id("org.jetbrains.kotlin.jvm") version "2.4.10" apply false

    // Kotlin linting for the hand-written wrapper + hosttest sources.
    id("io.gitlab.arturbosch.detekt") version "1.23.8" apply false
    id("org.jlleitschuh.gradle.ktlint") version "14.2.0" apply false
}

// Detekt + Ktlint over the hand-written Kotlin only. Generated code is kept
// out of both tools' inputs: Gradle build outputs (build/), the hosttest bin/
// copies produced by build-native.mjs, and the UniFFI-generated bindings
// (uniffi/) are all excluded below. Both tools read their shared
// configuration from the monorepo root (detekt.yml + .editorconfig). Run with:
//     ./gradlew detekt ktlintCheck

// Monorepo root: shared detekt.yml / .editorconfig live there.
val repoRoot: File = rootDir.parentFile.parentFile.parentFile.parentFile.parentFile

subprojects {
    apply(plugin = "io.gitlab.arturbosch.detekt")
    apply(plugin = "org.jlleitschuh.gradle.ktlint")

    configure<io.gitlab.arturbosch.detekt.extensions.DetektExtension> {
        config.setFrom(files("$repoRoot/detekt.yml"))
        buildUponDefaultConfig = true
        source.setFrom(fileTree(projectDir) {
            include("**/src/**/*.kt")
            exclude("**/build/**", "**/bin/**", "**/uniffi/**", "**/.kotlin/**")
        })
    }

    configure<org.jlleitschuh.gradle.ktlint.KtlintExtension> {
        version.set("1.8.0")
        filter {
            // Scope Ktlint to the Kotlin sources (src/**/*.kt); the Gradle
            // build scripts (*.kts) are not linted.
            include("**/src/**/*.kt")
            exclude("**/build/**", "**/bin/**", "**/uniffi/**", "**/.kotlin/**")
        }
    }

    // The Gradle build scripts (*.kts) are intentionally not linted or
    // auto-formatted — the kts check/format tasks use their own hardcoded
    // source that ignores the filter above, so disable them outright (both
    // the run* worker and the ktlint* aggregate carry the KotlinScript name).
    tasks.matching { it.name.contains("KotlinScript") }.configureEach {
        enabled = false
    }
}
