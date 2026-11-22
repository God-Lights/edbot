// 봇 대 봇 전체 게임 측정: 난이도별 승률, 자리(seat) 유불리, 판 길이, 결과 이유.
//
//   npx tsx scripts/bot-balance.ts [판수=200] [시드=1]
//
// 서버의 방 로직(room-state)을 그대로 돌리므로 자원 시스템, 라운드 진행, 체력 규칙이 모두 반영된다.
import { runChessBot } from "../src/bot";
import type { BotLevel } from "../src/bot";
import { advancePhase, createRoom, joinRoom, setReady } from "../src/room-state";

const [gamesArg = "200", seedArg = "1"] = process.argv.slice(2) as string[];
const games = Number(gamesArg);

function rngFrom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface GameResult { winner: 0 | 1 | null; rounds: number; reason: string }

function playGame(levels: [BotLevel, BotLevel], lite: boolean, seed: number): GameResult {
  let n = 0;
  const state = createRoom("SIM", 0, false, "chess", lite);
  const rng = rngFrom(seed);
  const ids: string[] = [];
  for (const name of ["A", "B"]) {
    const r = joinRoom(state, { name }, 0, () => `p${++n}`);
    if (!r.ok) throw new Error("join");
    r.player.bot = true;
    ids.push(r.player.id);
  }
  state.players.forEach((p, i) => { p.botLevel = levels[i]; });
  for (const id of ids) setReady(state, id, true, 0, 1, rng);
  let now = 0;
  let guard = 0;
  while (state.phase !== "result" && guard++ < 300) {
    for (const id of ids) runChessBot(state, id, now, 1, rng);
    now = Math.max(now + 1000, (state.phaseEndsAt ?? now) + 1);
    advancePhase(state, now, 1, rng);
  }
  return { winner: (state.result?.winner ?? null) as 0 | 1 | null, rounds: state.chess?.round ?? 0, reason: state.result?.reason ?? "?" };
}

const pct = (n: number, d: number) => (d === 0 ? "  - " : ((100 * n) / d).toFixed(1).padStart(5) + "%");

/** a 난이도와 b 난이도를 자리를 바꿔 가며 붙인다. a의 승률(무승부는 반반)을 돌려준다. */
function versus(a: BotLevel, b: BotLevel, lite: boolean, seed: number) {
  let aWins = 0, draws = 0, seat0 = 0, decided = 0, rounds = 0;
  const reasons: Record<string, number> = {};
  for (let i = 0; i < games; i++) {
    const swap = i % 2 === 1;
    const r = playGame(swap ? [b, a] : [a, b], lite, seed * 100003 + i);
    rounds += r.rounds;
    reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
    if (r.winner === null) { draws++; continue; }
    decided++;
    if (r.winner === 0) seat0++;
    const aSeat = swap ? 1 : 0;
    if (r.winner === aSeat) aWins++;
  }
  return { aWins, draws, seat0, decided, avgRounds: rounds / games, reasons };
}

for (const lite of [true, false]) {
  console.log(`\n== ${lite ? "입문 모드(쉬운 캐릭터, 자원 없음)" : "전체 모드(모든 캐릭터, 자원 시스템)"} · ${games}판씩 ==`);
  for (const [a, b] of [["normal", "normal"], ["easy", "normal"], ["normal", "hard"], ["easy", "hard"]] as Array<[BotLevel, BotLevel]>) {
    const r = versus(a, b, lite, Number(seedArg));
    console.log(
      `${a.padEnd(6)} vs ${b.padEnd(6)}  ${a} 승률 ${pct(r.aWins + r.draws / 2, games)}  무승부 ${r.draws}  seat0 승률 ${pct(r.seat0, r.decided)}  평균 ${r.avgRounds.toFixed(1)}라운드  이유 ${JSON.stringify(r.reasons)}`,
    );
  }
}
