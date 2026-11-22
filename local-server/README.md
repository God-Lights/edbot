# COMMANDER 로컬 서버 (시제품)

Cloudflare 없이, 기존 서버 엔진(`../server/src`)을 **그대로** Bun으로 돌린다. 설치 없이 실행파일 하나로 만들 수 있다.
설계: `docs/DESIGN-autochess.md` 24장.

## 실행 (개발)
```bash
cd local-server
bun run dev                                   # http://localhost:8787, 데이터는 ./commander-data
bun run dev -- --port 9000 --phase-scale 0.05 # 단계 시간을 20배 빠르게
bun run smoke                                 # 켜 둔 서버를 점검(웹·API·봇과 한 판)
```
같은 와이파이의 기기에서는 시작할 때 보여 주는 `http://<IP>:8787` 로 접속한다. 로그인은 이름만 쓴다(`REQUIRE_AUTH=false`).

## 실행파일 만들기
```bash
bun build.ts                              # 지금 컴퓨터용
bun build.ts --target bun-windows-x64     # 윈도우용 commander-server.exe (다른 OS에서도 만들 수 있다)
bun build.ts --edition expert             # 엑스퍼트 이름표(플러그인은 아직 없다)
```
웹 화면과 DB 마이그레이션이 실행파일 안에 들어가서, **exe 하나만 있으면** 돈다. 데이터는 exe 옆 `commander-data/`에 만든다.
(쓸 수 없는 폴더면 `%APPDATA%\CommanderServer`.) `--data 경로`로 바꿀 수 있다.

옵션: `--port`, `--data`, `--host`, `--phase-scale`, `--web <폴더>`(exe 안의 화면 대신 그 폴더를 쓴다).

## 구조
- `src/main.ts`: Bun 서버(HTTP, WebSocket), 웹 화면 내보내기, 시작·종료.
- `src/runtime/objects.ts`: Durable Object 흉내(이름으로 찾는 객체, JSON 파일 저장, 알람, 연결 목록).
- `src/runtime/websocket.ts`: `WebSocketPair`와 `new Response(null, { status: 101, webSocket })` 흉내.
- `src/runtime/d1.ts`: D1 흉내(지금은 bun:sqlite 파일. 다음 단계에서 JSON 저장소로 바꾼다).
- `src/runtime/workers-shim.ts`: `cloudflare:workers` 대신 쓰는 모듈.
- 서버 엔진 코드는 한 줄도 고치지 않았다.

## 지금의 한계 (시제품)
- 전적·랭킹 저장이 JSON이 아니라 SQLite 파일이다. (로컬은 로그인이 없어서 전적은 아직 안 남는다)
- 플러그인과 바닐라/엑스퍼트 구분은 이름뿐이다.
- 윈도우 .exe 는 이 저장소의 CI(`local-server.yml`, 윈도우 머신)에서 실행 점검한다.
- 서명이 없어서 처음 실행할 때 Windows SmartScreen 경고가 뜬다. ("추가 정보" -> "실행")
