# COMMANDER 안드로이드 앱

안드로이드 **8.0(API 26) 이상**. 패키지 `com.officialgl.commander`, 게임은 가로 화면.

```
app/src/main/java/com/officialgl/commander/
  MainActivity.kt     첫 화면: 서버 고르기 (공식 서버, 같은 와이파이, 최근, 직접 적기, QR 찍기)
  GameActivity.kt     게임 화면: 고른 서버의 웹 화면을 WebView 로 연다 (전체 화면, 화면 켜 둠)
  ServerDiscovery.kt  같은 와이파이의 로컬 서버 찾기 (mDNS `_commander._tcp`, TXT 의 ip·port·name·ed)
  ConnectLink.kt      commander://connect?url=..&name=.. 링크, 주소 다듬기 (안드로이드 없이 시험)
  ServerStore.kt      최근 서버 6개
  Ui.kt               헥스텍 색과 버튼 (웹·iOS 와 같은 색)
```

## 왜 웹 화면을 쓰나
게임 화면(로비·준비·전투·도감)은 서버가 함께 내보내는 웹 화면(`web/`)을 그대로 쓴다.
서버와 화면 버전이 늘 맞고, 웹에 들어간 디자인·기능이 앱에도 바로 들어온다.
서버 고르기, 같은 와이파이 찾기, QR, 링크처럼 폰 기능이 필요한 부분만 네이티브다.

- 웹 화면은 CSS `color-mix`·컨테이너 쿼리 등을 쓰므로 **Android System WebView(또는 Chrome) 111 이상**이 필요하다.
  안드로이드 8 기기라도 Play 스토어에서 WebView 를 업데이트하면 된다. 더 낮으면 앱이 업데이트를 안내한다("그래도 열기"도 있음).
- 로컬 서버(http)에 붙을 수 있게 평문 http 를 허용한다.
- 주소에 방식을 안 적으면 사설 IP·localhost·.local 은 http, 나머지는 https 로 연다.

## 빌드 (GitHub Actions)
`.github/workflows/android.yml`

- `android/` 를 바꾸는 PR: 단위 시험 → 디버그·릴리스 APK → 린트 → 에뮬레이터(8.0, 14)에서 서버 고르기·게임 화면 찍기
  - 결과물: `commander-android-apk`(설치용), `android-screenshots-api26`, `android-screenshots-api34`
- 릴리스: Actions 탭 **Android > Run workflow** 에서 버전을 적거나 태그 `android-vX.Y.Z` 를 올린다.

서명: 저장소 비밀값 `ANDROID_KEYSTORE_B64`(.jks 파일을 base64), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` 가 있으면 그 키로 서명한다.
없으면 CI 의 디버그 키로 서명하는데, 빌드마다 키가 달라서 **새 버전을 깔 때 이전 앱을 지워야** 할 수 있다.

```bash
keytool -genkeypair -v -keystore commander.jks -alias commander -keyalg RSA -keysize 2048 -validity 10000
```

```bash
base64 -w0 commander.jks
```

## 로컬에서 빌드
안드로이드 SDK 가 있으면 `cd android && ./gradlew assembleDebug` (JDK 17). 결과: `app/build/outputs/apk/debug/app-debug.apk`

## 설치
APK 를 폰에 받아 열고 "출처를 알 수 없는 앱 설치"를 허용한다.
