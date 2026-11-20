import { describe, expect, it } from "vitest";
import {
  GUARD_TOWER_HP,
  LANE_LENGTH,
  MAIN_TOWER_HP,
  RESPAWN_TICKS,
  createBattle,
  frontTower,
  seconds,
  towerById,
  unitById,
} from "../src/battle/core";
import type { BattleState, Unit } from "../src/battle/core";
import { finishByTime, moveLane, scoreWinner, startDeathmatch, stepBattle, useUltimate } from "../src/battle/sim";
import type { Lane } from "../src/protocol";

const team = (ids: string[], lane: Lane = "center") => ids.map((characterId) => ({ characterId, lane }));

/** 피해 계수 1로 만든 전투. 숫자를 그대로 검증할 수 있다. */
function battle(a: string[], b: string[], lane: Lane = "center", tuning = { unitDamageScale: 1 }): BattleState {
  return createBattle({ teams: [team(a, lane), team(b, lane)], secondPicker: 1, tuning });
}

const unit = (s: BattleState, seat: 0 | 1, id: string): Unit => unitById(s, `${seat}:${id}`)!;
const tower = (s: BattleState, seat: 0 | 1, lane: Lane, order: 0 | 1 | 2) => towerById(s, `t${seat}:${lane}:${order}`)!;

function run(s: BattleState, ticks: number): void {
  for (let i = 0; i < ticks; i++) stepBattle(s);
}

/** 스킬 자동 시전을 끈다. 기본 공격만 검증하고 싶을 때. */
function noSkills(s: BattleState): void {
  for (const u of s.units) u.skillReadyTick = Infinity;
  for (const t of s.towers) t.skillReadyTick = Infinity;
}

function place(s: BattleState, seat: 0 | 1, id: string, pos: number): Unit {
  const u = unit(s, seat, id);
  u.pos = pos;
  return u;
}

describe("전투 시작", () => {
  it("유닛 10명이 각자 본진에, 타워 18개가 정해진 자리에 선다", () => {
    const s = battle(["xenosaurs"], ["xenosaurs"]);
    expect(s.units).toHaveLength(2);
    expect(unit(s, 0, "xenosaurs").pos).toBe(0);
    expect(unit(s, 1, "xenosaurs").pos).toBe(LANE_LENGTH);

    expect(s.towers).toHaveLength(18);
    for (const lane of ["queenside", "center", "kingside"] as const) {
      expect(tower(s, 0, lane, 0).pos).toBe(35);
      expect(tower(s, 0, lane, 1).pos).toBe(22);
      expect(tower(s, 0, lane, 2).pos).toBe(10);
      expect(tower(s, 1, lane, 0).pos).toBe(65);
      expect(tower(s, 1, lane, 1).pos).toBe(78);
      expect(tower(s, 1, lane, 2).pos).toBe(90);
    }
  });

  it("가드 타워의 체력은 메인 타워의 절반 이하다", () => {
    expect(GUARD_TOWER_HP).toBeLessThanOrEqual(MAIN_TOWER_HP / 2);
    const s = battle(["xenosaurs"], ["xenosaurs"]);
    expect(tower(s, 0, "center", 0).hp).toBe(GUARD_TOWER_HP);
    expect(tower(s, 1, "kingside", 2).hp).toBe(MAIN_TOWER_HP);
  });

  it("스팀포스는 10에서 시작한다", () => {
    expect(battle(["xenosaurs"], ["xenosaurs"]).steam).toEqual([10, 10]);
  });

  it("기본 피해 계수는 0.6이다 (밸런스 시뮬레이션 결과)", () => {
    const s = createBattle({ teams: [team(["xenosaurs"]), team(["xenosaurs"])], secondPicker: 1 });
    expect(s.tuning.unitDamageScale).toBe(0.6);
  });
});

describe("이동과 교전", () => {
  it("유닛은 적 본진 쪽으로 속도만큼 걸어간다", () => {
    const s = battle(["raufaino"], ["raufaino"]); // 보통 속도 = 초당 4
    noSkills(s);
    run(s, 10);
    expect(unit(s, 0, "raufaino").pos).toBeCloseTo(4, 5);
    expect(unit(s, 1, "raufaino").pos).toBeCloseTo(96, 5);
  });

  it("마주친 두 유닛은 같은 틱에 서로 피해를 주고받는다 (먼저 움직인 쪽이 유리하지 않다)", () => {
    const s = battle(["xenosaurs"], ["xenosaurs"]);
    noSkills(s);
    place(s, 0, "xenosaurs", 50);
    place(s, 1, "xenosaurs", 51);
    run(s, 1);
    // 서로 55를 맞고, 제노사우로스의 산성 점액으로 근접 공격자가 8씩 되돌려 받는다.
    expect(unit(s, 0, "xenosaurs").hp).toBeCloseTo(750 - 55 - 8, 5);
    expect(unit(s, 1, "xenosaurs").hp).toBeCloseTo(750 - 55 - 8, 5);
  });

  it("사거리에 적이 있으면 멈춰서 싸운다", () => {
    const s = battle(["xenosaurs"], ["xenosaurs"]);
    noSkills(s);
    place(s, 0, "xenosaurs", 50);
    place(s, 1, "xenosaurs", 51);
    run(s, 5);
    expect(unit(s, 0, "xenosaurs").pos).toBe(50);
    expect(unit(s, 1, "xenosaurs").pos).toBe(51);
  });

  it("다른 레인의 유닛끼리는 싸우지 않는다", () => {
    const s = createBattle({
      teams: [team(["xenosaurs"], "queenside"), team(["xenosaurs"], "kingside")],
      secondPicker: 1,
      tuning: { unitDamageScale: 1 },
    });
    noSkills(s);
    place(s, 0, "xenosaurs", 50);
    place(s, 1, "xenosaurs", 51);
    run(s, 5);
    expect(unit(s, 0, "xenosaurs").hp).toBe(750);
    expect(unit(s, 1, "xenosaurs").hp).toBe(750);
  });

  it("피해 계수를 낮추면 받는 피해가 그만큼 줄어든다", () => {
    const s = createBattle({ teams: [team(["lappus"]), team(["lappus"])], secondPicker: 1 }); // 기본 0.6
    noSkills(s);
    place(s, 0, "lappus", 45);
    place(s, 1, "lappus", 50); // 사거리 10 안, 중립 구간
    run(s, 1);
    expect(unit(s, 0, "lappus").hp).toBeCloseTo(750 - 40 * 0.6, 5);
  });
});

describe("타워", () => {
  it("살아 있는 적 타워는 지나갈 수 없다", () => {
    const s = battle(["raufaino"], ["lappus"]);
    noSkills(s);
    place(s, 1, "lappus", 100);
    unit(s, 1, "lappus").alive = false; // 방해하지 않도록
    unit(s, 1, "lappus").respawnAtTick = null;
    place(s, 0, "raufaino", 64);
    run(s, 30);
    expect(unit(s, 0, "raufaino").pos).toBeLessThanOrEqual(64.9 + 1e-9);
  });

  it("가장 앞의 타워부터 공격하고 뒤의 타워는 건드리지 않는다", () => {
    const s = battle(["raufaino"], ["lappus"]);
    noSkills(s);
    unit(s, 1, "lappus").alive = false;
    place(s, 0, "raufaino", 63);
    run(s, 20);
    expect(tower(s, 1, "center", 0).hp).toBeLessThan(GUARD_TOWER_HP);
    expect(tower(s, 1, "center", 1).hp).toBe(GUARD_TOWER_HP);
    expect(tower(s, 1, "center", 2).hp).toBe(MAIN_TOWER_HP);
  });

  it("바깥 가드 → 안쪽 가드 → 메인 순서로만 부술 수 있다", () => {
    const s = battle(["raufaino"], ["lappus"]);
    expect(frontTower(s, 1, "center")!.order).toBe(0);
    tower(s, 1, "center", 0).alive = false;
    expect(frontTower(s, 1, "center")!.order).toBe(1);
    tower(s, 1, "center", 1).alive = false;
    expect(frontTower(s, 1, "center")!.order).toBe(2);
    tower(s, 1, "center", 2).alive = false;
    expect(frontTower(s, 1, "center")).toBeUndefined();
  });

  it("가드 타워 구역 안의 아군은 회복하고, 중립 구간에서는 회복하지 않는다", () => {
    const s = battle(["raufaino"], ["lappus"]);
    noSkills(s);
    unit(s, 1, "lappus").alive = false;
    const ally = place(s, 0, "raufaino", 30); // 아군 바깥 가드(35)의 구역 안
    ally.hp = 500;
    run(s, 10);
    expect(ally.hp).toBeGreaterThan(500 + 30); // 초당 3% = 39

    const t = battle(["raufaino"], ["lappus"]);
    noSkills(t);
    t.units[1]!.alive = false;
    const neutral = place(t, 0, "raufaino", 49); // 중립 구간 (45~55)
    neutral.hp = 500;
    neutral.speed = 0;
    run(t, 10);
    expect(neutral.hp).toBe(500);
  });

  it("적 가드 타워 구역 안의 유닛은 타워에게 공격받고 지속 피해를 입는다", () => {
    const s = battle(["raufaino"], ["lappus"]);
    noSkills(s);
    s.units[1]!.alive = false;
    const intruder = place(s, 0, "raufaino", 58); // 적 바깥 가드(65)의 구역 안, 타워 사거리 안
    intruder.speed = 0;
    run(s, 10);
    // 기본 공격 40(초당 1번) + 구역 12(초당) 가 들어간다.
    expect(intruder.hp).toBeLessThan(1300 - 40);
  });

  it("살아 있는 적이 없으면 타워는 공격하지 않는다", () => {
    const s = battle(["raufaino"], ["lappus"]);
    run(s, 50);
    expect(unit(s, 0, "raufaino").hp).toBe(1300);
  });

  it("화염 화살은 화상을 걸고, 대포는 늦게 떨어져서 움직이면 피할 수 있다", () => {
    const s = battle(["raufaino"], ["lappus"]);
    s.units[1]!.alive = false;
    const intruder = place(s, 0, "raufaino", 58);
    intruder.speed = 0;
    for (const t of s.towers) t.skillReadyTick = 0; // 바로 쓰게
    run(s, 1);
    expect(intruder.effects.some((e) => e.type === "dot")).toBe(true); // 화염 화살
    expect(s.projectiles).toHaveLength(0); // 가드 타워는 화살만 쏜다. 대포는 메인 타워가 쏜다.

    // 대포 검증: 메인 타워 사거리 안에서 포탄이 떨어질 위치에 있던 유닛만 맞는다.
    const c = battle(["raufaino"], ["lappus"]);
    c.units[1]!.alive = false;
    for (const t of c.towers) t.alive = t.kind === "main" && t.seat === 1 && t.lane === "center";
    for (const t of c.towers) if (t.alive) t.skillReadyTick = 0;
    const target = place(c, 0, "raufaino", 85);
    target.speed = 0;
    run(c, 1);
    expect(c.projectiles).toHaveLength(1);
    const landing = c.projectiles[0]!.pos;
    target.pos = landing - 20; // 포탄이 떨어지기 전에 피한다
    const before = target.hp;
    run(c, 12);
    expect(target.hp).toBe(before);
  });

  it("킹사이드 메인 타워는 체력이 절반 아래로 내려가면 일제 사격을 한 번만 한다", () => {
    const s = createBattle({
      teams: [team(["raufaino"], "kingside"), team(["lappus"], "kingside")],
      secondPicker: 1,
      tuning: { unitDamageScale: 1 },
    });
    s.units[1]!.alive = false;
    const main = tower(s, 1, "kingside", 2);
    tower(s, 1, "kingside", 0).alive = false;
    tower(s, 1, "kingside", 1).alive = false;
    main.hp = main.maxHp * 0.4;
    const attacker = place(s, 0, "raufaino", 85);
    attacker.speed = 0;
    run(s, 1);
    expect(main.salvoUsed).toBe(true);
    const afterFirst = attacker.hp;
    expect(afterFirst).toBeLessThan(1300 - 90); // 일제 사격 100
    run(s, 2);
    // 한 번만: 이후 틱에는 추가 100이 들어가지 않는다 (기본 공격 40이 쿨다운 중)
    expect(afterFirst - attacker.hp).toBeLessThan(60);
  });
});

describe("점수와 부활", () => {
  it("처치하면 +1점, 쓰러진 유닛은 8초 뒤 본진에서 되살아난다", () => {
    const s = battle(["xenosaurs"], ["lappus"]); // 라푸스는 비숍이라 부활이 8초
    noSkills(s);
    place(s, 0, "xenosaurs", 50);
    const victim = place(s, 1, "lappus", 51);
    victim.hp = 1;
    run(s, 1);
    expect(victim.alive).toBe(false);
    expect(s.score).toEqual([1, 0]);
    expect(s.kills).toEqual([1, 0]);
    expect(victim.respawnAtTick).toBe(1 + RESPAWN_TICKS);

    run(s, RESPAWN_TICKS - 1);
    expect(victim.alive).toBe(false);
    run(s, 1);
    expect(victim.alive).toBe(true);
    expect(victim.hp).toBe(victim.maxHp);
    expect(victim.pos).toBeGreaterThanOrEqual(99); // 본진에서 되살아나 그 틱에 한 걸음 움직인다
    expect(victim.pos).toBeLessThanOrEqual(100);
  });

  it("폰은 부활이 3초 빠르다", () => {
    const s = battle(["xenosaurs"], ["nut-wolf"]);
    noSkills(s);
    place(s, 0, "xenosaurs", 50);
    const victim = place(s, 1, "nut-wolf", 51);
    victim.hp = 1;
    run(s, 1);
    expect(victim.respawnAtTick).toBe(1 + RESPAWN_TICKS - seconds(3));
  });

  it("킹사이드 메인 타워는 +7점, 언더 타워는 +5점이고 가드 타워는 점수가 없다", () => {
    for (const [lane, expected] of [["kingside", 7], ["center", 5], ["queenside", 5]] as const) {
      const s = createBattle({
        teams: [team(["raufaino"], lane), team(["lappus"], lane)],
        secondPicker: 1,
        tuning: { unitDamageScale: 1 },
      });
      s.units[1]!.alive = false;
      noSkills(s);
      const guard = tower(s, 1, lane, 0);
      const attacker = place(s, 0, "raufaino", 63);
      guard.hp = 1;
      run(s, 1);
      expect(guard.alive).toBe(false);
      expect(s.score[0]).toBe(0); // 가드 타워는 점수가 없다

      tower(s, 1, lane, 1).alive = false;
      const main = tower(s, 1, lane, 2);
      main.hp = 1;
      attacker.pos = 88;
      run(s, 12); // 두 번째 공격은 첫 공격 1초(10틱) 뒤
      expect(main.alive).toBe(false);
      expect(s.score[0]).toBe(expected);
    }
  });

  it("한 팀의 메인 타워 3개가 모두 부서지면 바로 끝나고 점수가 높은 쪽이 이긴다", () => {
    const s = createBattle({
      teams: [team(["raufaino"], "kingside"), team(["lappus"], "kingside")],
      secondPicker: 1,
      tuning: { unitDamageScale: 1 },
    });
    s.units[1]!.alive = false;
    noSkills(s);
    for (const t of s.towers) {
      if (t.seat === 1 && t.lane !== "kingside") t.alive = false; // 다른 레인은 이미 부서졌다고 치고
    }
    tower(s, 1, "kingside", 0).alive = false;
    tower(s, 1, "kingside", 1).alive = false;
    tower(s, 1, "kingside", 2).hp = 1;
    place(s, 0, "raufaino", 88);
    expect(s.finished).toBe(false);
    run(s, 2);
    expect(s.finished).toBe(true);
    expect(s.winner).toBe(0);
    expect(s.reason).toBe("towers");
  });

  it("시간이 끝나면 점수가 높은 쪽이 이기고, 같으면 승자 없이 끝난다(데스매치로 간다)", () => {
    const s = battle(["xenosaurs"], ["xenosaurs"]);
    s.score = [8, 3];
    expect(scoreWinner(s)).toBe(0);
    finishByTime(s);
    expect(s).toMatchObject({ finished: true, winner: 0, reason: "time" });

    const tie = battle(["xenosaurs"], ["xenosaurs"]);
    tie.score = [5, 5];
    finishByTime(tie);
    expect(tie).toMatchObject({ finished: true, winner: null, reason: "time" });
  });

  it("폰이 타워를 부수면 승급해서 체력과 공격이 25% 오른다", () => {
    const s = battle(["nut-wolf"], ["lappus"]);
    s.units[1]!.alive = false;
    noSkills(s);
    const pawn = place(s, 0, "nut-wolf", 62);
    tower(s, 1, "center", 0).hp = 1;
    const maxBefore = pawn.maxHp;
    run(s, 1);
    expect(pawn.promoted).toBe(true);
    expect(pawn.maxHp).toBeCloseTo(maxBefore * 1.25, 5);
    expect(s.events.some((e) => e.type === "promote")).toBe(true);
  });

  it("소환수는 처치해도 점수를 주지 않고 부활하지 않는다", () => {
    const s = battle(["nut-wolf", "xenosaurs"], ["lappus"]);
    noSkills(s);
    expect(useUltimate(s, 0, "nut-wolf")).toEqual({ ok: true });
    const wolves = s.units.filter((u) => u.summon);
    expect(wolves).toHaveLength(2);
    const wolf = wolves[0]!;
    wolf.hp = -1;
    const before = [...s.score];
    run(s, 2); // 쓰러지는 틱 + 정리되는 다음 틱
    expect(s.score).toEqual(before as [number, number]);
    expect(s.units.find((u) => u.id === wolf.id)).toBeUndefined();
  });
});

describe("궁극기와 스팀포스", () => {
  it("스팀포스 5를 쓰고, 두 번이면 동나고, 시간이 지나면 회복한다", () => {
    const s = battle(["ancient-lord", "for-the-more", "dwargon"], ["lappus"]);
    expect(useUltimate(s, 0, "ancient-lord")).toEqual({ ok: true });
    expect(s.steam[0]).toBe(5);
    expect(useUltimate(s, 0, "for-the-more")).toEqual({ ok: true });
    expect(s.steam[0]).toBe(0);
    expect(useUltimate(s, 0, "dwargon")).toEqual({ ok: false, code: "not_enough_steam" });
    expect(s.steam[1]).toBe(10); // 상대는 그대로

    run(s, seconds(10)); // 초당 0.5
    expect(s.steam[0]).toBeCloseTo(5, 5);
  });

  it("같은 캐릭터는 40초 동안 다시 쓸 수 없다", () => {
    const s = battle(["ancient-lord"], ["lappus"]);
    expect(useUltimate(s, 0, "ancient-lord")).toEqual({ ok: true });
    run(s, seconds(39));
    expect(useUltimate(s, 0, "ancient-lord")).toEqual({ ok: false, code: "on_cooldown" });
    run(s, seconds(1));
    expect(useUltimate(s, 0, "ancient-lord")).toEqual({ ok: true });
  });

  it("쓰러진 캐릭터, 내 팀에 없는 캐릭터는 거절한다", () => {
    const s = battle(["ancient-lord", "richmond"], ["lappus"]);
    expect(useUltimate(s, 0, "lappus")).toEqual({ ok: false, code: "not_your_character" });
    unit(s, 0, "ancient-lord").alive = false;
    expect(useUltimate(s, 0, "ancient-lord")).toEqual({ ok: false, code: "unit_dead" });
    s.finished = true;
    expect(useUltimate(s, 1, "lappus")).toEqual({ ok: false, code: "wrong_phase" });
  });

  it("기절한 캐릭터는 궁극기를 쓸 수 없다", () => {
    const s = battle(["ancient-lord"], ["lappus"]);
    unit(s, 0, "ancient-lord").effects.push({ type: "stun", value: 0, untilTick: 50 });
    run(s, 1);
    expect(useUltimate(s, 0, "ancient-lord")).toEqual({ ok: false, code: "unit_disabled" });
  });
});

describe("나이트의 레인 이동", () => {
  it("나이트만 12초에 한 번 다른 레인으로 옮겨 갈 수 있다", () => {
    const s = battle(["ankio", "raufaino"], ["lappus"]);
    expect(moveLane(s, 0, "ankio", "kingside")).toEqual({ ok: true });
    expect(unit(s, 0, "ankio").lane).toBe("kingside");
    expect(moveLane(s, 0, "ankio", "queenside")).toEqual({ ok: false, code: "on_cooldown" });
    expect(moveLane(s, 0, "ankio", "kingside")).toEqual({ ok: false, code: "invalid_lane" });
    expect(moveLane(s, 0, "raufaino", "kingside")).toEqual({ ok: false, code: "not_a_knight" });
    run(s, seconds(12));
    expect(moveLane(s, 0, "ankio", "queenside")).toEqual({ ok: true });
  });

  it("새 레인의 적 타워를 넘은 위치로는 옮겨 갈 수 없다 (타워 앞으로 당겨진다)", () => {
    const s = battle(["ankio"], ["lappus"]);
    place(s, 0, "ankio", 80);
    moveLane(s, 0, "ankio", "kingside");
    expect(unit(s, 0, "ankio").pos).toBeLessThanOrEqual(64.9 + 1e-9);
  });
});

describe("데스매치", () => {
  it("전원이 센터 중앙에 모이고, 쓰러져 있던 캐릭터는 체력 50%로 되살아나며, 스팀포스가 가득 찬다", () => {
    const s = battle(["raufaino", "dwargon"], ["lappus", "xenosaurs"], "kingside");
    unit(s, 1, "lappus").alive = false;
    unit(s, 1, "lappus").respawnAtTick = 999;
    unit(s, 0, "dwargon").hp = 100;
    s.steam = [0, 0];
    s.score = [5, 5];
    startDeathmatch(s);

    expect(s.mode).toBe("deathmatch");
    expect(s.finished).toBe(false);
    for (const u of s.units) {
      expect(u.alive).toBe(true);
      expect(u.lane).toBe("center");
      expect(u.pos).toBeGreaterThan(40);
      expect(u.pos).toBeLessThan(60);
    }
    expect(unit(s, 1, "lappus").hp).toBeCloseTo(375, 5); // 750의 50%
    expect(unit(s, 0, "dwargon").hp).toBe(1400); // 살아 있던 캐릭터는 체력이 가득 찬다
    expect(s.steam).toEqual([10, 10]);
    expect(s.score).toEqual([5, 5]); // 점수는 그대로
  });

  it("한 팀이 전멸하면 그 즉시 끝나고, 쓰러져도 부활하지 않는다", () => {
    const s = battle(["raufaino"], ["lappus"]);
    startDeathmatch(s);
    noSkills(s);
    const victim = unit(s, 1, "lappus");
    place(s, 0, "raufaino", 50);
    place(s, 1, "lappus", 51);
    victim.hp = 1;
    run(s, 1);
    expect(victim.alive).toBe(false);
    expect(victim.respawnAtTick).toBeNull();
    expect(s).toMatchObject({ finished: true, winner: 0, reason: "deathmatch" });
    expect(s.score).toEqual([0, 0]); // 데스매치의 처치는 점수가 아니다
  });

  it("타워와 벽이 없어서 어디로든 갈 수 있다", () => {
    const s = battle(["raufaino"], ["lappus"]);
    startDeathmatch(s);
    noSkills(s);
    unit(s, 1, "lappus").speed = 0;
    run(s, 300);
    expect(unit(s, 0, "raufaino").pos).toBeGreaterThan(50); // 타워(65)에 막히지 않는다
  });

  it("시간이 끝나면 남은 체력 합이 많은 쪽 → 먼저 처치한 쪽 → 후공 팀 순서로 이긴다", () => {
    const hp = battle(["raufaino"], ["lappus"]);
    startDeathmatch(hp);
    unit(hp, 0, "raufaino").hp = 1000;
    unit(hp, 1, "lappus").hp = 700;
    finishByTime(hp);
    expect(hp).toMatchObject({ winner: 0, reason: "deathmatchTime" });

    const first = battle(["raufaino"], ["raufaino"]);
    startDeathmatch(first);
    first.firstDeathmatchKill = 0;
    finishByTime(first);
    expect(first.winner).toBe(0);

    const second = battle(["raufaino"], ["raufaino"]);
    startDeathmatch(second);
    finishByTime(second);
    expect(second.winner).toBe(1); // 후공 팀 (secondPicker = 1)
  });
});

describe("결정적 시뮬레이션", () => {
  it("같은 시작 조건과 같은 입력이면 틱마다 완전히 같은 상태가 된다", () => {
    const make = () =>
      createBattle({
        teams: [
          team(["ancient-lord", "rosmaktia", "bwtkan-jaws", "lappus", "nut-wolf"], "kingside"),
          team(["dwargon", "toka-loga", "ankio", "for-the-more", "xenosaurs"], "kingside"),
        ],
        secondPicker: 1,
      });
    const a = make();
    const b = make();
    for (let i = 0; i < 900; i++) {
      if (i === 200) {
        useUltimate(a, 0, "ancient-lord");
        useUltimate(b, 0, "ancient-lord");
      }
      if (i === 400) {
        useUltimate(a, 1, "toka-loga");
        useUltimate(b, 1, "toka-loga");
      }
      stepBattle(a);
      stepBattle(b);
    }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.tick).toBe(900);
  });

  it("종료된 전투는 더 이상 진행하지 않는다", () => {
    const s = battle(["raufaino"], ["lappus"]);
    s.finished = true;
    run(s, 10);
    expect(s.tick).toBe(0);
  });
});
