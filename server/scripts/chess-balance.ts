// 체스판 자동 전투 밸런스 측정. 서버 코드(src/chess)를 그대로 불러 쓴다.
//
//   npx tsx scripts/chess-balance.ts [판수=2000] [예산=14] [기물수=6] [시드=1]
//
// 같은 예산으로 무작위 팀을 만들어 서로 싸우게 하고, 캐릭터와 시너지의 승률을 표로 출력한다.
import { runBalance } from "../src/chess/balance";
import { unitDef } from "../src/chess/roster";
import { ALL_SYNERGIES, LINEAGE_TRAITS } from "../src/chess/synergy";

const [matches = "2000", budget = "14", cap = "6", seed = "1"] = process.argv.slice(2) as string[];
const report = runBalance({ matches: Number(matches), budget: Number(budget), cap: Number(cap), seed: Number(seed) });
const pct = (n: number, d: number) => (d === 0 ? "  - " : (100 * n / d).toFixed(1).padStart(5) + "%");

console.log(`전투 ${report.matches}판 (예산 ${budget}골드, 기물 ${cap}개 이하, 같은 팀을 자리 바꿔 2번씩)`);
console.log(`평균 ${report.averageBeats.toFixed(1)}박자, 돌발 사망까지 간 판 ${pct(report.suddenDeath, report.matches)}, 무승부 ${pct(report.draws, report.matches)}, seat0 승률 ${pct(report.seat0WinRate * 100, 100)}`);
console.log("\n캐릭터 (함께 나온 팀의 승률)");
for (const s of [...report.units].sort((a, b) => b.wins / (b.games || 1) - a.wins / (a.games || 1))) {
  const d = unitDef(s.defId)!;
  console.log(`${d.nameKo.padEnd(8, "　")} ${d.piece.padEnd(7)} ${d.cost}골드 ${String(s.games).padStart(5)}판 승률 ${pct(s.wins, s.games)}`);
}
console.log("\n시너지");
for (const s of report.synergies) {
  const info = [...ALL_SYNERGIES, ...LINEAGE_TRAITS].find((x) => x.id === s.id)!;
  console.log(`${info.nameKo.padEnd(8, "　")} ${String(s.games).padStart(5)}판 승률 ${pct(s.wins, s.games)}`);
}
