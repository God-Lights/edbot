// 캐릭터 12명의 패시브, 스킬(자동 시전), 궁극기(플레이어가 발동).
// 수치는 기획서의 "캐릭터 시트 (초안)"를 그대로 따른다. 모두 초안이라 플레이 테스트로 조정한다.

import { characterById } from "../characters";
import { weaponById } from "../forge/weapons";
import type { Lane, Seat } from "../protocol";
import {
  DT,
  addEffect,
  alliesNear,
  distance,
  emptyMods,
  enemiesNear,
  frontTower,
  inAlliedZone,
  LANE_LENGTH,
  queueHeal,
  queueHit,
  removeDots,
  RANGE_UNITS,
  seconds,
  unitById,
} from "./core";
import type { BattleState, Mods, Tower, Unit } from "./core";

const forward = (seat: Seat): 1 | -1 => (seat === 0 ? 1 : -1);

// ---------------------------------------------------------------------------
// 이동 제한: 살아 있는 적 타워와 벽은 지나갈 수 없다
// ---------------------------------------------------------------------------

/** 앞쪽(적 본진 방향)으로 갈 수 있는 한계 위치. */
export function forwardLimit(state: BattleState, unit: Unit): number {
  let limit = unit.seat === 0 ? LANE_LENGTH : 0;
  if (state.mode === "deathmatch") return limit; // 데스매치에는 타워와 벽이 없다
  const block = (pos: number) => {
    limit = unit.seat === 0 ? Math.min(limit, pos - 0.1) : Math.max(limit, pos + 0.1);
  };
  for (const tower of state.towers) {
    if (tower.alive && tower.seat !== unit.seat && tower.lane === unit.lane) block(tower.pos);
  }
  for (const wall of state.walls) {
    if (wall.seat !== unit.seat && wall.lane === unit.lane) block(wall.pos);
  }
  return limit;
}

export function clampPos(state: BattleState, unit: Unit, pos: number): number {
  const limit = forwardLimit(state, unit);
  return unit.seat === 0
    ? Math.max(0, Math.min(pos, limit))
    : Math.min(LANE_LENGTH, Math.max(pos, limit));
}

/** 목표에서 stopDistance 떨어진 곳까지 최대 maxDistance만큼 달려간다. */
function dashToward(state: BattleState, unit: Unit, target: Unit, stopDistance: number, maxDistance = Infinity): void {
  const dir = target.pos >= unit.pos ? 1 : -1;
  const wanted = Math.max(0, (target.pos - dir * stopDistance - unit.pos) * dir);
  unit.pos = clampPos(state, unit, unit.pos + dir * Math.min(wanted, maxDistance));
}

// ---------------------------------------------------------------------------
// 수정치: 효과와 패시브를 합쳐서 틱마다 계산한다
// ---------------------------------------------------------------------------

export function computeMods(state: BattleState, unit: Unit): Mods {
  const mods = emptyMods();

  for (const effect of unit.effects) {
    switch (effect.type) {
      case "stun":
        mods.stunned = true;
        break;
      case "root":
        mods.rooted = true;
        break;
      case "slow":
        mods.speed *= Math.max(0.2, 1 - effect.value);
        break;
      case "dmgTakenUp":
        mods.dmgTaken *= 1 + effect.value;
        break;
      case "dmgTakenDown":
        mods.dmgTaken *= Math.max(0.1, 1 - effect.value);
        break;
      case "atkUp":
        mods.atk *= 1 + effect.value;
        break;
      case "speedUp":
        mods.speed *= 1 + effect.value;
        break;
      case "atkSpeedUp":
        mods.atkSpeed *= 1 + effect.value;
        break;
      case "towerDmgUp":
        mods.towerDmg *= 1 + effect.value;
        break;
    }
  }

  if (unit.promoted) mods.atk *= 1.25;
  mods.atk *= 1 + (weaponById(unit.weapon)?.atkBonus ?? 0);

  // 패시브: 자기 자신
  if (unit.characterId === "dwargon") {
    mods.dmgTaken *= 0.9; // 용의 비늘
    mods.towerDmg *= 1.3;
  }
  if (unit.characterId === "raufaino" && inAlliedZone(state, unit)) {
    mods.dmgTaken *= 0.8; // 철벽: 아군 가드 타워 구역 안에서
  }

  // 패시브: 주변 아군의 오라
  for (const ally of alliesNear(state, unit, 8, true)) {
    if (ally.characterId === "ancient-lord") mods.dmgTaken *= 0.9; // 고대의 위엄
    if (ally.characterId === "for-the-more") {
      // 더 많이 위하여: 주변 아군이 많을수록 공격력 증가 (최대 +20%)
      const crowd = alliesNear(state, ally, 8, false).length;
      mods.atk *= 1 + Math.min(0.2, 0.05 * crowd);
    }
  }

  return mods;
}

export function currentAtk(unit: Unit): number {
  return unit.atk * unit.mods.atk;
}

const INVEST_COST = 3;

/** 지금 쓸 수 있는 탈런트. 방이 채워 준 사본에서 이번 틱까지 쓴 양을 뺀다. */
function availableTalent(state: BattleState, seat: Seat): number {
  return state.talent[seat] + state.talentDelta[seat];
}

/** 투자할 아군: 적과 싸우고 있는 아군 중 공격력이 가장 높은 쪽 (자신 포함). */
function investTarget(state: BattleState, unit: Unit): Unit | undefined {
  return alliesNear(state, unit, 12, true)
    .filter((ally) => enemiesNear(state, ally, 10).length > 0 && !ally.effects.some((e) => e.type === "atkUp"))
    .sort((a, b) => b.atk - a.atk || (a.id < b.id ? -1 : 1))[0];
}

// ---------------------------------------------------------------------------
// 스킬 (자동 시전)
// ---------------------------------------------------------------------------

export interface SkillDef {
  cooldownTicks: number;
  /** 지금 쓸 가치가 있는가. */
  shouldUse(state: BattleState, unit: Unit): boolean;
  use(state: BattleState, unit: Unit): void;
}

function hit(state: BattleState, unit: Unit, target: Unit, multiplier: number, extra: { penetration?: number; melee?: boolean } = {}): void {
  queueHit(state, {
    targetKind: "unit",
    targetId: target.id,
    amount: currentAtk(unit) * multiplier,
    srcSeat: unit.seat,
    srcUnitId: unit.id,
    ...extra,
  });
}

export const SKILLS: Record<string, SkillDef> = {
  // 군주의 호령 (20초): 5초 동안 주변 아군의 이동·공격 속도 +20%
  "ancient-lord": {
    cooldownTicks: seconds(20),
    shouldUse: (state, unit) => enemiesNear(state, unit, 12).length > 0,
    use: (state, unit) => {
      for (const ally of alliesNear(state, unit, 8, true)) {
        addEffect(ally, { type: "speedUp", value: 0.2, untilTick: state.tick + seconds(5) });
        addEffect(ally, { type: "atkSpeedUp", value: 0.2, untilTick: state.tick + seconds(5) });
      }
    },
  },

  // 투자 (15초): 탈런트 3을 써서 싸우는 아군 1명의 공격력을 10초 동안 +25%
  richmond: {
    cooldownTicks: seconds(15),
    shouldUse: (state, unit) => availableTalent(state, unit.seat) >= INVEST_COST && investTarget(state, unit) !== undefined,
    use: (state, unit) => {
      const target = investTarget(state, unit);
      if (!target) return;
      state.talentDelta[unit.seat] -= INVEST_COST;
      addEffect(target, { type: "atkUp", value: 0.25, untilTick: state.tick + seconds(10) });
    },
  },

  // 가시 채찍 (8초): 전방 부채꼴에 피해와 출혈 3초
  rosmaktia: {
    cooldownTicks: seconds(8),
    shouldUse: (state, unit) => enemiesNear(state, unit, 4).length > 0,
    use: (state, unit) => {
      for (const enemy of enemiesNear(state, unit, 4)) {
        hit(state, unit, enemy, 1.2, { melee: true });
        addEffect(enemy, { type: "dot", value: 10, untilTick: state.tick + seconds(3) });
      }
    },
  },

  // 토템 설치 (14초): 8초 동안 범위 안 적의 이동을 늦춘다. 주술 표식: 맞은 적은 5초 동안 받는 피해 +10%
  "toka-loga": {
    cooldownTicks: seconds(14),
    shouldUse: (state, unit) => enemiesNear(state, unit, 10).length > 0,
    use: (state, unit) => {
      const center = enemiesNear(state, unit, 10)[0];
      if (!center) return;
      for (const enemy of enemiesNear(state, unit, 30).filter((e) => Math.abs(e.pos - center.pos) <= 8)) {
        addEffect(enemy, { type: "slow", value: 0.4, untilTick: state.tick + seconds(8) });
        addEffect(enemy, { type: "dmgTakenUp", value: 0.1, untilTick: state.tick + seconds(5) });
      }
    },
  },

  // 화염 숨결 (10초): 짧은 전방 화염, 가드 타워에는 피해 1.5배
  dwargon: {
    cooldownTicks: seconds(10),
    shouldUse: (state, unit) => enemiesNear(state, unit, 4).length > 0 || towerInReach(state, unit, 4) !== undefined,
    use: (state, unit) => {
      for (const enemy of enemiesNear(state, unit, 4)) hit(state, unit, enemy, 1.5, { melee: true });
      const tower = towerInReach(state, unit, 4);
      if (tower) {
        const guardBonus = tower.kind === "guard" ? 1.5 : 1;
        queueHit(state, {
          targetKind: "tower",
          targetId: tower.id,
          amount: currentAtk(unit) * 1.5 * guardBonus * unit.mods.towerDmg,
          srcSeat: unit.seat,
          srcUnitId: unit.id,
        });
      }
    },
  },

  // 방패 돌진 (12초): 직선으로 돌진하며 적을 밀치고 1초 기절
  raufaino: {
    cooldownTicks: seconds(12),
    shouldUse: (state, unit) => !unit.mods.rooted && enemiesNear(state, unit, 10).some((e) => distance(e, unit) > 2),
    use: (state, unit) => {
      const target = enemiesNear(state, unit, 10).find((e) => distance(e, unit) > 2);
      if (!target) return;
      dashToward(state, unit, target, 1.5, 6);
      addEffect(target, { type: "stun", value: 0, untilTick: state.tick + seconds(1) });
    },
  },

  // 함성 (16초): 주변 아군 체력을 조금 회복하고 6초 동안 공격 속도 +15%
  "for-the-more": {
    cooldownTicks: seconds(16),
    shouldUse: (state, unit) => enemiesNear(state, unit, 12).length > 0 || alliesNear(state, unit, 8, true).some((a) => a.hp < a.maxHp * 0.9),
    use: (state, unit) => {
      for (const ally of alliesNear(state, unit, 8, true)) {
        queueHeal(state, ally.id, ally.maxHp * 0.1);
        addEffect(ally, { type: "atkSpeedUp", value: 0.15, untilTick: state.tick + seconds(6) });
      }
    },
  },

  // 치유의 빛 (8초): 아군 1명을 즉시 회복하고 화상·출혈을 지운다. 체력이 낮을수록 회복량이 늘어난다(패시브)
  lappus: {
    cooldownTicks: seconds(8),
    shouldUse: (state, unit) => lowestAlly(state, unit, 12) !== undefined,
    use: (state, unit) => {
      const target = lowestAlly(state, unit, 12);
      if (!target) return;
      const missing = 1 - target.hp / target.maxHp;
      queueHeal(state, target.id, target.maxHp * 0.2 * (1 + missing)); // 생명의 기운
      removeDots(target);
    },
  },

  // 돌진 물기 (10초): 대상에게 달려들어 1초 기절
  "bwtkan-jaws": {
    cooldownTicks: seconds(10),
    shouldUse: (state, unit) => !unit.mods.rooted && enemiesNear(state, unit, 12).some((e) => distance(e, unit) > 2),
    use: (state, unit) => {
      const target = enemiesNear(state, unit, 12).find((e) => distance(e, unit) > 2);
      if (!target) return;
      dashToward(state, unit, target, 1.5);
      addEffect(target, { type: "stun", value: 0, untilTick: state.tick + seconds(1) });
    },
  },

  // 안키오: 자동 스킬이 없다. 도약(레인 이동)은 플레이어가 직접 명령한다.

  // 도토리 투척 (6초): 원거리 소형 피해와 2초 이동 감소
  "nut-wolf": {
    cooldownTicks: seconds(6),
    shouldUse: (state, unit) => enemiesNear(state, unit, 10).length > 0,
    use: (state, unit) => {
      const target = enemiesNear(state, unit, 10)[0];
      if (!target) return;
      hit(state, unit, target, 0.8);
      addEffect(target, { type: "slow", value: 0.3, untilTick: state.tick + seconds(2) });
    },
  },

  // 산성 침 (9초): 적 1명의 방어를 5초 동안 낮춘다 (받는 피해 +15%)
  xenosaurs: {
    cooldownTicks: seconds(9),
    shouldUse: (state, unit) => enemiesNear(state, unit, 8).length > 0,
    use: (state, unit) => {
      const target = enemiesNear(state, unit, 8)[0];
      if (!target) return;
      addEffect(target, { type: "dmgTakenUp", value: 0.15, untilTick: state.tick + seconds(5) });
    },
  },
};

function towerInReach(state: BattleState, unit: Unit, reach: number): Tower | undefined {
  const tower = frontTower(state, unit.seat === 0 ? 1 : 0, unit.lane);
  return tower && distance(tower, unit) <= reach ? tower : undefined;
}

function lowestAlly(state: BattleState, unit: Unit, radius: number): Unit | undefined {
  return alliesNear(state, unit, radius, true)
    .filter((a) => a.hp < a.maxHp * 0.85)
    .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || (a.id < b.id ? -1 : 1))[0];
}

export function skillCooldown(unit: Unit, def: SkillDef): number {
  return unit.promoted ? Math.round(def.cooldownTicks * 0.8) : def.cooldownTicks;
}

// ---------------------------------------------------------------------------
// 궁극기 (플레이어가 발동. 스팀포스 5, 재사용 40초)
// ---------------------------------------------------------------------------

export type UltimateFailure = "not_implemented" | "no_target" | "invalid_lane";

export interface UltimateDef {
  /** 아직 만들 수 없는 궁극기 (경제 시스템이 필요한 것)는 false. */
  implemented: boolean;
  /** 레인을 골라야 하는가. */
  needsLane?: boolean;
  /** 쓸 수 없는 이유. 쓸 수 있으면 null. */
  check?(state: BattleState, unit: Unit, lane: Lane | undefined): UltimateFailure | null;
  use(state: BattleState, unit: Unit, lane: Lane | undefined): void;
}

export const ULTIMATES: Record<string, UltimateDef> = {
  // 고대의 맹약: 8초 동안 모든 아군이 받는 피해 -35%
  "ancient-lord": {
    implemented: true,
    use: (state, unit) => {
      for (const ally of state.units) {
        if (ally.alive && ally.seat === unit.seat) {
          addEffect(ally, { type: "dmgTakenDown", value: 0.35, untilTick: state.tick + seconds(8) });
        }
      }
    },
  },

  // 황금 계약: 탈런트 +8을 즉시 받고, 진행 중인 재련을 모두 5초 단축한다
  richmond: {
    implemented: true,
    use: (state, unit) => {
      state.talentDelta[unit.seat] += 8;
      state.smeltHaste[unit.seat] += seconds(5);
    },
  },

  // 만개: 6초 동안 주변 적에게 가시 폭풍으로 지속 피해, 처치하면 체력 회복
  rosmaktia: {
    implemented: true,
    use: (state, unit) => {
      addEffect(unit, { type: "bloom", value: 0.6, untilTick: state.tick + seconds(6) });
    },
  },

  // 대주술: 넓은 범위에 낙뢰 3번, 각각 큰 피해를 주고 타워에도 피해를 준다
  "toka-loga": {
    implemented: true,
    check: (state, unit) => (enemyCenter(state, unit) === null ? "no_target" : null),
    use: (state, unit) => {
      const center = enemyCenter(state, unit);
      if (center === null) return;
      for (let i = 0; i < 3; i++) {
        state.projectiles.push({
          landTick: state.tick + seconds(1) * i + 5,
          seat: unit.seat,
          lane: unit.lane,
          pos: center,
          radius: 8,
          unitDamage: currentAtk(unit) * 2,
          towerDamage: currentAtk(unit) * 2,
          srcUnitId: unit.id,
          kind: "strike",
        });
      }
    },
  },

  // 용암 파괴: 10초 동안 자신이 타워에 주는 피해 2배
  dwargon: {
    implemented: true,
    use: (state, unit) => {
      addEffect(unit, { type: "towerDmgUp", value: 1, untilTick: state.tick + seconds(10) });
    },
  },

  // 성채 전개: 8초 동안 벽을 세워 적의 통로를 막고 주변 아군에게 보호막을 준다
  raufaino: {
    implemented: true,
    use: (state, unit) => {
      state.walls.push({
        seat: unit.seat,
        lane: unit.lane,
        pos: Math.max(0.5, Math.min(LANE_LENGTH - 0.5, unit.pos + forward(unit.seat) * 4)),
        untilTick: state.tick + seconds(8),
      });
      for (const ally of alliesNear(state, unit, 8, true)) {
        ally.shield += ally.maxHp * 0.15;
        ally.shieldUntilTick = state.tick + seconds(8);
      }
    },
  },

  // 총공격 명령: 8초 동안 모든 아군의 공격력 +30%, 이동 속도 +20%
  "for-the-more": {
    implemented: true,
    use: (state, unit) => {
      for (const ally of state.units) {
        if (ally.alive && ally.seat === unit.seat) {
          addEffect(ally, { type: "atkUp", value: 0.3, untilTick: state.tick + seconds(8) });
          addEffect(ally, { type: "speedUp", value: 0.2, untilTick: state.tick + seconds(8) });
        }
      }
    },
  },

  // 생명의 샘: 8초 동안 그 자리에 가드 타워의 회복 구간과 같은 회복 구간을 만든다
  lappus: {
    implemented: true,
    use: (state, unit) => {
      state.wells.push({
        seat: unit.seat,
        lane: unit.lane,
        pos: unit.pos,
        radius: 8,
        untilTick: state.tick + seconds(8),
      });
    },
  },

  // 턱 파열: 대상 한 명을 6초 동안 물고 늘어져 이동을 막고 큰 지속 피해를 준다
  "bwtkan-jaws": {
    implemented: true,
    check: (state, unit) => (enemiesNear(state, unit, 12)[0] ? null : "no_target"),
    use: (state, unit) => {
      const target = enemiesNear(state, unit, 12)[0];
      if (!target) return;
      dashToward(state, unit, target, 1.5);
      addEffect(target, { type: "root", value: 0, untilTick: state.tick + seconds(6) });
      addEffect(target, { type: "dot", value: 20, untilTick: state.tick + seconds(6) });
    },
  },

  // 측면 기습: 원하는 레인의 가드 타워 뒤로 순간이동하고 그 타워의 스킬을 3초 동안 막는다
  ankio: {
    implemented: true,
    needsLane: true,
    check: (state, unit, lane) => {
      if (!lane) return "invalid_lane";
      const tower = frontTower(state, unit.seat === 0 ? 1 : 0, lane);
      return tower && tower.kind === "guard" ? null : "invalid_lane";
    },
    use: (state, unit, lane) => {
      if (!lane) return;
      const tower = frontTower(state, unit.seat === 0 ? 1 : 0, lane);
      if (!tower) return;
      unit.lane = lane;
      unit.pos = Math.max(0, Math.min(LANE_LENGTH, tower.pos + forward(unit.seat) * 2)); // 타워 뒤(적 본진 쪽)
      tower.silencedUntilTick = state.tick + seconds(3);
    },
  },

  // 늑대 울음: 8초 동안 분신 2마리를 부른다 (각각 체력 40%, 공격 50%)
  "nut-wolf": {
    implemented: true,
    use: (state, unit) => {
      for (let i = 0; i < 2; i++) spawnSummon(state, unit, "wolf", 0.4, 0.5, seconds(8), i * 0.5);
    },
  },

  // 군체 부화: 알 3개를 깔고 6초 뒤 새끼 3마리가 깨어난다
  xenosaurs: {
    implemented: true,
    use: (state, unit) => {
      for (let i = 0; i < 3; i++) {
        state.hatches.push({
          atTick: state.tick + seconds(6),
          seat: unit.seat,
          lane: unit.lane,
          pos: unit.pos + forward(unit.seat) * i * 0.5,
          ownerId: unit.id,
        });
      }
    },
  },
};

/** 낙뢰의 중심: 가장 가까운 적 유닛의 위치, 없으면 가장 앞의 적 타워. 둘 다 없으면 null. */
function enemyCenter(state: BattleState, unit: Unit): number | null {
  const enemy = enemiesNear(state, unit, 30)[0];
  if (enemy) return enemy.pos;
  const tower = frontTower(state, unit.seat === 0 ? 1 : 0, unit.lane);
  return tower ? tower.pos : null;
}

// ---------------------------------------------------------------------------
// 소환
// ---------------------------------------------------------------------------

type SummonKind = "wolf" | "hatchling";

export function spawnSummon(
  state: BattleState,
  owner: Unit,
  kind: SummonKind,
  hpFraction: number,
  atkFraction: number,
  lifeTicks: number,
  offset: number,
): Unit {
  const number = state.nextSummonNumber++;
  const summon: Unit = {
    id: `${owner.seat}:summon-${kind}:${number}`,
    characterId: `summon-${kind}`,
    weapon: null,
    seat: owner.seat,
    lane: owner.lane,
    pos: Math.max(0, Math.min(LANE_LENGTH, owner.pos + forward(owner.seat) * offset)),
    hp: owner.maxHp * hpFraction,
    maxHp: owner.maxHp * hpFraction,
    atk: owner.atk * atkFraction,
    speed: owner.speed,
    range: RANGE_UNITS.melee,
    alive: true,
    respawnAtTick: null,
    attackReadyTick: state.tick,
    skillReadyTick: Infinity,
    ultReadyTick: Infinity,
    laneMoveReadyTick: Infinity,
    effects: [],
    shield: 0,
    shieldUntilTick: 0,
    promoted: false,
    lastAttackerSeat: null,
    lastAttackerId: null,
    summon: { ownerId: owner.id, expiresTick: state.tick + lifeTicks },
    mods: emptyMods(),
  };
  state.units.push(summon);
  return summon;
}

/** 알이 부화한다. 주인이 죽었어도 부화한다. */
export function hatchEggs(state: BattleState): void {
  const due = state.hatches.filter((h) => h.atTick <= state.tick);
  if (due.length === 0) return;
  state.hatches = state.hatches.filter((h) => h.atTick > state.tick);
  for (const egg of due) {
    const base = characterById("xenosaurs");
    const owner = unitById(state, egg.ownerId);
    if (!base || !owner) continue;
    const baseOwner: Unit = { ...owner, maxHp: base.hp, atk: base.attack, lane: egg.lane, pos: egg.pos };
    spawnSummon(state, baseOwner, "hatchling", 0.3, 0.4, seconds(15), 0);
  }
}

// ---------------------------------------------------------------------------
// 지속 효과 (매 틱 처리)
// ---------------------------------------------------------------------------

/** 만개 중인 유닛이 주변 적에게 지속 피해를 준다. */
export function applyBloom(state: BattleState, unit: Unit): void {
  const bloom = unit.effects.find((e) => e.type === "bloom");
  if (!bloom) return;
  for (const enemy of enemiesNear(state, unit, 6)) {
    queueHit(state, {
      targetKind: "unit",
      targetId: enemy.id,
      amount: currentAtk(unit) * bloom.value * DT,
      srcSeat: unit.seat,
      srcUnitId: unit.id,
    });
  }
}
