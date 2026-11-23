import { describe, expect, it } from "vitest";
import {
  BENCH_SIZE, LITE_IDS, MAX_ROUNDS, SHOP_SIZE, START_GOLD, START_HP, buy, concedeGame, createChessGame, deploy, deployCap, finishRound, interest,
  reroll, rerollCost, runRoundCombat, sell, setDone, shopOdds, startRound, toBench, bothDone, finalRoster,
} from "../src/chess/game";
import type { ChessGame, ChessPlayer } from "../src/chess/game";
import { addBotIfNeeded, createRoom, joinRoom, setReady } from "../src/room-state";
import { EVOLVED_FROM, POOL_COPIES, ROSTER, unitDef } from "../src/chess/roster";

const newGame = (seed = 1): ChessGame => {
  const g = createChessGame(seed);
  startRound(g);
  return g;
};

/** 풀에 남은 것 + 상점에 나온 것 + 가진 것(★2는 3장)의 합이 처음 복사본 수와 같아야 한다. */
function conserved(g: ChessGame): boolean {
  // 진화로만 얻는 캐릭터는 풀에 없고, 뿌리(데보이트) 몇 장으로 센다.
  for (const def of ROSTER.filter((d) => !d.evolveOnly)) {
    let total = g.pool[def.id] ?? 0;
    for (const p of g.players) {
      total += p.shop.filter((id) => id === def.id).length;
      for (const u of [...p.board, ...p.bench.filter((x) => x !== null)]) {
        const evolved = EVOLVED_FROM[u!.defId];
        if (u!.defId === def.id) total += u!.star === 2 ? 3 : 1;
        else if (evolved?.root === def.id) total += evolved.copies * (u!.star === 2 ? 3 : 1);
      }
    }
    if (total !== POOL_COPIES[def.cost]) return false;
  }
  return true;
}

const give = (g: ChessGame, seat: 0 | 1, defId: string, n = 1) => {
  // 상점 첫 칸을 원하는 캐릭터로 바꿔 놓고(풀에서 빼서) 산다. 골드는 넉넉히 준다.
  const p = g.players[seat];
  for (let i = 0; i < n; i++) {
    p.gold = 99;
    const old = p.shop[0];
    if (old) g.pool[old] = (g.pool[old] ?? 0) + 1;
    p.shop[0] = defId;
    g.pool[defId] = (g.pool[defId] ?? 0) - 1;
    expect(buy(g, seat, 0)).toEqual({ ok: true });
  }
};

describe("시작과 라운드", () => {
  it("라운드 1: 골드 5 + 기본 5 = 10, 체력 30, 상점이 가득 찬다", () => {
    const g = newGame();
    expect(g.round).toBe(1);
    for (const p of g.players) {
      expect(p.gold).toBe(START_GOLD + 5);
      expect(p.hp).toBe(START_HP);
      expect(p.shop.filter(Boolean)).toHaveLength(SHOP_SIZE);
      expect(p.bench).toHaveLength(BENCH_SIZE);
    }
    expect(conserved(g)).toBe(true);
  });

  it("이자: 10골드마다 1, 최대 3", () => {
    expect([0, 9, 10, 25, 30, 99].map(interest)).toEqual([0, 0, 1, 2, 3, 3]);
    const g = newGame();
    g.players[0].gold = 30;
    startRound(g);
    expect(g.players[0].gold).toBe(30 + 5 + 3);
  });

  it("판에 올릴 수 있는 기물 수: 1라운드 3, 이후 +1, 최대 7", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(deployCap)).toEqual([3, 4, 5, 6, 7, 7, 7, 7]);
  });

  it("상점 확률은 항상 합이 100이고 라운드가 갈수록 비싼 캐릭터가 늘어난다", () => {
    for (let r = 1; r <= MAX_ROUNDS; r++) expect(shopOdds(r).reduce((a, b) => a + b, 0)).toBe(100);
    expect(shopOdds(1)[3]).toBe(0);
    expect(shopOdds(8)[3]).toBeGreaterThan(shopOdds(5)[3]);
    expect(shopOdds(8)[0]).toBeLessThan(shopOdds(1)[0]);
  });

  it("1~2라운드 상점에는 3·4골드 캐릭터가 나오지 않는다", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const g = newGame(seed);
      for (const p of g.players) for (const id of p.shop) expect(unitDef(id!)!.cost).toBeLessThanOrEqual(2);
    }
  });

  it("같은 시드면 같은 상점 (결정적)", () => {
    expect(newGame(9).players[0].shop).toEqual(newGame(9).players[0].shop);
    expect(newGame(9).players[0].shop).not.toEqual(newGame(10).players[0].shop);
  });
});

describe("사기, 팔기, 새로고침", () => {
  it("사면 골드가 줄고 상점 칸이 비며 대기석에 들어간다", () => {
    const g = newGame();
    const p = g.players[0];
    const defId = p.shop[2]!;
    const cost = unitDef(defId)!.cost;
    expect(buy(g, 0, 2)).toEqual({ ok: true });
    expect(p.gold).toBe(10 - cost);
    expect(p.shop[2]).toBeNull();
    expect(p.bench[0]).toMatchObject({ defId, star: 1 });
    expect(buy(g, 0, 2)).toEqual({ ok: false, code: "shop_empty" });
    expect(conserved(g)).toBe(true);
  });

  it("골드가 모자라거나 칸이 잘못되면 거절한다 (아무것도 바뀌지 않는다)", () => {
    const g = newGame();
    g.players[0].gold = 0;
    expect(buy(g, 0, 0)).toEqual({ ok: false, code: "not_enough_gold" });
    expect(buy(g, 0, 9)).toEqual({ ok: false, code: "invalid_slot" });
    expect(buy(g, 0, -1)).toEqual({ ok: false, code: "invalid_slot" });
    expect(g.players[0].bench.every((u) => u === null)).toBe(true);
  });

  it("대기석이 가득 차면 살 수 없다", () => {
    const g = newGame();
    const p = g.players[0];
    p.gold = 99;
    for (let i = 0; i < BENCH_SIZE; i++) p.bench[i] = { uid: `x${i}`, defId: ROSTER[i]!.id, star: 1 };
    p.shop[0] = ROSTER[10]!.id;
    expect(buy(g, 0, 0)).toEqual({ ok: false, code: "bench_full" });
  });

  it("같은 캐릭터 3장이 모이면 ★2 하나로 합쳐진다", () => {
    const g = newGame();
    give(g, 0, "nut-wolf", 3);
    const units = g.players[0].bench.filter((u) => u);
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({ defId: "nut-wolf", star: 2 });
    expect(conserved(g)).toBe(true);
  });

  it("판 위의 기물이 있으면 ★2가 그 자리에 생긴다", () => {
    const g = newGame();
    give(g, 0, "relic", 1);
    const first = g.players[0].bench.find((u) => u)!;
    expect(deploy(g, 0, first.uid, 2, 1)).toEqual({ ok: true });
    give(g, 0, "relic", 2);
    expect(g.players[0].board).toHaveLength(1);
    expect(g.players[0].board[0]).toMatchObject({ defId: "relic", star: 2, col: 2, row: 1 });
    expect(g.players[0].bench.every((u) => u === null)).toBe(true);
    expect(conserved(g)).toBe(true);
  });

  it("대기석이 가득 차 있어도 합쳐지는 캐릭터는 살 수 있다", () => {
    const g = newGame();
    const p = g.players[0];
    give(g, 0, "relic", 2); // 대기석 2칸
    for (let i = 2; i < BENCH_SIZE; i++) {
      p.bench[i] = { uid: `f${i}`, defId: ROSTER[(i + 5) % 20]!.id, star: 1 };
      g.pool[ROSTER[(i + 5) % 20]!.id] = (g.pool[ROSTER[(i + 5) % 20]!.id] ?? 0) - 1;
    }
    give(g, 0, "relic", 1);
    expect(p.bench.filter((u) => u?.defId === "relic" && u.star === 2)).toHaveLength(1);
    expect(conserved(g)).toBe(true);
  });

  it("★2는 더 합쳐지지 않는다 (★3 없음)", () => {
    const g = newGame();
    give(g, 0, "nut-wolf", 6);
    const stars = g.players[0].bench.filter((u) => u?.defId === "nut-wolf").map((u) => u!.star);
    expect(stars.sort()).toEqual([2, 2]);
  });

  it("팔면 산 값을 돌려받고 복사본이 풀로 돌아간다 (★2는 3장 값)", () => {
    const g = newGame();
    const p = g.players[0];
    give(g, 0, "ankio", 1); // 4골드
    const before = g.pool["ankio"]!;
    p.gold = 0;
    expect(sell(g, 0, p.bench.find((u) => u)!.uid)).toEqual({ ok: true });
    expect(p.gold).toBe(4);
    expect(g.pool["ankio"]).toBe(before + 1);

    give(g, 0, "nut-wolf", 3);
    p.gold = 0;
    expect(sell(g, 0, p.bench.find((u) => u)!.uid)).toEqual({ ok: true });
    expect(p.gold).toBe(3); // 1골드 x 3장
    expect(conserved(g)).toBe(true);
    expect(sell(g, 0, "없는-uid")).toEqual({ ok: false, code: "unit_not_found" });
  });

  it("새로고침은 2골드, 리치몬드가 판에 있으면 1골드, 안 쓴 칸은 풀로 돌아간다", () => {
    const g = newGame();
    const p = g.players[0];
    expect(rerollCost(p)).toBe(2);
    expect(reroll(g, 0)).toEqual({ ok: true });
    expect(p.gold).toBe(8);
    expect(conserved(g)).toBe(true);
    give(g, 0, "richmond", 1);
    deploy(g, 0, p.bench.find((u) => u)!.uid, 3, 1);
    expect(rerollCost(p)).toBe(1);
    p.gold = 0;
    expect(reroll(g, 0)).toEqual({ ok: false, code: "not_enough_gold" });
  });

  it("여러 번 사고 팔고 새로고침해도 복사본 수는 변하지 않는다 (임의의 행동 400번)", () => {
    const g = newGame(3);
    let rng = 12345;
    const next = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 400; i++) {
      const seat = next() < 0.5 ? 0 : 1;
      const p: ChessPlayer = g.players[seat];
      p.gold = Math.max(p.gold, 4);
      const roll = next();
      if (roll < 0.45) buy(g, seat, Math.floor(next() * 5));
      else if (roll < 0.6) reroll(g, seat);
      else if (roll < 0.75) {
        const all = [...p.board, ...p.bench.filter((u) => u)];
        if (all.length) sell(g, seat, all[Math.floor(next() * all.length)]!.uid);
      } else if (roll < 0.9) {
        const bench = p.bench.filter((u) => u);
        if (bench.length) deploy(g, seat, bench[0]!.uid, Math.floor(next() * 8), Math.floor(next() * 4));
      } else if (p.board.length) toBench(g, seat, p.board[0]!.uid);
      if (next() < 0.03) startRound(g);
      expect(conserved(g)).toBe(true);
    }
  });
});

describe("판에 놓기", () => {
  it("대기석에서 판으로, 판 위에서 칸 사이로 옮기고, 있는 칸이면 자리를 바꾼다", () => {
    const g = newGame();
    give(g, 0, "relic");
    give(g, 0, "lappus");
    const [a, b] = g.players[0].bench.filter((u) => u) as Array<{ uid: string }>;
    expect(deploy(g, 0, a!.uid, 3, 0)).toEqual({ ok: true });
    expect(deploy(g, 0, b!.uid, 3, 0)).toEqual({ ok: true }); // 같은 칸: b가 들어가고 a는 대기석으로
    expect(g.players[0].board.map((u) => u.uid)).toEqual([b!.uid]);
    expect(g.players[0].bench.some((u) => u?.uid === a!.uid)).toBe(true);
    expect(deploy(g, 0, b!.uid, 5, 2)).toEqual({ ok: true });
    expect(g.players[0].board[0]).toMatchObject({ col: 5, row: 2 });
  });

  it("판 위의 두 기물은 자리를 바꾼다", () => {
    const g = newGame();
    give(g, 0, "relic");
    give(g, 0, "lappus");
    const [a, b] = g.players[0].bench.filter((u) => u) as Array<{ uid: string }>;
    deploy(g, 0, a!.uid, 1, 0);
    deploy(g, 0, b!.uid, 2, 0);
    deploy(g, 0, a!.uid, 2, 0);
    const byUid = Object.fromEntries(g.players[0].board.map((u) => [u.uid, `${u.col},${u.row}`]));
    expect(byUid[a!.uid]).toBe("2,0");
    expect(byUid[b!.uid]).toBe("1,0");
  });

  it("올릴 수 있는 수(1라운드 3)를 넘으면 거절하고, 잘못된 칸이나 없는 기물도 거절한다", () => {
    const g = newGame();
    const p = g.players[0];
    p.gold = 99;
    for (let i = 0; i < 4; i++) {
      p.bench[i] = { uid: `z${i}`, defId: ROSTER[i]!.id, star: 1 };
    }
    for (let i = 0; i < 3; i++) expect(deploy(g, 0, `z${i}`, i, 0)).toEqual({ ok: true });
    expect(deploy(g, 0, "z3", 5, 0)).toEqual({ ok: false, code: "deploy_full" });
    expect(deploy(g, 0, "z3", 8, 0)).toEqual({ ok: false, code: "invalid_cell" });
    expect(deploy(g, 0, "z3", 0, 4)).toEqual({ ok: false, code: "invalid_cell" });
    expect(deploy(g, 0, "없음", 0, 1)).toEqual({ ok: false, code: "unit_not_found" });
    expect(toBench(g, 0, "z0")).toEqual({ ok: true });
    expect(toBench(g, 0, "z0")).toEqual({ ok: false, code: "unit_not_found" });
  });

  it("상대의 기물은 내 uid로 만질 수 없다", () => {
    const g = newGame();
    give(g, 1, "relic");
    const theirs = g.players[1].bench.find((u) => u)!;
    expect(deploy(g, 0, theirs.uid, 0, 0)).toEqual({ ok: false, code: "unit_not_found" });
    expect(sell(g, 0, theirs.uid)).toEqual({ ok: false, code: "unit_not_found" });
  });
});

describe("전투와 라운드 결과", () => {
  function armed(): ChessGame {
    const g = newGame();
    give(g, 0, "ancient-lord");
    give(g, 1, "nut-wolf");
    deploy(g, 0, g.players[0].bench.find((u) => u)!.uid, 3, 0);
    deploy(g, 1, g.players[1].bench.find((u) => u)!.uid, 4, 0);
    return g;
  }

  it("진 쪽은 `이긴 쪽의 살아남은 기물 수 x 2 + 라운드`만큼 체력을 잃는다", () => {
    const g = armed();
    const combat = runRoundCombat(g);
    expect(combat.result.winner).toBe(0);
    expect(combat.damage).toEqual([0, 1 * 2 + 1]);
    expect(g.players[1].hp).toBe(START_HP); // 전투를 계산했을 뿐, 체력은 전투 단계가 끝나야 깎는다
    finishRound(g);
    expect(g.players[1].hp).toBe(START_HP - 3);
    expect(g.roundWins).toEqual([1, 0]);
    expect(g.lastRound).toMatchObject({ round: 1, winner: 0 });
    expect(g.over).toBeNull();
  });

  it("전투 기록에 프레임과 이벤트가 담긴다", () => {
    const g = armed();
    const combat = runRoundCombat(g);
    expect(combat.frames.length).toBe(combat.result.beats + 1);
    expect(combat.units).toHaveLength(2);
    expect(combat.frames[0]![0]).toHaveLength(6);
    expect(combat.events.some((e) => e[1] === "attack")).toBe(true);
    expect(combat.boards[0]).toHaveLength(1);
  });

  it("빈 판끼리는 비기고 아무도 체력을 잃지 않는다", () => {
    const g = newGame();
    const combat = runRoundCombat(g);
    expect(combat.result.winner).toBeNull();
    finishRound(g);
    expect(g.players.map((p) => p.hp)).toEqual([START_HP, START_HP]);
  });

  it("체력이 0 이하가 되면 게임이 끝난다", () => {
    const g = armed();
    g.players[1].hp = 3;
    runRoundCombat(g);
    finishRound(g);
    expect(g.over).toEqual({ winner: 0, reason: "hp" });
  });

  it("8라운드가 끝나면 체력이 높은 쪽이 이긴다", () => {
    const g = armed();
    g.round = MAX_ROUNDS;
    runRoundCombat(g);
    finishRound(g);
    expect(g.over).toEqual({ winner: 0, reason: "rounds" });
  });

  it("체력과 라운드 승수까지 같으면 무승부", () => {
    const g = newGame();
    g.round = MAX_ROUNDS;
    runRoundCombat(g);
    finishRound(g);
    expect(g.over).toEqual({ winner: null, reason: "rounds" });
  });

  it("항복과 기권패: 상대가 바로 이긴다 (이미 끝난 게임은 바꾸지 않는다)", () => {
    const g = newGame();
    concedeGame(g, 0, "surrender");
    expect(g.over).toEqual({ winner: 1, reason: "surrender" });
    concedeGame(g, 1, "forfeit");
    expect(g.over).toEqual({ winner: 1, reason: "surrender" });
  });

  it("준비 끝: 둘 다 끝내야 바로 전투로 간다", () => {
    const g = newGame();
    expect(bothDone(g)).toBe(false);
    setDone(g, 0);
    expect(bothDone(g)).toBe(false);
    setDone(g, 1);
    expect(bothDone(g)).toBe(true);
    startRound(g);
    expect(bothDone(g)).toBe(false); // 새 라운드에서는 다시 준비
  });

  it("전적에 남길 캐릭터 목록은 중복이 없다", () => {
    const g = armed();
    give(g, 0, "relic", 2);
    expect(finalRoster(g.players[0]).sort()).toEqual(["ancient-lord", "relic"]);
  });
});

describe("입문 모드", () => {
  it("풀과 상점에 쉬운 캐릭터(1~2골드 11명)만 나온다", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const g = createChessGame(seed, true);
      expect(Object.keys(g.pool).sort()).toEqual([...LITE_IDS].sort());
      for (let r = 1; r <= MAX_ROUNDS; r++) {
        startRound(g);
        for (const p of g.players) for (const id of p.shop) expect(LITE_IDS).toContain(id);
      }
    }
  });

  it("확률은 3·4골드가 0이고 합이 100", () => {
    for (let r = 1; r <= MAX_ROUNDS; r++) {
      const odds = shopOdds(r, true);
      expect(odds[2] + odds[3]).toBe(0);
      expect(odds.reduce((a, b) => a + b, 0)).toBe(100);
    }
  });

  it("테스트 대전 방은 입문 모드, 일반 방은 전체 캐릭터", () => {
    const lite = chessRoomLite(true);
    const full = chessRoomLite(false);
    expect(lite.chess!.lite).toBe(true);
    expect(full.chess!.lite).toBe(false);
  });
});

function chessRoomLite(testMatch: boolean) {
  let n = 0;
  const state = createRoom("ADMN", 0, testMatch, "chess");
  const ids: string[] = [];
  for (const name of testMatch ? ["에드"] : ["에드", "상대"]) {
    const r = joinRoom(state, { name }, 0, () => `id${++n}`);
    if (!r.ok) throw new Error("join");
    ids.push(r.player.id);
  }
  if (testMatch) addBotIfNeeded(state);
  let s = 7;
  const rng = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  for (const p of state.players) setReady(state, p.id, true, 0, 1, rng);
  return state;
}
