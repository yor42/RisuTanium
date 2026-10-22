import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// Release signing sources, in precedence order: the four RISU_ANDROID_* environment variables (set by
// Agents/Tools/device/sign-release.ps1 for one build), then gen/android/keystore.properties (gitignored), which CI
// writes from secrets. With neither, nothing below applies and the release build stays unsigned.
// A partial environment fails the build and names the missing variables, so a half-set key never falls back silently.
val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) {
        keystorePropertiesFile.inputStream().use { load(it) }
    }
}
val signingEnvNames = listOf(
    "RISU_ANDROID_KEYSTORE",
    "RISU_ANDROID_KEYSTORE_PASSWORD",
    "RISU_ANDROID_KEY_ALIAS",
    "RISU_ANDROID_KEY_PASSWORD"
)
val signingEnvMissing = signingEnvNames.filter { System.getenv(it).isNullOrEmpty() }
if (signingEnvMissing.isNotEmpty() && signingEnvMissing.size < signingEnvNames.size) {
    throw GradleException("Incomplete release signing environment; missing: " + signingEnvMissing.joinToString(", "))
}
val useSigningEnv = signingEnvMissing.isEmpty()

android {
    compileSdk = 36
    namespace = "io.github.yor42.risutanium"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "io.github.yor42.risutanium"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    signingConfigs {
        if (useSigningEnv) {
            create("release") {
                storeFile = file(System.getenv("RISU_ANDROID_KEYSTORE"))
                storePassword = System.getenv("RISU_ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("RISU_ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("RISU_ANDROID_KEY_PASSWORD")
            }
        } else if (keystorePropertiesFile.exists()) {
            create("release") {
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            if (useSigningEnv || keystorePropertiesFile.exists()) {
                signingConfig = signingConfigs.getByName("release")
            }
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    implementation("androidx.core:core-splashscreen:1.2.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")