import { describe, expect, it } from "vitest";
import { CHARACTERS } from "../src/characters";
import { createBattle, queueHit, seconds, unitById } from "../src/battle/core";
import type { BattleState } from "../src/battle/core";
import { stepBattle } from "../src/battle/sim";
import { SYNERGIES, activeSynergyIds, combineEffects, neutralEffects } from "../src/synergy";
import { toGameSnapshot } from "../src/room-state";
import type { RoomState } from "../src/room-state";
import type { Lane } from "../src/protocol";

const KINGS = ["ancient-lord", "richmond"];
const QUEENS = ["rosmaktia", "toka-loga"];
const ROOKS = ["dwargon", "raufaino"];
const BISHOPS = ["for-the-more", "lappus"];
const KNIGHTS = ["bwtkan-jaws", "ankio"];
const PAWNS = ["nut-wolf", "xenosaurs"];

describe("시너지 판정", () => {
  it("시너지 id가 겹치지 않고 모두 설명이 있다", () => {
    expect(new Set(SYNERGIES.map((s) => s.id)).size).toBe(SYNERGIES.length);
    for (const s of SYNERGIES) {
      expect(s.nameKo.length).toBeGreaterThan(0);
      expect(s.requirement.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(0);
    }
  });

  it("같은 기물 2명이면 그 기물의 시너지가 켜진다", () => {
    expect(activeSynergyIds([...KINGS, "lappus"])).toContain("twin-kings");
    expect(activeSynergyIds([...QUEENS, "lappus"])).toContain("twin-queens");
    expect(activeSynergyIds([...ROOKS, "lappus"])).toContain("twin-rooks");
    expect(activeSynergyIds([...BISHOPS, "dwargon"])).toContain("twin-bishops");
    expect(activeSynergyIds([...KNIGHTS, "lappus"])).toContain("twin-knights");
    expect(activeSynergyIds([...PAWNS, "lappus"])).toContain("twin-pawns");
  });

  it("한 명뿐이면 켜지지 않는다", () => {
    expect(activeSynergyIds(["ancient-lord", "rosmaktia", "dwargon"])).toEqual([]);
    expect(activeSynergyIds([])).toEqual([]);
  });

  it("서로 다른 기물 4종 이상이면 정예 편성", () => {
    expect(activeSynergyIds(["ancient-lord", "rosmaktia", "dwargon", "lappus"])).toContain("diverse");
    expect(activeSynergyIds(["ancient-lord", "rosmaktia", "dwargon"])).not.toContain("diverse");
    expect(activeSynergyIds(["ancient-lord", "richmond", "rosmaktia", "toka-loga", "dwargon"])).not.toContain("diverse"); // 3종
  });

  it("특정 캐릭터 조합 시너지", () => {
    expect(activeSynergyIds(["raufaino", "lappus"])).toContain("bulwark-and-heal");
    expect(activeSynergyIds(["raufaino"])).not.toContain("bulwark-and-heal");
    expect(activeSynergyIds(["ancient-lord", "bwtkan-jaws"])).toContain("royal-charge");
  });

  it("여러 시너지가 함께 켜지고 효과가 합쳐진다", () => {
    const team = ["ancient-lord", "richmond", "raufaino", "lappus", "bwtkan-jaws"]; // 킹2, 룩/비숍/나이트 1명씩
    const ids = activeSynergyIds(team);
    expect(ids).toEqual(expect.arrayContaining(["twin-kings", "bulwark-and-heal", "royal-charge", "diverse"]));
    const fx = combineEffects(ids);
    expect(fx.dmgTaken).toBeCloseTo(0.95 * 0.95, 6); // 쌍왕 x 방벽과 치유
    expect(fx.speed).toBeCloseTo(1.05, 6);
    expect(fx.atk).toBeCloseTo(1.05, 6);
  });

  it("조건이 없으면 효과도 없다", () => {
    expect(combineEffects([])).toEqual(neutralEffects());
    expect(combineEffects(["없는-시너지"])).toEqual(neutralEffects());
  });

  it("뽑는 중에도 지금까지 뽑은 캐릭터로 계산한다 (드래프트 화면용)", () => {
    expect(activeSynergyIds(["dwargon"])).toEqual([]);
    expect(activeSynergyIds(["dwargon", "raufaino"])).toEqual(["twin-rooks"]);
  });

  it("5명을 어떻게 뽑아도 데이터에 없는 캐릭터는 무시한다", () => {
    expect(activeSynergyIds(["nobody", "ghost"])).toEqual([]);
  });
});

const member = (characterId: string, lane: Lane = "center") => ({ characterId, lane });
const make = (a: string[], b: string[], synergies?: boolean): BattleState =>
  createBattle({ teams: [a.map((x) => member(x)), b.map((x) => member(x))], secondPicker: 1, tuning: { unitDamageScale: 1 }, synergies });
const OPPONENT = ["lappus"]; // 시너지 없는 상대

describe("시너지가 전투에 주는 효과", () => {
  it("성가대: 최대 체력 +8% (시작할 때 한 번)", () => {
    const withSynergy = make([...BISHOPS, "dwargon"], OPPONENT);
    const base = CHARACTERS.find((c) => c.id === "dwargon")!.hp;
    expect(unitById(withSynergy, "0:dwargon")!.maxHp).toBeCloseTo(base * 1.08, 5);
    expect(unitById(withSynergy, "0:dwargon")!.hp).toBeCloseTo(base * 1.08, 5);
    expect(unitById(withSynergy, "1:lappus")!.maxHp).toBe(CHARACTERS.find((c) => c.id === "lappus")!.hp);
  });

  it("쌍왕: 받는 피해 -5%", () => {
    const s = make([...KINGS, "dwargon"], OPPONENT);
    stepBattle(s);
    // 에이션트 로드의 위엄 -10%, 드워곤의 용의 비늘 -10%와 함께
    expect(unitById(s, "0:dwargon")!.mods.dmgTaken).toBeCloseTo(0.9 * 0.9 * 0.95, 5);
  });

  it("기습조: 이동 속도 +8%", () => {
    const s = make([...KNIGHTS, "dwargon"], OPPONENT);
    stepBattle(s);
    expect(unitById(s, "0:dwargon")!.mods.speed).toBeCloseTo(1.08, 5);
  });

  it("철옹성: 타워에 주는 피해 +15%", () => {
    const s = make([...ROOKS, "lappus"], OPPONENT);
    stepBattle(s);
    expect(unitById(s, "0:lappus")!.mods.towerDmg).toBeCloseTo(1.15, 5);
    expect(unitById(s, "0:dwargon")!.mods.towerDmg).toBeCloseTo(1.3 * 1.15, 5); // 용의 비늘 +30%와 곱해진다
  });

  it("정예 편성: 공격력 +5%", () => {
    const s = make(["ancient-lord", "rosmaktia", "dwargon", "lappus"], OPPONENT);
    stepBattle(s);
    expect(unitById(s, "0:rosmaktia")!.mods.atk).toBeCloseTo(1.05, 5);
  });

  it("여왕의 화력: 스킬 쿨다운 -10%", () => {
    const s = make(["rosmaktia", "toka-loga", "lappus"], ["lappus"]);
    const rose = unitById(s, "0:rosmaktia")!;
    const enemy = unitById(s, "1:lappus")!;
    rose.pos = 50;
    enemy.pos = 52;
    s.units.filter((u) => u.id !== rose.id).forEach((u) => (u.skillReadyTick = Infinity));
    s.towers.forEach((t) => (t.skillReadyTick = Infinity));
    stepBattle(s);
    expect(rose.skillReadyTick).toBe(1 + Math.round(seconds(8) * 0.9)); // 가시 채찍 8초
  });

  it("병졸의 결의: 부활 시간 2초 단축 (폰은 이미 3초 단축)", () => {
    const s = make([...PAWNS, "lappus"], ["lappus", "dwargon"]);
    const pawn = unitById(s, "0:nut-wolf")!;
    queueHit(s, { targetKind: "unit", targetId: pawn.id, amount: 99999, srcSeat: 1, srcUnitId: null });
    stepBattle(s);
    expect(pawn.alive).toBe(false);
    expect(pawn.respawnAtTick! - s.tick).toBe(seconds(8) - seconds(3) - seconds(2));
  });

  it("시너지를 끄면 효과가 없다", () => {
    const s = make([...BISHOPS, "dwargon"], OPPONENT, false);
    expect(s.synergies).toEqual([[], []]);
    expect(unitById(s, "0:dwargon")!.maxHp).toBe(CHARACTERS.find((c) => c.id === "dwargon")!.hp);
  });

  it("양 팀의 시너지는 따로 계산된다", () => {
    const s = make([...KINGS, "lappus"], [...ROOKS, "ankio"]);
    expect(s.synergies[0]).toContain("twin-kings");
    expect(s.synergies[0]).not.toContain("twin-rooks");
    expect(s.synergies[1]).toContain("twin-rooks");
  });

  it("결정적이다: 같은 편성으로 두 번 돌리면 결과가 같다 (JSON으로 저장해도)", () => {
    const a = make([...BISHOPS, "dwargon", "ancient-lord", "bwtkan-jaws"], [...ROOKS, "ankio"]);
    const b = JSON.parse(JSON.stringify(a)) as BattleState;
    for (let i = 0; i < 300; i++) {
      stepBattle(a);
      stepBattle(b);
    }
    expect(b.units.map((u) => [u.id, u.pos, u.hp])).toEqual(a.units.map((u) => [u.id, u.pos, u.hp]));
  });
});

describe("방 상태에 담기는 시너지", () => {
  it("게임 스냅샷에 두 팀의 시너지가 들어간다 (뽑은 캐릭터는 공개라서 모두에게 보인다)", () => {
    const state = {
      phase: "draft",
      game: {
        firstPicker: 0, bans: ["x", "y"], banLocked: [true, true], pickOrder: [], picks: [["dwargon", "raufaino"], ["lappus"]],
        turnEndsAt: null, lanes: [{}, {}], placementLocked: [false, false],
      },
    } as unknown as RoomState;
    const snapshot = toGameSnapshot(state, 0)!;
    expect(snapshot.synergies).toEqual([["twin-rooks"], []]);
    expect(toGameSnapshot(state, 1)!.synergies).toEqual([["twin-rooks"], []]);
  });
});
