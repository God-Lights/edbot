// 무한 모드(뫼비우스 규칙) 점검: 같은 팀을 양쪽에 놓고 seat 편향, 전투 길이, 돌발 사망 비율, 유령이 나온 비율을 일반 규칙과 비교한다.
//
//   npx tsx scripts/mobius-balance.ts [판수=400] [예산=14] [기물수=6] [시드=1]
import { makeRng, placeTeam, randomTeam } from "../src/chess/balance";
import { recordCombat } from "../src/chess/sim";
import type { Placement } from "../src/chess/types";

const [matches = "400", budget = "14", cap = "6", seed = "1"] = process.argv.slice(2) as string[];

for (const mobius of [false, true]) {
  const rng = makeRng(Number(seed));
  let seat0 = 0, seat1 = 0, draws = 0, beats = 0, sudden = 0, ghostGames = 0, wormholes = 0, clones = 0, mirrorSeat0 = 0, mirrorDraw = 0;
  const games = Number(matches);
  for (let i = 0; i < games; i++) {
    const a: Placement[] = placeTeam(randomTeam(rng, Number(budget), Number(cap)));
    const b: Placement[] = placeTeam(randomTeam(rng, Number(budget), Number(cap)));
    const r = recordCombat([a, b], [], { mobius });
    const w = r.result.winner;
    if (w === 0) seat0++; else if (w === 1) seat1++; else draws++;
    beats += r.result.beats;
    if (r.result.suddenDeath) sudden++;
    if (r.frames.some((f) => f.some((u) => (u[5] & 4) === 4))) ghostGames++;
    wormholes += r.events.filter((e) => e[1] === "surface").length;
    clones += r.events.filter((e) => e[1] === "clone").length;
    // 같은 팀끼리: 어느 한 자리가 유리하면 거울 대칭이 깨진 것이다
    const m = recordCombat([a, a], [], { mobius }).result.winner;
    if (m === 0) mirrorSeat0++; else if (m === null) mirrorDraw++;
  }
  console.log(
    `${mobius ? "무한 모드" : "일반    "} | seat0 ${(100 * seat0 / games).toFixed(1)}% seat1 ${(100 * seat1 / games).toFixed(1)}% 무승부 ${(100 * draws / games).toFixed(1)}%` +
    ` | 평균 ${(beats / games).toFixed(1)}박자, 돌발사망 ${(100 * sudden / games).toFixed(1)}%` +
    ` | 유령 등장 ${(100 * ghostGames / games).toFixed(1)}%, 웜홀 ${(wormholes / games).toFixed(2)}회, 분신 ${(clones / games).toFixed(2)}개` +
    ` | 거울전 seat0 ${(100 * mirrorSeat0 / games).toFixed(1)}% 무승부 ${(100 * mirrorDraw / games).toFixed(1)}%`,
  );
}
