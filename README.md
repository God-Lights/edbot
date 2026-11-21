# edbot

체스 기물 클래스의 캐릭터 5명을 드래프트로 뽑아 세 레인에 보내고, 판 안에서 캐낸 재료로 만든 무기로
상대 타워를 부수는 약 4분짜리 온라인 1:1 팀 배틀 게임입니다.
클라이언트는 Unity 2D(C#) PC 앱, 서버는 Cloudflare(Workers, Durable Objects, D1)입니다.

| 폴더 | 내용 |
|---|---|
| [`server/`](server/README.md) | 온라인 대전 서버 (방 코드, WebSocket, 단계 타이머) |
| [`web/`](web/README.md) | **웹 클라이언트** (체스판 자동 전투). 서버가 같은 주소에서 내보낸다. iPad 앱과 같은 서버를 쓰므로 서로 대전할 수 있다 |
| `ios/` | iPad 앱 (SwiftUI) |
| [`client/`](client/README.md) | 옛 Unity 클라이언트 (레인 타워 게임, 더 이상 쓰지 않음) |

서버는 `main`에 합치면 GitHub Actions가 Cloudflare에 배포합니다. 설정 방법은 [server/README.md](server/README.md#배포-github-actions)를 보세요.
