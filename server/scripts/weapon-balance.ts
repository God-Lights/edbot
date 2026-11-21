// 무기 밸런스 측정: 같은 팀에서 무기를 낀 쪽과 안 낀 쪽을 싸우게 해서, 무기마다 승률을 본다.
//
//   npx tsx scripts/weapon-balance.ts [판수=600] [예산=14] [기물수=6] [시드=1]
import { makeRng, placeTeam, randomTeam } from "../src/chess/balance";
import { runCombat } from "../src/chess/sim";
import { WEAPONS } from "../src/chess/weapons";
import type { Placement } from "../src/chess/types";

const [matches = "600", budget = "14", cap = "6", seed = "1"] = process.argv.slice(2) as string[];
const rng = makeRng(Number(seed));
console.log(`무기 ${WEAPONS.length}종, 팀당 ${matches}판 (같은 팀 + 가장 비싼 기물 1~2개에만 무기, 자리를 바꿔 2번씩)`);
for (const weapon of WEAPONS) {
  let wins = 0, games = 0, draws = 0;
  for (let i = 0; i < Number(matches); i++) {
    const a = placeTeam(randomTeam(rng, Number(budget), Number(cap)));
    const b = placeTeam(randomTeam(rng, Number(budget), Number(cap)));
    const armed = (team: Placement[]) => team.map((p, idx) => (idx < 2 ? { ...p, weapon: weapon.id } : p));
    for (const swap of [false, true]) {
      const boards: [Placement[], Placement[]] = swap ? [b, armed(a)] : [armed(a), b];
      const result = runCombat(boards);
      const mine = swap ? 1 : 0;
      games++;
      if (result.winner === mine) wins++;
      if (result.winner === null) draws++;
    }
  }
  console.log(`${weapon.nameKo.padEnd(12, "　")} ${weapon.rarity.padEnd(9)} 승률 ${(100 * wins / games).toFixed(1).padStart(5)}%  무승부 ${draws}`);
}
