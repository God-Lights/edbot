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
bun build.ts --edition expert             # 엑스퍼트: commander-data/plugins/ 의 콘텐츠 팩을 읽는다
bun build.ts --edition vanilla --target bun-windows-x64   # 바닐라: 플러그인 코드가 아예 없다
```
웹 화면이 실행파일 안에 들어가서, **exe 하나만 있으면** 돈다. 데이터는 exe 옆 `commander-data/`에 만든다.
(쓸 수 없는 폴더면 `%APPDATA%\CommanderServer`.) `--data 경로`로 바꿀 수 있다.

옵션: `--no-discovery`(서버 자동 찾기 끄기), `--port`, `--data`, `--name <서버 이름>`(앱·웹 로비에 보인다), `--host`, `--phase-scale`, `--web <폴더>`(exe 안의 화면 대신 그 폴더를 쓴다).

`GET /api/server`가 이 서버의 이름·환경(`local`)·로그인 방식(`open`)·에디션·프로토콜 버전을 알려 준다. 앱과 웹은 이걸 보고 로비를 맞춘다(로그인 버튼 대신 이름 입력, "로컬 서버" 띠).

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

- 전적이 남는 순간(판이 끝날 때) 쓰는 파일은 바로 저장하지만, 방 상태(`objects/`)는 바뀐 뒤 0.15초 안에 쓴다. 그 사이에 강제로 끄면 마지막 변경만 잃는다.
- 서명이 없어서 처음 실행할 때 Windows SmartScreen 경고가 뜬다. ("추가 정보" -> "실행")

## 플러그인 (엑스퍼트만)
`COMMANDER_EDITION=expert bun run dev` 또는 엑스퍼트 exe로 켜면 `commander-data/plugins/`를 만들고 거기의 `*.json`·`*/pack.json`을 읽는다. 시작 화면에 적용된 팩과 거절된 팩(이유 포함)이 나온다. 형식은 `docs/PLUGINS.md`. 바닐라는 이 폴더를 읽지 않는다.

## 폰으로 접속하기 (QR, 자동 찾기)
- 서버를 켜면 터미널에 QR이 나온다. 같은 와이파이의 폰 카메라로 찍으면 COMMANDER 앱이 열리고 서버 주소가 입력된다. 같은 화면이 `http://localhost:8787/connect`에도 있다.
- 앱의 서버 입력칸 아래에는 같은 와이파이에서 찾은 서버가 목록으로 뜬다(Bonjour `_commander._tcp`). 눌러서 고른다. 윈도우 방화벽이 처음에 물으면 "허용"을 눌러야 폰이 찾을 수 있다.
- 웹 브라우저로는 화면에 나온 `http://IP:8787` 주소를 그대로 열면 된다.

## 우분투 (.deb)
```bash
sh linux/build-deb.sh              # 먼저 bun build.ts 와 bun build.ts --edition expert 로 두 실행파일을 만든다
sudo apt install ./dist/commander-server_0.1.0_amd64.deb
```
- 앱 메뉴의 **COMMANDER 서버**를 누르면 서버를 뒤에서 켜고 접속 화면(QR)을 브라우저로 연다. 오른쪽 클릭 메뉴에 "서버 끄기", "엑스퍼트로 켜기", "기록 보기".
- 터미널: `commander-server-launcher start|stop|status|log [--expert]`. 설정은 `~/.config/commander-server/config`(`PORT=`, `NAME=`, `EDITION=`), 데이터는 `~/.local/share/commander-server`(플러그인은 그 안 `plugins/`).
- 로그인할 때마다 켜려면 `systemctl --user enable --now commander-server`.
- 같은 와이파이의 폰이 못 찾으면 방화벽에서 8787(TCP)과 5353(UDP)을 연다: `sudo ufw allow 8787/tcp && sudo ufw allow 5353/udp`.
