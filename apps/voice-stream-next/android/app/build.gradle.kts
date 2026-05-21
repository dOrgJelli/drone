plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.huntelkator.voicestreamnext"
    compileSdk = 36

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
    testImplementation("junit:junit:4.13.2")
}
