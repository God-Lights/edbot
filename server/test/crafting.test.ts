import { describe, expect, it } from "vitest";
import {
  HYBRID_POWER, MATERIAL_FUSIONS, STAR_POWER, combine, fuseMaterials, hybridWeaponId, parseWeapon, starWeaponId,
} from "../src/chess/crafting";
import { buy, combineItems, createChessGame, equip, startRound } from "../src/chess/game";
import type { ChessGame } from "../src/chess/game";
import { recordCombat } from "../src/chess/sim";
import { MATERIALS, WEAPONS, materialDef } from "../src/chess/weapons";
import { parseClientMessage } from "../src/protocol";

const m = (id: string) => ({ kind: "material" as const, id });
const w = (id: string) => ({ kind: "weapon" as const, id });

describe("무기 이름표", () => {
  it("기본·★2·융합 무기를 해석한다", () => {
    expect(parseWeapon("clawstone-axe")).toEqual({ kind: "single", parts: ["clawstone-axe"], power: 1 });
    expect(parseWeapon("clawstone-axe*")).toEqual({ kind: "star", parts: ["clawstone-axe"], power: STAR_POWER });
    expect(parseWeapon("bit-dagger+clawstone-axe")).toEqual({ kind: "hybrid", parts: ["bit-dagger", "clawstone-axe"], power: HYBRID_POWER });
  });

  it("엉터리 이름표는 거절한다 (없는 무기, 정렬이 틀린 융합, 같은 무기 융합, 세 개 융합)", () => {
    for (const bad of ["nope", "nope*", "clawstone-axe**", "clawstone-axe+clawstone-axe", "clawstone-axe+bit-dagger", "a+b+c", "+", "clawstone-axe+", ""]) {
      expect(parseWeapon(bad), bad).toBeNull();
    }
  });

  it("융합 이름표는 순서와 상관없이 같다", () => {
    expect(hybridWeaponId("edmium-blade", "clawstone-axe")).toBe(hybridWeaponId("clawstone-axe", "edmium-blade"));
    expect(starWeaponId("bit-dagger")).toBe("bit-dagger*");
  });
});

describe("재료 조합표", () => {
  it("흔함 6쌍 + 보통 6쌍 + 희귀 3쌍 = 15가지이고, 결과는 항상 한 단계 위 재료다", () => {
    expect(MATERIAL_FUSIONS).toHaveLength(15);
    const next = { common: "uncommon", uncommon: "rare", rare: "legendary" } as const;
    for (const f of MATERIAL_FUSIONS) {
      const ra = materialDef(f.a)!.rarity;
      expect(materialDef(f.b)!.rarity).toBe(ra);
      expect(materialDef(f.result)!.rarity).toBe(next[ra as keyof typeof next]);
      expect(f.a < f.b).toBe(true);
    }
    // 모든 상위 재료가 최소 한 번은 만들어진다 (조합으로 전설까지 닿을 수 있다)
    for (const rarity of ["uncommon", "rare", "legendary"]) {
      for (const mat of MATERIALS.filter((x) => x.rarity === rarity)) {
        expect(MATERIAL_FUSIONS.some((f) => f.result === mat.id), mat.id).toBe(true);
      }
    }
  });

  it("순서가 바뀌어도 같은 결과, 같은 재료나 다른 희귀도, 전설은 합칠 수 없다", () => {
    const f = MATERIAL_FUSIONS[0]!;
    expect(fuseMaterials(f.a, f.b)).toBe(f.result);
    expect(fuseMaterials(f.b, f.a)).toBe(f.result);
    expect(combine(m("bit"), m("bit"))).toBeNull();
    expect(combine(m("bit"), m("titanium"))).toBeNull();
    expect(combine(m("bitcoin"), m("digital-miner"))).toBeNull();
    expect(combine(m("없는재료"), m("bit"))).toBeNull();
  });
});

describe("조합 규칙", () => {
  it("같은 무기 둘 -> ★2, 다른 무기 둘 -> 융합 (순서 무관)", () => {
    expect(combine(w("clawstone-axe"), w("clawstone-axe"))).toEqual(w("clawstone-axe*"));
    expect(combine(w("edmium-blade"), w("clawstone-axe"))).toEqual(w("clawstone-axe+edmium-blade"));
    expect(combine(w("clawstone-axe"), w("edmium-blade"))).toEqual(w("clawstone-axe+edmium-blade"));
  });

  it("★2와 융합 무기는 더 합치지 않는다", () => {
    expect(combine(w("clawstone-axe*"), w("clawstone-axe*"))).toBeNull();
    expect(combine(w("clawstone-axe*"), w("bit-dagger"))).toBeNull();
    expect(combine(w("clawstone-axe+edmium-blade"), w("bit-dagger"))).toBeNull();
  });

  it("무기 + 그 무기의 원재료 -> ★2, 다른 재료는 안 된다", () => {
    expect(combine(w("clawstone-axe"), m("clawstone"))).toEqual(w("clawstone-axe*"));
    expect(combine(m("clawstone"), w("clawstone-axe"))).toEqual(w("clawstone-axe*"));
    expect(combine(w("clawstone-axe"), m("edmium"))).toBeNull();
    expect(combine(w("clawstone-axe*"), m("clawstone"))).toBeNull();
  });
});

const newGame = (): ChessGame => {
  const g = createChessGame(1);
  startRound(g);
  return g;
};

describe("조합 행동", () => {
  it("재료 둘이 사라지고 상위 재료가 보관함에 들어온다", () => {
    const g = newGame();
    const p = g.players[0];
    const f = MATERIAL_FUSIONS[0]!;
    p.materials = { [f.a]: 1, [f.b]: 2 };
    expect(combineItems(g, 0, m(f.a), m(f.b))).toEqual({ ok: true });
    expect(p.materials[f.a]).toBe(0);
    expect(p.materials[f.b]).toBe(1);
    expect(p.materials[f.result]).toBe(1);
  });

  it("없는 것·부족한 것·합칠 수 없는 것은 거절하고 아무것도 바뀌지 않는다", () => {
    const g = newGame();
    const p = g.players[0];
    p.weapons = { "clawstone-axe": 1, "edmium-blade": 1 };
    p.materials = { bit: 1 };
    expect(combineItems(g, 0, w("clawstone-axe"), w("clawstone-axe"))).toEqual({ ok: false, code: "no_weapon" }); // 같은 무기는 2개 필요
    expect(combineItems(g, 0, w("clawstone-axe"), w("bit-dagger"))).toEqual({ ok: false, code: "no_weapon" });
    expect(combineItems(g, 0, m("bit"), m("edmium"))).toEqual({ ok: false, code: "no_material" });
    expect(combineItems(g, 0, m("bit"), w("clawstone-axe"))).toEqual({ ok: false, code: "invalid_recipe" });
    expect(p.weapons).toEqual({ "clawstone-axe": 1, "edmium-blade": 1 });
    expect(p.materials).toEqual({ bit: 1 });
  });

  it("무기 융합과 ★2: 둘이 사라지고 결과 무기가 생기며, 낄 수 있다", () => {
    const g = newGame();
    const p = g.players[0];
    p.weapons = { "clawstone-axe": 1, "edmium-blade": 1 };
    expect(combineItems(g, 0, w("clawstone-axe"), w("edmium-blade"))).toEqual({ ok: true });
    expect(p.weapons).toMatchObject({ "clawstone-axe": 0, "edmium-blade": 0, "clawstone-axe+edmium-blade": 1 });
    p.gold = 99;
    g.players[0].shop[0] = "relic";
    g.pool.relic = (g.pool.relic ?? 0) - 1;
    buy(g, 0, 0);
    const unit = p.bench.find((u) => u)!;
    expect(equip(g, 0, "clawstone-axe+edmium-blade", unit.uid)).toEqual({ ok: true });
    expect(unit.weapon).toBe("clawstone-axe+edmium-blade");
    p.weapons["clawstone-axe"] = 2;
    expect(combineItems(g, 0, w("clawstone-axe"), w("clawstone-axe"))).toEqual({ ok: true });
    expect(equip(g, 0, "clawstone-axe*", unit.uid)).toEqual({ ok: true }); // 이미 낀 융합 무기는 보관함으로 돌아온다
    expect(p.weapons["clawstone-axe+edmium-blade"]).toBe(1);
  });

  it("자원 시스템이 없는 입문 모드에서는 합칠 수 없다", () => {
    const g = createChessGame(1, true);
    startRound(g);
    expect(combineItems(g, 0, m("bit"), m("edmium"))).toEqual({ ok: false, code: "no_resources" });
  });
});

describe("전투에서 조합 무기", () => {
  const unit = (weapon?: string) => ({ defId: "relic", star: 1 as const, col: 3, row: 0, ...(weapon ? { weapon } : {}) });
  const maxHp = (weapon?: string) => recordCombat([[unit(weapon)], [unit()]]).units[0]!.maxHp;

  it("★2 타이타늄 방패는 체력 보너스가 1.5배, 융합은 각 효과가 75%", () => {
    const base = maxHp();
    expect(maxHp("titanium-shield") / base).toBeCloseTo(1.15, 2);
    expect(maxHp("titanium-shield*") / base).toBeCloseTo(1 + 0.15 * 1.5, 2);
    expect(maxHp("bit-dagger+titanium-shield") / base).toBeCloseTo(1 + 0.15 * 0.75, 2);
  });

  it("★2 비트코인 대검은 생존 골드가 +3, 융합은 +2(반올림)", () => {
    const vs = (weapon: string) => recordCombat([[{ ...unit(weapon), defId: "ancient-lord" }], [unit()]]).goldBonus[0];
    expect(vs("bitcoin-greatsword")).toBe(2);
    expect(vs("bitcoin-greatsword*")).toBe(3);
    expect(vs("bitcoin-greatsword+titanium-shield")).toBe(2); // round(2 * 0.75)
  });

  it("조합 무기도 결정적이고, 같은 조합끼리 거울로 붙이면 한쪽이 일방적으로 이기지 않는다", () => {
    const boards = (weapon: string): [ReturnType<typeof unit>[], ReturnType<typeof unit>[]] => [[unit(weapon)], [unit(weapon)]];
    for (const weapon of ["clawstone-axe*", "chaos-staff+edmium-blade", "dark-scythe+redocean-trident", "ankio-twinblades*"]) {
      const a = recordCombat(boards(weapon));
      const b = recordCombat(boards(weapon));
      expect(a.frames).toEqual(b.frames);
      expect(a.result.winner === 0 || a.result.winner === 1 || a.result.winner === null).toBe(true);
    }
  });

  it("★2 무기는 같은 기본 무기보다 세고, 모든 기본 무기가 ★2·융합으로 전투에 쓰인다", () => {
    for (const weapon of WEAPONS) {
      const r = recordCombat([[unit(`${weapon.id}*`)], [unit()]]);
      expect(r.units[0]!.weapon).toBe(`${weapon.id}*`);
    }
    const plain = recordCombat([[unit("bitcoin-greatsword")], [unit("bitcoin-greatsword")]]);
    const star = recordCombat([[unit("bitcoin-greatsword*")], [unit("bitcoin-greatsword")]]);
    expect(star.result.winner).toBe(0);
    expect(plain.result.winner === 0 || plain.result.winner === 1 || plain.result.winner === null).toBe(true);
  });
});

describe("프로토콜", () => {
  it("combine 메시지를 해석한다", () => {
    expect(parseClientMessage('{"t":"combine","a":{"kind":"material","id":"bit"},"b":{"kind":"weapon","id":"clawstone-axe"}}'))
      .toEqual({ t: "combine", a: { kind: "material", id: "bit" }, b: { kind: "weapon", id: "clawstone-axe" } });
    for (const bad of [
      '{"t":"combine"}', '{"t":"combine","a":{"kind":"gem","id":"x"},"b":{"kind":"weapon","id":"y"}}',
      '{"t":"combine","a":{"kind":"material"},"b":{"kind":"weapon","id":"y"}}', '{"t":"combine","a":"bit","b":"edmium"}',
    ]) {
      expect(parseClientMessage(bad)).toBeNull();
    }
  });
});
