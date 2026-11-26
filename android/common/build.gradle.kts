plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

// 게임 앱(app)과 서버 앱(server)이 함께 쓰는 것: 색·버튼(Ui.kt), 새 버전 안내(AppUpdater.kt)
android {
    namespace = "com.officialgl.commander.common"
    compileSdk = 35

    defaultConfig {
        minSdk = 26
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

dependencies {
    testImplementation("junit:junit:4.13.2")
}
