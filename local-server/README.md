# COMMANDER 로컬 서버 (시제품)

Cloudflare 없이, 기존 서버 엔진(`../server/src`)을 **그대로** Bun으로 돌린다. 설치 없이 실행파일 하나로 만들 수 있다.
설계: `docs/DESIGN-autochess.md` 24장.

## 실행 (개발)
```bash
cd local-server
bun run dev                                   # http://localhost:8787, 데이터는 ./commander-data
bun run dev -- --port 9000 --phase-scale 0.05 # 단계 시간을 20배 빠르게
bun run smoke                                 # 켜 둔 서버를 점검(웹·API·봇과 한 판·두 사람이 한 판)
bun test                                      # 저장소 시험
```
같은 와이파이의 기기에서는 시작할 때 보여 주는 `http://<IP>:8787` 로 접속한다. 로그인은 이름만 쓴다(`REQUIRE_AUTH=false`).

## 실행파일 만들기
```bash
bun build.ts                              # 지금 컴퓨터용
bun build.ts --target bun-windows-x64     # 윈도우용 commander-server.exe (다른 OS에서도 만들 수 있다)
bun build.ts --edition expert             # 엑스퍼트 이름표(플러그인은 아직 없다)
```
웹 화면이 실행파일 안에 들어가서, **exe 하나만 있으면** 돈다. 데이터는 exe 옆 `commander-data/`에 만든다.
(쓸 수 없는 폴더면 `%APPDATA%\CommanderServer`.) `--data 경로`로 바꿀 수 있다.

옵션: `--port`, `--data`, `--host`, `--phase-scale`, `--web <폴더>`(exe 안의 화면 대신 그 폴더를 쓴다).

## 데이터 (JSON 파일)
```
commander-data/
  data/players.json      선수 표(이름, 레이팅, 승패)
  data/matches.jsonl     한 판에 한 줄 (이것만 있으면 선수 표를 다시 만들 수 있다)
  data/replays/*.json    다시 보기, 판마다 하나
  objects/               진행 중인 방 등(껐다 켜도 이어진다)
  backups/<날짜>/        시작할 때와 하루마다 players.json·matches.jsonl 복사본, 최근 14일
  commander.lock         같은 폴더를 서버 두 개가 쓰지 못하게 하는 잠금
```
- **이름이 곧 사용자**다(대소문자·앞뒤 공백은 같은 사람). 두 사람이 이름으로 한 판을 하면 전적이 남는다. 봇과 한 판(`ADMN`·`ADMF`·`ADMX`)은 남기지 않는다.
- 파일은 임시 파일에 쓰고 이름을 바꿔서 쓰는 도중에 꺼져도 깨지지 않는다. `players.json`이 깨졌거나 없으면 `matches.jsonl`로 다시 만든다. 꺼지다 만 마지막 줄은 건너뛴다.
- **내보내기·불러오기** (서버를 끈 상태에서):
  ```bash
  commander-server export 전적.json                 # 선수·판·다시 보기를 JSON 하나로
  commander-server import 전적.json                 # 비어 있는 서버에 불러오기
  commander-server import 전적.json --merge         # 이미 있는 서버에 없는 것만 더하기(있는 판·선수는 그대로)
  ```
  JSON 행은 운영 D1 표(`players`, `matches`, `replays`)의 열과 같아서 서로 옮기기 쉽다.

## 구조
- `src/main.ts`: Bun 서버(HTTP, WebSocket), 웹 화면 내보내기, 시작·종료, 내보내기·불러오기 명령.
- `src/runtime/json-store.ts`: 전적 저장소(JSON 파일), 백업, 데이터 폴더 잠금.
- `src/runtime/objects.ts`: Durable Object 흉내(이름으로 찾는 객체, JSON 파일 저장, 알람, 연결 목록).
- `src/runtime/websocket.ts`: `WebSocketPair`와 `new Response(null, { status: 101, webSocket })` 흉내.
- `src/runtime/workers-shim.ts`: `cloudflare:workers` 대신 쓰는 모듈.
- 서버 엔진 코드는 전적 저장소를 `RankingStore`(`server/src/ranking/store.ts`) 한 겹으로만 쓴다. 운영·개발은 D1, 로컬은 JSON 파일.

## 지금의 한계 (시제품)
- 플러그인과 바닐라/엑스퍼트 구분은 이름뿐이다.
- 전적이 남는 순간(판이 끝날 때) 쓰는 파일은 바로 저장하지만, 방 상태(`objects/`)는 바뀐 뒤 0.15초 안에 쓴다. 그 사이에 강제로 끄면 마지막 변경만 잃는다.
- 서명이 없어서 처음 실행할 때 Windows SmartScreen 경고가 뜬다. ("추가 정보" -> "실행")
