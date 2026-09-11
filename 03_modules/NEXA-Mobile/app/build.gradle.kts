plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.ksp)
}

val nexaMobileRelayHost = providers.gradleProperty("nexaMobileRelayHost").orElse("")
val nexaMobileRelayPort = providers.gradleProperty("nexaMobileRelayPort").orElse("17443")
val nexaMobileRelayServerName = providers.gradleProperty("nexaMobileRelayServerName").orElse("")

android {
    namespace = "com.xingshu.nexa.mobile"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.xingshu.nexa.mobile"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        resValue("string", "nexa_mobile_relay_host", nexaMobileRelayHost.get())
        resValue("string", "nexa_mobile_relay_port", nexaMobileRelayPort.get())
        resValue("string", "nexa_mobile_relay_server_name", nexaMobileRelayServerName.get())
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    buildFeatures {
        compose = true
        resValues = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    implementation(libs.androidx.work.runtime.ktx)
    implementation(libs.androidx.camera.core)
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.lifecycle)
    implementation(libs.androidx.camera.view) {
        exclude(group = "androidx.camera", module = "camera-video")
    }
    implementation(libs.zxing.core)
    ksp(libs.androidx.room.compiler)
    debugImplementation(libs.androidx.compose.ui.tooling)
    testImplementation(libs.junit)
}
