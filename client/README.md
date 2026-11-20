# edbot 클라이언트 (Unity 2D, PC)

서버(`../server`)에 접속하는 Unity 클라이언트의 뼈대입니다.
지금은 **방 만들기 / 입장 → 준비 → 단계별 카운트다운**까지 되는 개발용 화면만 있습니다.

## 폴더

| 경로 | 내용 |
|---|---|
| `Assets/Scripts/Net/` | 네트워크 코어. **UnityEngine에 의존하지 않는 순수 C#** (`Edbot.Net`) |
| `Assets/Scripts/Game/` | Unity 쪽 코드 (`Edbot.Game`). 연결을 들고 있는 `GameClient`, 임시 화면 `DevLobbyGui` |
| `Tests~/Edbot.Net.Tests/` | 네트워크 코어 테스트 (`dotnet test`). 폴더 이름 끝의 `~` 때문에 Unity는 무시한다 |

### 네트워크 코어 (`Assets/Scripts/Net/`)

| 파일 | 하는 일 |
|---|---|
| `Protocol.cs` | 서버와 주고받는 메시지 형식, JSON 해석 |
| `Transport.cs` | WebSocket 한 개를 감싼 인터페이스와 실제 구현(`ClientWebSocket`) |
| `RoomConnection.cs` | 접속, 메시지 처리, ping, 끊겼을 때 token으로 자동 재접속. 결과는 이벤트 큐로만 내보낸다 |
| `ServerClock.cs` | 서버 시계와 내 시계의 차이를 추정해서 남은 시간을 정확히 계산 |
| `ApiClient.cs` | HTTP API (방 만들기, 방 정보 조회), 서버 주소 다듬기 |

네트워크는 백그라운드 스레드에서 돌고, Unity는 메인 스레드에서만 화면을 바꿀 수 있습니다.
그래서 `RoomConnection`은 이벤트를 큐에 쌓고, `GameClient.Update()`가 매 프레임 꺼내서 전합니다.

## Unity에서 열기

Unity 에디터가 없는 환경에서 만들어서 **프로젝트 설정 파일(`ProjectSettings`, `Packages`)은 아직 없습니다.**
Unity 버전을 정하면 바로 열리도록 추가할 수 있고, 그 전에는 아래 방법으로 쓰면 됩니다.

1. Unity Hub에서 **2D (Universal 2D)** 템플릿으로 새 프로젝트를 만든다. (권장: Unity 6 LTS)
2. 이 저장소의 `client/Assets/Scripts` 폴더를 새 프로젝트의 `Assets/` 안으로 복사한다.
3. `Window > Package Manager > + > Add package by name` 에서 `com.unity.nuget.newtonsoft-json` 을 추가한다.
4. 아무 씬에서 재생 버튼을 누르면 `DevBootstrap`이 개발용 로비 화면을 자동으로 만든다.

> 한국어가 네모로 보이면 한글이 들어 있는 폰트를 `DevLobbyGui`의 `Font` 칸에 끌어다 놓으세요.

## 서버와 함께 써 보기

```bash
# 터미널 1: 서버 (단계 시간을 20배 빠르게 하면 한 판이 12초)
cd server
npx wrangler dev --var PHASE_SCALE:0.05
```

Unity에서 재생하면 서버 주소가 `http://127.0.0.1:8787` 으로 채워져 있습니다.
**방 만들기**를 누르면 4자리 코드가 나오고, 상대는 그 코드로 **입장**해서 둘 다 **준비**를 누르면 시작됩니다.

한 컴퓨터에서 두 명을 시험하려면 Windows 빌드를 하나 만들어 에디터와 동시에 실행하면 됩니다.

## 테스트

네트워크 코어는 에디터 없이 `dotnet test` 로 검증합니다. (.NET 8 SDK 필요)

```bash
cd client/Tests~/Edbot.Net.Tests
dotnet test                      # 단위 테스트 (가짜 WebSocket 사용)
```

실제 서버에 진짜 WebSocket으로 붙는 통합 테스트는 서버를 띄운 뒤 주소를 환경 변수로 주면 실행됩니다.
방 만들기, 두 명 입장, 정원 초과 거절, 준비, 게임 중 연결을 끊었다가 재접속, 모든 단계를 지나 로비 복귀까지 확인합니다.

```bash
# 서버를 PHASE_SCALE:0.05 로 띄운 상태에서
EDBOT_SERVER=http://127.0.0.1:8787 dotnet test
```

테스트 프로젝트는 Unity와 **같은 소스 파일**을 그대로 컴파일하고, 언어 버전도 Unity가 지원하는 C# 9로 맞춰 두었습니다.

## 검증된 것과 아닌 것

- 검증됨: 네트워크 코어 전체 (단위 테스트 44개 + 실제 서버 통합 테스트).
- 아직 아님: `Assets/Scripts/Game/` 의 Unity 코드는 이 환경에 에디터가 없어서 **에디터에서 실행해 보지 못했습니다.**
  UnityEngine의 필요한 부분만 흉내 낸 임시 스텁으로 컴파일만 확인했습니다. 처음 열었을 때 오류가 있으면 알려 주세요.
