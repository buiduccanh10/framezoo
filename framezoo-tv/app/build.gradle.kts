import java.net.URI
import java.util.Properties
import java.io.StringReader

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.framezoo.tv"
    compileSdk = 36
    ndkVersion = "27.1.12297006"
    defaultConfig {
        applicationId = "com.framezoo.tv"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        val backendUrlFromFile = providers.fileContents(rootProject.layout.projectDirectory.file(".env")).asText.orNull?.let { contents ->
            Properties().apply { load(StringReader(contents)) }.getProperty("FRAMEZOO_TV_BACKEND_URL")
                ?.trim()?.removeSurrounding("\"")?.removeSurrounding("'")?.takeIf { it.isNotBlank() }
        }
        val backendUrl = (providers.environmentVariable("FRAMEZOO_TV_BACKEND_URL").orNull
            ?: providers.gradleProperty("framezooBackendUrl").orNull
            ?: backendUrlFromFile
            ?: "https://api.framezoo.top").trimEnd('/')
        val backendUri = URI(backendUrl)
        require(backendUri.scheme in listOf("https", "http") && !backendUri.host.isNullOrBlank() &&
            backendUri.userInfo == null && backendUri.query == null && backendUri.fragment == null) {
            "FRAMEZOO_TV_BACKEND_URL phải là URL HTTP(S) hợp lệ"
        }
        buildConfigField("String", "BACKEND_URL", "\"${backendUrl.replace("\\", "\\\\").replace("\"", "\\\"")}\"")
        externalNativeBuild { cmake { cppFlags += "-std=c++17" } }
    }
    buildTypes {
        release { isMinifyEnabled = false; ndk { abiFilters += "arm64-v8a" } }
        debug { ndk { abiFilters += providers.gradleProperty("tvAbi").orElse("arm64-v8a").get() } }
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    externalNativeBuild { cmake { path = file("src/main/cpp/CMakeLists.txt") } }
    packaging { jniLibs { useLegacyPackaging = true } }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.06.01"))
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.animation:animation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.tv:tv-material:1.0.1")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.9.1")
    implementation("io.coil-kt:coil-compose:2.7.0")
    implementation("io.coil-kt:coil-svg:2.7.0")
    implementation("org.bouncycastle:bcprov-jdk18on:1.81")
    debugImplementation("androidx.compose.ui:ui-tooling")
    testImplementation("junit:junit:4.13.2")
}

fun nativeBuild(abi: String) = tasks.register<Exec>("buildNative${abi.replace("-", "_")}") {
    workingDir = rootProject.projectDir
    commandLine("bash", "native/build-native.sh", "all")
    environment("ABI", abi)
    onlyIf {
        !file("src/main/jniLibs/$abi/libmpv.so").isFile ||
            !file("src/main/jniLibs/$abi/libavcodec.so").isFile ||
            !file("../native/.work/prefix/$abi/lib/libtorrent-rasterbar.a").isFile ||
            !file("../native/.work/prefix/$abi/include/mpv/client.h").isFile
    }
}

val arm64Native = nativeBuild("arm64-v8a")
val debugNative = if (providers.gradleProperty("tvAbi").orElse("arm64-v8a").get() == "x86_64") nativeBuild("x86_64") else arm64Native
tasks.matching { it.name.startsWith("configureCMakeDebug") || it.name.startsWith("mergeDebugJniLibFolders") }.configureEach { dependsOn(debugNative) }
tasks.matching { (it.name.startsWith("configureCMake") && !it.name.contains("Debug")) || it.name.startsWith("mergeReleaseJniLibFolders") }.configureEach { dependsOn(arm64Native) }
