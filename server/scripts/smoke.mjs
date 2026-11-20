// 실행 중인 서버(wrangler dev)에 가짜 클라이언트를 붙여서 한 판을 끝까지 돌려 본다.
//
//   터미널 1:  npx wrangler dev --var PHASE_SCALE:0.05     (단계 시간을 20배 빠르게)
//   터미널 2:  npm run smoke
//
// 시나리오 두 개를 확인한다.
//  1) 방 만들기, 입장, 정원 초과, ping, 재접속, 그리고 아무도 아무것도 하지 않는 판이
//     시간만으로 끝까지 흘러가는지 (자동 밴 없음, 자동 뽑기, 기본 레인 배치)
//  2) 두 사람이 직접 밴, 뽑기, 배치를 하는 판. 서로 숨겨야 할 정보가 숨겨지는지, 모두 끝내면
//     시간이 남아도 바로 다음 단계로 넘어가는지

const base = process.argv[2] ?? "http://127.0.0.1:8787";
const wsBase = base.replace(/^http/, "ws");

let failed = false;
function check(condition, label) {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}`);
  if (!condition) failed = true;
}

function connect(code, query) {
  const ws = new WebSocket(`${wsBase}/ws/${code}?${new URLSearchParams(query)}`);
  const messages = [];
  const waiters = [];
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    messages.push(msg);
    for (const w of [...waiters]) {
      if (w.pred(msg)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(msg);
      }
    }
  });
  const closed = new Promise((resolve) => ws.addEventListener("close", (e) => resolve(e)));
  // from: 이 번호 이후에 도착한 메시지만 본다. (같은 상태가 여러 번 나타나므로 구분이 필요하다.)
  const waitFor = (pred, ms = 8000, from = 0) =>
    new Promise((resolve, reject) => {
      const hit = messages.slice(from).find(pred);
      if (hit) return resolve(hit);
      const timer = setTimeout(() => reject(new Error("timeout waiting for message")), ms);
      waiters.push({
        pred,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
    });
  const send = (obj) => ws.send(JSON.stringify(obj));
  return { ws, messages, waitFor, send, closed };
}

const isState = (phase) => (m) => m.t === "state" && m.room.phase === phase;
const seatOf = (room, id) => room.players.find((p) => p.id === id)?.seat;
const pickCount = (room) => room.game.picks[0].length + room.game.picks[1].length;

async function createRoom() {
  const created = await fetch(`${base}/api/rooms`, { method: "POST" });
  const { code } = await created.json();
  return { created, code };
}

async function idleGame(ids) {
  console.log("\n== 시나리오 1: 입장, 재접속, 아무도 선택하지 않는 판 ==");
  const { created, code } = await createRoom();
  check(created.status === 201 && /^[A-Z2-9]{4}$/.test(code), `방 생성 (코드 ${code})`);

  const info = await (await fetch(`${base}/api/rooms/${code}`)).json();
  check(info.phase === "lobby" && info.players === 0 && info.joinable === true, "방 정보 조회");
  check((await fetch(`${base}/api/rooms/ZZZZ`)).status === 404, "없는 방은 404");

  // 두 명 입장
  const a = connect(code, { name: "에드" });
  const welcomeA = await a.waitFor((m) => m.t === "welcome");
  const b = connect(code, { name: "민수" });
  const welcomeB = await b.waitFor((m) => m.t === "welcome");
  check(welcomeA.room.players.length === 1 && welcomeB.room.players.length === 2, "두 명 입장");
  check(welcomeA.token && welcomeA.token !== welcomeB.token, "각자 token을 받는다");
  check(!JSON.stringify(welcomeB.room).includes("token"), "공개 상태에 token이 없다");
  check(welcomeB.room.game === null, "로비에는 게임 상태가 없다");
  check(
    seatOf(welcomeB.room, welcomeA.playerId) === 0 && seatOf(welcomeB.room, welcomeB.playerId) === 1,
    "seat 0, 1 배정",
  );

  // 정원 초과
  const c = connect(code, { name: "셋째" });
  check((await c.waitFor((m) => m.t === "error")).code === "room_full", "세 번째 사람은 room_full");
  await c.closed;

  // ping, 잘못된 메시지
  const sentAt = Date.now();
  a.send({ t: "ping", ts: sentAt });
  const pong = await a.waitFor((m) => m.t === "pong");
  check(pong.ts === sentAt && typeof pong.serverTime === "number", "ping -> pong");
  a.send({ t: "nonsense" });
  check(Boolean(await a.waitFor((m) => m.t === "error" && m.code === "bad_message")), "알 수 없는 메시지는 bad_message");

  // 로비에서는 밴을 할 수 없다
  a.send({ t: "ban", characterId: ids[0] });
  check(
    Boolean(await a.waitFor((m) => m.t === "error" && m.code === "wrong_phase")),
    "로비에서 밴하면 wrong_phase",
  );

  // 준비 -> 게임 시작
  a.send({ t: "ready", ready: true });
  await a.waitFor((m) => m.t === "state" && m.room.players.find((p) => p.id === welcomeA.playerId)?.ready);
  b.send({ t: "ready", ready: true });
  const started = await a.waitFor(isState("ban"));
  check(started.room.phaseEndsAt > started.room.serverTime, "둘 다 준비하면 ban 단계가 시작되고 종료 시각이 있다");
  check(
    started.room.game && started.room.game.pickOrder.length === 10 && [0, 1].includes(started.room.game.firstPicker),
    "게임 상태와 선공이 정해진다",
  );

  // 게임 중 재접속 (A가 끊겼다가 token으로 돌아옴)
  a.ws.close();
  await a.closed;
  await b.waitFor((m) => m.t === "state" && m.room.players.some((p) => !p.connected));
  check(true, "끊기면 상대에게 connected=false가 전달된다");
  const a2 = connect(code, { name: "아무거나", token: welcomeA.token });
  const welcomeA2 = await a2.waitFor((m) => m.t === "welcome");
  check(welcomeA2.playerId === welcomeA.playerId, "token으로 같은 자리에 재접속");
  check(welcomeA2.room.game !== null && welcomeA2.room.phase !== "lobby", "재접속하면 진행 중인 게임 상태를 받는다");

  // 아무도 아무것도 하지 않아도 시간만으로 모든 단계를 지나 로비로 돌아온다
  const gameStart = b.messages.findIndex(isState("ban"));
  const expected = ["ban", "draft", "placement", "explore", "forge", "battle", "result", "lobby"];
  let cursor = gameStart;
  for (const phase of expected) {
    const m = await b.waitFor(isState(phase), 25000, cursor);
    cursor = b.messages.indexOf(m) + 1;
  }
  const seq = b.messages
    .slice(gameStart)
    .filter((m) => m.t === "state")
    .map((m) => m.room.phase)
    .filter((p, i, arr) => i === 0 || p !== arr[i - 1]);
  check(JSON.stringify(seq) === JSON.stringify(expected), `단계가 순서대로 한 번씩만 나타난다 (${seq.join(" -> ")})`);

  // 시간이 지나면서 자동으로 채워진 결과
  const states = b.messages.slice(gameStart).filter((m) => m.t === "state");
  const battle = states.find((m) => m.room.phase === "battle").room.game;
  const all = [...battle.picks[0], ...battle.picks[1]];
  check(battle.picks[0].length === 5 && battle.picks[1].length === 5 && new Set(all).size === 10, "아무도 뽑지 않아도 5명씩 중복 없이 자동으로 뽑힌다");
  check(battle.bans.every((x) => x.locked && x.characterId === null), "밴하지 않으면 밴 없이 넘어간다");
  const lanes = (seat) => battle.lanes[seat];
  check(
    lanes(0) !== null && lanes(1) !== null && Object.keys(lanes(0)).length === 5 && Object.keys(lanes(1)).length === 5,
    "전투가 시작되면 양쪽의 레인 배치가 모두 공개되고 5명 모두 레인이 있다",
  );
  const explore = states.find((m) => m.room.phase === "explore");
  const mySeatB = seatOf(explore.room, welcomeB.playerId);
  check(explore.room.game.lanes[1 - mySeatB] === null, "전투 전에는 상대의 레인 배치가 보이지 않는다");

  const lobby = states.at(-1);
  check(lobby.room.phase === "lobby" && lobby.room.game === null && lobby.room.players.every((p) => !p.ready), "판이 끝나면 로비로 돌아가고 게임 상태와 준비가 사라진다");

  a2.ws.close();
  b.ws.close();
}

async function activeGame(ids) {
  console.log("\n== 시나리오 2: 두 사람이 직접 밴, 뽑기, 배치 ==");
  const { code } = await createRoom();
  const a = connect(code, { name: "에드" });
  const wA = await a.waitFor((m) => m.t === "welcome");
  const b = connect(code, { name: "민수" });
  const wB = await b.waitFor((m) => m.t === "welcome");
  a.send({ t: "ready", ready: true });
  b.send({ t: "ready", ready: true });
  const banStart = await a.waitFor(isState("ban"));
  const seatA = 0;
  const seatB = 1;
  check(seatOf(banStart.room, wA.playerId) === seatA && seatOf(banStart.room, wB.playerId) === seatB, "seat 확인");
  const conns = { [seatA]: a, [seatB]: b };

  // ---- 밴: 서로 무엇을 밴했는지 모른다
  a.send({ t: "ban", characterId: "ancient-lord" });
  const seen = await b.waitFor((m) => m.t === "state" && m.room.phase === "ban" && m.room.game.bans[seatA].locked);
  check(seen.room.game.bans[seatA].characterId === null, "내가 밴하면 상대는 밴했다는 것만 알고 무엇인지는 모른다");
  check(!JSON.stringify(seen).includes("ancient-lord"), "상대의 밴 캐릭터 id가 응답 어디에도 없다");
  const mine = await a.waitFor((m) => m.t === "state" && m.room.game?.bans[seatA].locked);
  check(mine.room.game.bans[seatA].characterId === "ancient-lord", "내 밴은 나에게는 보인다");

  const before = a.messages.length;
  a.send({ t: "ban", characterId: "richmond" });
  check((await a.waitFor((m) => m.t === "error", 5000, before)).code === "already_done", "밴은 한 번 정하면 바꿀 수 없다");
  b.send({ t: "ban", characterId: "no-such-character" });
  check((await b.waitFor((m) => m.t === "error" && m.code === "unknown_character")) !== undefined, "없는 캐릭터는 unknown_character");

  b.send({ t: "ban", characterId: "xenosaurs" });
  const draftStart = await a.waitFor(isState("draft"));
  check(draftStart.room.phaseStartedAt < banStart.room.phaseEndsAt, "둘 다 밴하면 시간이 남아도 바로 드래프트로 넘어간다");
  check(
    draftStart.room.game.bans[seatA].characterId === "ancient-lord" && draftStart.room.game.bans[seatB].characterId === "xenosaurs",
    "밴 단계가 끝나면 두 밴이 모두 공개된다",
  );

  // ---- 드래프트: 차례대로 뽑는다
  let state = draftStart.room;
  let first = true;
  while (state.phase === "draft") {
    const g = state.game;
    const turn = g.turnSeat;
    const taken = new Set([...g.bans.map((x) => x.characterId).filter(Boolean), ...g.picks[0], ...g.picks[1]]);
    const available = ids.filter((id) => !taken.has(id));
    const at = a.messages.length;

    if (first) {
      first = false;
      const other = conns[1 - turn];
      const otherAt = other.messages.length;
      other.send({ t: "pick", characterId: available[0] });
      check(
        (await other.waitFor((m) => m.t === "error", 5000, otherAt)).code === "not_your_turn",
        "내 차례가 아니면 not_your_turn",
      );
      const turnAt = conns[turn].messages.length;
      conns[turn].send({ t: "pick", characterId: "ancient-lord" });
      check(
        (await conns[turn].waitFor((m) => m.t === "error", 5000, turnAt)).code === "character_unavailable",
        "밴된 캐릭터는 character_unavailable",
      );
    }

    const count = pickCount(state);
    conns[turn].send({ t: "pick", characterId: available[0] });
    const next = await a.waitFor((m) => m.t === "state" && (m.room.phase !== "draft" || pickCount(m.room) > count), 5000, at);
    state = next.room;
  }

  check(state.phase === "placement", "10명을 다 뽑으면 바로 배치 단계로 넘어간다");
  const picks = state.game.picks;
  const everyone = [...picks[0], ...picks[1]];
  check(picks[0].length === 5 && picks[1].length === 5 && new Set(everyone).size === 10, "양쪽 5명씩 중복 없이 뽑혔다");
  check(!everyone.includes("ancient-lord") && !everyone.includes("xenosaurs"), "밴된 캐릭터는 아무도 뽑지 못했다");
  check(state.phaseStartedAt < draftStart.room.phaseEndsAt, "드래프트가 시간이 남은 채로 끝났다");

  // ---- 배치: 내 레인만 보인다
  const laneCycle = ["queenside", "center", "kingside", "center", "queenside"];
  const placeAt = a.messages.length;
  for (const seat of [seatA, seatB]) {
    picks[seat].forEach((id, i) => conns[seat].send({ t: "place", characterId: id, lane: laneCycle[i] }));
  }
  // 내 캐릭터 5명의 레인이 모두 정해진 상태를 기다린다
  const placedView = await a.waitFor(
    (m) => m.t === "state" && m.room.phase === "placement" && Object.keys(m.room.game.lanes[seatA] ?? {}).length === 5,
    5000,
    placeAt,
  );
  check(placedView.room.game.lanes[seatA][picks[seatA][0]] === "queenside", "내 배치는 나에게 보인다");
  check(placedView.room.game.lanes[seatB] === null, "상대의 배치는 보이지 않는다");

  const lockAt = a.messages.length;
  a.send({ t: "lock" });
  const lockedA = await b.waitFor((m) => m.t === "state" && m.room.game?.placementLocked[seatA] && m.room.phase === "placement");
  check(lockedA.room.game.lanes[seatA] === null, "상대는 내가 확정했다는 것만 안다");
  b.send({ t: "lock" });
  const explore = await a.waitFor(isState("explore"), 5000, lockAt);
  check(explore.room.phaseStartedAt < state.phaseEndsAt, "둘 다 확정하면 시간이 남아도 바로 다음 단계로 넘어간다");
  const lanesAfter = explore.room.game.lanes[seatA];
  check(
    picks[seatA].every((id, i) => lanesAfter[id] === laneCycle[i]),
    "직접 정한 레인이 그대로 적용된다",
  );
  check(explore.room.game.lanes[seatB] === null, "탐사 단계에서도 상대의 배치는 숨겨져 있다");

  // ---- 탐사: 지도와 내 자원만 보인다
  const map = explore.room.explore;
  check(map && map.tiles.length === 16 && map.gauge === 3 && map.resources.talent === 15, "탐사가 시작되면 4x4 지도와 내 자원(탈런트 15)이 온다");
  const tree = map.tiles.find((t) => t.known && t.kind === "tree");
  const foggy = map.tiles.find((t) => !t.known);
  const exAt = a.messages.length;
  a.send({ t: "explore", action: "gather", tile: tree.index });
  a.send({ t: "explore", action: "scout", tile: foggy.index });
  const gathering = await a.waitFor((m) => m.t === "state" && m.room.explore && m.room.explore.tiles[tree.index].myGatherInTicks !== null && m.room.explore.tiles[foggy.index].known, 5000, exAt);
  check(gathering.room.explore.gauge <= 1, "행동을 하면 행동 게이지가 줄어든다");
  const theirView = await b.waitFor((m) => m.t === "state" && m.room.explore, 5000, exAt);
  check(theirView.room.explore.tiles[tree.index].myGatherInTicks === null && !theirView.room.explore.tiles[foggy.index].known, "상대의 채집과 정찰 결과는 나에게 보이지 않는다");
  a.send({ t: "explore", action: "gather", tile: 99 });
  check((await a.waitFor((m) => m.t === "error", 5000, exAt)).code, "잘못된 칸은 거절된다");
  const gathered = await a.waitFor((m) => m.t === "state" && m.room.explore && m.room.explore.resources.branch >= 5, 15000, exAt);
  check(gathered.room.explore.resources.branch >= 5, "채집이 끝나면 나뭇가지가 늘어난다");

  // ---- 전투: 서버가 시뮬레이션을 돌리고 상태를 계속 보낸다
  const battle = await a.waitFor(isState("battle"), 15000);
  const bs = battle.room.battle;
  check(bs && bs.units.length === 10 && bs.towers.length === 18, "전투가 시작되면 유닛 10, 타워 18이 담긴 battle 상태가 온다");
  check(bs.steam === 10, "내 스팀포스가 보인다 (10)");
  const later = await a.waitFor((m) => m.t === "state" && m.room.battle && m.room.battle.tick > bs.tick + 5, 10000);
  check(later.room.battle.tick > bs.tick, "시간이 지나면 틱이 늘어난다");
  const myUlt = picks[seatA].find((id) => !["richmond", "ankio"].includes(id) && id !== "toka-loga");
  const ultAt = a.messages.length;
  a.send({ t: "ultimate", characterId: myUlt });
  const ultState = await a.waitFor((m) => (m.t === "state" && m.room.battle && m.room.battle.steam < 6) || m.t === "error", 5000, ultAt);
  check(ultState.t === "state" || ["on_cooldown", "no_target", "invalid_lane"].includes(ultState.code), "궁극기 명령이 처리된다");
  a.send({ t: "ultimate", characterId: picks[seatB][0] });
  check((await a.waitFor((m) => m.t === "error", 5000, ultAt)).code, "상대 캐릭터의 궁극기는 거절된다");
  const finalState = await a.waitFor((m) => m.t === "state" && (m.room.phase === "result" || m.room.phase === "deathmatch"), 30000);
  check(["result", "deathmatch"].includes(finalState.room.phase), "전투가 끝나면 결과(또는 동점일 때 데스매치)로 넘어간다");

  a.ws.close();
  b.ws.close();
}

async function main() {
  const { characters } = await (await fetch(`${base}/api/characters`)).json();
  check(characters.length === 12 && new Set(characters.map((c) => c.id)).size === 12, "GET /api/characters 가 캐릭터 12명을 돌려준다");
  const ids = characters.map((c) => c.id);

  await idleGame(ids);
  await activeGame(ids);
}

try {
  await main();
} catch (error) {
  console.error("ERROR", error);
  failed = true;
}
console.log(failed ? "\n실패" : "\n모두 통과");
process.exit(failed ? 1 : 0);
