// 로컬 서버 점검: 실행 중인 서버에 붙어서 (1) 웹 화면과 API가 열리는지 (2) 봇과 한 판이 준비 -> 전투 -> 다음 라운드까지 돌아가는지 본다.
//
//   bun scripts/smoke.ts [주소=http://localhost:8787] [방=ADMN]
// 서버를 PHASE_SCALE을 줄여서(--phase-scale 0.05) 띄우면 빨리 끝난다. 실패하면 0이 아닌 값으로 끝난다.

const base = (process.argv[2] ?? "http://localhost:8787").replace(/\/+$/, "");
const code = process.argv[3] ?? "ADMN";
const failures: string[] = [];

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures.push(name);
}

// ---- HTTP ----
const health = await fetch(`${base}/health`).then((r) => r.json()).catch(() => null);
check("/health", (health as { ok?: boolean } | null)?.ok === true);
const home = await fetch(`${base}/`).then((r) => r.text()).catch(() => "");
check("웹 화면(/)", home.includes("COMMANDER"));
const js = await fetch(`${base}/js/main.js`).then((r) => r.status).catch(() => 0);
check("웹 스크립트", js === 200);
const catalog = (await fetch(`${base}/api/chess`).then((r) => r.json()).catch(() => null)) as { units?: unknown[] } | null;
check("/api/chess 도감", (catalog?.units?.length ?? 0) > 10, `${catalog?.units?.length ?? 0}명`);
const info = (await fetch(`${base}/api/rooms/${code}`).then((r) => r.json()).catch(() => null)) as { code?: string } | null;
check(`/api/rooms/${code}`, info?.code === code);
const created = (await fetch(`${base}/api/rooms?mobius=1`, { method: "POST" }).then((r) => r.json()).catch(() => null)) as { code?: string } | null;
check("방 만들기(POST /api/rooms)", typeof created?.code === "string" && created.code.length === 4, created?.code);
const made = created?.code ? ((await fetch(`${base}/api/rooms/${created.code}`).then((r) => r.json()).catch(() => null)) as { mobius?: boolean } | null) : null;
check("만든 방이 무한 모드로 저장됨", made?.mobius === true);

// ---- WebSocket: 봇과 한 판 ----
type Unit = { uid: string };
type Room = { phase: string; players: Array<{ id: string; seat: number | null; ready?: boolean }>; chess?: { round: number; me?: { shop: Array<string | null>; bench: Array<Unit | null>; board: unknown[] } | null } | null };
const wsUrl = `${base.replace(/^http/, "ws")}/ws/${code}?name=Smoke`;
const seen: string[] = [];
const outcome = await new Promise<{ ok: boolean; why: string }>((resolve) => {
  const ws = new WebSocket(wsUrl);
  let last: Room | null = null;
  let sentReady = false;
  let boughtRound = 0;
  let sentDone = 0;
  const timer = setTimeout(() => finish(false, `시간 초과 (마지막 단계: ${last?.phase})`), 90_000);
  const finish = (ok: boolean, why: string) => {
    clearTimeout(timer);
    try { ws.close(); } catch { /* 이미 닫힘 */ }
    resolve({ ok, why });
  };
  ws.onerror = () => finish(false, "WebSocket 오류");
  ws.onclose = () => { if (!last) finish(false, "연결이 바로 닫힘"); };
  ws.onmessage = (event) => {
    const msg = JSON.parse(String(event.data)) as { t: string; room?: Room; code?: string; message?: string };
    if (msg.t === "error") return finish(false, `서버 오류: ${msg.code} ${msg.message}`);
    const room = msg.room;
    if (!room) return;
    last = room;
    if (seen[seen.length - 1] !== `${room.phase}/${room.chess?.round ?? 0}`) seen.push(`${room.phase}/${room.chess?.round ?? 0}`);
    if (room.phase === "lobby" && !sentReady) { sentReady = true; ws.send(JSON.stringify({ t: "ready", ready: true })); }
    if (room.phase === "prep" && room.chess?.me) {
      const round = room.chess.round;
      if (boughtRound !== round) {
        boughtRound = round;
        for (let slot = 0; slot < 3; slot++) ws.send(JSON.stringify({ t: "buy", slot }));
      } else if (sentDone !== round && room.chess.me.board.length === 0 && room.chess.me.bench.some((u) => u)) {
        sentDone = round;
        room.chess.me.bench.filter((u): u is Unit => !!u).slice(0, 3).forEach((u, col) => ws.send(JSON.stringify({ t: "deploy", uid: u.uid, col, row: 0 })));
        ws.send(JSON.stringify({ t: "done" }));
      }
    }
    // 라운드 2 준비 단계까지 오면 한 판이 돌았다는 뜻이다.
    if (room.phase === "prep" && (room.chess?.round ?? 0) >= 2) finish(true, "라운드 2 준비 단계까지 진행");
  };
});
check("봇과 한 판(준비 -> 전투 -> 다음 라운드)", outcome.ok, outcome.why);
console.log(`   단계 흐름: ${seen.join(" -> ")}`);

if (failures.length) {
  console.log(`\n실패 ${failures.length}개: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\n모두 통과");
