// iOS 앱의 시연 화면(-demo prep / -demo combat)에 쓸 고정 데이터를 실제 서버에서 받아 둔다.
//
//   bun run dev -- --port 8802 --phase-scale 0.3 --data /tmp/demo-data   (다른 창에서)
//   bun scripts/capture-demo.ts http://localhost:8802
//
// 결과: ios/EdbotApp/Resources/Demo/demo-{catalog,prep,combat}.json
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const base = (process.argv[2] ?? "http://localhost:8802").replace(/\/+$/, "");
const out = join(import.meta.dir, "..", "..", "ios", "EdbotApp", "Resources", "Demo");
mkdirSync(out, { recursive: true });

const catalog = await fetch(`${base}/api/chess`).then((r) => r.text());
writeFileSync(join(out, "demo-catalog.json"), catalog);

type Unit = { uid: string };
type Room = { phase: string; chess?: { round: number; me?: { gold: number; shop: Array<string | null>; bench: Array<Unit | null>; board: unknown[] } | null } | null };

const result = await new Promise<{ welcome: Record<string, unknown>; prep: Room; combat: Room }>((resolve, reject) => {
  const ws = new WebSocket(`${base.replace(/^http/, "ws")}/ws/ADMF?name=${encodeURIComponent("지휘관")}`);
  let welcome: Record<string, unknown> | null = null;
  let prep: Room | null = null;
  let bought = 0;
  let deployedRound = 0;
  const timer = setTimeout(() => reject(new Error("시간 초과")), 120_000);
  ws.onmessage = (event) => {
    const msg = JSON.parse(String(event.data)) as { t: string; room?: Room; code?: string };
    if (msg.t === "welcome") welcome = msg as Record<string, unknown>;
    if (msg.t === "error" && msg.code === "unit_not_found") { deployedRound = 0; return; }
    const room = msg.room;
    if (!room) return;
    if (room.phase === "lobby") ws.send(JSON.stringify({ t: "ready", ready: true }));
    const me = room.chess?.me;
    if (room.phase === "prep" && me) {
      const round = room.chess!.round;
      // 2라운드까지는 사고 놓기만 한다. 2라운드 준비 화면을 시연 화면으로 쓴다.
      if (bought < round * 3) {
        const slot = me.shop.findIndex((s) => s);
        if (slot >= 0 && me.gold >= 1) { bought += 1; ws.send(JSON.stringify({ t: "buy", slot })); return; }
        bought = round * 3;
      }
      if (deployedRound !== round) {
        deployedRound = round;
        const free = me.bench.filter((u): u is Unit => !!u);
        free.slice(0, 4).forEach((u, i) => ws.send(JSON.stringify({ t: "deploy", uid: u.uid, col: 2 + i, row: i % 2 })));
        return;
      }
      if (round >= 2 && me.board.length > 0) prep = room;
      if (round >= 2 && prep) { ws.send(JSON.stringify({ t: "done" })); }
      else if (round < 2) ws.send(JSON.stringify({ t: "done" }));
    }
    if (room.phase === "combat" && prep && welcome) {
      clearTimeout(timer);
      ws.close();
      resolve({ welcome, prep, combat: room });
    }
  };
  ws.onerror = () => reject(new Error("WebSocket 오류"));
});

// 앱은 welcome 으로 내 자리를 알고, room 으로 화면을 그린다.
// 시연 화면이 멈춘 듯 보이지 않게: 준비는 25초 남은 상태, 전투는 막 시작한 상태로 맞춘다.
const timed = (room: Room, startNow: boolean, ms: number) => {
  const r = room as Room & { serverTime: number; phaseStartedAt: number; phaseEndsAt: number };
  return { ...r, phaseStartedAt: startNow ? r.serverTime : r.phaseStartedAt, phaseEndsAt: r.serverTime + ms };
};
result.prep = timed(result.prep, false, 25_000);
result.combat = timed(result.combat, true, 30_000);
for (const [name, room] of [["prep", result.prep], ["combat", result.combat]] as const) {
  writeFileSync(join(out, `demo-${name}.json`), JSON.stringify({ ...result.welcome, room }));
}
console.log(`저장했다: ${out}`);
