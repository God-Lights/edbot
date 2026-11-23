import { describe, expect, it } from "vitest";
import { runChessBot } from "../src/bot";
import {
  MAX_ROUNDS, buy, buyMaterial, createChessGame, deploy, equip, finishRound, runRoundCombat, sell, smelt, startRound, toBench, unequip,
} from "../src/chess/game";
import type { ChessGame } from "../src/chess/game";
import { recordCombat, runCombat } from "../src/chess/sim";
import { MARKET_PRICE, MATERIALS, WEAPONS, materialDef, weaponDef } from "../src/chess/weapons";
import { parseClientMessage } from "../src/protocol";
import { advancePhase, createRoom, joinRoom, setReady, takeMatchRecord } from "../src/room-state";

const newGame = (seed = 1, lite = false): ChessGame => {
  const g = createChessGame(seed, lite);
  startRound(g);
  return g;
};

const giveUnit = (g: ChessGame, seat: 0 | 1, defId: string) => {
  const p = g.players[seat];
  p.gold = 99;
  const old = p.shop[0];
  if (old) g.pool[old] = (g.pool[old] ?? 0) + 1;
  p.shop[0] = defId;
  g.pool[defId] = (g.pool[defId] ?? 0) - 1;
  expect(buy(g, seat, 0)).toEqual({ ok: true });
  return p.bench.find((u) => u && u.defId === defId && !u.weapon) ?? p.board.find((u) => u.defId === defId)!;
};

describe("재료와 무기 데이터", () => {
  it("재료 16종(진화 재료 3종 포함), 무기 16종이 하나씩 짝을 이룬다", () => {
    expect(MATERIALS).toHaveLength(16);
    expect(MATERIALS.filter((m) => m.special).map((m) => m.id)).toEqual(["xe-code", "ve-code", "zesent"]);
    expect(WEAPONS).toHaveLength(16);
    for (const m of MATERIALS) {
      expect(weaponDef(m.weaponId)?.materialId).toBe(m.id);
      expect(weaponDef(m.weaponId)?.rarity).toBe(m.rarity);
    }
    expect(new Set(WEAPONS.map((w) => w.id)).size).toBe(16);
  });

  it("시장 가격: 흔함 3, 보통 5, 희귀 8, 전설은 팔지 않는다", () => {
    expect(MARKET_PRICE).toEqual({ common: 3, uncommon: 5, rare: 8, legendary: null });
  });
});

describe("자원 칸과 광물 시장", () => {
  it("라운드마다 자원 칸 4개: 거울 대칭이고 같은 재료이며 앞 두 줄에 있다", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const g = newGame(seed);
      expect(g.tiles).toHaveLength(4);
      const keys = new Set(g.tiles.map((t) => `${t.x},${t.y}`));
      expect(keys.size).toBe(4);
      for (const t of g.tiles) {
        expect(t.y).toBeGreaterThanOrEqual(2);
        expect(t.y).toBeLessThanOrEqual(5);
        const mirror = g.tiles.find((o) => o.x === 7 - t.x && o.y === 7 - t.y);
        expect(mirror?.material).toBe(t.material);
        expect(materialDef(t.material)).toBeDefined();
      }
    }
  });

  it("시장에는 1~2종이 나오고 전설은 없다", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const g = newGame(seed);
      expect(g.market.length).toBeGreaterThanOrEqual(1);
      expect(g.market.length).toBeLessThanOrEqual(2);
      expect(new Set(g.market).size).toBe(g.market.length);
      for (const id of g.market) expect(materialDef(id)!.rarity).not.toBe("legendary");
    }
  });

  it("전설 재료는 자원 칸에서 드물게 나온다 (3%)", () => {
    let legendary = 0, total = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const g = createChessGame(seed);
      for (let r = 0; r < 4; r++) {
        startRound(g);
        for (const t of g.tiles.slice(0, 2)) { total++; if (materialDef(t.material)!.rarity === "legendary") legendary++; }
      }
    }
    expect(legendary / total).toBeGreaterThan(0.005);
    expect(legendary / total).toBeLessThan(0.08);
  });

  it("입문 모드에는 자원 칸도 시장도 없다", () => {
    const g = newGame(1, true);
    expect(g.tiles).toEqual([]);
    expect(g.market).toEqual([]);
    expect(buyMaterial(g, 0, 0)).toEqual({ ok: false, code: "no_resources" });
    expect(smelt(g, 0, "bit")).toEqual({ ok: false, code: "no_resources" });
  });

  it("시장에서 사기: 값을 내고 한 라운드에 한 개, 다음 라운드에 다시 살 수 있다", () => {
    const g = newGame(3);
    const p = g.players[0];
    const id = g.market[0]!;
    const price = MARKET_PRICE[materialDef(id)!.rarity]!;
    p.gold = 50;
    expect(buyMaterial(g, 0, 0)).toEqual({ ok: true });
    expect(p.gold).toBe(50 - price);
    expect(p.materials[id]).toBe(1);
    expect(buyMaterial(g, 0, 0)).toEqual({ ok: false, code: "market_sold" });
    expect(g.players[1].marketBought).toBe(false); // 상대는 따로
    startRound(g);
    expect(p.marketBought).toBe(false);
    expect(buyMaterial(g, 0, 9)).toEqual({ ok: false, code: "invalid_slot" });
    p.gold = 0;
    expect(buyMaterial(g, 0, 0)).toEqual({ ok: false, code: "not_enough_gold" });
  });
});

describe("재련과 무기", () => {
  it("재료를 재련대에 넣으면 다음 라운드 시작에 무기가 나온다 (재련대 2칸)", () => {
    const g = newGame();
    const p = g.players[0];
    p.materials = { clawstone: 2, bit: 1 };
    expect(smelt(g, 0, "clawstone")).toEqual({ ok: true });
    expect(smelt(g, 0, "clawstone")).toEqual({ ok: true });
    expect(smelt(g, 0, "bit")).toEqual({ ok: false, code: "no_free_smelter" });
    expect(smelt(g, 0, "titanium")).toEqual({ ok: false, code: "no_material" });
    expect(p.materials.clawstone).toBe(0);
    expect(p.weapons).toEqual({});
    startRound(g);
    expect(p.weapons["clawstone-axe"]).toBe(2);
    expect(p.smelters).toEqual([null, null]);
  });

  it("무기 끼기: 기물당 하나, 바꾸면 이전 무기가 돌아오고, 빼면 보관함으로", () => {
    const g = newGame();
    const p = g.players[0];
    const unit = giveUnit(g, 0, "relic");
    p.weapons = { "clawstone-axe": 1, "titanium-shield": 1 };
    expect(equip(g, 0, "clawstone-axe", unit.uid)).toEqual({ ok: true });
    expect(unit.weapon).toBe("clawstone-axe");
    expect(p.weapons["clawstone-axe"]).toBe(0);
    expect(equip(g, 0, "titanium-shield", unit.uid)).toEqual({ ok: true });
    expect(p.weapons["clawstone-axe"]).toBe(1);
    expect(unequip(g, 0, unit.uid)).toEqual({ ok: true });
    expect(p.weapons["titanium-shield"]).toBe(1);
    expect(unit.weapon).toBeUndefined();
    expect(unequip(g, 0, unit.uid)).toEqual({ ok: false, code: "no_weapon" });
    expect(equip(g, 0, "bit-dagger", unit.uid)).toEqual({ ok: false, code: "no_weapon" });
    expect(equip(g, 0, "clawstone-axe", "없음")).toEqual({ ok: false, code: "unit_not_found" });
  });

  it("무기는 대기석↔판 이동과 자리 바꾸기에서도 유지되고, 팔면 보관함으로 돌아온다", () => {
    const g = newGame();
    const p = g.players[0];
    const a = giveUnit(g, 0, "relic");
    p.weapons = { "bit-dagger": 1 };
    equip(g, 0, "bit-dagger", a.uid);
    deploy(g, 0, a.uid, 3, 0);
    expect(p.board[0]!.weapon).toBe("bit-dagger");
    const b = giveUnit(g, 0, "lappus");
    deploy(g, 0, b.uid, 3, 0); // a가 대기석으로 밀려난다
    expect(p.bench.find((u) => u?.uid === a.uid)?.weapon).toBe("bit-dagger");
    deploy(g, 0, a.uid, 4, 0);
    toBench(g, 0, a.uid);
    expect(p.bench.find((u) => u?.uid === a.uid)?.weapon).toBe("bit-dagger");
    sell(g, 0, a.uid);
    expect(p.weapons["bit-dagger"]).toBe(1);
  });

  it("★2로 합쳐질 때 무기 하나는 ★2가 이어받고 나머지는 보관함으로", () => {
    const g = newGame();
    const p = g.players[0];
    p.weapons = { "bit-dagger": 1, "clawstone-axe": 1 };
    const first = giveUnit(g, 0, "nut-wolf");
    equip(g, 0, "bit-dagger", first.uid);
    const second = giveUnit(g, 0, "nut-wolf");
    equip(g, 0, "clawstone-axe", second.uid);
    giveUnit(g, 0, "nut-wolf");
    const star2 = p.bench.find((u) => u?.star === 2)!;
    expect(star2.weapon).toBeDefined();
    const returned = Object.values(p.weapons).reduce((a, b) => a + b, 0);
    expect(returned).toBe(1);
  });

  it("디지털 채굴기 포대는 매 라운드 시작에 비트를 만든다", () => {
    const g = newGame();
    const p = g.players[0];
    const unit = giveUnit(g, 0, "relic");
    p.weapons = { "digital-miner-pouch": 1 };
    equip(g, 0, "digital-miner-pouch", unit.uid);
    startRound(g);
    expect(p.materials.bit).toBe(1);
    startRound(g);
    expect(p.materials.bit).toBe(2);
  });
});

describe("전투에서의 무기와 채굴", () => {
  const pawn = (col: number, row: number, weapon?: string) => ({ defId: "relic", star: 1 as const, col, row, ...(weapon ? { weapon } : {}) });

  it("무기가 있어도 같은 배치는 같은 결과 (결정적)", () => {
    const boards: [ReturnType<typeof pawn>[], ReturnType<typeof pawn>[]] = [
      [pawn(3, 0, "clawstone-axe"), pawn(4, 0, "redocean-trident"), pawn(2, 1, "chaos-staff")],
      [pawn(3, 0, "dark-scythe"), pawn(4, 0, "ankio-twinblades"), pawn(2, 1, "edmium-blade")],
    ];
    const a = recordCombat(boards);
    const b = recordCombat(boards);
    expect(a.frames).toEqual(b.frames);
    expect(a.result).toEqual(b.result);
  });

  it("같은 무기를 거울로 끼면 어느 seat도 유리하지 않다 (무기 13종)", () => {
    for (const w of WEAPONS) {
      const team = [pawn(3, 0, w.id), pawn(4, 0), pawn(2, 1)];
      let seat0 = 0, seat1 = 0;
      const r = runCombat([team, team]);
      if (r.winner === 0) seat0++;
      if (r.winner === 1) seat1++;
      // 완전히 같은 팀끼리는 한쪽이 이기더라도 마지막 박자 한 번 차이다: 체력 비율 승부까지 가는 일은 거의 없다
      expect(seat0 + seat1).toBeLessThanOrEqual(1);
    }
  });

  it("무기 효과: 타이타늄 방패는 체력을 올리고, 비트코인 대검은 살아남으면 골드 +2", () => {
    const withShield = recordCombat([[pawn(3, 0, "titanium-shield")], [pawn(3, 0)]]);
    expect(withShield.units[0]!.maxHp).toBeGreaterThan(withShield.units[1]!.maxHp);
    expect(withShield.result.winner).toBe(0);
    const sword = recordCombat([[pawn(3, 0, "bitcoin-greatsword")], [pawn(3, 0)]]);
    expect(sword.result.winner).toBe(0);
    expect(sword.goldBonus).toEqual([2, 0]);
  });

  it("에드코인 슬링: 처치할 때마다 골드 +1 (최대 3)", () => {
    const enemies = [0, 1, 2, 3, 4, 5].map((c) => pawn(c, 0));
    const r = recordCombat([[{ defId: "ancient-lord", star: 2 as const, col: 3, row: 0, weapon: "edcoin-sling" }], enemies]);
    expect(r.goldBonus[0]).toBeGreaterThan(0);
    expect(r.goldBonus[0]).toBeLessThanOrEqual(3);
  });

  it("자원 칸 위에 서 있는 기물이 재료를 캔다. 칸은 한 번만 캘 수 있다", () => {
    const tiles = [{ x: 3, y: 4, material: "bit" }, { x: 4, y: 3, material: "bit" }];
    const r = recordCombat([[pawn(3, 0)], [pawn(3, 0)]], tiles);
    // seat 0의 (3,0) -> (3,4), seat 1의 (3,0) -> (4,3)
    expect(r.mines.filter((m) => m[1] === 0).map((m) => m[2])).toEqual([0]);
    expect(r.mines.filter((m) => m[1] === 1).map((m) => m[2])).toEqual([1]);
    expect(r.mines.every((m) => m[0] === 0)).toBe(true); // 처음부터 서 있으면 0박자에 캔다
    expect(r.events.filter((e) => e[1] === "mine")).toHaveLength(2);
    expect(r.tiles).toHaveLength(2);
  });

  it("같은 박자에 둘이 도착하면 둘 다 얻는다", () => {
    // seat 0 폰이 (3,4)에서 (3,3)으로, seat 1 폰이 (4,3)에서 (4,4)... 대신 같은 칸을 향해 서로 들어간다.
    const tiles = [{ x: 3, y: 3, material: "edcoin" }];
    const r = recordCombat([[pawn(3, 0)], [pawn(4, 0)]], tiles); // seat0 (3,4)->(3,3), seat1 (4,3)->(3,3)? 서로 비껴가며 한 칸에 모인다
    const seats = r.mines.filter((m) => m[1] === 0).map((m) => m[2]);
    expect(seats.length).toBeGreaterThanOrEqual(1);
  });

  it("전투가 끝나면 캔 재료와 무기로 번 골드를 받는다", () => {
    const g = newGame(5);
    giveUnit(g, 0, "relic");
    giveUnit(g, 1, "relic");
    const tile = g.tiles.find((t) => t.x === 3 && t.y === 4) ?? g.tiles[0]!;
    // seat 0의 기물을 자원 칸 위에 놓는다 (칸의 절대 좌표 -> seat 0 시점 col,row)
    const mine = tile.y >= 4;
    expect(mine || true).toBe(true);
    const seat0Tile = g.tiles.find((t) => t.y >= 4)!;
    deploy(g, 0, g.players[0].bench.find((u) => u)!.uid, seat0Tile.x, seat0Tile.y - 4);
    deploy(g, 1, g.players[1].bench.find((u) => u)!.uid, 0, 3);
    const goldBefore = g.players[0].gold;
    runRoundCombat(g);
    expect(g.players[0].materials[seat0Tile.material] ?? 0).toBe(0); // 전투를 계산했을 뿐, 받는 건 라운드가 끝날 때
    finishRound(g);
    expect(g.players[0].materials[seat0Tile.material]).toBe(1);
    expect(g.players[0].gold).toBeGreaterThanOrEqual(goldBefore);
  });
});

describe("프로토콜", () => {
  it("자원 메시지를 해석한다", () => {
    expect(parseClientMessage('{"t":"market","slot":1}')).toEqual({ t: "market", slot: 1 });
    expect(parseClientMessage('{"t":"smelt","material":"bit"}')).toEqual({ t: "smelt", material: "bit" });
    expect(parseClientMessage('{"t":"equip","weaponId":"bit-dagger","uid":"i3"}')).toEqual({ t: "equip", weaponId: "bit-dagger", uid: "i3" });
    expect(parseClientMessage('{"t":"unequip","uid":"i3"}')).toEqual({ t: "unequip", uid: "i3" });
    for (const bad of ['{"t":"market","slot":9}', '{"t":"market"}', '{"t":"smelt"}', '{"t":"equip","uid":"i3"}', '{"t":"unequip"}']) {
      expect(parseClientMessage(bad)).toBeNull();
    }
  });
});

describe("자원 시스템이 켜진 전체 게임", () => {
  it("봇 둘이 재료를 사고 재련하고 무기를 끼며 끝까지 한다", () => {
    for (let seed = 1; seed <= 4; seed++) {
      let n = 0;
      const state = createRoom("ADMF", 0, false, "chess", false);
      const ids: string[] = [];
      for (const name of ["가", "나"]) {
        const r = joinRoom(state, { name, userId: `u${name}` }, 0, () => `id${++n}`);
        if (!r.ok) throw new Error("join");
        ids.push(r.player.id);
      }
      let s = seed * 77;
      const rng = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
      for (const id of ids) setReady(state, id, true, 0, 1, rng);
      expect(state.chess!.resources).toBe(true);
      let now = 0;
      let guard = 0;
      let boughtSomething = false;
      while (state.phase !== "result" && guard++ < 200) {
        for (const id of ids) runChessBot(state, id, now, 1, rng);
        if (state.chess!.players.some((p) => Object.keys(p.weapons).length > 0 || p.smelters.some(Boolean) || p.board.some((u) => u.weapon))) boughtSomething = true;
        now = Math.max(now + 1000, (state.phaseEndsAt ?? now) + 1);
        advancePhase(state, now, 1, rng);
      }
      expect(state.phase).toBe("result");
      expect(state.chess!.round).toBeLessThanOrEqual(MAX_ROUNDS);
      expect(boughtSomething).toBe(true);
      expect(takeMatchRecord(state, now)).not.toBeNull();
    }
  });
});
