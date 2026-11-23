import java.io.FileInputStream
import java.net.URI
import java.util.Base64
import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Host of the verified App Links for `<SITE_URL>/auth/callback` (spec 03).
// Taken from `-Pchicman.appLinkHost=<host>`, else from the SITE_URL
// `--dart-define`. The fallback never verifies, so no domain is hardcoded.
val dartDefines: Map<String, String> =
    (project.findProperty("dart-defines") as String?)
        ?.split(",")
        ?.mapNotNull { encoded -> runCatching { String(Base64.getDecoder().decode(encoded)) }.getOrNull() }
        ?.mapNotNull { entry -> entry.split("=", limit = 2).takeIf { it.size == 2 }?.let { it[0] to it[1] } }
        ?.toMap()
        ?: emptyMap()
// A malformed SITE_URL (for example "htt://localhost:3000") stops the build
// here with a clear message instead of producing an app that fails at runtime.
val siteUrlHost: String? =
    dartDefines["SITE_URL"]?.takeIf { it.isNotBlank() }?.let { value ->
        val uri = runCatching { URI(value.trim()) }.getOrNull()
        if (uri == null || (uri.scheme != "http" && uri.scheme != "https") || uri.host.isNullOrEmpty()) {
            throw GradleException("SITE_URL must be an http(s) URL with a host, got \"$value\"")
        }
        uri.host
    }
val appLinkHost: String =
    (project.findProperty("chicman.appLinkHost") as String?)
        ?: siteUrlHost
        ?: "app-links.invalid"

// Release signing (QA-01): android/key.properties (git-ignored) with
// storeFile, storePassword, keyAlias, keyPassword. App Links verify only
// against this key's SHA-256 fingerprint (ANDROID_CERT_SHA256 in
// infrastructure/production/.env). Without the file, release builds fall back
// to the debug key: fine for `flutter run --release`, never for distribution.
val keystorePropertiesFile = rootProject.file("key.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) FileInputStream(keystorePropertiesFile).use { load(it) }
}
val hasReleaseKey = keystorePropertiesFile.exists()
if (!hasReleaseKey) {
    logger.warn("android/key.properties not found: release builds are signed with the DEBUG key (not distributable).")
}

android {
    namespace = "com.chicman.chicman"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.chicman.chicman"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        manifestPlaceholders["appLinkHost"] = appLinkHost
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName(if (hasReleaseKey) "release" else "debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
