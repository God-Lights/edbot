# edbot 클라이언트 (Unity 2D, PC)

서버(`../server`)에 접속하는 Unity 클라이언트의 뼈대입니다.
지금은 **방 만들기 / 입장 → 준비 → 밴 → 드래프트 → 레인 배치 → 단계별 카운트다운**까지 되는 개발용 화면만 있습니다.

## 폴더

| 경로 | 내용 |
|---|---|
| `Assets/Scripts/Net/` | 네트워크 코어. **UnityEngine에 의존하지 않는 순수 C#** (`Edbot.Net`) |
| `Assets/Scripts/Game/` | Unity 쪽 코드 (`Edbot.Game`). 연결을 들고 있는 `GameClient`, 임시 화면 `DevLobbyGui` |
| `Tests~/Edbot.Net.Tests/` | 네트워크 코어 테스트 (`dotnet test`). 폴더 이름 끝의 `~` 때문에 Unity는 무시한다 |

### 네트워크 코어 (`Assets/Scripts/Net/`)

| 파일 | 하는 일 |
|---|---|
| `Protocol.cs` | 서버와 주고받는 메시지 형식(밴, 드래프트, 배치 포함), JSON 해석 |
| `Transport.cs` | WebSocket 한 개를 감싼 인터페이스와 실제 구현(`ClientWebSocket`) |
| `RoomConnection.cs` | 접속, 메시지 처리, ping, 끊겼을 때 token으로 자동 재접속. 결과는 이벤트 큐로만 내보낸다 |
| `ServerClock.cs` | 서버 시계와 내 시계의 차이를 추정해서 남은 시간을 정확히 계산 |
| `ApiClient.cs` | HTTP API (방 만들기, 방 정보 조회, 캐릭터 데이터), 서버 주소 다듬기 |

네트워크는 백그라운드 스레드에서 돌고, Unity는 메인 스레드에서만 화면을 바꿀 수 있습니다.
그래서 `RoomConnection`은 이벤트를 큐에 쌓고, `GameClient.Update()`가 매 프레임 꺼내서 전합니다.

## Unity에서 열기

**Unity 6.6 LTS** 기준입니다.

1. Unity Hub에서 **Add > Add project from disk** 로 이 저장소의 `client` 폴더를 고른다.
2. 에디터 버전을 묻거나 "설치되지 않은 버전"이라고 나오면, 설치한 **6.6.x** 를 고른다.
   (`ProjectSettings/ProjectVersion.txt`의 버전은 임시값이라 Unity가 알아서 바꾼다.)
3. 처음 열 때 Unity가 `ProjectSettings/` 의 나머지 파일, `Packages/packages-lock.json`, 각 파일의 `.meta` 를 만든다.
   **이 파일들은 처음 한 번 커밋**해 두어야 팀원/다른 컴퓨터에서 같은 상태로 열린다.
4. 아무 씬에서 재생 버튼을 누르면 `DevBootstrap`이 개발용 화면을 자동으로 만든다.

패키지는 `Packages/manifest.json` 에 적혀 있고 Newtonsoft JSON(`com.unity.nuget.newtonsoft-json`)이 꼭 필요합니다.
패키지 버전 오류가 나면 `Window > Package Manager` 에서 해당 패키지를 최신 버전으로 올리면 됩니다.

> **한국어 패치:** Unity Hub에서 설치하는 한국어 언어 팩은 **에디터 메뉴의 언어**만 바꿉니다.
> 게임 화면에 그려지는 글자와는 상관이 없습니다. 게임 안에서 한국어가 네모로 보이면
> 한글이 들어 있는 폰트를 `DevLobbyGui`의 `Font` 칸에 끌어다 놓으세요. (Windows에서는 대개 그대로 보입니다.)

## 서버와 함께 써 보기

```bash
# 터미널 1: 서버 (시간을 10배 빠르게 하면 한 판이 24초)
cd server
npx wrangler dev --var PHASE_SCALE:0.1
```

Unity에서 재생하면 서버 주소가 `http://127.0.0.1:8787` 으로 채워져 있습니다.
**방 만들기**를 누르면 4자리 코드가 나오고, 상대는 그 코드로 **입장**해서 둘 다 **준비**를 누르면 시작됩니다.
이후 밴 → 드래프트 → 배치 순서로 직접 눌러서 진행해 볼 수 있습니다. (시간이 부족하면 서버가 알아서 채웁니다.)
사람이 직접 하기에는 `PHASE_SCALE:0.1` 이 너무 빠르니, 손으로 해 볼 때는 `PHASE_SCALE` 없이(실제 시간) 서버를 띄우세요.

한 컴퓨터에서 두 명을 시험하려면 Windows 빌드를 하나 만들어 에디터와 동시에 실행하면 됩니다.

## 테스트

네트워크 코어는 에디터 없이 `dotnet test` 로 검증합니다. (.NET 8 SDK 필요)

```bash
cd client/Tests~/Edbot.Net.Tests
dotnet test                      # 단위 테스트 (가짜 WebSocket 사용)
```

실제 서버에 진짜 WebSocket으로 붙는 통합 테스트는 서버를 띄운 뒤 주소를 환경 변수로 주면 실행됩니다.

- 방 만들기, 두 명 입장, 정원 초과 거절, 준비, 게임 중 연결을 끊었다가 재접속, 모든 단계를 지나 로비 복귀
- 두 사람이 직접 밴(서로 숨김) → 드래프트(차례, 밴된 캐릭터 거절) → 배치(내 것만 보임, 둘 다 확정하면 바로 진행)

```bash
# 서버를 PHASE_SCALE:0.1 로 띄운 상태에서
EDBOT_SERVER=http://127.0.0.1:8787 dotnet test
```

테스트 프로젝트는 Unity와 **같은 소스 파일**을 그대로 컴파일하고, 언어 버전도 Unity가 지원하는 C# 9로 맞춰 두었습니다.

## 검증된 것과 아닌 것

- 검증됨: 네트워크 코어 전체 (단위 테스트 56개 + 실제 서버 통합 테스트 2개).
- 아직 아님: `Assets/Scripts/Game/` 의 Unity 코드는 이 환경에 에디터가 없어서 **에디터에서 실행해 보지 못했습니다.**
  UnityEngine의 필요한 부분만 흉내 낸 임시 스텁으로 컴파일만 확인했습니다. 처음 열었을 때 오류가 있으면 알려 주세요.

## 로그인 (GL Account)와 전투 화면

- 서버 주소 기본값은 `https://edgame-api.officialgl.com` 입니다. 로컬 개발 서버(`--var REQUIRE_AUTH:false`)에는 `http://127.0.0.1:8787` 로 바꾸면 로그인 없이 쓸 수 있습니다.
- **로그인하기** 버튼을 누르면 브라우저로 `account.officialgl.com` 로그인 화면이 열리고, 로그인한 뒤 서버 페이지의 **로그인 확인**을 누르면 게임이 토큰을 받습니다 (`AuthClient`, `GameClient.BeginLogin`). 자동으로 열리지 않습니다. 토큰은 `PlayerPrefs`에 저장되고, 방을 만들거나 들어갈 때 `Authorization: Bearer` 헤더로 보냅니다. 로그인하면 이름은 GL 닉네임이 됩니다.
- 전투(`Phase.Battle`)와 데스매치는 `BattleView`(IMGUI)가 그립니다. 레인 3개, 타워, 유닛, 점수, 스팀포스, 내 캐릭터별 궁극기 버튼(안키오는 레인 선택), 나이트의 레인 이동 버튼이 있습니다. 내 본진이 항상 왼쪽에 오도록 seat 1이면 좌우를 뒤집습니다.
- 새 메시지: `MessageCodec.Ultimate`, `MessageCodec.Move`, `RoomConnection.SendUltimate/SendMoveLane`.
- Unity 에디터에서 실행해 본 것은 아닙니다. 순수 C#(`Net`)은 `dotnet test`로 검증했고, `Game` 스크립트는 컴파일만 확인했습니다.
