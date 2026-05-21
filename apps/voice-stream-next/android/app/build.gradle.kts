plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.huntelkator.voicestreamnext"
    compileSdk = 36
    val releaseKeystorePath = System.getenv("VOICE_STREAM_NEXT_ANDROID_KEYSTORE").orEmpty()
    val releaseKeyAlias = System.getenv("VOICE_STREAM_NEXT_ANDROID_KEY_ALIAS").orEmpty()
    val releaseKeyPassword = System.getenv("VOICE_STREAM_NEXT_ANDROID_KEY_PASSWORD").orEmpty()
    val releaseStorePassword = System.getenv("VOICE_STREAM_NEXT_ANDROID_STORE_PASSWORD").orEmpty()

    defaultConfig {
        applicationId = "com.huntelkator.voicestreamnext"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.1"
        buildConfigField("String", "CLERK_PUBLISHABLE_KEY", "\"${System.getenv("VOICE_STREAM_NEXT_ANDROID_CLERK_PUBLISHABLE_KEY").orEmpty()}\"")
    }

    buildFeatures {
        buildConfig = true
    }

    sourceSets {
        getByName("main") {
            assets.srcDir("../../../voice-stream/android/app/src/main/assets")
        }
    }

    if (releaseKeystorePath.isNotBlank() && releaseKeyAlias.isNotBlank() && releaseKeyPassword.isNotBlank() && releaseStorePassword.isNotBlank()) {
        signingConfigs {
            create("release") {
                storeFile = file(releaseKeystorePath)
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
                storePassword = releaseStorePassword
            }
        }
        buildTypes {
            getByName("release") {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    packaging {
        resources {
            excludes += "META-INF/versions/9/OSGI-INF/MANIFEST.MF"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.clerk:clerk-android-api:1.0.13")
    implementation("com.alphacephei:vosk-android:0.3.47")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    testImplementation("junit:junit:4.13.2")
}
