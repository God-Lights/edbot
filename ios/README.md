# COMMANDER iPad 앱 (SwiftUI)

서버(`../server`)에 붙는 iPad 전용 네이티브 클라이언트입니다. 번들 ID `com.officialgl.commander`, iPadOS 17 이상, 가로 화면 고정. Unity 클라이언트(`../client`)는 PC용으로 따로 유지합니다.

```
EdbotKit/    Swift Package. UI 없는 순수 로직: 모델, 메시지 코덱, 서버 연결(재접속), 기기 로그인, 토큰 저장
EdbotApp/    SwiftUI 앱 (AppModel, 화면)
project.yml  XcodeGen 설정 (Commander.xcodeproj 는 저장소에 두지 않는다)
```

## 지금 되는 것
- **1단계:** 로비(로고, 서버 주소, 로그인하기, 방 만들기·입장), 방 안(플레이어, 준비)
- **2단계:** 밴(캐릭터 1명 고르고 확정), 드래프트(스네이크 순서 표시, 내 팀·상대 팀, 차례 타이머), 배치(캐릭터를 레인으로 끌어다 놓거나 누르고 레인을 누르기, 확정). 상대의 밴과 배치는 서버가 숨기는 대로 단계가 끝나야 보입니다.
- 전투, 탐사, 대장간, 랭킹은 다음 단계에서 만듭니다.

- **전투 화면:** 롤처럼 **위에서 내려다본 2D 지도**입니다. 내 본진은 항상 왼쪽 아래, 적 본진은 오른쪽 위(seat 1이면 지도를 180도 돌려서 그렇게 보임). 위쪽 길(퀸사이드), 가운데 대각선(센터), 아래쪽 길(킹사이드) 세 레인이 있고 강이 가로지릅니다. 서버는 레인을 직선(0~100)으로 계산하므로 서버 규칙은 바뀌지 않고, 지도 좌표 변환은 `EdbotKit/MapGeometry.swift`가 맡습니다. 가드 타워의 사거리 고리(회복·피해 구간)가 보입니다.

디자인: 로고의 남색·보라·은색에서 뽑은 색(`Theme.swift`), 캐릭터는 체스 기물 글자(♚♛♜♝♞♟)로 구분합니다. 앱 아이콘, 화면 로고, 시작 화면 이미지는 `design/commander-logo.png`(투명 배경 원본)에서 `python3 design/make_assets.py` 로 만들어 `EdbotApp/Assets.xcassets`에 넣습니다. 로고를 바꾸면 원본만 교체하고 스크립트를 다시 돌리세요.

로그인은 Unity 클라이언트와 같은 "기기 로그인"입니다. **로그인하기**를 눌러야 Safari가 열리고, 로그인한 뒤 서버 페이지의 "로그인 확인"을 누르면 앱이 토큰을 받아 Keychain에 저장합니다.

## 빌드와 설치 (전부 GitHub Actions)
`.github/workflows/ios.yml`

작업 하나(macOS)가 `swift test` → `xcodegen generate` → `xcodebuild archive`(서명 끔) → **서명 없는 `Commander.ipa`** 를 만듭니다. `ios/` 를 바꾸는 PR에서만 자동으로 돌고, 릴리스는 Actions 탭 **iOS > Run workflow** 에서 버전을 적어 실행하거나 태그 `ios-vX.Y.Z` 를 올리면 만들어집니다.

```bash
git tag ios-v0.1.0 && git push origin ios-v0.1.0
```

설치: 받은 `.ipa`를 **Sideloadly** 또는 **AltStore** 로 본인 Apple ID에 서명해서 iPad에 올립니다. (무료 Apple ID는 7일마다 다시 서명해야 합니다. iPad의 설정에서 개발자 모드를 켜야 합니다.) 인증서와 비밀번호는 저장소와 워크플로에 두지 않습니다.

## 개발 메모
- 로컬 서버(`npx wrangler dev --var REQUIRE_AUTH:false`)에 붙으려면 서버 주소에 `http://<Mac의 IP>:8787` 을 적습니다(로컬 네트워크 http 허용).
- 서버 메시지 규격이 바뀌면 `EdbotKit/Tests` 의 예시 JSON이 먼저 깨지도록 서버가 실제로 보내는 형식으로 적어 두었습니다.
- 이 코드는 Swift 컴파일러가 없는 환경에서 작성되어, 첫 빌드는 CI에서 확인합니다. 컴파일 오류가 나면 Actions 로그를 보내 주세요.

## SideStore로 설치하고 업데이트 받기

**소스 주소:** `https://edgame-api.officialgl.com/sidestore.json`

1. iPad의 SideStore에서 **Browse > Sources > +** 를 눌러 위 주소를 붙여 넣고 소스를 추가합니다. (서버 첫 화면 `https://edgame-api.officialgl.com/` 에 있는 **SideStore에 소스 추가** 링크를 iPad에서 눌러도 됩니다. `sidestore://source?url=...` 로 바로 열립니다.)
2. 목록에 나온 **COMMANDER**를 설치합니다. 서명은 SideStore가 본인 Apple ID로 합니다.
3. 새 버전이 올라오면 SideStore가 업데이트를 알려 줍니다.

소스는 서버가 GitHub 릴리스(`ios-vX.Y.Z` 태그, `Commander.ipa` 첨부)를 읽어서 만듭니다(5분 캐시). 그래서 **새 버전을 내는 방법**은 태그를 올리는 것뿐입니다.

```bash
git tag ios-v0.2.0 && git push origin ios-v0.2.0
```

워크플로가 그 버전 번호로 `.ipa`를 만들어 릴리스에 `Commander.ipa`와 `icon.png`(소스의 앱 아이콘)를 올립니다. 릴리스를 올리기 전에는 소스에 앱이 보이지 않습니다. AltStore에도 같은 주소로 소스를 추가할 수 있습니다.

### 소스가 만들어지는 방식
서버의 `/sidestore.json` 은 GitHub API가 아니라, 릴리스를 올릴 때 워크플로(`SideStore 소스 갱신` 작업)가 만들어 고정 릴리스 **`sidestore-source`** 에 올려 둔 `sidestore.json` 파일을 읽어 와서 5분 캐시합니다. (GitHub API는 Cloudflare Workers의 공유 IP에서 호출 한도에 걸려 `releases_unavailable` 오류가 났습니다.) 그래서 iOS 릴리스를 한 번도 올리지 않은 동안에는 앱이 없는 빈 소스가 나가고, 릴리스를 올리면 자동으로 채워집니다. `sidestore-source` 릴리스는 직접 지우거나 고치지 마세요.

### 버전 번호 규칙
SideStore는 내려받은 앱의 `CFBundleVersion`이 소스의 `buildVersion`과 같은지 검사합니다. 그래서 워크플로가 앱의 `CFBundleVersion`과 `CFBundleShortVersionString`을 둘 다 **릴리스 버전 번호**(예: `0.1.2`)로 맞춥니다(빌드가 끝난 앱의 `Info.plist`를 직접 고치고 확인). 소스도 `buildVersion`을 같은 값으로 씁니다. 0.1.0, 0.1.1 릴리스는 이 맞춤 전에 만들어져서 설치가 거부됩니다. 0.1.2부터 설치됩니다.
