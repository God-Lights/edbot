import { describe, expect, it } from "vitest";
import { createBattle, seconds, towerById, unitById } from "../src/battle/core";
import type { BattleState, Unit } from "../src/battle/core";
import { stepBattle, useUltimate } from "../src/battle/sim";
import type { Lane } from "../src/protocol";

const team = (ids: string[], lane: Lane = "center") => ids.map((characterId) => ({ characterId, lane }));

function battle(a: string[], b: string[], lane: Lane = "center"): BattleState {
  return createBattle({ teams: [team(a, lane), team(b, lane)], secondPicker: 1, tuning: { unitDamageScale: 1 } });
}
const unit = (s: BattleState, seat: 0 | 1, id: string): Unit => unitById(s, `${seat}:${id}`)!;
const tower = (s: BattleState, seat: 0 | 1, lane: Lane, order: 0 | 1 | 2) => towerById(s, `t${seat}:${lane}:${order}`)!;
const run = (s: BattleState, ticks: number) => {
  for (let i = 0; i < ticks; i++) stepBattle(s);
};
const place = (s: BattleState, seat: 0 | 1, id: string, pos: number) => {
  const u = unit(s, seat, id);
  u.pos = pos;
  return u;
};
/** 지정한 캐릭터만 스킬을 쓰게 하고 나머지는 끈다. 아무도 지정하지 않으면 모두 끈다. */
function onlySkills(s: BattleState, ...ids: string[]) {
  for (const u of s.units) if (!ids.includes(u.characterId)) u.skillReadyTick = Infinity;
  for (const t of s.towers) t.skillReadyTick = Infinity;
}
const hasEffect = (u: Unit, type: string) => u.effects.some((e) => e.type === type);

describe("패시브", () => {
  it("고대의 위엄: 주변 아군이 받는 피해 -10%", () => {
    const s = battle(["ancient-lord", "xenosaurs"], ["lappus"]);
    onlySkills(s);
    run(s, 1);
    expect(unit(s, 0, "ancient-lord").mods.dmgTaken).toBeCloseTo(0.9, 5);
    expect(unit(s, 0, "xenosaurs").mods.dmgTaken).toBeCloseTo(0.9, 5);
    expect(unit(s, 1, "lappus").mods.dmgTaken).toBe(1);
  });

  it("고대의 위엄은 멀리 있는 아군에게는 미치지 않는다", () => {
    const s = battle(["ancient-lord", "xenosaurs"], ["lappus"]);
    onlySkills(s);
    place(s, 0, "xenosaurs", 40);
    run(s, 1);
    expect(unit(s, 0, "xenosaurs").mods.dmgTaken).toBe(1);
  });

  it("용의 비늘: 받는 피해 -10%, 타워에 주는 피해 +30%", () => {
    const s = battle(["dwargon"], ["lappus"]);
    onlySkills(s);
    run(s, 1);
    expect(unit(s, 0, "dwargon").mods.dmgTaken).toBeCloseTo(0.9, 5);
    expect(unit(s, 0, "dwargon").mods.towerDmg).toBeCloseTo(1.3, 5);
  });

  it("철벽: 아군 가드 타워 구역 안에서만 받는 피해 -20%", () => {
    const s = battle(["raufaino"], ["lappus"]);
    onlySkills(s);
    place(s, 0, "raufaino", 30);
    run(s, 1);
    expect(unit(s, 0, "raufaino").mods.dmgTaken).toBeCloseTo(0.8, 5);

    const t = battle(["raufaino"], ["lappus"]);
    onlySkills(t);
    run(t, 1); // 본진 근처는 구역 밖
    expect(unit(t, 0, "raufaino").mods.dmgTaken).toBe(1);
  });

  it("더 많이 위하여: 주변 아군이 많을수록 공격력이 오르고 최대 +20%", () => {
    const two = battle(["for-the-more", "xenosaurs", "nut-wolf"], ["lappus"]);
    onlySkills(two);
    run(two, 1);
    expect(unit(two, 0, "xenosaurs").mods.atk).toBeCloseTo(1.1, 5); // 주변 아군 2명 -> +10%

    const four = battle(["for-the-more", "xenosaurs", "nut-wolf", "ankio", "dwargon"], ["lappus"]);
    onlySkills(four);
    run(four, 1);
    expect(unit(four, 0, "xenosaurs").mods.atk).toBeCloseTo(1.2, 5); // 4명 -> 상한 +20%
    expect(unit(four, 0, "for-the-more").mods.atk).toBeCloseTo(1.2, 5);
  });

  it("가시: 받은 피해의 15%를 공격자에게 되돌린다", () => {
    const s = battle(["rosmaktia"], ["dwargon"]);
    onlySkills(s);
    place(s, 0, "rosmaktia", 50);
    place(s, 1, "dwargon", 51);
    run(s, 1);
    expect(unit(s, 0, "rosmaktia").hp).toBeCloseTo(900 - 65, 5);
    // 로즈막티아의 공격 90 x 0.9(용의 비늘) = 81, 그리고 반사 65 x 15% = 9.75
    expect(unit(s, 1, "dwargon").hp).toBeCloseTo(1400 - 81 - 9.75, 5);
  });

  it("물어뜯기: 상대의 피해 감소를 20%만큼 무시한다", () => {
    const s = battle(["bwtkan-jaws"], ["dwargon"]);
    onlySkills(s);
    place(s, 0, "bwtkan-jaws", 50);
    place(s, 1, "dwargon", 51);
    run(s, 1);
    // 용의 비늘 -10%의 20%를 무시 -> 받는 피해 x0.92. 부캉죠스 공격 80 -> 73.6
    expect(unit(s, 1, "dwargon").hp).toBeCloseTo(1400 - 73.6, 5);
  });

  it("승급한 폰은 공격력이 25% 오른다", () => {
    const s = battle(["nut-wolf"], ["lappus"]);
    onlySkills(s);
    unit(s, 0, "nut-wolf").promoted = true;
    run(s, 1);
    expect(unit(s, 0, "nut-wolf").mods.atk).toBeCloseTo(1.25, 5);
  });
});

describe("스킬 (자동 시전)", () => {
  it("군주의 호령: 주변 아군의 이동·공격 속도 +20%", () => {
    const s = battle(["ancient-lord", "xenosaurs"], ["lappus"]);
    onlySkills(s, "ancient-lord");
    place(s, 1, "lappus", 9); // 12 안에 적이 있어야 쓴다
    run(s, 1);
    expect(hasEffect(unit(s, 0, "xenosaurs"), "speedUp")).toBe(true);
    expect(hasEffect(unit(s, 0, "xenosaurs"), "atkSpeedUp")).toBe(true);
    expect(unit(s, 0, "ancient-lord").skillReadyTick).toBe(1 + seconds(20));
  });

  it("리치몬드의 투자: 탈런트 3을 쓰고 싸우는 아군의 공격력을 10초 동안 +25%", () => {
    const s = battle(["richmond", "xenosaurs"], ["lappus"]);
    onlySkills(s, "richmond");
    s.talent[0] = 10;
    place(s, 1, "lappus", 8);
    run(s, 1);
    expect(s.talentDelta[0]).toBe(-3);
    const boosted = s.units.filter((u) => u.seat === 0 && hasEffect(u, "atkUp"));
    expect(boosted).toHaveLength(1);
  });

  it("탈런트가 모자라면 투자하지 않는다", () => {
    const s = battle(["richmond", "xenosaurs"], ["lappus"]);
    onlySkills(s, "richmond");
    s.talent[0] = 2;
    place(s, 1, "lappus", 8);
    run(s, 30);
    expect(s.talentDelta[0]).toBe(0);
  });

  it("가시 채찍: 가까운 적에게 피해와 출혈", () => {
    const s = battle(["rosmaktia"], ["lappus"]);
    onlySkills(s, "rosmaktia");
    place(s, 0, "rosmaktia", 50);
    place(s, 1, "lappus", 52);
    run(s, 1);
    expect(hasEffect(unit(s, 1, "lappus"), "dot")).toBe(true);
    expect(unit(s, 1, "lappus").hp).toBeLessThan(750 - 100); // 90 x 1.2 = 108 + 기본 공격 90
  });

  it("토템 설치: 범위 안 적을 느리게 하고 받는 피해를 늘린다", () => {
    const s = battle(["toka-loga"], ["lappus", "xenosaurs"]);
    onlySkills(s, "toka-loga");
    place(s, 0, "toka-loga", 50);
    place(s, 1, "lappus", 58);
    place(s, 1, "xenosaurs", 60);
    run(s, 1);
    for (const id of ["lappus", "xenosaurs"]) {
      expect(hasEffect(unit(s, 1, id), "slow")).toBe(true);
      expect(hasEffect(unit(s, 1, id), "dmgTakenUp")).toBe(true);
    }
  });

  it("화염 숨결: 가드 타워에는 피해가 1.5배", () => {
    const s = battle(["dwargon"], ["lappus"]);
    onlySkills(s, "dwargon");
    s.units[1]!.alive = false;
    place(s, 0, "dwargon", 63);
    run(s, 1);
    // 기본 공격 65 x 1.3, 화염 숨결 65 x 1.5 x 1.5 x 1.3
    expect(tower(s, 1, "center", 0).hp).toBeCloseTo(1000 - 65 * 1.3 - 65 * 1.5 * 1.5 * 1.3, 4);
  });

  it("방패 돌진: 앞으로 달려가 적을 1초 기절시킨다", () => {
    const s = battle(["raufaino"], ["lappus"]);
    onlySkills(s, "raufaino");
    place(s, 0, "raufaino", 0);
    place(s, 1, "lappus", 8);
    run(s, 1);
    expect(unit(s, 0, "raufaino").pos).toBeGreaterThanOrEqual(6); // 최대 6만큼 돌진
    expect(hasEffect(unit(s, 1, "lappus"), "stun")).toBe(true);
  });

  it("함성: 주변 아군을 회복하고 공격 속도를 올린다", () => {
    const s = battle(["for-the-more", "xenosaurs"], ["lappus"]);
    onlySkills(s, "for-the-more");
    unit(s, 0, "xenosaurs").hp = 300;
    run(s, 1);
    expect(unit(s, 0, "xenosaurs").hp).toBeCloseTo(300 + 75, 0); // 최대 체력 750의 10%
    expect(hasEffect(unit(s, 0, "xenosaurs"), "atkSpeedUp")).toBe(true);
  });

  it("치유의 빛: 가장 다친 아군을 회복하고 화상과 출혈을 지운다", () => {
    const s = battle(["lappus", "raufaino"], ["xenosaurs"]);
    onlySkills(s, "lappus");
    const hurt = unit(s, 0, "raufaino");
    hurt.hp = 500;
    hurt.effects.push({ type: "dot", value: 8, untilTick: 100 });
    s.units.find((u) => u.id === "1:xenosaurs")!.alive = false;
    run(s, 1);
    // 최대 체력 1300의 20%에, 체력이 낮을수록 늘어난다(패시브): 260 x (1 + 0.615) = 420
    expect(hurt.hp).toBeGreaterThan(500 + 400);
    expect(hasEffect(hurt, "dot")).toBe(false);
  });

  it("돌진 물기: 멀리 있는 적에게 달려들어 기절시킨다", () => {
    const s = battle(["bwtkan-jaws"], ["lappus"]);
    onlySkills(s, "bwtkan-jaws");
    place(s, 1, "lappus", 12);
    run(s, 1);
    expect(unit(s, 0, "bwtkan-jaws").pos).toBeGreaterThan(9);
    expect(hasEffect(unit(s, 1, "lappus"), "stun")).toBe(true);
  });

  it("도토리 투척: 소형 피해와 이동 감소", () => {
    const s = battle(["nut-wolf"], ["lappus"]);
    onlySkills(s, "nut-wolf");
    place(s, 0, "nut-wolf", 45);
    place(s, 1, "lappus", 50);
    run(s, 1);
    expect(hasEffect(unit(s, 1, "lappus"), "slow")).toBe(true);
    expect(unit(s, 1, "lappus").hp).toBeLessThan(750 - 40); // 투척 48 + 기본 공격 60
  });

  it("산성 침: 적의 방어를 낮춰서 받는 피해를 늘린다", () => {
    const s = battle(["xenosaurs"], ["lappus"]);
    onlySkills(s, "xenosaurs");
    place(s, 0, "xenosaurs", 45);
    place(s, 1, "lappus", 50);
    run(s, 1);
    expect(hasEffect(unit(s, 1, "lappus"), "dmgTakenUp")).toBe(true);
  });

  it("스킬은 쓰고 나면 쿨다운이 지날 때까지 다시 쓰지 않는다", () => {
    const s = battle(["rosmaktia"], ["lappus"]);
    onlySkills(s, "rosmaktia");
    place(s, 0, "rosmaktia", 50);
    place(s, 1, "lappus", 52);
    run(s, 1);
    const first = unit(s, 0, "rosmaktia").skillReadyTick;
    expect(first).toBe(1 + seconds(8));
    run(s, 20);
    expect(unit(s, 0, "rosmaktia").skillReadyTick).toBe(first);
  });

  it("승급하면 스킬 쿨다운이 20% 줄어든다", () => {
    const s = battle(["nut-wolf"], ["lappus"]);
    onlySkills(s, "nut-wolf");
    unit(s, 0, "nut-wolf").promoted = true;
    place(s, 0, "nut-wolf", 45);
    place(s, 1, "lappus", 50);
    run(s, 1);
    expect(unit(s, 0, "nut-wolf").skillReadyTick).toBe(1 + Math.round(seconds(6) * 0.8));
  });
});

describe("궁극기", () => {
  it("고대의 맹약: 모든 아군이 8초 동안 받는 피해 -35%", () => {
    const s = battle(["ancient-lord", "xenosaurs"], ["lappus"]);
    onlySkills(s);
    expect(useUltimate(s, 0, "ancient-lord")).toEqual({ ok: true });
    run(s, 1);
    expect(unit(s, 0, "xenosaurs").mods.dmgTaken).toBeCloseTo(0.9 * 0.65, 5); // 오라와 함께
    expect(unit(s, 1, "lappus").mods.dmgTaken).toBe(1);
    run(s, seconds(8));
    expect(unit(s, 0, "xenosaurs").mods.dmgTaken).toBeCloseTo(0.9, 5);
  });

  it("만개: 주변 적에게 지속 피해를 주고, 처치하면 체력을 회복한다", () => {
    const s = battle(["rosmaktia"], ["lappus"]);
    onlySkills(s);
    const rose = place(s, 0, "rosmaktia", 50);
    const victim = place(s, 1, "lappus", 53);
    rose.hp = 500;
    victim.hp = 1;
    expect(useUltimate(s, 0, "rosmaktia")).toEqual({ ok: true });
    run(s, 1);
    expect(victim.alive).toBe(false);
    // 라푸스의 기본 공격 40을 맞고, 처치해서 최대 체력 900의 20% = 180 회복
    expect(rose.hp).toBeCloseTo(500 - 40 + 180, 3);
  });

  it("대주술: 낙뢰 3번이 1초 간격으로 떨어지고 타워에도 피해를 준다", () => {
    const s = battle(["toka-loga"], ["lappus"]);
    onlySkills(s);
    s.units[1]!.alive = false;
    const caster = place(s, 0, "toka-loga", 56);
    caster.speed = 0;
    const guard = tower(s, 1, "center", 0);
    expect(useUltimate(s, 0, "toka-loga")).toEqual({ ok: true });
    expect(s.projectiles).toHaveLength(3);
    expect(s.projectiles.map((p) => p.landTick)).toEqual([5, 15, 25]);
    run(s, 30);
    expect(s.projectiles).toHaveLength(0);
    // 낙뢰 85 x 2 = 170 x 3 = 510 + 기본 공격
    expect(guard.hp).toBeLessThanOrEqual(1000 - 510);
  });

  it("용암 파괴: 10초 동안 타워에 주는 피해가 2배", () => {
    const s = battle(["dwargon"], ["lappus"]);
    onlySkills(s);
    expect(useUltimate(s, 0, "dwargon")).toEqual({ ok: true });
    run(s, 1);
    expect(unit(s, 0, "dwargon").mods.towerDmg).toBeCloseTo(1.3 * 2, 5);
    run(s, seconds(10));
    expect(unit(s, 0, "dwargon").mods.towerDmg).toBeCloseTo(1.3, 5);
  });

  it("성채 전개: 벽이 적의 통로를 막고 주변 아군에게 보호막을 준다", () => {
    const s = battle(["raufaino", "xenosaurs"], ["lappus"]);
    onlySkills(s);
    const lappus = place(s, 1, "lappus", 20);
    lappus.speed = 4;
    expect(useUltimate(s, 0, "raufaino")).toEqual({ ok: true });
    expect(s.walls).toHaveLength(1);
    expect(s.walls[0]!.pos).toBeCloseTo(4, 5); // 시전자 앞 4
    expect(unit(s, 0, "xenosaurs").shield).toBeCloseTo(750 * 0.15, 5);

    run(s, seconds(7));
    expect(lappus.pos).toBeGreaterThanOrEqual(4.1 - 1e-9); // 벽 때문에 더 못 온다
    run(s, seconds(2)); // 벽이 사라진 뒤
    expect(s.walls).toHaveLength(0);
  });

  it("총공격 명령: 모든 아군의 공격력 +30%, 이동 속도 +20%", () => {
    const s = battle(["for-the-more", "xenosaurs"], ["lappus"]);
    onlySkills(s);
    expect(useUltimate(s, 0, "for-the-more")).toEqual({ ok: true });
    for (const id of ["for-the-more", "xenosaurs"]) {
      expect(hasEffect(unit(s, 0, id), "atkUp")).toBe(true);
      expect(hasEffect(unit(s, 0, id), "speedUp")).toBe(true);
    }
    expect(hasEffect(unit(s, 1, "lappus"), "atkUp")).toBe(false);
  });

  it("생명의 샘: 8초 동안 그 자리에 회복 구역을 만든다", () => {
    const s = battle(["lappus", "xenosaurs"], ["raufaino"]);
    onlySkills(s);
    s.units.find((u) => u.id === "1:raufaino")!.alive = false;
    place(s, 0, "lappus", 5);
    const ally = place(s, 0, "xenosaurs", 5);
    ally.speed = 0;
    ally.hp = 300;
    expect(useUltimate(s, 0, "lappus")).toEqual({ ok: true });
    expect(s.wells).toHaveLength(1);
    run(s, seconds(2));
    expect(ally.hp).toBeGreaterThan(300 + 750 * 0.03); // 초당 3%
    run(s, seconds(7));
    expect(s.wells).toHaveLength(0);
  });

  it("턱 파열: 대상을 6초 동안 움직이지 못하게 하고 지속 피해를 준다", () => {
    const s = battle(["bwtkan-jaws"], ["lappus"]);
    onlySkills(s);
    place(s, 1, "lappus", 12);
    expect(useUltimate(s, 0, "bwtkan-jaws")).toEqual({ ok: true });
    const victim = unit(s, 1, "lappus");
    expect(hasEffect(victim, "root")).toBe(true);
    expect(hasEffect(victim, "dot")).toBe(true);
    expect(unit(s, 0, "bwtkan-jaws").pos).toBeGreaterThan(9);
  });

  it("턱 파열은 적이 없으면 쓸 수 없다", () => {
    const s = battle(["bwtkan-jaws"], ["lappus"]);
    place(s, 1, "lappus", 90);
    expect(useUltimate(s, 0, "bwtkan-jaws")).toEqual({ ok: false, code: "no_target" });
    expect(s.steam[0]).toBe(10); // 실패하면 스팀포스를 쓰지 않는다
  });

  it("측면 기습: 원하는 레인의 가드 타워 뒤로 순간이동하고 그 타워의 스킬을 3초 막는다", () => {
    const s = battle(["ankio"], ["lappus"], "queenside");
    onlySkills(s);
    expect(useUltimate(s, 0, "ankio", "kingside")).toEqual({ ok: true });
    const ankio = unit(s, 0, "ankio");
    expect(ankio.lane).toBe("kingside");
    expect(ankio.pos).toBe(67); // 바깥 가드 타워(65)의 뒤
    expect(tower(s, 1, "kingside", 0).silencedUntilTick).toBe(seconds(3));
  });

  it("측면 기습은 레인을 골라야 하고, 가드 타워가 없는 레인으로는 갈 수 없다", () => {
    const s = battle(["ankio"], ["lappus"]);
    expect(useUltimate(s, 0, "ankio")).toEqual({ ok: false, code: "invalid_lane" });
    tower(s, 1, "kingside", 0).alive = false;
    tower(s, 1, "kingside", 1).alive = false; // 메인만 남았다
    expect(useUltimate(s, 0, "ankio", "kingside")).toEqual({ ok: false, code: "invalid_lane" });
    expect(s.steam[0]).toBe(10);
  });

  it("늑대 울음: 분신 2마리가 8초 동안 싸우고 사라진다", () => {
    const s = battle(["nut-wolf"], ["lappus"]);
    onlySkills(s);
    expect(useUltimate(s, 0, "nut-wolf")).toEqual({ ok: true });
    const wolves = s.units.filter((u) => u.summon);
    expect(wolves).toHaveLength(2);
    const owner = unit(s, 0, "nut-wolf");
    expect(wolves[0]!.maxHp).toBeCloseTo(owner.maxHp * 0.4, 5);
    expect(wolves[0]!.atk).toBeCloseTo(owner.atk * 0.5, 5);
    run(s, seconds(8) + 2);
    expect(s.units.filter((u) => u.summon)).toHaveLength(0);
  });

  it("군체 부화: 6초 뒤 알에서 새끼 3마리가 깨어난다", () => {
    const s = battle(["xenosaurs"], ["lappus"]);
    onlySkills(s);
    expect(useUltimate(s, 0, "xenosaurs")).toEqual({ ok: true });
    expect(s.hatches).toHaveLength(3);
    expect(s.units.filter((u) => u.summon)).toHaveLength(0);
    run(s, seconds(6) - 1);
    expect(s.units.filter((u) => u.summon)).toHaveLength(0);
    run(s, 1);
    const hatchlings = s.units.filter((u) => u.characterId === "summon-hatchling");
    expect(hatchlings).toHaveLength(3);
    expect(hatchlings[0]!.maxHp).toBeCloseTo(750 * 0.3, 5);
    expect(s.hatches).toHaveLength(0);
  });

  it("황금 계약: 탈런트 +8을 받고 재련을 5초 단축한다", () => {
    const s = battle(["richmond"], ["lappus"]);
    expect(useUltimate(s, 0, "richmond")).toEqual({ ok: true });
    expect(s.talentDelta[0]).toBe(8);
    expect(s.smeltHaste[0]).toBe(seconds(5));
    expect(s.steam[0]).toBe(5);
  });
});
