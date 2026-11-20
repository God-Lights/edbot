import { describe, expect, it } from "vitest";
import { createExplore, stepExplore } from "../src/explore/explore";
import type { ExploreState } from "../src/explore/explore";
import {
  EQUIP_TICKS,
  MAX_BUY_AT_ONCE,
  ORE_PRICE,
  SMELT_STEAM,
  SMELT_TICKS,
  STEAM_MAX,
  buyOre,
  craftWeapon,
  finishEquips,
  hasten,
  orePrice,
  startEquip,
  startSmelting,
} from "../src/forge/forge";
import type { SteamPool } from "../src/forge/forge";
import { toForgeSnapshot } from "../src/forge/snapshot";
import { ADVANTAGE_DAMAGE, DISADVANTAGE_DAMAGE, WEAPONS, matchupMultiplier, weaponById } from "../src/forge/weapons";

const TEAM = ["nut-wolf", "xenosaurs", "ankio", "lappus", "dwargon"];
const make = (a = TEAM, b = TEAM): ExploreState => createExplore({ seed: 3, teams: [a, b], secondPicker: 1 });
const run = (s: ExploreState, n: number) => {
  for (let i = 0; i < n; i++) stepExplore(s);
};
const pool = (s: ExploreState): SteamPool => ({
  get: (seat) => s.forge.steam[seat],
  spend: (seat, n) => void (s.forge.steam[seat] -= n),
});

describe("무기 데이터", () => {
  it("일반 6종 + 특수 3종이고 id가 겹치지 않는다", () => {
    expect(WEAPONS).toHaveLength(9);
    expect(new Set(WEAPONS.map((w) => w.id)).size).toBe(9);
    expect(WEAPONS.filter((w) => w.tier === 1)).toHaveLength(3);
    expect(WEAPONS.filter((w) => w.tier === 2)).toHaveLength(3);
    expect(WEAPONS.filter((w) => w.tier === "special")).toHaveLength(3);
  });
  it("종류마다 1등급과 2등급이 있고 레시피는 기획서대로다", () => {
    expect(weaponById("stone-axe")!.recipe).toEqual({ branch: 1, stone: 2 });
    expect(weaponById("wood-spear")!.recipe).toEqual({ branch: 2, stone: 1 });
    expect(weaponById("wood-bow")!.recipe).toEqual({ branch: 3 });
    expect(weaponById("iron-axe")!.recipe).toEqual({ ironIngot: 2, stone: 1 });
    expect(weaponById("iron-spear")!.recipe).toEqual({ ironIngot: 2, branch: 1 });
    expect(weaponById("iron-crossbow")!.recipe).toEqual({ ironIngot: 2, branch: 2 });
  });
  it("특수 무기는 일반 2등급보다 약하다 (특수 효과 중심)", () => {
    const iron = weaponById("iron-axe")!.atkBonus;
    for (const w of WEAPONS.filter((x) => x.tier === "special")) expect(w.atkBonus).toBeLessThan(iron);
  });
  it("상성: 중량 > 장병 > 원거리 > 중량", () => {
    expect(matchupMultiplier("stone-axe", "wood-spear")).toBe(ADVANTAGE_DAMAGE);
    expect(matchupMultiplier("wood-spear", "wood-bow")).toBe(ADVANTAGE_DAMAGE);
    expect(matchupMultiplier("wood-bow", "stone-axe")).toBe(ADVANTAGE_DAMAGE);
    expect(matchupMultiplier("wood-spear", "stone-axe")).toBe(DISADVANTAGE_DAMAGE);
    expect(matchupMultiplier("stone-axe", "iron-axe")).toBe(1); // 같은 종류
    expect(matchupMultiplier("stone-axe", null)).toBe(1); // 무기가 없으면 상성 없음
    expect(matchupMultiplier(null, "wood-bow")).toBe(1);
  });
});

describe("상점", () => {
  it("탈런트 4로 광석 하나를 즉시 산다", () => {
    const s = make();
    expect(buyOre(s.forge, s.resources[0], 0, 1)).toEqual({ ok: true });
    expect(s.resources[0].ore).toBe(1);
    expect(s.resources[0].talent).toBe(15 - ORE_PRICE);
  });
  it("탈런트가 모자라거나 개수가 이상하면 거절한다", () => {
    const s = make();
    s.resources[0].talent = 3;
    expect(buyOre(s.forge, s.resources[0], 0, 1)).toEqual({ ok: false, code: "not_enough_talent" });
    expect(buyOre(s.forge, s.resources[0], 0, 0)).toEqual({ ok: false, code: "invalid_quantity" });
    expect(buyOre(s.forge, s.resources[0], 0, MAX_BUY_AT_ONCE + 1)).toEqual({ ok: false, code: "invalid_quantity" });
    expect(buyOre(s.forge, s.resources[0], 0, 1.5)).toEqual({ ok: false, code: "invalid_quantity" });
    expect(s.resources[0].talent).toBe(3);
  });
  it("리치몬드가 있는 팀은 25% 싸다", () => {
    const s = make(["richmond", ...TEAM.slice(0, 4)]);
    expect(orePrice(s.forge, 0)).toBe(3);
    expect(orePrice(s.forge, 1)).toBe(4);
    buyOre(s.forge, s.resources[0], 0, 2);
    expect(s.resources[0].talent).toBe(15 - 6);
  });
});

describe("재련", () => {
  it("광석 1 + 탈런트 2 + 스팀포스 3을 쓰고 15초 뒤 철괴가 된다", () => {
    const s = make();
    s.resources[0].ore = 1;
    expect(startSmelting(s.forge, s.resources[0], pool(s), 0, s.tick)).toEqual({ ok: true });
    expect(s.resources[0]).toMatchObject({ ore: 0, talent: 13 });
    expect(s.forge.steam[0]).toBe(STEAM_MAX - SMELT_STEAM);
    run(s, SMELT_TICKS - 1);
    expect(s.resources[0].ironIngot).toBe(0);
    run(s, 1);
    expect(s.resources[0].ironIngot).toBe(1);
    expect(s.forge.smelters[0].every((j) => j === null)).toBe(true);
  });
  it("재련대는 2개라서 세 번째는 거절한다", () => {
    const s = make();
    s.resources[0].ore = 3;
    s.forge.steam[0] = 10;
    expect(startSmelting(s.forge, s.resources[0], pool(s), 0, 0).ok).toBe(true);
    expect(startSmelting(s.forge, s.resources[0], pool(s), 0, 0).ok).toBe(true);
    expect(startSmelting(s.forge, s.resources[0], pool(s), 0, 0)).toEqual({ ok: false, code: "no_free_smelter" });
    expect(s.resources[0].ore).toBe(1);
  });
  it("재료, 탈런트, 스팀포스 중 하나라도 모자라면 아무것도 쓰지 않는다", () => {
    const s = make();
    expect(startSmelting(s.forge, s.resources[0], pool(s), 0, 0)).toEqual({ ok: false, code: "not_enough_materials" });
    s.resources[0].ore = 1;
    s.resources[0].talent = 1;
    expect(startSmelting(s.forge, s.resources[0], pool(s), 0, 0)).toEqual({ ok: false, code: "not_enough_talent" });
    s.resources[0].talent = 10;
    s.forge.steam[0] = 2.9;
    expect(startSmelting(s.forge, s.resources[0], pool(s), 0, 0)).toEqual({ ok: false, code: "not_enough_steam" });
    expect(s.resources[0]).toMatchObject({ ore: 1, talent: 10 });
    expect(s.forge.steam[0]).toBe(2.9);
  });
  it("스팀포스는 전투 전에도 초당 0.5씩 차고 10에서 멈춘다", () => {
    const s = make();
    s.forge.steam[0] = 2;
    run(s, 40); // 4초
    expect(s.forge.steam[0]).toBeCloseTo(4, 5);
    run(s, 1000);
    expect(s.forge.steam[0]).toBe(STEAM_MAX);
  });
  it("황금 계약은 진행 중인 재련을 단축한다", () => {
    const s = make();
    s.resources[0].ore = 1;
    startSmelting(s.forge, s.resources[0], pool(s), 0, 0);
    hasten(s.forge, 0, 50);
    run(s, SMELT_TICKS - 50);
    expect(s.resources[0].ironIngot).toBe(1);
  });
});

describe("조합", () => {
  it("재료를 쓰고 무기를 인벤토리에 넣는다", () => {
    const s = make();
    expect(craftWeapon(s.forge, s.resources[0], 0, "stone-axe")).toEqual({ ok: true });
    expect(s.resources[0]).toMatchObject({ branch: 2, stone: 1 });
    expect(s.forge.inventory[0]).toEqual({ "stone-axe": 1 });
  });
  it("시작 재료(나뭇가지 3, 돌 3)로 첫 무기를 바로 만들 수 있다", () => {
    for (const id of ["stone-axe", "wood-spear", "wood-bow"]) {
      const s = make();
      expect(craftWeapon(s.forge, s.resources[0], 0, id).ok, id).toBe(true);
    }
  });
  it("재료가 모자라거나 없는 무기는 거절하고 재료를 쓰지 않는다", () => {
    const s = make();
    expect(craftWeapon(s.forge, s.resources[0], 0, "iron-axe")).toEqual({ ok: false, code: "not_enough_materials" });
    expect(craftWeapon(s.forge, s.resources[0], 0, "nope")).toEqual({ ok: false, code: "unknown_weapon" });
    expect(s.resources[0]).toMatchObject({ branch: 3, stone: 3 });
  });
  it("특수 무기는 설계도와 희귀 재료가 필요하다", () => {
    const s = make();
    s.resources[0].branch = 5;
    expect(craftWeapon(s.forge, s.resources[0], 0, "frost-bow")).toEqual({ ok: false, code: "not_enough_materials" });
    s.resources[0].blueprints = 1;
    s.resources[0].rare = 1;
    expect(craftWeapon(s.forge, s.resources[0], 0, "frost-bow")).toEqual({ ok: true });
    expect(s.resources[0]).toMatchObject({ blueprints: 0, rare: 0, branch: 3 });
  });
  it("상대의 인벤토리는 건드리지 않는다", () => {
    const s = make();
    craftWeapon(s.forge, s.resources[0], 0, "wood-bow");
    expect(s.forge.inventory[1]).toEqual({});
  });
});

describe("장착", () => {
  function armed() {
    const s = make();
    craftWeapon(s.forge, s.resources[0], 0, "stone-axe");
    return s;
  }
  it("3초 뒤에 끼워지고 무기는 인벤토리에서 빠진다", () => {
    const s = armed();
    expect(startEquip(s.forge, 0, TEAM, "dwargon", "stone-axe", 0, true)).toEqual({ ok: true });
    expect(s.forge.inventory[0]["stone-axe"]).toBe(0);
    expect(finishEquips(s.forge, EQUIP_TICKS - 1, () => true)).toEqual([]);
    expect(finishEquips(s.forge, EQUIP_TICKS, () => true)).toEqual([{ seat: 0, characterId: "dwargon", weaponId: "stone-axe" }]);
    expect(s.forge.equipped[0]).toEqual({ dwargon: "stone-axe" });
  });
  it("바꾸면 이전 무기는 인벤토리로 돌아온다 (캐릭터당 슬롯 1개)", () => {
    const s = armed();
    startEquip(s.forge, 0, TEAM, "dwargon", "stone-axe", 0, true);
    finishEquips(s.forge, EQUIP_TICKS, () => true);
    s.resources[0].branch = 3;
    craftWeapon(s.forge, s.resources[0], 0, "wood-bow");
    startEquip(s.forge, 0, TEAM, "dwargon", "wood-bow", 100, true);
    finishEquips(s.forge, 100 + EQUIP_TICKS, () => true);
    expect(s.forge.equipped[0]).toEqual({ dwargon: "wood-bow" });
    expect(s.forge.inventory[0]["stone-axe"]).toBe(1);
  });
  it("정비 구간 밖이면 시작할 수 없고, 끼우는 동안 벗어나면 취소되어 무기가 돌아온다", () => {
    const s = armed();
    expect(startEquip(s.forge, 0, TEAM, "dwargon", "stone-axe", 0, false)).toEqual({ ok: false, code: "not_in_zone" });
    expect(s.forge.inventory[0]["stone-axe"]).toBe(1);
    startEquip(s.forge, 0, TEAM, "dwargon", "stone-axe", 0, true);
    expect(finishEquips(s.forge, EQUIP_TICKS, () => false)).toEqual([]);
    expect(s.forge.inventory[0]["stone-axe"]).toBe(1);
    expect(s.forge.equipped[0]).toEqual({});
  });
  it("거절 조건: 내 팀이 아님, 무기가 없음, 이미 끼우는 중, 이미 끼고 있음", () => {
    const s = armed();
    expect(startEquip(s.forge, 0, TEAM, "richmond", "stone-axe", 0, true)).toEqual({ ok: false, code: "not_your_character" });
    expect(startEquip(s.forge, 0, TEAM, "dwargon", "wood-bow", 0, true)).toEqual({ ok: false, code: "no_weapon" });
    expect(startEquip(s.forge, 0, TEAM, "dwargon", "nope", 0, true)).toEqual({ ok: false, code: "unknown_weapon" });
    startEquip(s.forge, 0, TEAM, "dwargon", "stone-axe", 0, true);
    s.resources[0].branch = 3;
    craftWeapon(s.forge, s.resources[0], 0, "wood-bow");
    expect(startEquip(s.forge, 0, TEAM, "dwargon", "wood-bow", 0, true)).toEqual({ ok: false, code: "already_equipping" });
    finishEquips(s.forge, EQUIP_TICKS, () => true);
    s.forge.inventory[0]["stone-axe"] = 1;
    expect(startEquip(s.forge, 0, TEAM, "dwargon", "stone-axe", 50, true)).toEqual({ ok: false, code: "already_equipped" });
  });
});

describe("보이는 정보", () => {
  it("상대의 인벤토리, 장착, 재련은 스냅샷에 없다", () => {
    const s = make();
    craftWeapon(s.forge, s.resources[1], 1, "wood-bow");
    s.forge.equipped[1] = { lappus: "wood-bow" };
    s.resources[1].ore = 1;
    startSmelting(s.forge, s.resources[1], pool(s), 1, 0);
    const mine = toForgeSnapshot(s.forge, 0, 1, 7);
    const theirs = toForgeSnapshot(s.forge, 0, 0, 10);
    expect(mine.inventory).toEqual({ "wood-bow": 1 });
    expect(mine.smelters.filter(Boolean)).toHaveLength(1);
    expect(theirs.inventory).toEqual({});
    expect(theirs.equipped).toEqual({});
    expect(theirs.smelters.filter(Boolean)).toHaveLength(0);
    expect(JSON.stringify(theirs)).not.toContain("wood-bow");
    expect(toForgeSnapshot(s.forge, 0, null, 0).inventory).toEqual({});
  });
});
