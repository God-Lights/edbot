# 콘텐츠 팩(플러그인) 만들기

팩은 **JSON 파일 하나**다. 코드는 못 넣는다(그래서 서버가 안전하다). 새 캐릭터·재료·무기를 더하고, 기존 캐릭터 값을 조정하고, 규칙 몇 개를 바꾼다.
엑스퍼트 서버에서만 읽힌다. 바닐라 서버는 `plugins/` 폴더를 무시한다.

## 어디에 두나
- **로컬 서버(엑스퍼트)**: exe 옆 `commander-data/plugins/` 에 `이름.json` 또는 `폴더/pack.json`. 처음 켜면 폴더와 설명서(`README.txt`), 예시(`example-pack.json.sample`, 확장자를 `.json`으로 바꾸면 적용)를 만든다. 서버를 다시 켜면 적용된다.
- **안드로이드 서버 앱(엑스퍼트)**: 앱의 **플러그인** 칸에서 **팩 추가**로 `.json` 파일을 고른다(내려받기·드라이브 등). 켜기/끄기·삭제도 거기서. 서버를 다시 켜면 적용된다.
- **개발 서버(Cloudflare)**: `server/packs/` 에 파일을 넣고 `server/packs/index.ts`에 등록한 뒤 배포한다. 개발 서버는 `EDITION=expert`.
- 개발 중: `cd local-server && COMMANDER_EDITION=expert bun run dev`

## 형식 (apiVersion 1)
```json
{
  "apiVersion": 1,
  "id": "example",            // 팩 이름표. 영문 소문자·숫자·-, 다른 팩과 겹치면 안 된다
  "name": "예시 팩",
  "version": "1.0.0",
  "units": [ ... ],           // 새 캐릭터(팩마다 40명까지, 전체 120명)
  "unitOverrides": { "dwargon": { "hpMult": 1.1, "atkMult": 1.0 } },
  "materials": [ ... ],       // 새 재료(40개까지)
  "weapons": [ ... ],         // 새 무기(60개까지)
  "rules": { "rerollCost": 2 }
}
```
전체 예시는 `server/packs/example-pack.json`.

### units
`id`, `nameKo`, `piece`(pawn·knight·bishop·rook·queen·king), `faction`, `cost`(1~5), `role`, `ability`(이미 있는 능력 이름만), `abilityText`, 선택: `hpMult`, `atkMult`, `lite`(체험판에도 나옴).
능력치는 공식 캐릭터와 같은 공식(기본값 × 역할 × 말 종류)으로 계산하고 배율만 곱한다. 아이디는 `팩id:id`로 불린다(예: `example:moon-guard`).

### materials / weapons
재료와 무기는 서로를 가리켜야 한다(`material` ↔ `weapon`). 무기 `stats`는 배율이고 범위가 있다: `atk` 0.5~2, `hp` 0.5~2, `dmgTaken` 0.5~1.5, `energy` 0.5~2.

### rules
`startHp, startGold, baseIncome, maxInterest, maxRounds, maxDeploy, rerollCost, prepSeconds, firstPrepSeconds, poolCopies` 중 필요한 것만. 범위를 벗어나면 팩 전체가 거절된다.

## 규칙
- **틀리면 팩 전체를 거절**한다(일부만 적용하지 않는다). 서버 시작 화면과 `/api/server`의 정보에 어느 경로가 왜 틀렸는지 나온다.
- 팩 id 순서로 적용하므로 같은 팩이면 어디서나 같은 결과다(대전·다시 보기가 어긋나지 않는다).
- 공식 조합 쌍은 그대로 두고 팩 재료를 조합표에 더한다.
- **규칙 묶음 이름(ruleset)**: 공식이면 `official`, 팩이 있으면 `custom-<해시>`. 방과 판에 박혀서, 팩이 바뀌면 진행 중이던 방은 버려진다(규칙이 도중에 달라지는 일이 없다).
- 앱과 웹은 접속한 서버의 목록을 읽으므로 새 캐릭터가 도감·상점에 그대로 나온다. 로비에는 "엑스퍼트 · 팩 N개"가 보인다.
