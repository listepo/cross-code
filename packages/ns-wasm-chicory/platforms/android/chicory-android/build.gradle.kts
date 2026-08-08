plugins {
    id("com.android.library") version "9.3.1" apply false
    id("org.jetbrains.kotlin.jvm") version "2.4.10" apply false

    // Kotlin linting for the hand-written wrapper sources.
    id("io.gitlab.arturbosch.detekt") version "1.23.8" apply false
    id("org.jlleitschuh.gradle.ktlint") version "14.2.0" apply false
}

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
            exclude("**/build/**", "**/bin/**", "**/.kotlin/**")
        })
    }

    configure<org.jlleitschuh.gradle.ktlint.KtlintExtension> {
        version.set("1.8.0")
        filter {
            include("**/src/**/*.kt")
            exclude("**/build/**", "**/bin/**", "**/.kotlin/**")
        }
    }

    tasks.matching { it.name.contains("KotlinScript") }.configureEach {
        enabled = false
    }
}
