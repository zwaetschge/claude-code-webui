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

    // Docker bind-mounts the ADB identity into ~/.android, which makes Docker
    // create that directory as root — Gradle then cannot write the default
    // debug keystore and signing fails. Use a project-local keystore when one
    // is present; elsewhere the default path keeps working untouched.
    signingConfigs {
        val projectDebugKeystore = rootProject.file(".android/debug.keystore")
        if (projectDebugKeystore.exists()) {
            getByName("debug") {
                storeFile = projectDebugKeystore
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
            }
        }
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
