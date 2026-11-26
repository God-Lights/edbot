plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// 앱과 같은 서명 키 (CI 비밀값 ANDROID_KEYSTORE_*). 없으면 디버그 서명.
val keystoreFile = System.getenv("ANDROID_KEYSTORE_FILE")?.let { file(it) }?.takeIf { it.exists() }

// 서버 엔진(ios-server/engine 에서 bun build.ts 로 만든 engine.js)과 웹 화면(web/)을 APK 의 assets 에 넣는다.
val engineJs = rootDir.resolve("../ios-server/engine/dist/engine.js")
val webDir = rootDir.resolve("../web")
val generatedAssets: File = layout.buildDirectory.dir("generated/serverAssets").get().asFile
val copyServerAssets by tasks.registering(Copy::class) {
    doFirst {
        require(engineJs.exists()) { "engine.js 가 없다. 먼저 만든다: cd ios-server/engine && bun build.ts" }
    }
    from(webDir) {
        into("web")
        exclude("README.md")
    }
    from(engineJs)
    into(generatedAssets)
}

android {
    namespace = "com.officialgl.commander.server"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.officialgl.commander.server"
        minSdk = 26 // 안드로이드 8.0
        targetSdk = 35
        versionCode = (System.getenv("ANDROID_VERSION_CODE") ?: "1").toInt()
        versionName = System.getenv("ANDROID_VERSION_NAME") ?: "0.1.0"
    }

    sourceSets.getByName("main").assets.srcDir(generatedAssets)

    signingConfigs {
        if (keystoreFile != null) {
            create("release") {
                storeFile = keystoreFile
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (keystoreFile != null) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    lint {
        abortOnError = false
    }
}

tasks.named("preBuild") { dependsOn(copyServerAssets) }

dependencies {
    // HTTP + WebSocket 서버
    implementation("org.nanohttpd:nanohttpd-websocket:2.3.1")
    // 접속 QR
    implementation("com.google.zxing:core:3.5.3")
    testImplementation("junit:junit:4.13.2")
}
