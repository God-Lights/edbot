// 데보이트 계보: 데보이트 3장 -> 데도키온, 데도키온 + E 코드 + 재료 -> 토가로가 / 드워곤, 계보 시너지 "근원".
import { describe, expect, it } from "vitest";
import { buy, combineItems, createChessGame, equip, finishRound, runRoundCombat, sell, startRound } from "../src/chess/game";
import type { ChessGame, OwnedUnit } from "../src/chess/game";
import { EVOLUTION, ROSTER, unitDef } from "../src/chess/roster";
import { createCombat, recordCombat } from "../src/chess/sim";
import { castAbility, onKill } from "../src/chess/abilities";
import { runChessBot } from "../src/bot";
import { createRoom, joinRoom, setReady } from "../src/room-state";
import { activeSynergies, combineBonuses } from "../src/chess/synergy";
import { MATERIALS } from "../src/chess/weapons";
import { fuseMaterials } from "../src/chess/crafting";
import { toChessSnapshot } from "../src/chess/snapshot";

const newGame = (seed = 3): ChessGame => {
  const g = createChessGame(seed);
  startRound(g);
  return g;
};

const give = (g: ChessGame, defId: string, n = 1) => {
  const p = g.players[0];
  for (let i = 0; i < n; i++) {
    p.gold = 99;
    const old = p.shop[0];
    if (old) g.pool[old] = (g.pool[old] ?? 0) + 1;
    p.shop[0] = defId;
    g.pool[defId] = (g.pool[defId] ?? 0) - 1;
    expect(buy(g, 0, 0)).toEqual({ ok: true });
  }
};

const owned = (g: ChessGame): OwnedUnit[] => [...g.players[0].board, ...g.players[0].bench.filter((u): u is OwnedUnit => u !== null)];

/** 데도키온 하나를 판에 올려 둔다 */
function dedokionOnBoard(g: ChessGame): OwnedUnit {
  give(g, "devoit", 3);
  const unit = owned(g).find((u) => u.defId === "dedokion")!;
  const p = g.players[0];
  p.bench = p.bench.map((u) => (u?.uid === unit.uid ? null : u));
  p.board.push({ ...unit, col: 3, row: 0 });
  return p.board[p.board.length - 1]!;
}

/** 전투를 한 번 치르고 다음 라운드를 시작한다 */
function playRound(g: ChessGame): void {
  runRoundCombat(g);
  finishRound(g);
  startRound(g);
}

describe("상점 풀", () => {
  it("데도키온·토가로가·드워곤은 상점에 나오지 않고, 데보이트는 나온다", () => {
    const g = createChessGame(1);
    for (const id of ["dedokion", "toka-loga", "dwargon"]) expect(g.pool[id], id).toBeUndefined();
    expect(g.pool["devoit"]).toBeGreaterThan(0);
    for (let seed = 1; seed < 40; seed++) {
      const game = newGame(seed);
      for (let r = 0; r < 6; r++) {
        for (const p of game.players) for (const id of p.shop) expect(unitDef(id ?? "devoit")?.evolveOnly ?? false, String(id)).toBe(false);
        game.round = 6; // 비싼 캐릭터도 나오게
        startRound(game);
      }
    }
  });

  it("이름은 토가로가 (아이디는 그대로)", () => {
    expect(unitDef("toka-loga")?.nameKo).toBe("토가로가");
  });
});

describe("데보이트 -> 데도키온", () => {
  it("데보이트 3장이 모이면 ★2 대신 데도키온 ★1이 된다", () => {
    const g = newGame();
    give(g, "devoit", 3);
    const units = owned(g);
    expect(units.filter((u) => u.defId === "devoit")).toHaveLength(0);
    expect(units.filter((u) => u.defId === "dedokion").map((u) => u.star)).toEqual([1]);
  });

  it("데도키온을 팔면 데보이트 3장이 풀로 돌아간다", () => {
    const g = newGame();
    const before = g.pool["devoit"]!;
    give(g, "devoit", 3);
    const unit = owned(g).find((u) => u.defId === "dedokion")!;
    g.players[0].gold = 0;
    expect(sell(g, 0, unit.uid)).toEqual({ ok: true });
    expect(g.players[0].gold).toBe(3);
    expect(g.pool["devoit"]).toBe(before);
    expect(g.pool["dedokion"]).toBeUndefined();
  });
});

describe("진화 재료", () => {
  it("E 코드와 재상트는 정해진 조합으로만 만든다", () => {
    expect(fuseMaterials("bit", "edgem")).toBe("xe-code");
    expect(fuseMaterials("redocean", "bit")).toBe("ve-code");
    expect(fuseMaterials("titanium", "clawstone")).toBe("zesent");
    const g = newGame();
    const p = g.players[0];
    p.materials = { bit: 1, edgem: 1 };
    expect(combineItems(g, 0, { kind: "material", id: "bit" }, { kind: "material", id: "edgem" })).toEqual({ ok: true });
    expect(p.materials["xe-code"]).toBe(1);
  });

  it("진화 재료는 자원 칸과 광물 시장에 나오지 않는다", () => {
    const special = new Set(MATERIALS.filter((m) => m.special).map((m) => m.id));
    for (let seed = 1; seed < 200; seed++) {
      const g = newGame(seed);
      for (const t of g.tiles) expect(special.has(t.material), t.material).toBe(false);
      for (const m of g.market) expect(special.has(m), m).toBe(false);
    }
  });
});

describe("데도키온 -> 토가로가 / 드워곤", () => {
  it("E 코드 없이 싸우면 A-C 코어만 오른다", () => {
    const g = newGame();
    dedokionOnBoard(g);
    playRound(g);
    expect(owned(g).find((u) => u.defId === "dedokion")!.evo).toEqual({ engine: 0, core: EVOLUTION.corePerCombat });
  });

  it("X-E E 코드 + 2전투 + 고대의 파편 2개 -> 다음 라운드 시작에 토가로가", () => {
    const g = newGame();
    const unit = dedokionOnBoard(g);
    const p = g.players[0];
    p.weapons["e-code-xe"] = 1;
    expect(equip(g, 0, "e-code-xe", unit.uid)).toEqual({ ok: true });
    playRound(g);
    expect(owned(g).find((u) => u.uid === unit.uid)!.evo).toEqual({ engine: 9.4, core: 25 });
    // 재료가 모자라면 다 채워도 진화하지 않는다
    playRound(g);
    expect(owned(g).find((u) => u.uid === unit.uid)!.defId).toBe("dedokion");
    expect(owned(g).find((u) => u.uid === unit.uid)!.evo).toEqual({ engine: 18.8, core: 50 });
    p.materials["ancient-shard"] = 3;
    startRound(g);
    const evolved = owned(g).find((u) => u.uid === unit.uid)!;
    expect(evolved.defId).toBe("toka-loga");
    expect(evolved.weapon).toBeUndefined(); // E 코드는 진화에 쓰인다
    expect(evolved.evo).toBeUndefined();
    expect(p.materials["ancient-shard"]).toBe(1);
    expect(p.evolved).toEqual([{ uid: unit.uid, from: "dedokion", to: "toka-loga" }]);
    expect(toChessSnapshot(g, 0, false).me!.evolved).toEqual([{ uid: unit.uid, from: "dedokion", to: "toka-loga" }]);
  });

  it("V-E E 코드 + 재상트 2개 -> 드워곤", () => {
    const g = newGame();
    const unit = dedokionOnBoard(g);
    const p = g.players[0];
    p.weapons["e-code-ve"] = 1;
    equip(g, 0, "e-code-ve", unit.uid);
    p.materials.zesent = 2;
    playRound(g);
    playRound(g);
    expect(owned(g).find((u) => u.uid === unit.uid)!.defId).toBe("dwargon");
    expect(p.materials.zesent).toBe(0);
  });

  it("진행도는 스냅샷으로 보인다", () => {
    const g = newGame();
    const unit = dedokionOnBoard(g);
    playRound(g);
    const view = toChessSnapshot(g, 0, false).me!.board.find((u) => u.uid === unit.uid)!;
    expect(view.evo).toEqual({ engine: 0, core: 25 });
  });
});

describe("전투: 데보이트와 데도키온", () => {
  it("데보이트는 처음 쓰러지는 아군 1명을 되살린다 (한 번)", () => {
    const boards = [
      [{ defId: "devoit", star: 1 as const, col: 0, row: 3 }, { defId: "relic", star: 1 as const, col: 3, row: 0 }],
      [{ defId: "dwargon", star: 2 as const, col: 3, row: 0 }, { defId: "toka-loga", star: 2 as const, col: 4, row: 0 }],
    ];
    const rec = recordCombat(boards as never, []);
    const revives = rec.events.filter((e) => e[1] === "ability" && e[4] === "origin");
    expect(revives).toHaveLength(1);
    const same = recordCombat(boards as never, []);
    expect(same.events).toEqual(rec.events); // 결정적
  });

  it("데도키온은 처치할 때마다 그 적 최대 체력의 10%만큼 최대 체력이 오르고 회복한다", () => {
    const state = createCombat([[{ defId: "dedokion", star: 1, col: 3, row: 0 }], [{ defId: "relic", star: 1, col: 3, row: 0 }]]);
    const [dedokion, relic] = [state.units.find((u) => u.seat === 0)!, state.units.find((u) => u.seat === 1)!];
    const before = dedokion.maxHp;
    dedokion.hp = before - 200;
    onKill(state, dedokion, relic);
    expect(dedokion.maxHp).toBeCloseTo(before + relic.maxHp * 0.1);
    expect(dedokion.hp).toBeCloseTo(before - 200 + relic.maxHp * 0.1);
    expect(dedokion.kills).toBe(1);
  });
});

describe("계보 시너지 근원", () => {
  it("같은 계보 2명이면 lineage-1, 3명이면 lineage-2, 체력 +8% / +16%", () => {
    expect(activeSynergies(["devoit", "ankio"])).toContain("lineage-1");
    expect(activeSynergies(["devoit", "ankio", "dwargon"])).toContain("lineage-2");
    expect(activeSynergies(["devoit", "devoit"])).not.toContain("lineage-1"); // 같은 캐릭터는 한 명
    expect(combineBonuses(["lineage-1"]).teamHp).toBeCloseTo(1.08);
    expect(combineBonuses(["lineage-2"]).teamHp).toBeCloseTo(1.16);
  });

  it("계보 시너지가 켜지면 전투 시작 체력이 오른다", () => {
    const alone = recordCombat([[{ defId: "ankio", star: 1, col: 0, row: 0 }], [{ defId: "relic", star: 1, col: 0, row: 0 }]], []);
    const pair = recordCombat([[{ defId: "ankio", star: 1, col: 0, row: 0 }, { defId: "devoit", star: 1, col: 7, row: 3 }], [{ defId: "relic", star: 1, col: 0, row: 0 }]], []);
    expect(pair.units[0]!.maxHp).toBeCloseTo(alone.units[0]!.maxHp * 1.08, 0);
    expect(ROSTER.find((d) => d.id === "devoit")?.passive).toBe(true);
  });
});

describe("안키오: 신의 전달자", () => {
  it("같은 편에 데보이트 계보가 있으면 순간이동 뒤 보호막을 얻는다", () => {
    const withKin = createCombat([[{ defId: "ankio", star: 1, col: 3, row: 0 }, { defId: "devoit", star: 1, col: 0, row: 3 }], [{ defId: "relic", star: 1, col: 3, row: 3 }]]);
    const alone = createCombat([[{ defId: "ankio", star: 1, col: 3, row: 0 }], [{ defId: "relic", star: 1, col: 3, row: 3 }]]);
    for (const [state, expected] of [[withKin, true], [alone, false]] as const) {
      const ankio = state.units.find((u) => u.defId === "ankio")!;
      castAbility(state, ankio);
      expect(ankio.shield > 0, expected ? "계보가 있으면" : "혼자면").toBe(expected);
    }
  });
});

describe("봇과 데보이트 계보", () => {
  it("데도키온이 있으면 E 코드를 만들어 끼우고, 진화 재료는 재련하지 않는다", () => {
    let n = 0;
    const state = createRoom("ADMF", 0, false, "chess", false);
    const ids: string[] = [];
    for (const name of ["가", "나"]) {
      const r = joinRoom(state, { name, userId: `u${name}` }, 0, () => `id${++n}`);
      if (!r.ok) throw new Error("join");
      ids.push(r.player.id);
    }
    const rng = () => 0.5;
    for (const id of ids) setReady(state, id, true, 0, 1, rng);
    const seat = state.players.find((p) => p.id === ids[0])!.seat;
    const me = state.chess!.players[seat];
    me.bench[0] = { uid: "d1", defId: "dedokion", star: 1 };
    me.materials = { bit: 1, edgem: 1, "ancient-shard": 2 };
    me.weapons = {};
    runChessBot(state, ids[0]!, 0, 1, rng);
    // 비트 + 에드잼 -> X-E E 코드 (재련대에 들어가서 다음 라운드에 무기가 된다)
    expect(me.materials.bit ?? 0).toBe(0);
    expect(me.smelters.includes("e-code-xe") || (me.materials["xe-code"] ?? 0) > 0).toBe(true);
    expect(me.materials["ancient-shard"]).toBe(2); // 진화 재료는 남긴다
    // 무기가 되면 데도키온에 낀다
    me.done = false;
    me.weapons = { "e-code-xe": 1 };
    runChessBot(state, ids[0]!, 0, 1, rng);
    const dedokion = [...me.board, ...me.bench].find((u) => u?.uid === "d1")!;
    expect(dedokion.weapon).toBe("e-code-xe");
  });
});
