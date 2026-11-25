# edbot 서버

Cloudflare Workers + Durable Objects로 만든 온라인 대전 서버입니다.
기획서의 로드맵 **1단계(서버 뼈대)** 와 **2단계(밴, 스네이크 드래프트, 레인 배치)** 까지 구현되어 있습니다.

- 4자리 방 코드로 방 만들기 / 입장, WebSocket 연결, 재접속(token)
- 단계 타이머: 밴 → 드래프트 → 배치 → 탐사 → 대장간 → 전투 → 결과 (총 4분) → 로비로 복귀
- **밴**: 각자 캐릭터 1명을 동시에 금지 (서로 무엇을 밴했는지 숨김)
- **드래프트**: 선공은 무작위, 스네이크 순서로 5명씩 뽑기, 차례마다 4초
- **배치**: 뽑은 5명을 세 레인(퀸사이드·센터·킹사이드)에 나눠 보내기 (상대에게 숨김)
- 캐릭터 12명의 데이터 (`GET /api/characters`)

탐사, 대장간, 전투는 아직 없습니다. 해당 단계는 시간이 지나면 다음 단계로 넘어가기만 합니다.

## 구조

| 파일 | 하는 일 |
|---|---|
| `src/index.ts` | Worker 진입점. HTTP API와 WebSocket 연결을 방(Durable Object)으로 넘긴다 |
| `src/room.ts` | 방 하나 = Durable Object 하나. 저장, 소켓, 알람(타이머) 담당 |
| `src/room-state.ts` | 방 전체의 규칙: 입장, 준비, 단계 전환, 차례 타이머, 보는 사람별 공개 범위 |
| `src/game.ts` | 밴, 드래프트, 배치의 규칙 (한 판 안의 선택) |
| `src/characters.ts`, `src/data/characters.json` | 캐릭터 12명의 데이터와 기본 레인 |
| `src/phases.ts` | 단계 순서와 시간 |
| `src/protocol.ts` | 클라이언트와 주고받는 메시지 형식 |
| `test/` | 단위 테스트 (vitest) |
| `scripts/smoke.mjs` | 실행 중인 서버에 가짜 클라이언트를 붙여 한 판을 끝까지 돌리는 테스트 |

규칙은 `room-state.ts`와 `game.ts`(순수 함수)에, 입출력은 `room.ts`에 나눠 두었습니다.
그래서 규칙은 서버를 띄우지 않고도 테스트할 수 있습니다.

## 실행

```bash
cd server
npm install
npm test            # 단위 테스트
npm run typecheck   # 타입 검사
npm run dev         # 로컬 서버 (http://localhost:8787)
```

한 판이 4분이라 개발 중에는 `PHASE_SCALE`로 시간을 줄여서 돌립니다.

```bash
# 터미널 1: 시간을 20배 빠르게 (4분 → 12초)
npx wrangler dev --var PHASE_SCALE:0.05 --var REQUIRE_AUTH:false

# 터미널 2: 한 판을 끝까지 돌려 보기
npm run smoke
```

## 배포 (GitHub Actions)

배포는 GitHub Actions가 합니다. 워크플로는 `.github/workflows/` 에 있습니다.

| 언제 | 워크플로 | 하는 일 |
|---|---|---|
| `server/` 를 바꾸는 PR | `server.yml` (test 작업) | 서버 타입 검사·단위 테스트·배포 시험(`wrangler deploy --dry-run`). 한 번만 검사한다 |
| `main`에 `server/` 변경이 합쳐질 때 (또는 Actions 탭에서 수동 실행) | `server.yml` (deploy 작업) | 검사 없이 바로 Cloudflare Workers에 배포하고 D1 마이그레이션 적용 (검사는 PR에서 이미 했다) |

테스트가 하나라도 실패하면 배포는 일어나지 않습니다. 배포 단계는 저장소에 고정된 wrangler 버전(`npm run deploy`)을 쓰고
별도의 서드파티 액션은 쓰지 않습니다.

### 처음 한 번 설정하기

1. **계정 ID 확인:** Cloudflare 대시보드 → Workers & Pages 개요 화면 오른쪽의 **Account ID** 를 복사한다.
2. **API 토큰 만들기:** 대시보드 오른쪽 위 프로필 → My Profile → API Tokens → **Create Token** →
   **Edit Cloudflare Workers** 템플릿 → 내 계정만 선택해서 만든다. 토큰은 만들 때 한 번만 보이니 바로 복사한다.
3. **GitHub에 등록:** 저장소 Settings → Secrets and variables → Actions → **New repository secret** 으로 두 개를 만든다.
   - `CLOUDFLARE_API_TOKEN` : 위에서 만든 토큰
   - `CLOUDFLARE_ACCOUNT_ID` : 계정 ID
4. **(권장) 배포 승인 걸기:** 저장소 Settings → Environments → `production` → **Required reviewers** 에 본인을 추가하면,
   배포 전에 승인 버튼을 눌러야 올라간다. (첫 배포가 돌면 `production` 환경이 자동으로 생긴다.)
5. `main`에 합치거나, Actions 탭 → **Deploy server** → Run workflow 로 첫 배포를 한다.

시크릿이 없으면 배포 작업이 첫 단계에서 이유를 적고 멈춥니다. 토큰은 절대 저장소 파일에 적지 마세요.

### 배포된 서버 쓰기

배포가 끝나면 주소는 `https://edbot-server.<내 workers 서브도메인>.workers.dev` 입니다. (Actions 로그의 마지막 줄에 나옵니다.)
Unity 개발용 화면의 **서버 주소** 칸에 이 주소를 그대로 넣으면 됩니다. `https://` 는 자동으로 `wss://` 로 바뀝니다.

운영 서버의 `PHASE_SCALE` 은 `wrangler.jsonc` 의 `"1"` (실제 시간) 그대로 둡니다. 개발용 `--var PHASE_SCALE:0.1` 은 로컬 실행에만 씁니다.

내 컴퓨터에서 직접 배포하려면 `npx wrangler login` 후 `npm run deploy` 도 됩니다.
방 하나가 Durable Object 하나라서 `wrangler.jsonc`의 `migrations`(SQLite 기반)가 첫 배포 때 함께 적용됩니다.

## HTTP API

| 요청 | 설명 |
|---|---|
| `POST /api/rooms` | 새 방을 만들고 `{ "code": "K3S2" }` 를 돌려준다 (201) |
| `GET /api/rooms/:code` | 방 정보 `{ code, phase, players, joinable }`. 없으면 404 |
| `GET /api/characters` | 캐릭터 12명 `{ characters: [{ id, nameKo, nameEn, piece, hp, attack, speed, range }] }` |
| `GET /ws/:code?name=이름&token=...` | WebSocket으로 방에 들어간다. `token`은 재접속할 때만 |

방 코드는 헷갈리는 글자(`0 O 1 I L`)를 뺀 4자리입니다. 입력은 대소문자를 구분하지 않습니다.
캐릭터는 메시지에서 `id`(예: `ancient-lord`)로 가리킵니다.

## WebSocket 메시지

모든 메시지는 JSON 문자열이고 `t` 필드로 종류를 구분합니다. 자세한 형식은 `src/protocol.ts` 입니다.

**서버 → 클라이언트**

| `t` | 내용 |
|---|---|
| `welcome` | 입장 직후 한 번. `playerId`, 재접속용 `token`, 현재 방 상태 `room` |
| `state` | 방 상태가 바뀔 때마다 모두에게. `room` 에 단계, 종료 시각, 플레이어, 게임 상태(`game`)가 있다 |
| `pong` | `ping`에 대한 답. `serverTime`으로 서버 시계와의 차이를 잴 수 있다 |
| `error` | `code`: 아래 표 참고 |

**클라이언트 → 서버**

| `t` | 내용 | 가능한 단계 |
|---|---|---|
| `ready` | `{ "t": "ready", "ready": true }` 준비 / 취소. 둘 다 준비하면 게임 시작 | 로비 |
| `ping` | `{ "t": "ping", "ts": 123 }` | 언제나 |
| `ban` | `{ "t": "ban", "characterId": "richmond" }` 캐릭터 1명 금지. 한 번 하면 바꿀 수 없다 | 밴 |
| `pick` | `{ "t": "pick", "characterId": "lappus" }` 내 차례에 캐릭터 뽑기 | 드래프트 |
| `place` | `{ "t": "place", "characterId": "lappus", "lane": "center" }` 내 캐릭터의 레인 정하기 (확정 전에는 바꿀 수 있다) | 배치 |
| `lock` | `{ "t": "lock" }` 배치 확정. 정하지 않은 캐릭터는 기본 레인으로 간다 | 배치 |
| `ultimate` | `{ "t": "ultimate", "characterId": "dwargon" }` 궁극기 발동 (스팀포스 5, 40초 재사용). 안키오는 `"lane"`도 보낸다 | 전투·데스매치 |
| `move` | `{ "t": "move", "characterId": "...", "lane": "kingside" }` 나이트의 레인 이동 (12초 재사용) | 전투 |

**오류 코드**

| `code` | 뜻 |
|---|---|
| `bad_message` | 알 수 없거나 형식이 틀린 메시지 |
| `room_not_found`, `room_full`, `game_in_progress`, `not_in_lobby` | 입장·준비 관련 |
| `wrong_phase` | 지금 단계에서는 할 수 없는 행동 |
| `unknown_character` | 없는 캐릭터 id |
| `character_unavailable` | 이미 밴되었거나 뽑힌 캐릭터 |
| `not_your_turn` | 드래프트에서 내 차례가 아님 |
| `already_done` | 이미 밴했거나 배치를 확정함 |
| `not_your_character` | 내 팀에 없는 캐릭터를 배치하려 함 |

## 밴, 드래프트, 배치 규칙

### 한 판의 흐름과 시간

| 단계 | 시간 | 끝나는 조건 |
|---|---|---|
| 밴 | 10초 | 시간이 끝나거나, **둘 다 밴하면 바로** |
| 드래프트 | 40초 | 10명을 다 뽑으면 바로 (한 차례 4초) |
| 배치 | 20초 | 시간이 끝나거나, **둘 다 확정하면 바로** |
| 탐사, 대장간, 전투 | 20초, 20초, 120초 | 시간 (아직 구현되지 않음) |
| 결과 | 10초 | 시간 → 로비로 복귀 |

모두 할 일을 끝내면 남은 시간과 상관없이 바로 다음 단계로 넘어갑니다. 그래서 빠르게 하면 한 판이 더 짧아집니다.

### 시간 초과 처리

- **밴:** 못 정한 사람은 밴 없이 넘어간다.
- **드래프트:** 한 차례(4초)가 지나면 그 사람 대신 남은 캐릭터 중 하나를 무작위로 뽑고, 다음 차례가 바로 시작된다.
- **배치:** 정하지 못한 캐릭터는 기물별 기본 레인으로 간다. 룩은 킹사이드, 비숍과 킹은 센터, 퀸과 나이트는 퀸사이드, 폰은 킹사이드.

### 스네이크 드래프트

선공은 무작위입니다. 순서는 선공 1명 → 후공 2명 → 선공 2명 → 후공 2명 → 선공 2명 → 후공 1명으로, 양쪽 모두 5명입니다.
캐릭터가 12명이라 밴 2명을 빼면 딱 10명이 남습니다. (같은 캐릭터를 서로 밴하면 11명이 남고 1명은 쓰이지 않습니다.)

### 상대에게 숨기는 정보

`state` 메시지는 **받는 사람마다 다르게** 만들어 보냅니다.

| 정보 | 공개 시점 |
|---|---|
| 내 밴 | 나에게는 바로. 상대에게는 밴 단계가 끝난 뒤 |
| 상대가 밴을 정했는지 | 바로 (`locked`) 보이지만 무엇을 밴했는지(`characterId`)는 단계가 끝날 때까지 `null` |
| 뽑은 캐릭터 | 뽑는 즉시 모두에게 |
| 내 레인 배치 | 나에게는 바로 |
| 상대 레인 배치 | **전투가 시작될 때** (그 전까지 `null`). 확정했는지(`placementLocked`)만 보인다 |

## 남은 시간 보여 주기

`state.room.phaseEndsAt` 과 `state.room.game.turnEndsAt` 은 **서버 시각**입니다. 클라이언트 시계와 어긋날 수 있어서,
`serverTime`과 받은 순간의 내 시각 차이로 보정해서 카운트다운을 그립니다.

```
offset = 내 시각(수신 순간) - room.serverTime
남은 시간 = room.phaseEndsAt - (내 시각 - offset)
```

## 기타 규칙

- 방은 2명. 세 번째 사람은 `room_full`, 게임이 시작된 뒤 새로 오는 사람은 `game_in_progress`.
- `token`이 맞으면 게임 중에도 같은 자리로 재접속한다. 재접속하면 진행 중인 게임 상태를 그대로 받는다.
- 로비에서 연결이 끊기면 30초 안에 돌아와야 자리가 유지되고, 게임 중에는 자리를 유지한다.
- 아무도 접속하지 않은 방은 10분 뒤에 지워진다.
- 한 판이 끝나면(result 다음) 로비로 돌아가고 준비 상태와 게임 상태가 사라진다. 다시 하면 선공이 새로 정해진다.

## 다음 단계

기획서의 로드맵 3단계부터 전투를 넣습니다. 레인 타워전, 가드 타워, 타워 스킬, 점수, 궁극기, 서버 틱 시뮬레이션이 들어갑니다.

## 전투 (3단계)

- 서버가 10Hz(0.1초/틱, `PHASE_SCALE`을 곱함)로 시뮬레이션을 돌린다. 코드는 `src/battle/` (`core.ts` 규칙 상수·타입, `abilities.ts` 패시브·스킬·궁극기, `sim.ts` 한 틱의 진행, `snapshot.ts` 클라이언트용 요약).
- 전투 중 상태(`room.battle`)는 약 0.25초마다 전송된다. 이벤트에는 `seq`가 있어 이미 본 것을 거를 수 있다.
- 내 스팀포스와 내 궁극기 준비 틱만 보인다. 상대 것은 숨겨진다.
- 시간(120초)이 끝나면 점수가 높은 쪽이 승리, 동점이면 `deathmatch` 단계(60초)로 이어진다. 한쪽 본진 타워 3개가 모두 무너지면 바로 `result`.
- `result` 단계의 스냅샷에는 `room.result`(승자, 이유, 점수)가 있다.
- 리치몬드의 스킬·궁극기는 대장간(5단계)이 생길 때까지 쓸 수 없다 (`not_implemented`).

## GL Account 로그인과 커스텀 도메인

서버는 `https://edgame-api.officialgl.com` 에서 동작하고(`wrangler.jsonc`의 `routes`, 배포하면 도메인이 자동으로 연결됩니다. `officialgl.com` 존이 같은 Cloudflare 계정에 있어야 합니다), 로그인은 GL Account(`account.officialgl.com`)에 맡깁니다. 로그인·회원가입 화면은 만들지 않습니다. 연동 규칙: `god-lights/gl-account` 의 `docs/INTEGRATION.md`.

**처음 한 번 할 일**
1. 서비스 키를 만듭니다: `openssl rand -base64 48`
2. GL Account Worker의 `SERVICE_API_KEYS`(쉼표로 구분)에 그 키를 추가합니다.
3. 이 서버에 시크릿으로 넣습니다: `cd server && npx wrangler secret put GL_ACCOUNT_KEY`
   (코드, 저장소, 로그에는 넣지 않습니다. 로컬은 `server/.dev.vars`, 이미 `.gitignore`에 있습니다.)

**로그인 흐름** (자동으로 넘기지 않고 버튼을 눌러야 로그인 화면으로 갑니다)
- 웹: `/` 에 "로그인하기" 버튼 -> `/auth/login` -> GL Account -> `/auth/done` 으로 돌아옴. `gl_session` 쿠키를 서버가 `verify-session` 으로 검증합니다 (결과는 30초만 캐시).
- 게임 클라이언트(Unity): 브라우저 쿠키가 없으므로 "기기 로그인"을 씁니다.
  1. `POST /api/auth/start` -> `{ loginId, loginUrl }`. 클라이언트가 `loginUrl`을 브라우저로 엽니다 (로그인하기 버튼을 눌렀을 때).
  2. 브라우저에서 GL 로그인 후 "로그인 확인"을 누르면 승인됩니다.
  3. 클라이언트는 `GET /api/auth/poll?id=<loginId>` 를 반복 호출 (202 대기 중, 200 `{ token, user }`, 404 만료). 토큰은 한 번만 받을 수 있고 7일 유효합니다.
  4. 이후 `POST /api/rooms` 와 WebSocket(`/ws/:code`) 요청에 `Authorization: Bearer <token>` 헤더를 보냅니다. 없거나 틀리면 401 `{ error: "unauthorized", loginUrl }`.
- `GET /api/auth/me` 현재 사용자, `POST /api/auth/logout` 게임 세션 끊기 (GL 계정 로그아웃은 account.officialgl.com 에서).
- 방에서 이름은 GL 닉네임, 식별자는 `user.id`(UUID)입니다. 같은 계정이 다시 들어오면 원래 자리로 돌아옵니다.

로컬 개발에서 로그인을 끄려면 `--var REQUIRE_AUTH:false` 또는 `.dev.vars` 에 `REQUIRE_AUTH=false` (운영에서는 켜져 있어야 합니다).

## 탐사 (4단계)

- 코드: `src/explore/explore.ts`(규칙), `src/explore/snapshot.ts`(보는 사람별 요약). 탐사 단계가 시작될 때 4x4 지도(시드로 생성, 안개 6칸)가 만들어지고, 대장간·전투·데스매치 동안에도 계속 흐르다가 로비로 돌아가면 사라진다.
- 메시지: `{ "t": "explore", "action": "gather" | "ambush" | "scout", "tile": 0~15 }`. 행동 게이지(최대 3, 12초마다 +1)를 1 쓴다.
- 채집 3초, 매복 10초, 채집한 칸은 25초 뒤 재생, 보물상자는 한 번만. 겹치면 반씩 나누고(홀수는 특성이 높은 쪽, 같으면 후공), 매복한 쪽이 채집한 쪽의 수확을 가진다. 양쪽이 같은 칸에 매복하면 서로 무효.
- 탐사 특성(팀 구성): 킹 10초마다 탈런트 +1, 퀸 정찰 시 안개 1칸 추가 확인, 룩 돌·광석 +1, 비숍 나뭇가지 +1, 나이트 매복으로 빼앗는 양 +1.
- 자원(탈런트, 나뭇가지, 돌, 광석, 희귀 재료, 설계도)은 `room.explore.resources`에 내 것만 보인다. 시작 탈런트 15, 10초마다 +2, 처치 +2. 대장간(5단계)이 이 자원을 쓴다.
- 상대의 매복은 정찰한 안개 칸에서만 보이고, 상대의 자원과 행동은 어디에도 나오지 않는다.

## 대장간 (5단계)

- 코드: `src/forge/weapons.ts`(무기와 레시피, 상성), `src/forge/forge.ts`(상점, 재련, 조합, 장착), `src/forge/snapshot.ts`. 탐사 상태 안에 들어 있어서 탐사와 같은 시계로 흐르고, 탐사 자원(탈런트, 나뭇가지, 돌, 광석, 철괴, 희귀 재료, 설계도)을 같이 씁니다. 탐사 단계부터 열립니다(기획서는 배치부터).
- 메시지 `forge`: `buy`(광석 구입, 탈런트 4, 리치몬드 팀은 3) / `smelt`(광석 1 + 탈런트 2 + 스팀포스 3, 15초, 재련대 2개) / `craft`(무기 즉시 조합) / `equip`(3초, 캐릭터당 무기 1개, 본진이나 아군 가드 타워 범위 안에서만).
- 무기 9종: 일반 6(돌도끼·나무 창·나무 활 +12%, 철 도끼·철 창·철 석궁 +25%)과 설계도로 여는 특수 3(화염 도끼 화상, 서리 활 둔화, 흡혈 창 흡혈, 공격력 +8%). 목록은 `GET /api/weapons`.
- 상성: 중량 > 장병 > 원거리 > 중량. 유리하면 피해 x1.2, 불리하면 x0.85, 무기가 없으면 상성이 없습니다. 상대의 무기는 맞붙기(같은 레인에서 6 안) 전에는 보이지 않습니다.
- 스팀포스는 전투 전에는 대장간이, 전투가 시작되면 전투가 관리합니다(재련과 궁극기가 같은 풀을 씁니다).
- 리치몬드: 금고(상점 -25%), 투자(탈런트 3으로 싸우는 아군 공격력 +25%, 10초), 황금 계약(탈런트 +8, 재련 5초 단축).

## 전적과 랭킹 (6단계)

- 저장: Cloudflare D1(`DB`). 스키마는 `migrations/0001_init.sql`(`players`, `matches`). 로컬은 `npm run db:migrate:local`, 운영은 `npm run db:migrate`(배포 워크플로가 배포 뒤에 자동으로 실행합니다). `wrangler.jsonc`에 `database_id`가 없어서 첫 배포 때 wrangler가 DB를 자동으로 만듭니다. 이때 `CLOUDFLARE_API_TOKEN`에 D1 편집 권한이 있어야 합니다.
- 기록 조건: 두 사람 모두 GL 계정으로 로그인한 판만 판이 끝날 때 한 번 기록합니다(`REQUIRE_AUTH=false`인 개발 판은 기록하지 않음). 같은 판(방 코드 + 시작 시각)은 두 번 저장되지 않고, 저장이 실패해도 게임 진행에는 영향이 없습니다.
- 레이팅: Elo, 시작 1000, K는 처음 10판 40 이후 24, 무승부 0.5. 결과 단계의 `room.result.ratings`에 판 전후 레이팅이 담깁니다.
- API
  - `GET /api/leaderboard?limit=20` 레이팅 순위 (로그인했다면 내 줄에 `isMe`; 사용자 id는 내보내지 않음)
  - `GET /api/me/stats` 내 레이팅, 순위, 승·패·무 (로그인 필요)
  - `GET /api/me/matches?limit=10` 내 최근 판 (상대 닉네임, 점수, 처치, 뽑은 캐릭터, 레이팅 변화)

## 테스트 대전 (코드 ADMN)

방 코드 **`ADMN`** 으로 들어가면 **봇과 한 판**을 할 수 있습니다. 혼자서 화면과 흐름을 시험하려고 만든 방입니다.

- 접속한 사람마다 자기만의 방이 따로 만들어집니다(로그인한 사용자 id로 구분). 다른 사람과 섞이지 않습니다.
- 들어가면 빈 자리에 `테스트 봇`이 앉고 로비에서 바로 준비합니다. 사람이 준비하면 시작합니다.
- 봇은 사람과 같은 규칙으로만 행동합니다: 무작위로 밴·뽑기·레인 배치, 채집하고 무기를 조합해 끼우고, 같은 레인에서 적과 맞붙으면 궁극기를 씁니다. 일부러 단순합니다.
- 봇과의 판은 **전적과 레이팅에 기록되지 않습니다.**
- 일반 방 코드는 `ADMN`이 나오지 않게 만들어집니다. `GET /api/rooms/ADMN` 은 항상 들어갈 수 있다고 답합니다. 로그인(운영 서버)은 일반 방과 같이 필요합니다.
- 코드: `src/bot.ts`, 방 연결은 `src/index.ts`(방 선택)와 `src/room.ts`(봇 앉히기와 행동).

## 워크플로
작업 파일은 둘뿐입니다. `server.yml`(서버 검사·배포), `ios.yml`(iPad 앱 빌드). 서버 스모크(`npm run smoke`)와 C# 단위 테스트는 느려서 CI에서 빼고, 필요할 때 로컬에서 돌립니다.

## 캐릭터 시너지

뽑은 5명의 구성이 조건을 채우면 팀 전체가 보너스를 받습니다. 전투가 시작될 때 정해지고 판 내내 유지되며, 여러 개가 켜지면 효과가 곱해집니다(부활 단축은 더함). 코드는 `src/synergy.ts`, 목록은 `GET /api/synergies`, 켜진 시너지는 방 상태의 `game.synergies`(seat별 id 배열; 뽑은 캐릭터가 공개라서 모두에게 보임)에 있습니다. 수치는 작게 잡은 초안입니다.

| 시너지 | 조건 | 효과 |
|---|---|---|
| 쌍왕 | 킹 2명 | 받는 피해 -5% |
| 여왕의 화력 | 퀸 2명 | 스킬 쿨다운 -10% |
| 철옹성 | 룩 2명 | 타워에 주는 피해 +15% |
| 성가대 | 비숍 2명 | 최대 체력 +8% |
| 기습조 | 나이트 2명 | 이동 속도 +8% |
| 병졸의 결의 | 폰 2명 | 부활 시간 -2초 |
| 정예 편성 | 서로 다른 기물 4종 이상 | 공격력 +5% |
| 방벽과 치유 | 라우페이노 + 라푸스 | 받는 피해 -5% |
| 왕의 돌격 | 에이션트 로드 + 부캉죠스 | 이동 속도 +5% |

`GET /api/characters` 에는 캐릭터마다 `passive`, `skill`, `ultimate` 설명(없으면 null)이 들어 있습니다. 앱의 가이드가 이를 그대로 보여 줍니다.

## 체스판 자동 전투 (새 게임, 개발 중)
설계는 `docs/DESIGN-autochess.md`. 1단계로 전투 시뮬레이션이 `src/chess/`에 구현되어 있다(방/프로토콜에는 아직 연결 전).
```bash
npm run balance                  # 기본 2000판
npx tsx scripts/chess-balance.ts 5000 14 6 1   # 판수, 예산(골드), 기물 수, 시드
```
같은 예산의 무작위 팀을 자리를 바꿔 싸우게 하고 캐릭터와 시너지 승률, 돌발 사망 비율, seat 쏠림을 표로 출력한다.

## 문의(채팅)
설치 안내 페이지(`/install.html#ask`)에서 사용자가 문의를 남기면 Durable Object `SupportDesk`(이름 `global`)에 대화별로 저장된다.
관리자는 `/support-admin.html` 에서 관리자 키로 들어가 목록을 보고 답한다. 사용자는 같은 페이지에서 답을 본다(6초마다 확인).

- 관리자 키: 시크릿 `SUPPORT_ADMIN_KEY`. GitHub 저장소 Secrets 에 같은 이름으로 넣으면 배포 워크플로가 Cloudflare 에 올린다.
  직접 넣으려면 `npx wrangler secret put SUPPORT_ADMIN_KEY`. 로컬 서버는 `--support-key <키>` 또는 `COMMANDER_SUPPORT_KEY`.
- 제한: 글 1000자, 한 사람(IP)이 한 시간에 새 대화 5개, 한 대화에서 1분에 6개, 한 대화 200개.
- 대화 id 는 추측할 수 없는 난수이고 사용자의 브라우저에만 저장된다(대화 주소 복사로 다른 기기에서 이어 보기).
