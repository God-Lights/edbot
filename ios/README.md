# COMMANDER iPad 앱 (SwiftUI)

서버(`../server`)에 붙는 iPad 전용 네이티브 클라이언트입니다. 번들 ID `com.officialgl.commander`, iPadOS 17 이상, 가로 화면 고정. Unity 클라이언트(`../client`)는 PC용으로 따로 유지합니다.

```
EdbotKit/    Swift Package. UI 없는 순수 로직: 모델, 메시지 코덱, 서버 연결(재접속), 기기 로그인, 토큰 저장
EdbotApp/    SwiftUI 앱 (AppModel, 화면)
project.yml  XcodeGen 설정 (Commander.xcodeproj 는 저장소에 두지 않는다)
```

## 지금 되는 것 (1단계)
로비(서버 주소, 로그인하기, 방 만들기·입장), 방 안(플레이어, 준비, 단계와 남은 시간). 밴·드래프트·배치, 전투, 탐사, 대장간, 랭킹은 다음 단계에서 만듭니다.

로그인은 Unity 클라이언트와 같은 "기기 로그인"입니다. **로그인하기**를 눌러야 Safari가 열리고, 로그인한 뒤 서버 페이지의 "로그인 확인"을 누르면 앱이 토큰을 받아 Keychain에 저장합니다.

## 빌드와 설치 (전부 GitHub Actions)
`.github/workflows/ios.yml`

1. `EdbotKit` 테스트(Linux, `swift test`)
2. macOS 러너에서 `xcodegen generate` → `xcodebuild archive`(서명 끔) → **서명 없는 `Commander.ipa`**
3. 실행 결과의 Artifacts에서 내려받거나, 태그 `ios-vX.Y.Z` 를 올리면 릴리스에 올라갑니다.

```bash
git tag ios-v0.1.0 && git push origin ios-v0.1.0
```

설치: 받은 `.ipa`를 **Sideloadly** 또는 **AltStore** 로 본인 Apple ID에 서명해서 iPad에 올립니다. (무료 Apple ID는 7일마다 다시 서명해야 합니다. iPad의 설정에서 개발자 모드를 켜야 합니다.) 인증서와 비밀번호는 저장소와 워크플로에 두지 않습니다.

## 개발 메모
- 로컬 서버(`npx wrangler dev --var REQUIRE_AUTH:false`)에 붙으려면 서버 주소에 `http://<Mac의 IP>:8787` 을 적습니다(로컬 네트워크 http 허용).
- 서버 메시지 규격이 바뀌면 `EdbotKit/Tests` 의 예시 JSON이 먼저 깨지도록 서버가 실제로 보내는 형식으로 적어 두었습니다.
- 이 코드는 Swift 컴파일러가 없는 환경에서 작성되어, 첫 빌드는 CI에서 확인합니다. 컴파일 오류가 나면 Actions 로그를 보내 주세요.
