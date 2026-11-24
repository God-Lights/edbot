import { describe, expect, it } from "vitest";
import {
  absolutePosition, attackableEnemies, chebyshev, freeAdjacent, moveDestinations,
} from "../src/chess/board";
import { makeRng, placeTeam, randomTeam, runBalance } from "../src/chess/balance";
import { createUnit } from "../src/chess/core";
import { ROSTER, STAR2_STATS, unitDef } from "../src/chess/roster";
import { MAX_BEATS, SUDDEN_DEATH_BEAT, createCombat, runCombat, stepCombat } from "../src/chess/sim";
import { activeSynergies, combineBonuses } from "../src/chess/synergy";
import type { CombatState, Piece, Placement, Seat } from "../src/chess/types";

/** 빈 판에 기물만 직접 놓는다 (패턴 시험용). */
function board(units: Array<{ seat: Seat; piece: Piece; x: number; y: number; hp?: number; atk?: number }>): CombatState {
  const state = createCombat([[], []]);
  for (const u of units) {
    createUnit(state, {
      defId: "nut-wolf", seat: u.seat, star: 1, x: u.x, y: u.y, hp: u.hp ?? 1000, maxHp: u.hp ?? 1000, atk: u.atk ?? 50,
      energyMax: null, piece: u.piece, summon: false,
    });
  }
  return state;
}
const squares = (list: Array<{ x: number; y: number }>) => list.map((p) => `${p.x},${p.y}`).sort();

describe("좌표", () => {
  it("내 쪽 시점의 배치를 절대 좌표로 바꾼다 (seat 1은 180도 돌려서 본다)", () => {
    expect(absolutePosition(0, 0, 0)).toEqual({ x: 0, y: 4 }); // 앞줄 왼쪽
    expect(absolutePosition(0, 7, 3)).toEqual({ x: 7, y: 7 }); // 뒷줄 오른쪽
    expect(absolutePosition(1, 0, 0)).toEqual({ x: 7, y: 3 });
    expect(absolutePosition(1, 7, 3)).toEqual({ x: 0, y: 0 });
  });
  it("두 팀의 배치 영역이 겹치지 않는다", () => {
    const a = new Set<string>();
    for (let col = 0; col < 8; col++) for (let row = 0; row < 4; row++) a.add(JSON.stringify(absolutePosition(0, col, row)));
    for (let col = 0; col < 8; col++) for (let row = 0; row < 4; row++) expect(a.has(JSON.stringify(absolutePosition(1, col, row)))).toBe(false);
    expect(a.size).toBe(32);
  });
});

describe("이동 모양", () => {
  it("킹은 8방향 1칸", () => {
    const s = board([{ seat: 0, piece: "king", x: 3, y: 4 }]);
    expect(moveDestinations(s, s.units[0]!)).toHaveLength(8);
  });
  it("킹은 판 가장자리 밖으로 나가지 않는다", () => {
    const s = board([{ seat: 0, piece: "king", x: 0, y: 7 }]);
    expect(squares(moveDestinations(s, s.units[0]!))).toEqual(["0,6", "1,6", "1,7"]);
  });
  it("룩은 직선으로 최대 3칸, 막히면 그 너머로 못 간다", () => {
    const s = board([{ seat: 0, piece: "rook", x: 3, y: 4 }, { seat: 0, piece: "pawn", x: 3, y: 2 }]);
    const moves = squares(moveDestinations(s, s.units[0]!));
    expect(moves).toContain("3,3"); // 앞 1칸
    expect(moves).not.toContain("3,2"); // 아군 자리
    expect(moves).not.toContain("3,1"); // 아군 너머
    expect(moves).toContain("6,4"); // 오른쪽 3칸
    expect(moves).not.toContain("7,4"); // 4칸은 안 된다
    expect(moves).not.toContain("4,5"); // 대각선은 안 된다
  });
  it("비숍은 대각선만", () => {
    const s = board([{ seat: 0, piece: "bishop", x: 3, y: 4 }]);
    for (const p of moveDestinations(s, s.units[0]!)) expect(Math.abs(p.x - 3)).toBe(Math.abs(p.y - 4));
  });
  it("퀸은 직선과 대각선", () => {
    const s = board([{ seat: 0, piece: "queen", x: 3, y: 4 }]);
    const moves = moveDestinations(s, s.units[0]!);
    expect(moves.some((p) => p.x === 3)).toBe(true);
    expect(moves.some((p) => p.y === 4)).toBe(true);
    expect(moves.some((p) => Math.abs(p.x - 3) === Math.abs(p.y - 4))).toBe(true);
  });
  it("나이트는 L자로 점프하고 사이가 막혀도 넘는다", () => {
    const s = board([
      { seat: 0, piece: "knight", x: 3, y: 4 },
      { seat: 0, piece: "pawn", x: 3, y: 3 }, { seat: 0, piece: "pawn", x: 4, y: 4 }, { seat: 1, piece: "pawn", x: 4, y: 3 },
    ]);
    const moves = squares(moveDestinations(s, s.units[0]!));
    expect(moves).toContain("4,2");
    expect(moves).toContain("2,2");
    expect(moves).toHaveLength(8);
  });
  it("폰은 앞으로 한 칸 (seat 0은 위, seat 1은 아래), 앞이 막히면 못 간다", () => {
    const a = board([{ seat: 0, piece: "pawn", x: 3, y: 5 }]);
    expect(squares(moveDestinations(a, a.units[0]!))).toEqual(["3,4"]);
    const b = board([{ seat: 1, piece: "pawn", x: 3, y: 2 }]);
    expect(squares(moveDestinations(b, b.units[0]!))).toEqual(["3,3"]);
    const c = board([{ seat: 0, piece: "pawn", x: 3, y: 5 }, { seat: 1, piece: "pawn", x: 3, y: 4 }]);
    expect(moveDestinations(c, c.units[0]!)).toEqual([]);
  });
});

describe("공격 모양", () => {
  it("킹은 인접 8칸의 적만", () => {
    const s = board([{ seat: 0, piece: "king", x: 3, y: 4 }, { seat: 1, piece: "pawn", x: 4, y: 3 }, { seat: 1, piece: "pawn", x: 6, y: 4 }]);
    expect(attackableEnemies(s, s.units[0]!).map((u) => u.id)).toEqual([s.units[1]!.id]);
  });
  it("룩은 직선에서 가장 가까운 적을 치고, 그 뒤의 적은 가려진다", () => {
    const s = board([{ seat: 0, piece: "rook", x: 3, y: 7 }, { seat: 1, piece: "pawn", x: 3, y: 5 }, { seat: 1, piece: "pawn", x: 3, y: 4 }]);
    expect(attackableEnemies(s, s.units[0]!).map((u) => u.id)).toEqual([s.units[1]!.id]);
  });
  it("아군이 앞을 막으면 룩의 공격도 막힌다", () => {
    const s = board([{ seat: 0, piece: "rook", x: 3, y: 7 }, { seat: 0, piece: "pawn", x: 3, y: 6 }, { seat: 1, piece: "pawn", x: 3, y: 5 }]);
    expect(attackableEnemies(s, s.units[0]!)).toEqual([]);
  });
  it("룩의 공격은 4칸까지", () => {
    const s = board([{ seat: 0, piece: "rook", x: 0, y: 7 }, { seat: 1, piece: "pawn", x: 4, y: 7 }, { seat: 1, piece: "pawn", x: 0, y: 2 }]);
    expect(attackableEnemies(s, s.units[0]!).map((u) => u.id)).toEqual([s.units[1]!.id]); // 가로 4칸은 닿고 세로 5칸은 안 닿는다
  });
  it("비숍은 대각선만, 나이트는 L자 위치만", () => {
    const b = board([{ seat: 0, piece: "bishop", x: 3, y: 4 }, { seat: 1, piece: "pawn", x: 5, y: 2 }, { seat: 1, piece: "pawn", x: 3, y: 2 }]);
    expect(attackableEnemies(b, b.units[0]!).map((u) => u.id)).toEqual([b.units[1]!.id]);
    const n = board([{ seat: 0, piece: "knight", x: 3, y: 4 }, { seat: 1, piece: "pawn", x: 5, y: 3 }, { seat: 1, piece: "pawn", x: 3, y: 3 }]);
    expect(attackableEnemies(n, n.units[0]!).map((u) => u.id)).toEqual([n.units[1]!.id]);
  });
  it("폰은 앞과 앞쪽 대각선만 (뒤나 옆은 안 된다)", () => {
    const s = board([
      { seat: 0, piece: "pawn", x: 3, y: 5 },
      { seat: 1, piece: "pawn", x: 3, y: 4 }, { seat: 1, piece: "pawn", x: 2, y: 4 }, { seat: 1, piece: "pawn", x: 4, y: 4 },
      { seat: 1, piece: "pawn", x: 3, y: 6 }, { seat: 1, piece: "pawn", x: 2, y: 5 },
    ]);
    expect(attackableEnemies(s, s.units[0]!)).toHaveLength(3);
  });
  it("인접한 빈 칸 찾기는 판 밖과 기물을 피한다", () => {
    const s = board([{ seat: 0, piece: "king", x: 0, y: 7 }, { seat: 1, piece: "pawn", x: 1, y: 7 }]);
    const spot = freeAdjacent(s, 0, 7, 0)!;
    expect(chebyshev(spot, { x: 0, y: 7 })).toBe(1);
    expect(spot.x >= 0 && spot.y <= 7).toBe(true);
  });
});

describe("전투 진행", () => {
  const duel = (a: string, b: string): [Placement[], Placement[]] => [
    [{ defId: a, star: 1, col: 3, row: 0 }],
    [{ defId: b, star: 1, col: 4, row: 0 }],
  ];

  it("같은 배치는 언제나 같은 결과다 (결정적)", () => {
    const rng = makeRng(11);
    const boards: [Placement[], Placement[]] = [placeTeam(randomTeam(rng, 14, 6)), placeTeam(randomTeam(rng, 14, 6))];
    const a = runCombat(boards);
    const b = runCombat(boards);
    expect(b).toEqual(a);
  });

  it("모든 전투가 정해진 박자 안에 끝난다 (돌발 사망 덕분)", () => {
    const rng = makeRng(3);
    for (let i = 0; i < 60; i++) {
      const r = runCombat([placeTeam(randomTeam(rng, 14, 6)), placeTeam(randomTeam(rng, 14, 6))]);
      expect(r.beats).toBeLessThanOrEqual(MAX_BEATS);
    }
  });

  it("서로 닿을 수 없어도 돌발 사망으로 끝난다", () => {
    // 비숍끼리 서로 다른 색 칸에 있어 공격이 닿지 않는다
    const state = createCombat([[{ defId: "lappus", star: 1, col: 0, row: 3 }], [{ defId: "lappus", star: 1, col: 1, row: 3 }]]);
    while (!state.finished) stepCombat(state);
    expect(state.beat).toBeGreaterThanOrEqual(SUDDEN_DEATH_BEAT);
    expect(state.events.some((e) => e.type === "suddenDeath")).toBe(true);
  });

  it("두 팀이 완전히 같은 배치면 거의 비긴다 (좌우·자리 대칭이라 어느 쪽도 유리하지 않다)", () => {
    const rng = makeRng(5);
    let decided = 0;
    let seat0 = 0;
    for (let i = 0; i < 80; i++) {
      const t = placeTeam(randomTeam(rng, 14, 6));
      const r = runCombat([t, t]);
      if (r.winner !== null) {
        decided++;
        if (r.winner === 0) seat0++;
      }
    }
    expect(decided).toBeLessThan(30); // 대부분 무승부
    expect(Math.abs(seat0 - (decided - seat0))).toBeLessThanOrEqual(Math.max(8, decided * 0.5));
  });

  it("체력이 높고 공격이 센 쪽이 이긴다", () => {
    const r = runCombat([[{ defId: "ancient-lord", star: 1, col: 3, row: 0 }], [{ defId: "nut-wolf", star: 1, col: 4, row: 0 }]]);
    expect(r.winner).toBe(0);
    expect(r.survivors).toEqual([1, 0]);
  });

  it("★2는 능력치가 높다", () => {
    const state = createCombat([[{ defId: "dwargon", star: 2, col: 3, row: 0 }], [{ defId: "dwargon", star: 1, col: 4, row: 0 }]]);
    const [a, b] = state.units;
    expect(a!.maxHp / b!.maxHp).toBeCloseTo(STAR2_STATS, 5);
    expect(runCombat([[{ defId: "dwargon", star: 2, col: 3, row: 0 }], [{ defId: "dwargon", star: 1, col: 4, row: 0 }]]).winner).toBe(0);
  });

  it("폰이 상대 끝줄에 닿으면 퀸으로 승급한다", () => {
    const state = createCombat([[], []]);
    const pawn = createUnit(state, { defId: "nut-wolf", seat: 0, star: 1, x: 3, y: 1, hp: 500, maxHp: 500, atk: 50, energyMax: null, piece: "pawn", summon: false });
    // 상대는 멀리 구석에 둔다
    createUnit(state, { defId: "relic", seat: 1, star: 1, x: 7, y: 0, hp: 5000, maxHp: 5000, atk: 1, energyMax: null, piece: "pawn", summon: false });
    stepCombat(state);
    expect(pawn.y).toBe(0);
    expect(pawn.piece).toBe("queen");
    expect(pawn.promoted).toBe(true);
    expect(state.events.some((e) => e.type === "promote")).toBe(true);
  });

  it("에너지가 가득 차면 능력이 자동 발동한다", () => {
    const state = createCombat([[{ defId: "toka-loga", star: 1, col: 3, row: 3 }], [{ defId: "ancient-lord", star: 1, col: 3, row: 3 }]]);
    const caster = state.units[0]!;
    caster.energy = caster.energyMax!;
    stepCombat(state);
    expect(state.events.some((e) => e.type === "ability" && e.unitId === caster.id)).toBe(true);
    expect(caster.energy).toBeLessThan(caster.energyMax!);
  });
});

describe("캐릭터 20명", () => {
  it("26명(데보이트 계보 2명, 설정 v2의 4명 추가)이고 id와 이름이 겹치지 않으며 가격 분포가 설계와 같다", () => {
    expect(ROSTER).toHaveLength(26);
    expect(new Set(ROSTER.map((d) => d.id)).size).toBe(26);
    expect(new Set(ROSTER.map((d) => d.nameKo)).size).toBe(26);
    const count = (cost: number) => ROSTER.filter((d) => d.cost === cost).length;
    expect([count(1), count(2), count(3), count(4)]).toEqual([9, 5, 6, 6]);
    const pieces = (p: Piece) => ROSTER.filter((d) => d.piece === p).length;
    expect([pieces("king"), pieces("queen"), pieces("rook"), pieces("bishop"), pieces("knight"), pieces("pawn")]).toEqual([3, 4, 4, 5, 4, 6]);
    // 상점에 나오는 캐릭터는 진화 전용 3명을 뺀 19명
    expect(ROSTER.filter((d) => d.evolveOnly).map((d) => d.id).sort()).toEqual(["dedokion", "dwargon", "toka-loga"]);
  });

  it("가격이 비쌀수록 평균 능력치가 높다", () => {
    const avg = (cost: number) => {
      const list = ROSTER.filter((d) => d.cost === cost);
      return list.reduce((s, d) => s + d.hp * d.atk, 0) / list.length;
    };
    expect(avg(1)).toBeLessThan(avg(2));
    expect(avg(2)).toBeLessThan(avg(3));
    expect(avg(3)).toBeLessThan(avg(4));
  });

  it("20명 모두의 능력이 에러 없이 발동한다 (6대6 전투를 끝까지)", () => {
    for (const def of ROSTER) {
      const others = ROSTER.filter((d) => d.id !== def.id).slice(0, 5);
      const team = [def, ...others].map((d) => ({ defId: d.id, star: 1 as const }));
      const state = createCombat([placeTeam({ units: team }), placeTeam({ units: team.slice().reverse() })]);
      for (const u of state.units) if (u.energyMax !== null) u.energy = u.energyMax - 1; // 곧바로 능력이 나가게
      let guard = 0;
      while (!state.finished && guard++ < 60) stepCombat(state);
      expect(state.finished, def.id).toBe(true);
      expect(state.events.some((e) => e.type === "ability"), def.id).toBe(true);
    }
  });

  it("소환수와 승급한 폰은 살아남은 기물 수에 소환수를 세지 않는다", () => {
    const state = createCombat([[{ defId: "nut-wolf", star: 1, col: 3, row: 0 }], [{ defId: "ancient-lord", star: 1, col: 4, row: 0 }]]);
    const wolf = state.units[0]!;
    wolf.energy = wolf.energyMax!;
    stepCombat(state);
    expect(state.units.some((u) => u.summon)).toBe(true);
    while (!state.finished) stepCombat(state);
    expect(state.survivors[0]).toBe(0);
  });
});

describe("기물 시너지", () => {
  it("같은 기물 2명이면 켜지고, 3명이면 2단계가 된다 (폰은 2명/4명)", () => {
    expect(activeSynergies(["ancient-lord", "richmond"])).toEqual(["king-1"]);
    expect(activeSynergies(["ancient-lord", "richmond", "marshal-berg"])).toEqual(["king-2"]);
    expect(activeSynergies(["nut-wolf", "xenosaurs", "relic"])).toEqual(["pawn-1"]);
    expect(activeSynergies(["nut-wolf", "xenosaurs", "relic", "mossling"])).toEqual(["pawn-2"]);
    expect(activeSynergies(["ancient-lord", "dwargon"])).toEqual([]);
  });
  it("같은 캐릭터는 몇 장이든 한 명으로 센다", () => {
    expect(activeSynergies(["richmond", "richmond", "richmond"])).toEqual([]);
  });
  it("효과가 합쳐진다", () => {
    const b = combineBonuses(["rook-1", "queen-1", "king-1"]);
    expect(b.dmgTaken).toBeCloseTo(0.9, 6);
    expect(b.abilityDamage).toBeCloseTo(1.15, 6);
    expect(b.energyGain).toBeCloseTo(1.2, 6);
  });
  it("룩 시너지는 실제로 받는 피해를 줄인다", () => {
    const state = createCombat([[{ defId: "dwargon", star: 1, col: 3, row: 0 }, { defId: "raufaino", star: 1, col: 4, row: 0 }], [{ defId: "ancient-lord", star: 1, col: 3, row: 0 }]]);
    expect(state.synergies[0]).toEqual(["rook-1"]);
    expect(state.bonuses[0].dmgTaken).toBeCloseTo(0.9, 6);
    expect(state.bonuses[1].dmgTaken).toBe(1);
  });
  it("나이트 시너지: 나이트가 처음 도약하면 5박자 동안 나이트 공격이 오른다", () => {
    const state = createCombat([[{ defId: "bwtkan-jaws", star: 1, col: 3, row: 3 }, { defId: "ankio", star: 1, col: 4, row: 3 }], [{ defId: "ancient-lord", star: 1, col: 3, row: 3 }]]);
    expect(state.knightBoostUntil).toEqual([0, 0]);
    stepCombat(state); // 나이트가 적에게 다가간다(도약)
    expect(state.knightBoostUntil[0]).toBeGreaterThan(0);
  });
});

describe("밸런스 측정 도구", () => {
  it("같은 시드면 같은 결과, 자리를 바꿔 싸우므로 seat 쏠림이 작다", () => {
    const options = { matches: 120, budget: 14, cap: 6, seed: 7 };
    const a = runBalance(options);
    const b = runBalance(options);
    expect(b).toEqual(a);
    expect(a.matches).toBe(240);
    expect(a.seat0WinRate).toBeGreaterThan(0.4);
    expect(a.seat0WinRate).toBeLessThan(0.6);
    expect(a.units).toHaveLength(26);
  });
  it("팀은 예산과 기물 수를 넘지 않고 겹치지 않게 배치된다", () => {
    const rng = makeRng(1);
    for (let i = 0; i < 50; i++) {
      const team = randomTeam(rng, 14, 6);
      expect(team.units.length).toBeLessThanOrEqual(6);
      expect(team.units.reduce((s, u) => s + unitDef(u.defId)!.cost, 0)).toBeLessThanOrEqual(14);
      const placed = placeTeam(team);
      expect(new Set(placed.map((p) => `${p.col},${p.row}`)).size).toBe(placed.length);
      expect(placed.every((p) => p.col >= 0 && p.col < 8 && p.row >= 0 && p.row < 4)).toBe(true);
    }
  });
});
