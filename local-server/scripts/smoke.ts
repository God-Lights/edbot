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

// ---- 서버 정보(/api/server) ----
const meta = (await fetch(`${base}/api/server`).then((r) => r.json()).catch(() => null)) as { protocol?: number; name?: string; env?: string; authMode?: string; edition?: string; ranking?: boolean } | null;
check("/api/server", typeof meta?.protocol === "number" && !!meta.name, JSON.stringify(meta));
check("로컬 서버는 open 방식·local 환경·이름으로 전적", meta?.authMode === "open" && meta?.env === "local" && meta?.ranking === true);

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
    // 같은 기물을 세 번 사면 합쳐져서, 합치기 전 목록으로 보낸 배치가 "기물 없음"이 될 수 있다. 다음 상태에서 다시 배치한다.
    if (msg.t === "error" && msg.code === "unit_not_found") { sentDone = 0; return; }
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

// ---- 두 사람이 한 판: 한 사람이 항복하면 이름으로 전적이 남는다 (로컬 서버) ----
const stamp = Date.now().toString(36).slice(-5);
const names = [`갑${stamp}`, `을${stamp}`] as const;
const duel = await new Promise<{ ok: boolean; why: string }>((resolve) => {
  const made = fetch(`${base}/api/rooms`, { method: "POST" }).then((r) => r.json() as Promise<{ code?: string }>);
  void made.then(({ code: room }) => {
    if (!room) return resolve({ ok: false, why: "방을 못 만듦" });
    const sockets = names.map((name) => new WebSocket(`${base.replace(/^http/, "ws")}/ws/${room}?name=${encodeURIComponent(name)}`));
    const timer = setTimeout(() => done(false, "시간 초과"), 45_000);
    const done = (ok: boolean, why: string) => {
      clearTimeout(timer);
      for (const ws of sockets) { try { ws.close(); } catch { /* 이미 닫힘 */ } }
      resolve({ ok, why });
    };
    const readied = [false, false];
    let surrendered = false;
    sockets.forEach((ws, i) => {
      ws.onerror = () => done(false, "WebSocket 오류");
      ws.onmessage = (event) => {
        const msg = JSON.parse(String(event.data)) as { t: string; room?: { phase: string }; message?: string };
        if (msg.t === "error") return done(false, `서버 오류 ${msg.message}`);
        const phase = msg.room?.phase;
        if (phase === "lobby" && !readied[i]) { readied[i] = true; ws.send(JSON.stringify({ t: "ready", ready: true })); }
        if (phase === "prep" && i === 1 && !surrendered) { surrendered = true; ws.send(JSON.stringify({ t: "surrender" })); }
        if (phase === "result" && i === 0) done(true, "항복으로 한 판이 끝남");
      };
    });
  });
});
check("두 사람이 한 판(항복으로 끝내기)", duel.ok, duel.why);
await Bun.sleep(300);
const board = (await fetch(`${base}/api/leaderboard?limit=50`).then((r) => r.json()).catch(() => null)) as { entries?: Array<{ nickname: string; rating: number; wins: number; losses: number }> } | null;
const winner = board?.entries?.find((e) => e.nickname === names[0]);
const loser = board?.entries?.find((e) => e.nickname === names[1]);
check("이름으로 전적이 남음(순위표)", !!winner && !!loser && winner.wins === 1 && loser.losses === 1, `${winner?.rating ?? "?"} / ${loser?.rating ?? "?"}`);

if (failures.length) {
  console.log(`\n실패 ${failures.length}개: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\n모두 통과");
