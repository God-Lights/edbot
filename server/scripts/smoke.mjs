// 실행 중인 서버(wrangler dev)에 가짜 클라이언트 두 명을 붙여서 한 판을 끝까지 돌려 본다.
//
//   터미널 1:  npx wrangler dev --var PHASE_SCALE:0.05     (단계 시간을 20배 빠르게)
//   터미널 2:  npm run smoke
//
// 확인하는 것: 방 만들기, 입장, 정원 초과 거절, ping, 준비 -> 모든 단계 순서대로 진행,
// 게임 중 재접속, 판이 끝난 뒤 로비 복귀.

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
  // from: 이 번호 이후에 도착한 메시지만 본다. (로비 상태는 처음에도 나타나므로 구분이 필요하다.)
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

async function main() {
  // 1. 방 만들기
  const created = await fetch(`${base}/api/rooms`, { method: "POST" });
  const { code } = await created.json();
  check(created.status === 201 && /^[A-Z2-9]{4}$/.test(code), `방 생성 (코드 ${code})`);

  const info = await (await fetch(`${base}/api/rooms/${code}`)).json();
  check(info.phase === "lobby" && info.players === 0 && info.joinable === true, "방 정보 조회");
  const missing = await fetch(`${base}/api/rooms/ZZZZ`);
  check(missing.status === 404, "없는 방은 404");

  // 2. 두 명 입장
  const a = connect(code, { name: "에드" });
  const welcomeA = await a.waitFor((m) => m.t === "welcome");
  const b = connect(code, { name: "민수" });
  const welcomeB = await b.waitFor((m) => m.t === "welcome");
  check(welcomeA.room.players.length === 1 && welcomeB.room.players.length === 2, "두 명 입장");
  check(welcomeA.token && welcomeA.token !== welcomeB.token, "각자 token을 받는다");
  check(JSON.stringify(welcomeB.room).includes("token") === false, "공개 상태에 token이 없다");
  const seatOf = (room, id) => room.players.find((p) => p.id === id)?.seat;
  check(seatOf(welcomeB.room, welcomeA.playerId) === 0 && seatOf(welcomeB.room, welcomeB.playerId) === 1, "seat 0, 1 배정");

  // 3. 정원 초과
  const c = connect(code, { name: "셋째" });
  const err = await c.waitFor((m) => m.t === "error");
  check(err.code === "room_full", "세 번째 사람은 room_full");
  await c.closed;

  // 4. ping
  const sentAt = Date.now();
  a.send({ t: "ping", ts: sentAt });
  const pong = await a.waitFor((m) => m.t === "pong");
  check(pong.ts === sentAt && typeof pong.serverTime === "number", "ping -> pong");

  // 5. 잘못된 메시지
  a.send({ t: "nonsense" });
  const bad = await a.waitFor((m) => m.t === "error" && m.code === "bad_message");
  check(Boolean(bad), "알 수 없는 메시지는 bad_message");

  // 6. 준비 -> 게임 시작
  a.send({ t: "ready", ready: true });
  await a.waitFor((m) => m.t === "state" && m.room.players.find((p) => p.id === welcomeA.playerId)?.ready);
  check(true, "한 명 준비 (아직 로비)");
  b.send({ t: "ready", ready: true });
  const started = await a.waitFor((m) => m.t === "state" && m.room.phase === "ban");
  check(started.room.phaseEndsAt > started.room.serverTime, "둘 다 준비하면 ban 단계 시작, 종료 시각이 있다");

  // 7. 게임 중 재접속 (A가 끊겼다가 token으로 돌아옴)
  a.ws.close();
  await a.closed;
  await b.waitFor((m) => m.t === "state" && m.room.players.some((p) => !p.connected));
  check(true, "끊기면 상대에게 connected=false가 전달된다");
  const a2 = connect(code, { name: "아무거나", token: welcomeA.token });
  const welcomeA2 = await a2.waitFor((m) => m.t === "welcome");
  check(welcomeA2.playerId === welcomeA.playerId, "token으로 같은 자리에 재접속");

  // 8. 모든 단계를 순서대로 지나 로비로 복귀 (판이 시작된 이후의 메시지만 본다)
  const gameStart = b.messages.findIndex((m) => m.t === "state" && m.room.phase === "ban");
  const expected = ["ban", "draft", "placement", "explore", "forge", "battle", "result", "lobby"];
  let cursor = gameStart;
  for (const phase of expected) {
    const m = await b.waitFor(
      (msg) => msg.t === "state" && msg.room.phase === phase,
      20000,
      cursor,
    );
    cursor = b.messages.indexOf(m) + 1;
  }
  check(true, `단계 진행: ${expected.join(" -> ")}`);

  const seq = b.messages
    .slice(gameStart)
    .filter((m) => m.t === "state")
    .map((m) => m.room.phase)
    .filter((p, i, arr) => i === 0 || p !== arr[i - 1]);
  check(JSON.stringify(seq) === JSON.stringify(expected), `단계가 순서대로 한 번씩만 나타난다 (${seq.join(" -> ")})`);

  const lobby = b.messages.filter((m) => m.t === "state").at(-1);
  check(
    lobby.room.phase === "lobby" && lobby.room.players.every((p) => !p.ready),
    "판이 끝나면 로비로 돌아가고 준비가 풀린다",
  );

  a2.ws.close();
  b.ws.close();
}

try {
  await main();
} catch (error) {
  console.error("ERROR", error);
  failed = true;
}
console.log(failed ? "\n실패" : "\n모두 통과");
process.exit(failed ? 1 : 0);
