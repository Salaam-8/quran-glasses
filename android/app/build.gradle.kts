plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.quranglasses.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.quranglasses.app"
        minSdk = 26
        targetSdk = 35
        versionCode = (System.getenv("VERSION_CODE") ?: "1").toInt()
        versionName = "0.1." + (System.getenv("VERSION_CODE") ?: "0")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // glasses and phones are arm64; x86_64 is for the emulator test in CI
        ndk { abiFilters += listOf("arm64-v8a", "x86_64") }
    }

    externalNativeBuild {
        cmake { path = file("src/main/cpp/CMakeLists.txt"); version = "3.22.1" }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // sideloaded test builds: signed with the debug key until a release key exists
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    // instrumentation tests run against the optimised build that users get
    testBuildType = "release"

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // the web page (built by ../../build.py) and the speech models (placed by scripts/build-models.sh)
    sourceSets["main"].assets.srcDirs("src/main/assets", "$rootDir/../dist/android", "$rootDir/build-assets")
    androidResources { noCompress += listOf("bin") }
}

kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }

dependencies {
    implementation("com.quranglasses:core:1.0")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")

    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:rules:1.6.1")
}
