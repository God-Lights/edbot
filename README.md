# edbot

체스 기물 클래스의 캐릭터 5명을 드래프트로 뽑아 세 레인에 보내고, 판 안에서 캐낸 재료로 만든 무기로
상대 타워를 부수는 약 4분짜리 온라인 1:1 팀 배틀 게임입니다.
클라이언트는 Unity(C#) PC 앱, 서버는 Cloudflare(Workers, Durable Objects, D1)입니다.

| 폴더 | 내용 |
|---|---|
| [`server/`](server/README.md) | 온라인 대전 서버 (방 코드, WebSocket, 단계 타이머) |
