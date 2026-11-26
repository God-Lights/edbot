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

## 공통 (`common/`)
게임 앱과 서버 앱이 함께 쓰는 것: 색·버튼(`Ui.kt`), 새 버전 안내(`AppUpdater.kt`, `Versions.kt`).
- 새 버전 안내: GitHub 릴리스 `android-v*` 의 `Commander-*.apk`(서버 앱은 `CommanderServer-*.apk`)가 지금보다 새것이면 맨 위에 띠.
  "업데이트"는 APK 를 내려받아 설치 창을 연다(처음 한 번 "출처를 알 수 없는 앱 설치" 허용). 개발용·시험판은 확인하지 않는다.

## 폰에서 쓰기 좋게
- 게임 화면(웹): 누를 때 회색 번쩍임·길게 눌러 글자 선택이 없고, 사기·★2·라운드 결과 등에 짧은 진동(효과음을 끄면 진동도 꺼짐)
- 시작 화면(로고), 첫 화면의 "이어하기"(마지막 서버), 화면 바뀔 때 부드럽게(fade)

## 서버 앱 (`server/`, COMMANDER 서버)
이 폰을 같은 와이파이용 게임 서버로 켠다. 패키지 `com.officialgl.commander.server`. iPad 서버 앱(`ios-server/`)과 같은 구조다.

```
server/src/main/java/com/officialgl/commander/server/
  ServerActivity.kt  설정(이름·포트·바닐라/엑스퍼트), 켜기/끄기, 접속 주소와 QR, 기록
  ServerService.kt   포그라운드 서비스: 엔진 + 접속 서버 + 같은 와이파이 알림(mDNS). 앱을 내려도 돈다
  Engine.kt          숨은 WebView 에서 서버 엔진(engine.js)을 돌린다. 요청·소켓·파일 저장을 주고받는다
  HttpServer.kt      HTTP + WebSocket (NanoHTTPD). 웹 화면은 APK 의 assets/web, 나머지는 엔진으로
  DataStore.kt       데이터 폴더(전적·방). 엔진이 알려 주는 파일 변경을 순서대로 쓴다
```
- 엔진은 `ios-server/engine` 의 `engine.js`(서버 코드 전체를 한 파일로 묶은 것)를 그대로 쓴다. 빌드 전에 `cd ios-server/engine && bun build.ts`.
- **타이머는 앱이 돌린다**: 화면에 안 보이는 WebView 는 setTimeout 을 늦추므로, 엔진의 `timers` 옵션으로 Kotlin(Handler)이 시간을 잰다.
- 화면이 꺼져도 돌게 부분 wake lock·와이파이 lock 을 잡는다. 오래 켜 둘 때는 배터리 최적화를 끄는 게 좋다.
- WebView 100 이상이 필요하다 (엔진이 최신 JS 문법을 쓴다).
- CI 는 에뮬레이터(14)에서 서버 앱을 켜고 `local-server/scripts/smoke.ts` 로 봇과 한 판·두 사람 한 판까지 점검한다.

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
