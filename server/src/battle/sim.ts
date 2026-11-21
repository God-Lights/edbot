// 전투 시뮬레이션: 한 틱(0.1초)을 진행하고, 플레이어의 명령(궁극기, 레인 이동)을 받는다.
//
// 한 틱의 순서
//  1. 정리: 끝난 효과·벽·샘·소환수 제거, 알 부화, 부활
//  2. 수정치 계산 (효과와 패시브), 스팀포스 회복
//  3. 타워의 행동 (구역 효과, 기본 공격, 스킬)
//  4. 늦게 떨어지는 공격(대포, 낙뢰) 착탄, 샘, 지속 피해, 만개
//  5. 유닛의 행동 (스킬, 공격, 이동)
//  6. 위의 3~5에서 쌓인 피해와 회복을 한꺼번에 반영하고, 쓰러진 유닛과 타워를 처리
//
// 피해를 쌓아 두었다가 한꺼번에 반영하기 때문에, 같은 틱에 서로 때려서 둘 다 쓰러지는 경우도
// 먼저 행동하는 쪽이 유리하지 않다.

import { characterById } from "../characters";
import { matchupMultiplier, weaponById } from "../forge/weapons";
import type { Lane, Seat } from "../protocol";
import {
  ATTACK_INTERVAL_TICKS,
  DT,
  GUARD_TOWER_ATTACK,
  LANE_MOVE_COOLDOWN_TICKS,
  MAIN_TOWER_ATTACK,
  PAWN_RESPAWN_BONUS_TICKS,
  RANGE_UNITS,
  RESPAWN_TICKS,
  SCORE_KILL,
  SCORE_KINGSIDE_MAIN,
  SCORE_UNDER_MAIN,
  STEAM_MAX,
  STEAM_PER_SECOND,
  TICKS_PER_SECOND,
  TOWER_RANGE,
  ULTIMATE_COOLDOWN_TICKS,
  ULTIMATE_STEAM_COST,
  ZONE_DAMAGE_PER_SEC,
  ZONE_HEAL_PCT,
  ZONE_RADIUS,
  addEffect,
  basePosition,
  distance,
  enemiesNear,
  frontTower,
  otherSeat,
  pushEvent,
  queueHeal,
  queueHit,
  seconds,
  towerById,
  unitById,
} from "./core";
import type { BattleReason, BattleState, Tower, Unit } from "./core";
import {
  SKILLS,
  ULTIMATES,
  applyBloom,
  clampPos,
  computeMods,
  currentAtk,
  hatchEggs,
  skillCooldown,
} from "./abilities";

const forward = (seat: Seat): 1 | -1 => (seat === 0 ? 1 : -1);

/** 처치에 점수를 주는 "캐릭터"인가. 소환수는 아니다. */
const isCharacter = (unit: Unit): boolean => unit.summon === null;

// ---------------------------------------------------------------------------
// 한 틱 진행
// ---------------------------------------------------------------------------

export function stepBattle(state: BattleState): void {
  if (state.finished) return;
  state.tick++;

  maintain(state);
  for (const unit of state.units) {
    if (unit.alive) unit.mods = computeMods(state, unit);
  }
  regenSteam(state);

  if (state.mode === "battle") {
    for (const tower of state.towers) {
      if (tower.alive) towerAct(state, tower);
    }
  }
  landProjectiles(state);
  applyWells(state);
  for (const unit of state.units) {
    if (!unit.alive) continue;
    applyDots(state, unit);
    applyBloom(state, unit);
  }
  // 이동은 틱 시작 위치를 기준으로 모두 정한 뒤 한꺼번에 적용한다.
  // (순서대로 움직이면 나중에 움직이는 쪽이 먼저 사거리에 들어온 상대를 먼저 때리게 되어 불공평하다)
  const moves: Array<{ unit: Unit; pos: number }> = [];
  for (const unit of state.units) {
    if (unit.alive) unitAct(state, unit, moves);
  }
  for (const move of moves) {
    if (move.unit.alive) move.unit.pos = clampPos(state, move.unit, move.pos);
  }

  resolve(state);
}

// ---------------------------------------------------------------------------
// 1. 정리
// ---------------------------------------------------------------------------

function maintain(state: BattleState): void {
  const t = state.tick;

  for (const unit of state.units) {
    unit.effects = unit.effects.filter((e) => e.untilTick > t);
    if (t >= unit.shieldUntilTick) unit.shield = 0;
    if (unit.alive && unit.summon && t >= unit.summon.expiresTick) unit.alive = false;
  }
  state.walls = state.walls.filter((w) => w.untilTick > t);
  state.wells = state.wells.filter((w) => w.untilTick > t);
  hatchEggs(state);

  for (const unit of state.units) {
    if (!unit.alive && unit.respawnAtTick !== null && t >= unit.respawnAtTick) {
      unit.alive = true;
      unit.respawnAtTick = null;
      unit.hp = unit.maxHp;
      unit.pos = basePosition(unit.seat);
      unit.effects = [];
      unit.shield = 0;
      unit.attackReadyTick = t;
      unit.lastAttackerId = null;
      unit.lastAttackerSeat = null;
      pushEvent(state, { type: "respawn", seat: unit.seat, unitId: unit.id });
    }
  }

  // 죽은 소환수는 정리한다. (죽은 캐릭터는 부활을 기다리므로 남겨 둔다)
  state.units = state.units.filter((u) => u.alive || u.summon === null);
}

function regenSteam(state: BattleState): void {
  for (const seat of [0, 1] as const) {
    state.steam[seat] = Math.min(STEAM_MAX, state.steam[seat] + STEAM_PER_SECOND * DT);
  }
}

// ---------------------------------------------------------------------------
// 3. 타워
// ---------------------------------------------------------------------------

function enemiesAt(state: BattleState, seat: Seat, lane: Lane, pos: number, radius: number): Unit[] {
  return state.units
    .filter((u) => u.alive && u.seat !== seat && u.lane === lane && Math.abs(u.pos - pos) <= radius)
    .sort((a, b) => Math.abs(a.pos - pos) - Math.abs(b.pos - pos) || (a.id < b.id ? -1 : 1));
}

function towerAct(state: BattleState, tower: Tower): void {
  const t = state.tick;

  // 가드 타워 구역: 아군은 회복하고 적은 지속 피해를 받는다.
  if (tower.kind === "guard") {
    for (const unit of state.units) {
      if (!unit.alive || unit.lane !== tower.lane || distance(unit, tower) > ZONE_RADIUS) continue;
      if (unit.seat === tower.seat) {
        if (unit.hp < unit.maxHp) queueHeal(state, unit.id, unit.maxHp * ZONE_HEAL_PCT * DT);
      } else {
        queueHit(state, {
          targetKind: "unit",
          targetId: unit.id,
          amount: ZONE_DAMAGE_PER_SEC * DT,
          srcSeat: tower.seat,
          srcUnitId: null,
          noReflect: true,
        });
      }
    }
  }

  const targets = enemiesAt(state, tower.seat, tower.lane, tower.pos, TOWER_RANGE);
  const target = targets[0];
  if (!target) return;

  // 기본 공격
  if (t >= tower.attackReadyTick) {
    queueHit(state, {
      targetKind: "unit",
      targetId: target.id,
      amount: tower.kind === "main" ? MAIN_TOWER_ATTACK : GUARD_TOWER_ATTACK,
      srcSeat: tower.seat,
      srcUnitId: null,
      noReflect: true,
    });
    tower.attackReadyTick = t + ATTACK_INTERVAL_TICKS;
  }

  // 킹사이드 메인 타워의 일제 사격: 체력이 절반 아래로 내려가면 범위 안의 모든 적에게 한 번
  if (tower.kind === "main" && tower.lane === "kingside" && !tower.salvoUsed && tower.hp < tower.maxHp * 0.5) {
    tower.salvoUsed = true;
    for (const enemy of targets) {
      queueHit(state, { targetKind: "unit", targetId: enemy.id, amount: 100, srcSeat: tower.seat, srcUnitId: null, noReflect: true });
    }
    pushEvent(state, { type: "skill", seat: tower.seat, targetId: tower.id, text: "salvo" });
  }

  // 스킬 (자동)
  if (t >= tower.skillReadyTick && t >= tower.silencedUntilTick) {
    if (tower.kind === "guard") {
      // 화염 화살 (6초): 가장 가까운 적에게 불화살, 화상으로 지속 피해
      queueHit(state, { targetKind: "unit", targetId: target.id, amount: 30, srcSeat: tower.seat, srcUnitId: null, noReflect: true });
      addEffect(target, { type: "dot", value: 8, untilTick: t + seconds(3) });
      tower.skillReadyTick = t + seconds(6);
    } else {
      // 대포 발사 (12초): 느리게 날아가는 포탄. 떨어지는 순간의 위치로 판정해서 움직이면 피할 수 있다.
      state.projectiles.push({
        landTick: t + seconds(1),
        seat: tower.seat,
        lane: tower.lane,
        pos: target.pos,
        radius: 4,
        unitDamage: 80,
        towerDamage: 0,
        srcUnitId: null,
        kind: "cannon",
      });
      tower.skillReadyTick = t + seconds(12);
    }
  }
}

// ---------------------------------------------------------------------------
// 4. 착탄, 샘, 지속 피해
// ---------------------------------------------------------------------------

function landProjectiles(state: BattleState): void {
  const due = state.projectiles.filter((p) => p.landTick <= state.tick);
  if (due.length === 0) return;
  state.projectiles = state.projectiles.filter((p) => p.landTick > state.tick);

  for (const p of due) {
    for (const unit of enemiesAt(state, p.seat, p.lane, p.pos, p.radius)) {
      queueHit(state, {
        targetKind: "unit",
        targetId: unit.id,
        amount: p.unitDamage,
        srcSeat: p.seat,
        srcUnitId: p.srcUnitId,
        noReflect: true,
      });
    }
    if (p.towerDamage > 0) {
      // 타워는 순서대로만 부술 수 있다: 가장 앞의 타워만 맞는다.
      const tower = frontTower(state, otherSeat(p.seat), p.lane);
      if (tower && Math.abs(tower.pos - p.pos) <= p.radius) {
        queueHit(state, {
          targetKind: "tower",
          targetId: tower.id,
          amount: p.towerDamage,
          srcSeat: p.seat,
          srcUnitId: p.srcUnitId,
          noReflect: true,
        });
      }
    }
  }
}

function applyWells(state: BattleState): void {
  for (const well of state.wells) {
    for (const unit of state.units) {
      if (unit.alive && unit.seat === well.seat && unit.lane === well.lane && Math.abs(unit.pos - well.pos) <= well.radius) {
        if (unit.hp < unit.maxHp) queueHeal(state, unit.id, unit.maxHp * ZONE_HEAL_PCT * DT);
      }
    }
  }
}

function applyDots(state: BattleState, unit: Unit): void {
  for (const effect of unit.effects) {
    if (effect.type !== "dot") continue;
    queueHit(state, {
      targetKind: "unit",
      targetId: unit.id,
      amount: effect.value * DT,
      srcSeat: otherSeat(unit.seat),
      srcUnitId: null,
      noReflect: true,
    });
  }
}

// ---------------------------------------------------------------------------
// 5. 유닛
// ---------------------------------------------------------------------------

type Target = { kind: "unit"; unit: Unit } | { kind: "tower"; tower: Tower };

function pickTarget(state: BattleState, unit: Unit): Target | null {
  const enemy = enemiesNear(state, unit, unit.range)[0];
  if (enemy) return { kind: "unit", unit: enemy };
  if (state.mode === "deathmatch") return null;
  const tower = frontTower(state, otherSeat(unit.seat), unit.lane);
  if (tower && distance(tower, unit) <= unit.range) return { kind: "tower", tower };
  return null;
}

function unitAct(state: BattleState, unit: Unit, moves: Array<{ unit: Unit; pos: number }>): void {
  const t = state.tick;
  if (unit.mods.stunned) return;

  const skill = unit.summon ? undefined : SKILLS[unit.characterId];
  if (skill && t >= unit.skillReadyTick && skill.shouldUse(state, unit)) {
    skill.use(state, unit);
    unit.skillReadyTick = t + skillCooldown(unit, skill, state.synergyFx[unit.seat].cooldown);
    pushEvent(state, { type: "skill", seat: unit.seat, unitId: unit.id });
  }

  const target = pickTarget(state, unit);
  if (target) {
    if (t >= unit.attackReadyTick) {
      const melee = unit.range <= RANGE_UNITS.melee;
      if (target.kind === "unit") {
        queueHit(state, {
          targetKind: "unit",
          targetId: target.unit.id,
          amount: currentAtk(unit),
          srcSeat: unit.seat,
          srcUnitId: unit.id,
          penetration: unit.characterId === "bwtkan-jaws" ? 0.2 : undefined, // 물어뜯기
          melee,
          basic: true,
        });
      } else {
        queueHit(state, {
          targetKind: "tower",
          targetId: target.tower.id,
          amount: currentAtk(unit) * unit.mods.towerDmg,
          srcSeat: unit.seat,
          srcUnitId: unit.id,
        });
      }
      unit.attackReadyTick = t + Math.max(1, Math.round(ATTACK_INTERVAL_TICKS / unit.mods.atkSpeed));
    }
    return;
  }

  if (unit.mods.rooted) return;
  moves.push({ unit, pos: unit.pos + forward(unit.seat) * unit.speed * unit.mods.speed * DT });
}

// ---------------------------------------------------------------------------
// 6. 반영과 정산
// ---------------------------------------------------------------------------

function resolve(state: BattleState): void {
  // 회복
  for (const heal of state.heals) {
    const unit = unitById(state, heal.targetId);
    if (unit && unit.alive) unit.hp = Math.min(unit.maxHp, unit.hp + heal.amount);
  }

  // 피해
  for (const hit of state.hits) {
    if (hit.targetKind === "tower") {
      const tower = towerById(state, hit.targetId);
      if (!tower || !tower.alive) continue;
      tower.hp -= hit.amount;
      if (hit.srcUnitId) tower.lastAttackerId = hit.srcUnitId;
      continue;
    }

    const unit = unitById(state, hit.targetId);
    if (!unit || !unit.alive) continue;

    let multiplier = unit.mods.dmgTaken;
    if (hit.penetration && multiplier < 1) multiplier = 1 - (1 - multiplier) * (1 - hit.penetration);
    let amount = hit.amount * multiplier * state.tuning.unitDamageScale;
    const source = hit.srcUnitId ? unitById(state, hit.srcUnitId) : undefined;
    if (source) amount *= matchupMultiplier(source.weapon, unit.weapon); // 무기 상성

    if (unit.shield > 0) {
      const absorbed = Math.min(unit.shield, amount);
      unit.shield -= absorbed;
      amount -= absorbed;
    }
    unit.hp -= amount;
    unit.lastAttackerSeat = hit.srcSeat;
    if (hit.srcUnitId) unit.lastAttackerId = hit.srcUnitId;

    // 특수 무기: 기본 공격에 붙는 효과
    if (hit.basic && source && source.alive) applyWeaponEffect(state, source, unit, amount);

    // 반사: 로즈막티아의 가시, 제노사우로스의 산성 점액
    if (!hit.noReflect && hit.srcUnitId) {
      const attacker = unitById(state, hit.srcUnitId);
      if (attacker && attacker.alive) {
        let reflected = 0;
        if (unit.characterId === "rosmaktia") reflected = amount * 0.15;
        if (unit.characterId === "xenosaurs" && hit.melee) reflected = 8;
        if (reflected > 0) {
          attacker.hp -= reflected;
          attacker.lastAttackerSeat = unit.seat;
          attacker.lastAttackerId = unit.id;
        }
      }
    }
  }

  state.hits = [];
  state.heals = [];

  // 쓰러진 유닛
  for (const unit of state.units) {
    if (unit.alive && unit.hp <= 0) killUnit(state, unit);
  }

  // 부서진 타워
  for (const tower of state.towers) {
    if (tower.alive && tower.hp <= 0) destroyTower(state, tower);
  }

  checkFinished(state);
}

function applyWeaponEffect(state: BattleState, source: Unit, target: Unit, dealt: number): void {
  switch (weaponById(source.weapon)?.effect) {
    case "burn":
      addEffect(target, { type: "dot", value: 6, untilTick: state.tick + seconds(3) });
      break;
    case "slow":
      addEffect(target, { type: "slow", value: 0.2, untilTick: state.tick + seconds(2) });
      break;
    case "lifesteal":
      source.hp = Math.min(source.maxHp, source.hp + dealt * 0.1);
      break;
  }
}

function killUnit(state: BattleState, unit: Unit): void {
  unit.alive = false;
  unit.hp = 0;
  unit.effects = [];
  unit.shield = 0;

  if (unit.summon) {
    // 소환수는 부활하지 않고 점수도 주지 않는다. (다음 틱 정리 때 사라진다)
    return;
  }

  const killerSeat = unit.lastAttackerSeat ?? otherSeat(unit.seat);
  if (state.mode === "battle") {
    state.score[killerSeat] += SCORE_KILL;
    state.kills[killerSeat] += 1;
    const respawn = Math.max(
      seconds(2),
      RESPAWN_TICKS - (isPawn(unit) ? PAWN_RESPAWN_BONUS_TICKS : 0) - state.synergyFx[unit.seat].respawnReduceTicks,
    );
    unit.respawnAtTick = state.tick + respawn;
  } else if (state.firstDeathmatchKill === null) {
    state.firstDeathmatchKill = killerSeat;
  }
  pushEvent(state, { type: "kill", seat: killerSeat, unitId: unit.lastAttackerId ?? undefined, targetId: unit.id });

  // 만개: 처치하면 체력을 회복한다.
  const killer = unit.lastAttackerId ? unitById(state, unit.lastAttackerId) : undefined;
  if (killer && killer.alive && killer.effects.some((e) => e.type === "bloom")) {
    killer.hp = Math.min(killer.maxHp, killer.hp + killer.maxHp * 0.2);
  }
}

function isPawn(unit: Unit): boolean {
  return characterById(unit.characterId)?.piece === "pawn";
}

function destroyTower(state: BattleState, tower: Tower): void {
  tower.alive = false;
  tower.hp = 0;
  const scoringSeat = otherSeat(tower.seat);

  if (tower.kind === "main") {
    state.score[scoringSeat] += tower.lane === "kingside" ? SCORE_KINGSIDE_MAIN : SCORE_UNDER_MAIN;
  }
  pushEvent(state, { type: "towerDestroyed", seat: scoringSeat, targetId: tower.id, unitId: tower.lastAttackerId ?? undefined });

  // 폰은 타워를 부수는 순간 승급해서 남은 시간 동안 강해진다.
  const attacker = tower.lastAttackerId ? unitById(state, tower.lastAttackerId) : undefined;
  if (attacker && attacker.alive && attacker.summon === null && isPawn(attacker) && !attacker.promoted) {
    attacker.promoted = true;
    attacker.maxHp *= 1.25;
    attacker.hp *= 1.25;
    pushEvent(state, { type: "promote", seat: attacker.seat, unitId: attacker.id });
  }
}

function checkFinished(state: BattleState): void {
  if (state.finished) return;

  if (state.mode === "deathmatch") {
    const alive: [number, number] = [0, 0];
    for (const unit of state.units) {
      if (unit.alive && unit.summon === null) alive[unit.seat] += 1;
    }
    if (alive[0] === 0 || alive[1] === 0) {
      finish(state, alive[0] === 0 && alive[1] === 0 ? state.secondPicker : alive[0] === 0 ? 1 : 0, "deathmatch");
    }
    return;
  }

  // 한 팀의 메인 타워 3개가 모두 무너지면 바로 끝난다.
  for (const seat of [0, 1] as const) {
    const mains = state.towers.filter((t) => t.seat === seat && t.kind === "main");
    if (mains.every((t) => !t.alive)) {
      finish(state, scoreWinner(state), "towers");
      return;
    }
  }
}

/** 점수가 높은 쪽. 같으면 null (데스매치로 간다). */
export function scoreWinner(state: BattleState): Seat | null {
  if (state.score[0] === state.score[1]) return null;
  return state.score[0] > state.score[1] ? 0 : 1;
}

function finish(state: BattleState, winner: Seat | null, reason: BattleReason): void {
  state.finished = true;
  state.winner = winner;
  state.reason = reason;
  pushEvent(state, { type: "end", seat: winner ?? undefined, text: reason });
}

/**
 * 한쪽이 졌다고 인정하거나(항복) 연결이 오래 끊겨서 기권패 처리할 때. 상대가 바로 이기고, 점수는 그대로 둔다.
 * 이미 끝난 판이면 아무것도 하지 않는다.
 */
export function concede(state: BattleState, loserSeat: Seat, reason: "surrender" | "forfeit"): void {
  if (state.finished) return;
  finish(state, otherSeat(loserSeat), reason);
}

/** 제한 시간이 끝났을 때. 전투는 점수, 데스매치는 남은 체력으로 승부를 가린다. */
export function finishByTime(state: BattleState): void {
  if (state.finished) return;

  if (state.mode === "battle") {
    finish(state, scoreWinner(state), "time"); // 동점이면 winner가 null -> 데스매치
    return;
  }

  // 데스매치: 남은 체력 합 -> 먼저 처치한 쪽 -> 후공 팀
  const hp: [number, number] = [0, 0];
  for (const unit of state.units) {
    if (unit.alive && unit.summon === null) hp[unit.seat] += unit.hp;
  }
  let winner: Seat;
  if (Math.round(hp[0]) !== Math.round(hp[1])) winner = hp[0] > hp[1] ? 0 : 1;
  else winner = state.firstDeathmatchKill ?? state.secondPicker;
  finish(state, winner, "deathmatchTime");
}

// ---------------------------------------------------------------------------
// 데스매치 시작
// ---------------------------------------------------------------------------

/**
 * 전투가 동점으로 끝났을 때 이어지는 연장전.
 * 모두가 센터 레인 중앙에 모이고, 쓰러져 있던 캐릭터는 체력 50%로 되살아난다.
 * 타워와 부활은 없고, 스팀포스는 가득 차고, 쿨다운은 모두 초기화된다.
 */
export function startDeathmatch(state: BattleState): void {
  state.mode = "deathmatch";
  state.modeStartTick = state.tick;
  state.finished = false;
  state.winner = null;
  state.reason = null;
  state.projectiles = [];
  state.walls = [];
  state.wells = [];
  state.hatches = [];
  state.hits = [];
  state.heals = [];
  state.units = state.units.filter((u) => u.summon === null);

  const arrivals: [number, number] = [0, 0];
  for (const unit of state.units) {
    unit.hp = unit.alive ? unit.maxHp : unit.maxHp * 0.5;
    unit.alive = true;
    unit.respawnAtTick = null;
    unit.effects = [];
    unit.shield = 0;
    unit.lane = "center";
    unit.pos = unit.seat === 0 ? 42 + arrivals[0]++ * 0.2 : 58 - arrivals[1]++ * 0.2;
    unit.attackReadyTick = state.tick;
    unit.skillReadyTick = state.tick + seconds(2);
    unit.ultReadyTick = state.tick;
    unit.laneMoveReadyTick = state.tick;
    unit.lastAttackerId = null;
    unit.lastAttackerSeat = null;
    unit.mods = computeMods(state, unit);
  }
  state.steam = [STEAM_MAX, STEAM_MAX];
  pushEvent(state, { type: "end", text: "deathmatchStart" });
}

// ---------------------------------------------------------------------------
// 플레이어의 명령
// ---------------------------------------------------------------------------

export type CommandFailure =
  | "wrong_phase"
  | "not_your_character"
  | "unit_dead"
  | "unit_disabled"
  | "not_implemented"
  | "on_cooldown"
  | "not_enough_steam"
  | "no_target"
  | "invalid_lane"
  | "not_a_knight";

export type CommandResult = { ok: true } | { ok: false; code: CommandFailure };

const failure = (code: CommandFailure): CommandResult => ({ ok: false, code });

/** 궁극기를 발동한다. 스팀포스 5를 쓰고 40초 동안 다시 쓸 수 없다. */
export function useUltimate(state: BattleState, seat: Seat, characterId: string, lane?: Lane): CommandResult {
  if (state.finished) return failure("wrong_phase");
  const unit = unitById(state, `${seat}:${characterId}`);
  if (!unit) return failure("not_your_character");
  if (!unit.alive) return failure("unit_dead");
  if (unit.mods.stunned) return failure("unit_disabled");

  const def = ULTIMATES[characterId];
  if (!def || !def.implemented) return failure("not_implemented");
  if (state.tick < unit.ultReadyTick) return failure("on_cooldown");
  if (state.steam[seat] < ULTIMATE_STEAM_COST) return failure("not_enough_steam");
  const problem = def.check?.(state, unit, lane);
  if (problem) return failure(problem);

  state.steam[seat] -= ULTIMATE_STEAM_COST;
  unit.ultReadyTick = state.tick + ULTIMATE_COOLDOWN_TICKS;
  def.use(state, unit, lane);
  pushEvent(state, { type: "ultimate", seat, unitId: unit.id });
  return { ok: true };
}

/** 나이트가 다른 레인으로 옮겨 간다. 12초에 한 번. 위치는 그대로이고, 새 레인의 적 타워는 넘지 못한다. */
export function moveLane(state: BattleState, seat: Seat, characterId: string, lane: Lane): CommandResult {
  if (state.finished || state.mode !== "battle") return failure("wrong_phase");
  const unit = unitById(state, `${seat}:${characterId}`);
  if (!unit) return failure("not_your_character");
  if (characterById(characterId)?.piece !== "knight") return failure("not_a_knight");
  if (!unit.alive) return failure("unit_dead");
  if (unit.mods.stunned || unit.mods.rooted) return failure("unit_disabled");
  if (lane === unit.lane) return failure("invalid_lane");
  if (state.tick < unit.laneMoveReadyTick) return failure("on_cooldown");

  unit.lane = lane;
  unit.pos = clampPos(state, unit, unit.pos);
  unit.laneMoveReadyTick = state.tick + LANE_MOVE_COOLDOWN_TICKS;
  return { ok: true };
}

export { TICKS_PER_SECOND };
