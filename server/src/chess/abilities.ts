// 캐릭터 능력 20개. 에너지가 가득 차면 자동 발동한다(패시브는 조건이 맞을 때). 규칙: docs/DESIGN-autochess.md 7장.
// 모두 결정적이다: 대상을 고를 때 같은 조건이면 id가 작은 쪽을 고른다.

import { adjacentUnits, alliesOf, chebyshev, comparePerspective, enemiesOf, forward, freeAdjacent, inBounds } from "./board";
import {
  abilityDamage, addEffect, createUnit, healUnit, pushEvent, shieldUnit, starPower,
} from "./core";
import { LINEAGE, unitDef } from "./roster";
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
  const spot = freeAdjacent(state, owner.x, owner.y, owner.seat, owner.face);
  if (!spot) return;
  const p = starPower(owner);
  createUnit(state, {
    defId: owner.defId,
    seat: owner.seat,
    face: owner.face,
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
  // 데보이트·데도키온도 패시브다 (되살리기는 sim.ts 의 resolveDeaths, 유전 흡수는 onKill)
  origin: () => {},
  "gene-absorb": () => {},
  // 신덱스(나열의 마법사): 적이 가장 많은 가로줄(같은 y)의 적 모두에게 공격력의 110% 피해
  "array-strike": (s, u) => {
    const foes = enemiesOf(s, u);
    const rowCount = (y: number) => foes.filter((e) => e.y === y).length;
    const target = [...foes].sort((a, b) => rowCount(b.y) - rowCount(a.y) || chebyshev(u, a) - chebyshev(u, b) || comparePerspective(u)(a, b))[0];
    if (!target) return;
    for (const e of foes.filter((o) => o.y === target.y)) abilityDamage(s, u, e, 1.1);
  },
  // 소버녀(충성의 군사): 체력 비율이 가장 낮은 아군에게 자신 최대 체력 25% 보호막(4박자), 자신은 3박자 도발
  "loyal-guard": (s, u) => {
    const ward = [...alliesOf(s, u, false)].sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || comparePerspective(u)(a, b))[0] ?? u;
    shieldUnit(s, u, ward, u.maxHp * 0.25, 4);
    addEffect(u, { type: "taunt", value: 1, untilBeat: s.beat + 3 });
  },
  // 자바(불의 달인): 적이 가장 많이 모인 칸을 중심으로 3x3의 적에게 공격력의 90% 피해, 3박자 동안 박자마다 공격력의 30% 화상
  inferno: (s, u) => {
    const foes = enemiesOf(s, u);
    const crowd = (e: CombatUnit) => foes.filter((o) => chebyshev(e, o) <= 1).length;
    const center = [...foes].sort((a, b) => crowd(b) - crowd(a) || comparePerspective(u)(a, b))[0];
    if (!center) return;
    for (const e of foes.filter((o) => chebyshev(center, o) <= 1)) {
      abilityDamage(s, u, e, 0.9);
      addEffect(e, { type: "dot", value: u.atk * 0.3 * starPower(u), untilBeat: s.beat + 3 });
    }
  },
  // 파이(굴곡의 소리): 가장 가까운 적부터, 직전 대상에서 가장 가까운 다른 적으로 꺾이며 최대 4명에게 140% / 110% / 80% / 50%
  resonance: (s, u) => {
    const hit = new Set<string>();
    let from: CombatUnit = u;
    for (const mult of [1.4, 1.1, 0.8, 0.5]) {
      const next = nearest(from, enemiesOf(s, u).filter((e) => !hit.has(e.id)));
      if (!next) break;
      hit.add(next.id);
      abilityDamage(s, u, next, mult);
      from = next;
    }
  },
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
    for (const ally of adjacentUnits(s, u).filter((x) => x.team === u.team)) shieldUnit(s, u, ally, ally.maxHp * 0.15, 6);
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
    const spot = freeAdjacent(s, target.x, target.y, u.seat, u.face);
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
    const spot = freeAdjacent(s, target.x, target.y, u.seat, u.face);
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
    const spot = freeAdjacent(s, target.x, target.y, u.seat, u.face);
    if (spot) jumpTo(s, u, spot.x, spot.y);
    abilityDamage(s, u, target, 2.2);
    // 신의 전달자: 같은 편에 데보이트 계보(안키오 말고)가 살아 있으면 순간이동 뒤 최대 체력 20% 보호막 (3박자)
    const kin = s.units.some((o) => o.alive && o.team === u.team && o.id !== u.id && !o.summon && o.defId !== "ankio" && LINEAGE.includes(o.defId));
    if (kin) shieldUnit(s, u, u, u.maxHp * 0.2, 3);
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
    for (const ally of state.units.filter((u) => u.alive && u.team === unit.team && u.face === unit.face && u.id !== unit.id && chebyshev(u, unit) === 1)) {
      shieldUnit(state, unit, ally, ally.maxHp * 0.2, 5);
    }
  } else if (ability === "spore") {
    for (const e of state.units.filter((u) => u.alive && u.team !== unit.team && u.face === unit.face && chebyshev(u, unit) <= 1)) {
      addEffect(e, { type: "dot", value: 60 * starPower(unit), untilBeat: state.beat + 3 });
    }
  }
}

/** 처치했을 때 발동하는 패시브 (스크리치, 데도키온). */
export function onKill(state: CombatState, killer: CombatUnit, victim?: CombatUnit): void {
  killer.kills += 1;
  const ability = killer.summon ? undefined : unitDef(killer.defId)?.ability;
  if (ability === "hunger") killer.atkStack *= 1 + 0.2 * starPower(killer);
  // 유전 흡수: 처치한 적 최대 체력의 10%만큼 최대 체력이 오르고 그만큼 회복한다.
  if (ability === "gene-absorb" && victim) {
    const gain = victim.maxHp * 0.1 * starPower(killer);
    killer.maxHp += gain;
    killer.hp = Math.min(killer.maxHp, killer.hp + gain);
  }
}

export { inBounds };
