# edbot 서버

Cloudflare Workers + Durable Objects로 만든 온라인 대전 서버입니다.
기획서의 로드맵 **1단계(서버 뼈대)** 까지 구현되어 있습니다.

- 4자리 방 코드로 방 만들기 / 입장
- WebSocket 연결, 재접속(token)
- 단계 타이머: 밴 → 드래프트 → 배치 → 탐사 → 대장간 → 전투 → 결과 (총 4분) → 로비로 복귀

드래프트·전투 같은 실제 게임 규칙은 아직 없습니다. 각 단계는 시간이 지나면 다음 단계로 넘어가기만 합니다.

## 구조

| 파일 | 하는 일 |
|---|---|
| `src/index.ts` | Worker 진입점. HTTP API와 WebSocket 연결을 방(Durable Object)으로 넘긴다 |
| `src/room.ts` | 방 하나 = Durable Object 하나. 저장, 소켓, 알람(타이머) 담당 |
| `src/room-state.ts` | 방의 규칙 (입장, 준비, 단계 진행, 정리). Cloudflare에 의존하지 않는 순수 함수 |
| `src/phases.ts` | 단계 순서와 시간 |
| `src/protocol.ts` | 클라이언트와 주고받는 메시지 형식 |
| `test/` | 단위 테스트 (vitest) |
| `scripts/smoke.mjs` | 실행 중인 서버에 가짜 클라이언트 둘을 붙여 한 판을 끝까지 돌리는 테스트 |

규칙은 `room-state.ts`에, 입출력은 `room.ts`에 나눠 두었습니다. 그래서 규칙은 서버를 띄우지 않고도 테스트할 수 있습니다.

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
npx wrangler dev --var PHASE_SCALE:0.05

# 터미널 2: 한 판을 끝까지 돌려 보기
npm run smoke
```

배포는 Cloudflare 계정에 로그인한 뒤 `npm run deploy` 입니다. 방 하나가 Durable Object 하나라서
`wrangler.jsonc`의 `migrations`(SQLite 기반)가 첫 배포 때 함께 적용됩니다.

## HTTP API

| 요청 | 설명 |
|---|---|
| `POST /api/rooms` | 새 방을 만들고 `{ "code": "K3S2" }` 를 돌려준다 (201) |
| `GET /api/rooms/:code` | 방 정보 `{ code, phase, players, joinable }`. 없으면 404 |
| `GET /ws/:code?name=이름&token=...` | WebSocket으로 방에 들어간다. `token`은 재접속할 때만 |

방 코드는 헷갈리는 글자(`0 O 1 I L`)를 뺀 4자리입니다. 입력은 대소문자를 구분하지 않습니다.

## WebSocket 메시지

모든 메시지는 JSON 문자열이고 `t` 필드로 종류를 구분합니다. 자세한 형식은 `src/protocol.ts` 입니다.

**서버 → 클라이언트**

| `t` | 내용 |
|---|---|
| `welcome` | 입장 직후 한 번. `playerId`, 재접속용 `token`, 현재 방 상태 `room` |
| `state` | 방 상태가 바뀔 때마다 모두에게. `room` 에 단계, 종료 시각, 플레이어 목록이 있다 |
| `pong` | `ping`에 대한 답. `serverTime`으로 서버 시계와의 차이를 잴 수 있다 |
| `error` | `code`: `bad_message`, `room_full`, `game_in_progress`, `not_in_lobby` |

**클라이언트 → 서버**

| `t` | 내용 |
|---|---|
| `ready` | `{ "t": "ready", "ready": true }` 로비에서 준비 / 취소. 둘 다 준비하면 게임 시작 |
| `ping` | `{ "t": "ping", "ts": 123 }` |

### 남은 시간 보여 주기

`state.room.phaseEndsAt` 은 단계가 끝나는 **서버 시각**입니다. 클라이언트 시계와 어긋날 수 있어서,
`serverTime`과 받은 순간의 내 시각 차이로 보정해서 카운트다운을 그립니다.

```
offset = 내 시각(수신 순간) - room.serverTime
남은 시간 = room.phaseEndsAt - (내 시각 - offset)
```

## 규칙 요약

- 방은 2명. 세 번째 사람은 `room_full`, 게임이 시작된 뒤 새로 오는 사람은 `game_in_progress`.
- `token`이 맞으면 게임 중에도 같은 자리로 재접속한다.
- 로비에서 연결이 끊기면 30초 안에 돌아와야 자리가 유지되고, 게임 중에는 자리를 유지한다.
- 아무도 접속하지 않은 방은 10분 뒤에 지워진다.
- 한 판이 끝나면(result 다음) 로비로 돌아가고 준비 상태가 풀린다. 다시 하려면 새로 준비한다.

## 다음 단계

기획서의 로드맵 2단계(드래프트와 배치)부터 `room-state.ts`에 단계별 상태와 규칙을 더해 나갑니다.
