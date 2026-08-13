plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.claudewebui.wear"
    compileSdk = 35

    defaultConfig {
        // Must match the phone app's applicationId (incl. the debug suffix
        // below) — the Wear data layer only bridges same-package, same-cert
        // apps.
        applicationId = "com.claudewebui.app"
        minSdk = 30
        targetSdk = 34
        versionCode = 3
        versionName = "1.2.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation(libs.core.ktx)
    implementation(libs.play.services.wearable)
    implementation(libs.wear)
    implementation(libs.wear.tiles)
    implementation(libs.wear.complications.data.source)
    implementation(libs.concurrent.futures)
}
