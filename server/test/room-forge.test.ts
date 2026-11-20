import { describe, expect, it } from "vitest";
import { createBattle, towerById, unitById } from "../src/battle/core";
import type { BattleState, Unit } from "../src/battle/core";
import { stepBattle } from "../src/battle/sim";
import { toBattleSnapshot } from "../src/battle/snapshot";
import { parseClientMessage } from "../src/protocol";
import type { Lane } from "../src/protocol";
import {
  advancePhase,
  createRoom,
  joinRoom,
  playerBan,
  playerForge,
  playerLock,
  playerPick,
  playerUltimate,
  setReady,
  toSnapshot,
} from "../src/room-state";

const zero = () => 0;

// ---- 무기가 전투에 미치는 영향 ----

const member = (characterId: string, weapon: string | null = null, lane: Lane = "center") => ({ characterId, lane, weapon });
function duel(a: [string, string | null], b: [string, string | null]): BattleState {
  const s = createBattle({ teams: [[member(...a)], [member(...b)]], secondPicker: 1, tuning: { unitDamageScale: 1 } });
  for (const t of s.towers) t.skillReadyTick = Infinity;
  for (const u of s.units) u.skillReadyTick = Infinity;
  const [x, y] = s.units as [Unit, Unit];
  x.pos = 50;
  y.pos = 51;
  return s;
}
const dmgTo = (s: BattleState, id: string, ticks = 1) => {
  const u = unitById(s, id)!;
  const before = u.hp;
  for (let i = 0; i < ticks; i++) stepBattle(s);
  return before - u.hp;
};

describe("무기와 전투", () => {
  it("무기를 끼면 공격력이 오른다 (돌도끼 +12%)", () => {
    const plain = duel(["dwargon", null], ["lappus", null]);
    const armed = duel(["dwargon", "stone-axe"], ["lappus", null]);
    const base = dmgTo(plain, "1:lappus");
    const boosted = dmgTo(armed, "1:lappus");
    expect(boosted / base).toBeCloseTo(1.12, 2);
  });

  it("상성이 유리하면 피해가 1.2배, 불리하면 0.85배", () => {
    const neutral = dmgTo(duel(["dwargon", "stone-axe"], ["lappus", "stone-axe"]), "1:lappus");
    const good = dmgTo(duel(["dwargon", "stone-axe"], ["lappus", "wood-spear"]), "1:lappus"); // 중량 > 장병
    const bad = dmgTo(duel(["dwargon", "stone-axe"], ["lappus", "wood-bow"]), "1:lappus"); // 원거리 > 중량
    expect(good / neutral).toBeCloseTo(1.2, 2);
    expect(bad / neutral).toBeCloseTo(0.85, 2);
  });

  it("무기가 없는 쪽에게는 상성이 없다", () => {
    const a = dmgTo(duel(["dwargon", "stone-axe"], ["lappus", null]), "1:lappus");
    const b = dmgTo(duel(["dwargon", "stone-axe"], ["lappus", "stone-axe"]), "1:lappus");
    expect(a).toBeCloseTo(b, 5);
  });

  it("화염 도끼: 기본 공격이 화상을 건다", () => {
    const s = duel(["dwargon", "flame-axe"], ["lappus", null]);
    stepBattle(s);
    expect(unitById(s, "1:lappus")!.effects.some((e) => e.type === "dot")).toBe(true);
  });

  it("서리 활: 기본 공격이 이동을 늦춘다", () => {
    const s = duel(["lappus", "frost-bow"], ["dwargon", null]);
    stepBattle(s);
    expect(unitById(s, "1:dwargon")!.effects.some((e) => e.type === "slow")).toBe(true);
  });

  it("흡혈 창: 준 피해의 10%를 회복한다", () => {
    const s = duel(["dwargon", "vampire-spear"], ["lappus", null]);
    const me = unitById(s, "0:dwargon")!;
    me.hp = 500;
    unitById(s, "1:lappus")!.effects.push({ type: "stun", value: 1, untilTick: 100 }); // 반격을 못 하게
    const dealt = dmgTo(s, "1:lappus");
    expect(me.hp).toBeCloseTo(500 + dealt * 0.1, 1);
  });

  it("부활해도 무기가 유지되고, 상대에게는 맞붙기 전까지 무기가 보이지 않는다", () => {
    const s = duel(["dwargon", "stone-axe"], ["lappus", "wood-bow"]);
    const far = createBattle({ teams: [[member("dwargon", "stone-axe")], [member("lappus", "wood-bow")]], secondPicker: 1 });
    const hidden = toBattleSnapshot(far, 1).units.find((u) => u.seat === 0)!;
    expect(hidden.weapon).toBeNull();
    expect(toBattleSnapshot(far, 0).units.find((u) => u.seat === 0)!.weapon).toBe("stone-axe");
    expect(toBattleSnapshot(s, 1).units.find((u) => u.seat === 0)!.weapon).toBe("stone-axe"); // 맞붙었다
    const me = unitById(s, "0:dwargon")!;
    me.hp = 0;
    stepBattle(s);
    expect(me.weapon).toBe("stone-axe");
  });
});

// ---- 방 흐름 ----

function forgeRoom() {
  let n = 0;
  const newId = () => `id${++n}`;
  const state = createRoom("ABCD", 0);
  const a = joinRoom(state, { name: "에드" }, 0, newId);
  const b = joinRoom(state, { name: "민수" }, 0, newId);
  if (!a.ok || !b.ok) throw new Error("join");
  const A = a.player.id;
  const B = b.player.id;
  setReady(state, A, true, 0, 1, zero);
  setReady(state, B, true, 0, 1, zero);
  playerBan(state, A, "ancient-lord", 0, 1, zero);
  playerBan(state, B, "xenosaurs", 0, 1, zero);
  const order = [A, B, B, A, A, B, B, A, A, B];
  const ids = ["richmond", "rosmaktia", "toka-loga", "dwargon", "raufaino", "for-the-more", "lappus", "bwtkan-jaws", "ankio", "nut-wolf"];
  ids.forEach((id, i) => playerPick(state, order[i]!, id, 0, 1, zero));
  playerLock(state, A, 0, 1, zero);
  playerLock(state, B, 0, 1, zero);
  expect(state.phase).toBe("explore");
  return { state, A, B, start: state.phaseStartedAt };
}

const forge = (state: ReturnType<typeof forgeRoom>["state"], id: string, cmd: Parameters<typeof playerForge>[2], at: number) =>
  playerForge(state, id, cmd, at, 1, zero);

describe("방에서의 대장간", () => {
  it("탐사 단계에서 광석을 사고 재련하고 조합하고 장착한다", () => {
    const { state, A, start } = forgeRoom();
    // A 팀: richmond, dwargon, raufaino, ankio, ... (A가 뽑은 캐릭터)
    expect(forge(state, A, { t: "forge", action: "buy", quantity: 1 }, start + 100)).toEqual({ ok: true, advanced: false });
    expect(toSnapshot(state, start + 100, A).explore!.resources!.ore).toBe(1);
    expect(toSnapshot(state, start + 100, A).forge!.orePrice).toBe(3); // 리치몬드: 25% 할인
    expect(forge(state, A, { t: "forge", action: "smelt" }, start + 200)).toEqual({ ok: true, advanced: false });
    expect(toSnapshot(state, start + 200, A).forge!.steam).toBeLessThanOrEqual(7.1);
    expect(forge(state, A, { t: "forge", action: "craft", weaponId: "stone-axe" }, start + 300)).toEqual({ ok: true, advanced: false });
    expect(forge(state, A, { t: "forge", action: "equip", weaponId: "stone-axe", characterId: "dwargon" }, start + 400)).toEqual({ ok: true, advanced: false });
    advancePhase(state, start + 4_000, 1, zero);
    expect(toSnapshot(state, start + 4_000, A).forge!.equipped).toEqual({ dwargon: "stone-axe" });
  });

  it("재련이 끝나면 철괴가 생긴다", () => {
    const { state, A, start } = forgeRoom();
    forge(state, A, { t: "forge", action: "buy", quantity: 1 }, start);
    forge(state, A, { t: "forge", action: "smelt" }, start);
    advancePhase(state, start + 15_500, 1, zero);
    expect(toSnapshot(state, start + 15_500, A).explore!.resources!.ironIngot).toBe(1);
  });

  it("실패하면 오류 코드를 준다", () => {
    const { state, A, B, start } = forgeRoom();
    expect(forge(state, A, { t: "forge", action: "smelt" }, start)).toMatchObject({ ok: false, code: "not_enough_materials" });
    expect(forge(state, A, { t: "forge", action: "craft", weaponId: "iron-axe" }, start)).toMatchObject({ ok: false, code: "not_enough_materials" });
    expect(forge(state, A, { t: "forge", action: "equip", weaponId: "stone-axe", characterId: "dwargon" }, start)).toMatchObject({ ok: false, code: "no_weapon" });
    expect(forge(state, B, { t: "forge", action: "buy", quantity: 99 }, start)).toMatchObject({ ok: false, code: "invalid_quantity" });
    expect(forge(state, B, { t: "forge", action: "equip", weaponId: "stone-axe", characterId: "dwargon" }, start)).toMatchObject({ ok: false });
  });

  it("상대의 재료와 무기는 내 스냅샷에 없다", () => {
    const { state, A, B, start } = forgeRoom();
    forge(state, B, { t: "forge", action: "craft", weaponId: "wood-bow" }, start);
    const forA = toSnapshot(state, start, A);
    expect(forA.forge!.inventory).toEqual({});
    expect(toSnapshot(state, start, B).forge!.inventory).toEqual({ "wood-bow": 1 });
  });

  it("전투가 시작되면 장착한 무기와 남은 스팀포스가 전투로 넘어간다", () => {
    const { state, A, start } = forgeRoom();
    forge(state, A, { t: "forge", action: "craft", weaponId: "wood-bow" }, start);
    forge(state, A, { t: "forge", action: "equip", weaponId: "wood-bow", characterId: "dwargon" }, start);
    forge(state, A, { t: "forge", action: "buy", quantity: 1 }, start);
    forge(state, A, { t: "forge", action: "smelt" }, start); // 스팀포스 3 사용
    advancePhase(state, start + 40_000, 1, zero);
    expect(state.phase).toBe("battle");
    expect(unitById(state.battle!, "0:dwargon")!.weapon).toBe("wood-bow");
    expect(toSnapshot(state, start + 40_000, A).battle!.steam).toBeGreaterThan(9); // 40초 동안 다시 찼다
    expect(state.explore!.forge.steamActive).toBe(false);
  });

  it("전투 중 재련은 전투의 스팀포스를 쓴다", () => {
    const { state, A, start } = forgeRoom();
    advancePhase(state, start + 40_000, 1, zero);
    forge(state, A, { t: "forge", action: "buy", quantity: 1 }, start + 40_100);
    const before = state.battle!.steam[0];
    forge(state, A, { t: "forge", action: "smelt" }, start + 40_100);
    expect(state.battle!.steam[0]).toBeLessThan(before - 2.5);
  });

  it("전투 중에는 본진이나 아군 가드 타워 근처에서만 장착할 수 있다", () => {
    const { state, A, start } = forgeRoom();
    advancePhase(state, start + 40_000, 1, zero);
    forge(state, A, { t: "forge", action: "craft", weaponId: "wood-bow" }, start + 40_000);
    const u = unitById(state.battle!, "0:dwargon")!;
    u.pos = 60;
    for (const t of state.battle!.towers) if (t.seat === 0 && t.lane === u.lane) t.alive = false;
    expect(forge(state, A, { t: "forge", action: "equip", weaponId: "wood-bow", characterId: "dwargon" }, start + 40_100)).toMatchObject({
      ok: false,
      code: "not_in_zone",
    });
    u.pos = 5; // 본진 근처
    expect(forge(state, A, { t: "forge", action: "equip", weaponId: "wood-bow", characterId: "dwargon" }, start + 40_100)).toMatchObject({ ok: true });
  });

  it("전투 중 장착이 끝나면 그 캐릭터에게 바로 적용된다", () => {
    const { state, A, start } = forgeRoom();
    advancePhase(state, start + 40_000, 1, zero);
    forge(state, A, { t: "forge", action: "craft", weaponId: "wood-bow" }, start + 40_000);
    unitById(state.battle!, "0:dwargon")!.pos = 3;
    forge(state, A, { t: "forge", action: "equip", weaponId: "wood-bow", characterId: "dwargon" }, start + 40_000);
    advancePhase(state, start + 40_000 + 3_500, 1, zero);
    expect(unitById(state.battle!, "0:dwargon")!.weapon).toBe("wood-bow");
  });

  it("리치몬드의 황금 계약: 탈런트 +8과 재련 단축이 탐사 자원에 반영된다", () => {
    const { state, A, start } = forgeRoom();
    forge(state, A, { t: "forge", action: "buy", quantity: 1 }, start);
    forge(state, A, { t: "forge", action: "smelt" }, start);
    advancePhase(state, start + 40_000, 1, zero);
    const talent = state.explore!.resources[0].talent;
    expect(playerUltimate(state, A, "richmond", undefined, start + 40_000, 1, zero)).toMatchObject({ ok: true });
    expect(state.explore!.resources[0].talent).toBe(talent + 8);
  });

  it("전투가 아닌 단계(배치 이전)에는 대장간을 쓸 수 없다", () => {
    const { state, A } = forgeRoom();
    state.phase = "placement";
    expect(playerForge(state, A, { t: "forge", action: "buy", quantity: 1 }, 1, 1, zero)).toMatchObject({ ok: false, code: "wrong_phase" });
  });

  it("JSON으로 저장했다가 되살려도 이어서 진행된다", () => {
    const { state, A, start } = forgeRoom();
    forge(state, A, { t: "forge", action: "craft", weaponId: "wood-bow" }, start);
    forge(state, A, { t: "forge", action: "equip", weaponId: "wood-bow", characterId: "dwargon" }, start);
    const restored = JSON.parse(JSON.stringify(state)) as typeof state;
    advancePhase(restored, start + 41_000, 1, zero);
    expect(unitById(restored.battle!, "0:dwargon")!.weapon).toBe("wood-bow");
  });
});

describe("forge 메시지 파싱", () => {
  it("올바른 메시지만 받는다", () => {
    expect(parseClientMessage('{"t":"forge","action":"buy"}')).toEqual({ t: "forge", action: "buy", quantity: 1 });
    expect(parseClientMessage('{"t":"forge","action":"buy","quantity":3}')).toEqual({ t: "forge", action: "buy", quantity: 3 });
    expect(parseClientMessage('{"t":"forge","action":"smelt"}')).toEqual({ t: "forge", action: "smelt" });
    expect(parseClientMessage('{"t":"forge","action":"craft","weaponId":"stone-axe"}')).toEqual({ t: "forge", action: "craft", weaponId: "stone-axe" });
    expect(parseClientMessage('{"t":"forge","action":"equip","weaponId":"a","characterId":"b"}')).toEqual({ t: "forge", action: "equip", weaponId: "a", characterId: "b" });
    for (const bad of [
      '{"t":"forge"}',
      '{"t":"forge","action":"steal"}',
      '{"t":"forge","action":"buy","quantity":0}',
      '{"t":"forge","action":"buy","quantity":"2"}',
      '{"t":"forge","action":"craft"}',
      '{"t":"forge","action":"equip","weaponId":"a"}',
    ]) {
      expect(parseClientMessage(bad), bad).toBeNull();
    }
  });
});

void towerById;
