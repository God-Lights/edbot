// 밸런스 측정: 봇이 무작위로 팀을 만들어 서로 싸우게 하고 캐릭터와 시너지의 승률을 센다.
// 같은 예산(골드)으로 만든 팀끼리 싸우므로 "비싼 캐릭터가 이긴다"가 아니라 "가격 대비 강한가"를 본다.

import { roster, unitDef } from "./roster";
import { ALL_SYNERGIES, activeSynergies } from "./synergy";
import { runCombat } from "./sim";
import type { Placement, UnitDef } from "./types";

/** 결정적인 난수. 시드가 같으면 같은 수열이다. */
export function makeRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const shuffle = <T>(items: readonly T[], rng: () => number): T[] => {
  const list = [...items];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j]!, list[i]!];
  }
  return list;
};

export interface TeamSpec {
  units: Array<{ defId: string; star: 1 | 2 }>;
}

/**
 * 예산 안에서 기물 cap개 이하를 무작위로 뽑는다. 같은 캐릭터는 한 번만(★1). 가능한 한 예산을 다 쓴다.
 */
export function randomTeam(rng: () => number, budget: number, cap: number): TeamSpec {
  const order = shuffle(roster(), rng);
  const units: TeamSpec["units"] = [];
  let spent = 0;
  for (const def of order) {
    if (units.length >= cap) break;
    if (spent + def.cost > budget) continue;
    units.push({ defId: def.id, star: 1 });
    spent += def.cost;
  }
  return { units };
}

/** 앞줄에서 뒷줄까지: 탱커와 폰이 앞, 기동과 암살이 가운데, 서포터와 딜러가 뒤 */
const ROW_BY_ROLE: Record<UnitDef["role"], number> = { 탱커: 0, 지휘: 1, 암살: 1, 기동: 1, 제어: 2, 딜러: 2, 서포터: 3 };

/** 역할에 맞게 줄을 정하고, 같은 줄 안에서는 가운데부터 채운다. 한 줄이 넘치면 다음 줄로 간다. */
export function placeTeam(team: TeamSpec): Placement[] {
  const taken = new Set<string>();
  const centre = [3, 4, 2, 5, 1, 6, 0, 7];
  const out: Placement[] = [];
  const sorted = [...team.units].sort((a, b) => ROW_BY_ROLE[unitDef(a.defId)!.role] - ROW_BY_ROLE[unitDef(b.defId)!.role] || (a.defId < b.defId ? -1 : 1));
  for (const u of sorted) {
    const def = unitDef(u.defId)!;
    let placed = false;
    for (let row = ROW_BY_ROLE[def.role]; row < 4 && !placed; row++) {
      for (const col of centre) {
        const key = `${col},${row}`;
        if (taken.has(key)) continue;
        taken.add(key);
        out.push({ defId: u.defId, star: u.star, col, row });
        placed = true;
        break;
      }
    }
    if (!placed) {
      for (let row = 0; row < 4 && !placed; row++) {
        for (const col of centre) {
          const key = `${col},${row}`;
          if (!taken.has(key)) {
            taken.add(key);
            out.push({ defId: u.defId, star: u.star, col, row });
            placed = true;
            break;
          }
        }
      }
    }
  }
  return out;
}

export interface BalanceOptions {
  matches: number;
  budget: number;
  cap: number;
  seed: number;
}

export interface UnitStat {
  defId: string;
  games: number;
  wins: number;
  draws: number;
}

export interface BalanceReport {
  options: BalanceOptions;
  matches: number;
  draws: number;
  suddenDeath: number;
  averageBeats: number;
  /** seat 0이 이긴 비율(무승부 제외). 대칭이라 0.5에 가까워야 한다. */
  seat0WinRate: number;
  units: UnitStat[];
  synergies: Array<{ id: string; games: number; wins: number }>;
}

export function runBalance(options: BalanceOptions): BalanceReport {
  const rng = makeRng(options.seed);
  const stats = new Map<string, UnitStat>(roster().map((d) => [d.id, { defId: d.id, games: 0, wins: 0, draws: 0 }]));
  const synergy = new Map<string, { games: number; wins: number }>(ALL_SYNERGIES.map((s) => [s.id, { games: 0, wins: 0 }]));
  let draws = 0;
  let sudden = 0;
  let beats = 0;
  let seat0Wins = 0;
  let decided = 0;

  for (let i = 0; i < options.matches; i++) {
    const a = randomTeam(rng, options.budget, options.cap);
    const b = randomTeam(rng, options.budget, options.cap);
    // 같은 두 팀을 자리만 바꿔서 두 번 싸운다. 대칭 때문에 생기는 우연한 차이를 없앤다.
    for (const swap of [false, true]) {
      const [t0, t1] = swap ? [b, a] : [a, b];
      const result = runCombat([placeTeam(t0), placeTeam(t1)]);
      beats += result.beats;
      if (result.suddenDeath) sudden++;
      if (result.winner === null) draws++;
      else {
        decided++;
        if (result.winner === 0) seat0Wins++;
      }
      for (const seat of [0, 1] as const) {
        const team = seat === 0 ? t0 : t1;
        const ids = team.units.map((u) => u.defId);
        for (const id of ids) {
          const s = stats.get(id)!;
          s.games++;
          if (result.winner === seat) s.wins++;
          if (result.winner === null) s.draws++;
        }
        for (const sid of activeSynergies(ids)) {
          const entry = synergy.get(sid)!;
          entry.games++;
          if (result.winner === seat) entry.wins++;
        }
      }
    }
  }
  const total = options.matches * 2;
  return {
    options,
    matches: total,
    draws,
    suddenDeath: sudden,
    averageBeats: beats / total,
    seat0WinRate: decided > 0 ? seat0Wins / decided : 0.5,
    units: [...stats.values()],
    synergies: [...synergy.entries()].map(([id, v]) => ({ id, ...v })),
  };
}
