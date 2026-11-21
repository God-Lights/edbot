// 전투 시뮬레이션의 공통 도구: 공격력 계산, 피해·효과 쌓기, 이벤트.

import type { CombatEvent, CombatState, CombatUnit, Effect, EffectType, Hit } from "./types";

export const BEAT_ENERGY_ATTACK = 12; // 공격할 때 차는 에너지
export const BEAT_ENERGY_HURT = 6; // 맞을 때 차는 에너지

/** 확률 p의 효과가 이번에 터지는가. 난수 대신 값을 쌓아서 1이 넘으면 터진다. (같은 입력 -> 같은 결과, 두 팀에 똑같이 적용) */
export function proc(unit: CombatUnit, key: string, p: number): boolean {
  const acc = (unit.procs[key] ?? 0) + p;
  if (acc >= 1 - 1e-9) {
    unit.procs[key] = acc - 1;
    return true;
  }
  unit.procs[key] = acc;
  return false;
}

export function pushEvent(state: CombatState, event: Omit<CombatEvent, "beat">): void {
  state.events.push({ beat: state.beat, ...event });
}

export function hasEffect(unit: CombatUnit, type: EffectType, beat: number): boolean {
  return unit.effects.some((e) => e.type === type && e.untilBeat >= beat);
}

export function addEffect(unit: CombatUnit, effect: Effect): void {
  unit.effects.push(effect);
}

/** 지금 유효한 효과 값의 합 (atkUp 등) */
export function effectSum(unit: CombatUnit, type: EffectType, beat: number): number {
  let total = 0;
  for (const e of unit.effects) if (e.type === type && e.untilBeat >= beat) total += e.value;
  return total;
}

/** 받는 피해 배율: 효과(dmgTaken: 비율)를 곱하고, 팀의 시너지 배율을 곱한다. */
export function damageTakenMultiplier(state: CombatState, unit: CombatUnit): number {
  let m = state.bonuses[unit.seat].dmgTaken * unit.dmgMult;
  for (const e of unit.effects) if (e.type === "dmgTaken" && e.untilBeat >= state.beat) m *= e.value;
  return m;
}

/** 지금 공격력: 기본 x 쌓인 배율 x (1 + 버프 합) x 시너지 */
export function effectiveAtk(state: CombatState, unit: CombatUnit): number {
  const bonus = state.bonuses[unit.seat];
  let atk = unit.atk * unit.atkStack * (1 + effectSum(unit, "atkUp", state.beat)) * bonus.teamAtk;
  if (unit.piece === "pawn" || unit.promoted) atk *= bonus.pawnAtk;
  if (unit.piece === "knight" && bonus.knightBoost && state.beat <= state.knightBoostUntil[unit.seat]) atk *= 1.2;
  return atk;
}

/** ★2는 능력도 1.5배 */
export const starPower = (unit: CombatUnit): number => (unit.star === 2 ? 1.5 : 1) * (unit.weapon === "edgem-orb" ? 1.4 : 1);

export function queueHit(state: CombatState, hit: Hit): void {
  state.hits.push(hit);
}

/** 능력으로 주는 피해: 공격력의 mult배 x ★ x 능력 피해 시너지 */
export function abilityDamage(state: CombatState, source: CombatUnit, target: CombatUnit, mult: number): void {
  const amount = effectiveAtk(state, source) * mult * starPower(source) * state.bonuses[source.seat].abilityDamage;
  queueHit(state, { targetId: target.id, amount, sourceId: source.id, kind: "ability" });
}

/** 회복: 시너지(비숍)를 반영해 바로 적용한다. */
export function healUnit(state: CombatState, source: CombatUnit, target: CombatUnit, amount: number): void {
  if (!target.alive) return;
  const total = amount * starPower(source) * state.bonuses[source.seat].healShield;
  target.hp = Math.min(target.maxHp, target.hp + total);
}

export function shieldUnit(state: CombatState, source: CombatUnit, target: CombatUnit, amount: number, beats: number): void {
  if (!target.alive) return;
  target.shield += amount * starPower(source) * state.bonuses[source.seat].healShield;
  target.shieldUntilBeat = Math.max(target.shieldUntilBeat, state.beat + beats);
}

export function createUnit(
  state: CombatState,
  fields: Omit<CombatUnit, "id" | "alive" | "shield" | "shieldUntilBeat" | "effects" | "kills" | "atkStack" | "energy" | "promoted" | "lastHitBy" | "weapon" | "procs" | "dmgMult" | "energyMult"> & { promoted?: boolean; weapon?: string | null },
): CombatUnit {
  const unit: CombatUnit = {
    ...fields,
    id: `u${state.nextUnitNumber++}`,
    alive: true,
    shield: 0,
    shieldUntilBeat: 0,
    effects: [],
    kills: 0,
    atkStack: 1,
    lastHitBy: null,
    energy: 0,
    promoted: fields.promoted ?? false,
    weapon: fields.weapon ?? null,
    procs: {},
    dmgMult: 1,
    energyMult: 1,
  };
  state.units.push(unit);
  return unit;
}
