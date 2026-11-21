// 캐릭터 능력 20개. 에너지가 가득 차면 자동 발동한다(패시브는 조건이 맞을 때). 규칙: docs/DESIGN-autochess.md 7장.
// 모두 결정적이다: 대상을 고를 때 같은 조건이면 id가 작은 쪽을 고른다.

import { adjacentUnits, alliesOf, chebyshev, comparePerspective, enemiesOf, forward, freeAdjacent, inBounds } from "./board";
import {
  abilityDamage, addEffect, createUnit, healUnit, pushEvent, shieldUnit, starPower,
} from "./core";
import { unitDef } from "./roster";
import type { AbilityId, CombatState, CombatUnit } from "./types";

function lowestHp(actor: CombatUnit, units: CombatUnit[]): CombatUnit | undefined {
  const tie = comparePerspective(actor);
  return [...units].sort((a, b) => a.hp - b.hp || tie(a, b))[0];
}

function nearest(from: CombatUnit, units: CombatUnit[]): CombatUnit | undefined {
  const tie = comparePerspective(from);
  return [...units].sort((a, b) => chebyshev(from, a) - chebyshev(from, b) || tie(a, b))[0];
}

/** 나이트가 도약하면 나이트 시너지가 켜진다(처음 한 번). */
export function registerLeap(state: CombatState, unit: CombatUnit): void {
  const bonus = state.bonuses[unit.seat];
  if (unit.piece === "knight" && bonus.knightBoost && state.knightBoostUntil[unit.seat] === 0) {
    state.knightBoostUntil[unit.seat] = state.beat + 5;
  }
}

function jumpTo(state: CombatState, unit: CombatUnit, x: number, y: number): void {
  unit.x = x;
  unit.y = y;
  registerLeap(state, unit);
  pushEvent(state, { type: "move", unitId: unit.id, text: "leap" });
}

/** 앞쪽에 있는 정도(클수록 상대 쪽에 가깝다). */
const progress = (unit: CombatUnit): number => (unit.seat === 0 ? 7 - unit.y : unit.y);

/** 상대 후열 깊이(클수록 그 쪽 본진 가까이). */
const depth = (unit: CombatUnit): number => (unit.seat === 1 ? 3 - unit.y : unit.y - 4);

function summon(state: CombatState, owner: CombatUnit, hpRatio: number, atkRatio: number): void {
  const spot = freeAdjacent(state, owner.x, owner.y, owner.seat);
  if (!spot) return;
  const p = starPower(owner);
  createUnit(state, {
    defId: owner.defId,
    seat: owner.seat,
    star: 1,
    x: spot.x,
    y: spot.y,
    hp: owner.maxHp * hpRatio * p,
    maxHp: owner.maxHp * hpRatio * p,
    atk: owner.atk * atkRatio * p,
    energyMax: null,
    piece: "pawn",
    summon: true,
  });
}

type Cast = (state: CombatState, unit: CombatUnit) => void;

export const ABILITIES: Record<AbilityId, Cast> = {
  // 분신: 인접 칸에 체력 40%, 공격 50%의 분신
  clone: (s, u) => summon(s, u, 0.4, 0.5),
  // 새끼: 인접 칸에 체력 30%, 공격 40%의 새끼
  hatch: (s, u) => summon(s, u, 0.3, 0.4),
  // 패시브(쓰러질 때)라 에너지로는 쓰지 않는다
  "relic-shield": () => {},
  spore: () => {},
  hunger: () => {},
  // 아군 1명(공격력이 가장 높은)의 공격력 +20%, 5박자
  inspire: (s, u) => {
    const target = [...alliesOf(s, u, true)].sort((a, b) => b.atk - a.atk || comparePerspective(u)(a, b))[0];
    if (target) addEffect(target, { type: "atkUp", value: 0.2 * starPower(u), untilBeat: s.beat + 5 });
  },
  // 가장 다친 아군(체력 비율이 가장 낮은)을 최대 체력의 35% 회복
  heal: (s, u) => {
    const target = [...alliesOf(s, u, true)].sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || comparePerspective(u)(a, b))[0];
    if (target) healUnit(s, u, target, target.maxHp * 0.35);
  },
  // 아군 전체 공격력 +20%, 5박자
  rally: (s, u) => {
    for (const ally of alliesOf(s, u, true)) addEffect(ally, { type: "atkUp", value: 0.2 * starPower(u), untilBeat: s.beat + 5 });
  },
  // 자신 최대 체력의 30%, 인접 아군은 각자 최대 체력의 15% 보호막 (6박자)
  "shield-wall": (s, u) => {
    shieldUnit(s, u, u, u.maxHp * 0.3, 6);
    for (const ally of adjacentUnits(s, u).filter((x) => x.seat === u.seat)) shieldUnit(s, u, ally, ally.maxHp * 0.15, 6);
  },
  // 4박자 동안 받는 피해 -50%, 도발
  "stone-skin": (s, u) => {
    addEffect(u, { type: "dmgTaken", value: 0.5, untilBeat: s.beat + 4 });
    addEffect(u, { type: "taunt", value: 1, untilBeat: s.beat + 4 });
  },
  // 같은 줄(같은 y)의 아군 공격력 +25%, 6박자
  formation: (s, u) => {
    for (const ally of alliesOf(s, u, true).filter((x) => x.y === u.y)) {
      addEffect(ally, { type: "atkUp", value: 0.25 * starPower(u), untilBeat: s.beat + 6 });
    }
  },
  // 가장 앞에 있는 아군 2명의 공격력 +30%, 6박자
  invest: (s, u) => {
    const front = [...alliesOf(s, u, true)].sort((a, b) => progress(b) - progress(a) || comparePerspective(u)(a, b)).slice(0, 2);
    for (const ally of front) addEffect(ally, { type: "atkUp", value: 0.3 * starPower(u), untilBeat: s.beat + 6 });
  },
  // 주변 2칸의 적에게 공격력의 120% 피해, 맞힌 수만큼 최대 체력의 6% 회복
  bloom: (s, u) => {
    const targets = enemiesOf(s, u).filter((e) => chebyshev(u, e) <= 2);
    for (const e of targets) abilityDamage(s, u, e, 1.2);
    if (targets.length > 0) healUnit(s, u, u, u.maxHp * 0.06 * targets.length);
  },
  // 가장 가까운 적을 3박자 속박하고 공격력의 130% 피해
  bind: (s, u) => {
    const target = nearest(u, enemiesOf(s, u));
    if (!target) return;
    addEffect(target, { type: "root", value: 1, untilBeat: s.beat + 3 });
    abilityDamage(s, u, target, 1.3);
  },
  // 체력이 가장 낮은 적에게 도약, 1박자 기절, 공격력의 140% 피해
  "leap-bite": (s, u) => {
    const target = lowestHp(u, enemiesOf(s, u));
    if (!target) return;
    const spot = freeAdjacent(s, target.x, target.y, u.seat);
    if (spot) jumpTo(s, u, spot.x, spot.y);
    addEffect(target, { type: "stun", value: 1, untilBeat: s.beat + 1 });
    abilityDamage(s, u, target, 1.4);
  },
  // 적이 가장 많이 모인 곳으로 도약해 인접한 적 모두에게 공격력의 100% 피해
  "dimension-leap": (s, u) => {
    const foes = enemiesOf(s, u);
    const crowd = (e: CombatUnit) => foes.filter((o) => chebyshev(e, o) <= 1).length;
    const target = [...foes].sort((a, b) => crowd(b) - crowd(a) || comparePerspective(u)(a, b))[0];
    if (!target) return;
    const spot = freeAdjacent(s, target.x, target.y, u.seat);
    if (spot) jumpTo(s, u, spot.x, spot.y);
    for (const e of enemiesOf(s, u).filter((o) => chebyshev(u, o) <= 1)) abilityDamage(s, u, e, 1.0);
  },
  // 아군 전체 3박자 동안 받는 피해 -35%
  pact: (s, u) => {
    for (const ally of alliesOf(s, u, true)) addEffect(ally, { type: "dmgTaken", value: 0.7, untilBeat: s.beat + 3 });
  },
  // 공격력이 가장 높은 적 3명에게 공격력의 160% 낙뢰
  thunder: (s, u) => {
    const foes = [...enemiesOf(s, u)].sort((a, b) => b.atk - a.atk || comparePerspective(u)(a, b)).slice(0, 3);
    for (const e of foes) abilityDamage(s, u, e, 1.15);
  },
  // 앞쪽 같은 세로줄의 적 모두에게 공격력의 150% 화염
  "dragon-breath": (s, u) => {
    const f = forward(u.seat);
    for (const e of enemiesOf(s, u).filter((o) => o.x === u.x && (o.y - u.y) * f > 0)) abilityDamage(s, u, e, 1.9);
  },
  // 적 후열(본진에 가장 가까운)로 순간이동해 공격력의 220% 피해
  flank: (s, u) => {
    const target = [...enemiesOf(s, u)].sort((a, b) => depth(b) - depth(a) || a.hp - b.hp || comparePerspective(u)(a, b))[0];
    if (!target) return;
    const spot = freeAdjacent(s, target.x, target.y, u.seat);
    if (spot) jumpTo(s, u, spot.x, spot.y);
    abilityDamage(s, u, target, 2.2);
  },
};

/** 에너지가 찬 기물의 능력을 발동한다. */
export function castAbility(state: CombatState, unit: CombatUnit): void {
  const ability = unitDef(unit.defId)?.ability;
  if (!ability) return;
  ABILITIES[ability](state, unit);
  pushEvent(state, { type: "ability", unitId: unit.id, text: ability });
}

/** 쓰러졌을 때 발동하는 패시브 (렐릭, 모슬링). killer는 마지막으로 때린 기물. */
export function onDeath(state: CombatState, unit: CombatUnit): void {
  const ability = unit.summon ? undefined : unitDef(unit.defId)?.ability;
  if (ability === "relic-shield") {
    for (const ally of state.units.filter((u) => u.alive && u.seat === unit.seat && u.id !== unit.id && chebyshev(u, unit) === 1)) {
      shieldUnit(state, unit, ally, ally.maxHp * 0.2, 5);
    }
  } else if (ability === "spore") {
    for (const e of state.units.filter((u) => u.alive && u.seat !== unit.seat && chebyshev(u, unit) <= 1)) {
      addEffect(e, { type: "dot", value: 60 * starPower(unit), untilBeat: state.beat + 3 });
    }
  }
}

/** 처치했을 때 발동하는 패시브 (스크리치). */
export function onKill(state: CombatState, killer: CombatUnit): void {
  killer.kills += 1;
  if (!killer.summon && unitDef(killer.defId)?.ability === "hunger") killer.atkStack *= 1 + 0.2 * starPower(killer);
}

export { inBounds };
