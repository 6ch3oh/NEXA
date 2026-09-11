plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.ksp) apply false
}

providers.gradleProperty("nexaBuildRoot").orNull?.let { configuredRoot ->
    val externalBuildRoot = file(configuredRoot)
    layout.buildDirectory.set(externalBuildRoot.resolve("root"))
    subprojects {
        layout.buildDirectory.set(externalBuildRoot.resolve(name))
    }
}
