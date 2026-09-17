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

// Google Play services (for googleAuthorize) is not open source, so it can be
// left out: build with -PlollyGooglePlayServices=false, or set
// lollyGooglePlayServices=false in the app's gradle.properties, for F-Droid and
// other builds without Google software. Then the dependency is not added, the
// code in src/play/java is not compiled, and googleAuthorize rejects with
// play-services-unavailable. The default is true.
val lollyGooglePlayServices: Boolean =
    when (val raw = findProperty("lollyGooglePlayServices")?.toString()?.trim()?.lowercase()) {
        null, "", "true" -> true
        "false" -> false
        else -> throw GradleException("lollyGooglePlayServices must be true or false, got '$raw'")
    }

android {
    namespace = "tools.lolly.auth"
    compileSdk = 36

    defaultConfig {
        minSdk = 24
        consumerProguardFiles("consumer-rules.pro")
        manifestPlaceholders["lollyAuthExtraScheme"] = lollyAuthExtraScheme
    }

    sourceSets {
        getByName("main") {
            if (lollyGooglePlayServices) {
                java.srcDir("src/play/java")
            }
        }
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
    if (lollyGooglePlayServices) {
        // AuthorizationClient (Identity.getAuthorizationClient). Licensed under
        // the Android Software Development Kit License, not an open source licence.
        implementation("com.google.android.gms:play-services-auth:22.0.0")
    }
}
