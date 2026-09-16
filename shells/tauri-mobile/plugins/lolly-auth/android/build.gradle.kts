// SPDX-License-Identifier: MPL-2.0

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

// RedirectActivity always accepts tools.lolly.mobile. A second scheme can be
// added at build time with the Gradle property `lollyAuthExtraScheme` (for
// example in the app's gradle.properties). It defaults to the same value, so
// the manifest is unchanged unless someone sets it.
val lollyAuthExtraScheme: String =
    (findProperty("lollyAuthExtraScheme") as String?)?.trim()?.takeIf { it.isNotEmpty() }
        ?: "tools.lolly.mobile"
require(Regex("^[a-z][a-z0-9+.-]*$").matches(lollyAuthExtraScheme) && lollyAuthExtraScheme.contains('.')) {
    "lollyAuthExtraScheme must be a lower-case URI scheme with at least one dot, got '$lollyAuthExtraScheme'"
}

android {
    namespace = "tools.lolly.auth"
    compileSdk = 36

    defaultConfig {
        minSdk = 24
        consumerProguardFiles("consumer-rules.pro")
        manifestPlaceholders["lollyAuthExtraScheme"] = lollyAuthExtraScheme
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
}

dependencies {
    // Auth Tab (AuthTabIntent) first shipped in androidx.browser 1.9.0.
    implementation("androidx.browser:browser:1.9.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation(project(":tauri-android"))
}
