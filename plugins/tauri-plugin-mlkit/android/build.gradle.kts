import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "jp.sluchin.zephyrdoc.mlkit"
    compileSdk = 37

    defaultConfig {
        minSdk = 24

        consumerProguardFiles("consumer-rules.pro")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_1_8
    }
}

dependencies {

    implementation("androidx.core:core-ktx:1.9.0")
    // オンデバイス翻訳 (ML Kit)
    implementation("com.google.mlkit:translate:17.0.3")
    implementation(project(":tauri-android"))
}
