# 콘텐츠 팩 만들기

> 보기 좋은 판(표, 능력 목록, 능력치 계산기, **팩 검사기**)은 게임 서버의 **팩 개발 위키** `/packs-wiki.html` 에 있어요.
> 예: https://edgame-api.officialgl.com/packs-wiki.html . 위키의 표는 서버의 `GET /api/packs/schema` 에서, 검사는 `POST /api/packs/validate` 에서 해요.

팩은 코드를 넣을 수 없는 **데이터 묶음**이다. 그래서 서버가 안전하다. 팩은 세 종류다.

| 종류 (`kind`) | 바꾸는 것 | 모양 |
|---|---|---|
| **플러그인** `plugin` | 캐릭터·재료·무기·규칙 (게임 내용) | `.json` 파일 하나 (또는 zip) |
| **리소스** `resource` | 색·로고·배경·캐릭터 그림·효과음·음악 (화면과 소리) | `.zip` (`pack.json` + 그림·소리) |
| **종합** `bundle` | 둘 다 | `.zip` |

- 엑스퍼트 서버에서만 읽힌다. 바닐라 서버는 `plugins/` 폴더를 무시한다.
- `kind` 를 안 쓰면 내용을 보고 정한다: `resources` 만 있으면 리소스, 둘 다 있으면 종합, 아니면 플러그인.
- 리소스 팩에 게임 내용(`units`, `unitOverrides`, `materials`, `weapons`, `fusions`, `rules`)을 넣으면 팩이 거절된다. 플러그인 팩에 `resources` 를 넣어도 마찬가지다.
- **리소스 팩만** 있는 서버는 규칙이 공식 그대로라 ruleset 이 `official` 로 남는다. 전적과 다시 보기가 공식과 섞여도 된다.

## 어디에 두나
- **로컬 서버(엑스퍼트)**: exe 옆의 `commander-data/plugins/` 에 둔다.
  - 넣을 수 있는 모양: `이름.json`, `이름.zip`, `폴더/pack.json`.
  - zip 은 켤 때 `plugins/<이름>/` 폴더로 풀린다. 같은 이름의 손으로 만든 폴더가 있으면 `<이름>-zip/` 로 풀린다. zip 을 바꾸면 다시 풀린다.
  - 끄려면 이름 끝에 `.off` 를 붙인다 (`moon.json.off`, `night-skin.off/`).
  - 처음 켜면 폴더와 설명서(`README.txt`), 예시(`example-pack.json.sample`)를 만든다. 예시는 확장자를 `.json` 으로 바꾸면 적용된다.
  - 서버를 다시 켜면 적용된다.
- **안드로이드 서버 앱(엑스퍼트)**:
  - 앱의 **플러그인** 칸에서 **팩 추가**를 누르고 `.json` 이나 `.zip` 을 고른다 (내려받기·드라이브 등).
  - 켜기/끄기·삭제도 거기서 한다. 목록에 종류(종합·리소스·플러그인)가 보인다.
  - 서버를 다시 켜면 적용된다.
- **iPad 서버 앱(엑스퍼트)**:
  - 파일 앱에서 앱 폴더의 `plugins/` 에 `이름.json` 이나 `팩id/pack.json` 폴더를 넣는다.
  - zip 은 파일 앱에서 먼저 풀고, 폴더 이름을 팩 id 로 바꿔서 넣는다.
- **개발 서버(Cloudflare)**:
  - `server/packs/` 에 파일을 넣고 `server/packs/index.ts` 에 등록한 뒤 배포한다. 개발 서버는 `EDITION=expert` 다.
  - 그림·소리는 개발 서버에서 내보내지 않는다. 리소스 팩은 로컬·안드로이드·iPad 서버용이다.
- **개발 중**:

  ```bash
  cd local-server && COMMANDER_EDITION=expert bun run dev
  ```

## 앱에서 보이는 것
- **로비**: 팩이 있으면 **"이 서버의 팩 N개"** 단추가 나온다. 누르면 팩마다 종류, 버전, 만든 사람, 설명, 바꾼 것 요약이 보인다.
- **게임 가이드**: 팩이 있으면 **"팩 N"** 탭이 생긴다. 팩마다 바꾼 것(자동 요약)과 팩이 쓴 설명서(`guide`)를 보여 준다.
- **리소스 적용**: 웹과 안드로이드 앱(웹 화면)이 접속한 서버의 리소스를 바로 적용한다. 색, 로고, 로비·판 배경, 캐릭터 그림, 효과음, 음악이 바뀐다.
- **iPad 앱**: 아직 팩 목록과 설명서만 보여 준다. 리소스 적용은 나중에 한다.

## 형식 (apiVersion 1)
```json
{
  "apiVersion": 1,
  "id": "example",            // 팩 이름표. 영문 소문자·숫자·-, 2~32자. 다른 팩과 겹치면 안 된다
  "name": "예시 팩",
  "version": "1.0.0",
  "kind": "plugin",           // plugin | resource | bundle (안 쓰면 내용을 보고 정한다)
  "author": "만든 사람",       // 선택
  "description": "한두 줄 설명",
  "guide": [ { "title": "새 캐릭터", "body": "..." } ],   // 선택: 가이드 "팩" 탭에 나오는 설명서
  "units": [ ... ],           // 새 캐릭터 (팩마다 40명까지, 전체 120명)
  "unitOverrides": { "dwargon": { "hpMult": 1.1, "atkMult": 1.0 } },
  "materials": [ ... ],       // 새 재료 (40개까지)
  "weapons": [ ... ],         // 새 무기 (60개까지)
  "rules": { "rerollCost": 2 },
  "resources": { ... }        // 리소스·종합 팩만
}
```
- 전체 예시:
  - 플러그인: `server/packs/example-pack.json`
  - 리소스: `server/packs/examples/night-skin/`
  - 종합: `server/packs/examples/starfall/`

### guide (설명서)
- 12칸까지 쓸 수 있다. 칸마다 `title`(40자까지)과 `body`(4000자까지)를 쓴다.
- `body` 는 그냥 글자다 (HTML 은 안 된다). 줄바꿈은 `\n` 으로 쓴다.
- 안 써도 가이드에는 자동 요약(새 캐릭터, 바뀐 캐릭터, 재료, 무기, 규칙, 화면·소리)이 나온다.

### units
- 필수: `id`, `nameKo`, `piece`(pawn·knight·bishop·rook·queen·king), `faction`, `cost`(1~4), `role`, `ability`(이미 있는 능력 이름만), `abilityText`.
- 선택: `hpMult`, `atkMult`, `lite`(체험판에도 나온다).
- 능력치는 공식 캐릭터와 같은 공식(기본값 × 역할 × 말 종류)으로 계산하고, 배율만 곱한다.
- 아이디는 `팩id:id` 로 불린다 (예: `example:moon-guard`).

### unitOverrides
- `{ "캐릭터 id": { ... } }`. 공식 캐릭터는 id 그대로, 앞선 팩의 캐릭터는 전체 id(`팩id:id`).
- 바꿀 수 있는 것: `hpMult`·`atkMult`(0.3~3, 지금 값에 곱함), `nameKo`, `abilityText`, `lite`.

### materials / weapons
- 재료와 무기는 서로를 가리켜야 한다 (`material` ↔ `weapon`).
- 무기 `stats` 는 배율이고 범위가 있다: `atk` 0.5~2, `hp` 0.5~2, `dmgTaken` 0.5~1.5, `energy` 0.5~2.
- `fusions`: `[{ "a", "b", "result" }]` 같은 희귀도의 서로 다른 재료 둘 → 한 단계 위 재료. 이 팩의 재료는 짧은 id, 공식·다른 팩 재료는 전체 id.

### rules
- 다음 중 필요한 것만 쓴다: `startHp`, `startGold`, `baseIncome`, `maxInterest`, `maxRounds`, `maxDeploy`, `rerollCost`, `prepSeconds`, `firstPrepSeconds`, `poolCopies`.
- 8전 5승제부터 `startHp` 는 쓰지 않는다 (받기는 한다). 이기는 승수는 `maxRounds` 의 과반이다 (8 → 5승, 5 → 3승).
- 범위를 벗어나면 팩 전체가 거절된다.

### resources (리소스·종합 팩)
경로는 모두 **pack.json 이 있는 폴더 기준**이다 (예: `assets/logo.png`).

| 키 | 내용 |
|---|---|
| `colors` | 다음 키에 `#rrggbb` 색을 넣는다.<br>`bgTop`, `bgBottom`: 배경 위·아래<br>`panel`: 칸<br>`gold`, `goldHi`: 금색·밝은 금색<br>`accent`: 강조<br>`text`: 글자<br>`mine`, `theirs`: 내 편·상대 편<br>`cost1`~`cost5`: 가격별 테두리 |
| `logo` | 로비 로고 그림 |
| `lobbyBackground` | 로비 배경 그림 |
| `boardBackground` | 체스판 배경 그림 (칸이 반투명해진다) |
| `units` | `{ "캐릭터 id": "그림" }`, 150개까지.<br>공식 캐릭터는 공식 id(`relic`)로, 이 팩의 캐릭터는 팩 안의 id(`comet-knight`)로 쓴다. |
| `sounds` | `{ "소리 이름": "파일" }`.<br>이름: `click`, `buy`, `sell`, `place`, `ready`, `hit`, `ability`, `death`, `promote`, `mine`, `roundWin`, `roundLose`, `win`, `lose`, `pickup`, `drop`, `equip`, `smelt`, `combine`, `merge`, `full`, `roundStart`, `combatStart`, `ghost`, `surface`, `tick`, `suddenDeath` |
| `music` | `{ "prep" \| "combat" \| "finale": "파일" }`<br>`prep`: 준비 단계, `combat`: 전투, `finale`: 마지막 라운드 |

- **파일 종류**:
  - 그림: `png`, `jpg`, `jpeg`, `webp`, `gif`
  - 소리: `mp3`, `ogg`, `m4a`, `wav`
  - SVG·HTML·스크립트는 안 된다.
- **경로 규칙**: 영문·숫자·`_-./` 로 120자까지다. `..` 이나 `//` 는 안 된다.
- **파일 공개**: 서버는 그림·소리만 `/packs/<팩id>/<경로>` 로 내보낸다. `pack.json` 과 다른 파일은 내보내지 않는다.
- **크기 제한**: zip 하나를 풀면 40MB, 파일 600개까지다.

## zip 만들기
`pack.json` 이 zip 맨 위에 있어도 되고, 폴더째 압축해도 된다. 그 경우 `pack.json` 이 있는 폴더를 기준으로 본다.

```bash
cd server/packs/examples/night-skin && zip -r ../night-skin.zip .
```

맥의 Finder 에서 폴더를 **압축**해도 된다. `__MACOSX` 같은 숨김 파일은 무시한다.

## 규칙
- **틀리면 팩 전체를 거절**한다. 일부만 적용하지는 않는다. 서버 시작 화면과 `/api/server` 의 정보에 어느 경로가 왜 틀렸는지 나온다.
- 팩 id 순서로 적용한다. 그래서 같은 팩이면 어디서나 같은 결과가 나오고, 대전과 다시 보기가 어긋나지 않는다.
- 공식 조합 쌍은 그대로 두고, 팩 재료를 조합표에 더한다.
- **규칙 묶음 이름(ruleset)**:
  - 공식 규칙 그대로면 `official` 이다 (리소스 팩만 있어도 마찬가지).
  - 게임 내용을 바꾼 팩이 있으면 `custom-<해시>` 다.
  - ruleset 은 방과 판에 박힌다. 팩이 바뀌면 진행 중이던 방은 버려져서, 규칙이 도중에 달라지는 일이 없다.
- 앱과 웹은 접속한 서버의 목록을 읽는다. 그래서 새 캐릭터가 도감과 상점에 그대로 나온다.
- **API**:
  - `/api/server`: 팩의 id·이름·버전·종류만 준다.
  - `/api/packs`: 설명서·요약·리소스 주소까지 준다.
