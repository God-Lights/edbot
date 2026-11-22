// 체스판 자동 전투 시뮬레이션. 1초(한 박자)마다 모든 기물이 한 번씩 행동한다.
// 같은 배치면 언제나 같은 결과다(난수 없음). 규칙: docs/DESIGN-autochess.md 5장.

import { ABILITIES, castAbility, onDeath, onKill, registerLeap } from "./abilities";
import {
  absolutePosition, allEnemiesOf, attackableEnemies, chebyshev, comparePerspective, distanceBetween, enemiesOf, forward, moveDestinations, perspective,
  stepCell, unitAt,
} from "./board";
import type { Cell } from "./board";
import {
  BEAT_ENERGY_ATTACK, BEAT_ENERGY_HURT, addEffect, createUnit, damageTakenMultiplier, effectiveAtk, hasEffect, hasWeapon, proc, pushEvent, queueHit,
} from "./core";
import { ENERGY_MAX, STAR2_STATS, unitDef } from "./roster";
import { activeSynergies, combineBonuses, neutralBonus } from "./synergy";
import { BOARD_SIZE } from "./types";
import { parseWeapon } from "./crafting";
import { WEAPON_ATK } from "./weapons";
import type { CombatOptions, CombatResult, CombatState, CombatUnit, Placement, ResourceTile, Seat } from "./types";

/** 이 박자부터 모든 기물이 점점 커지는 피해를 받는다(돌발 사망). */
export const SUDDEN_DEATH_BEAT = 20;
/** 이 박자에 끝나지 않으면 남은 체력 비율로 승부를 가린다. (돌발 사망이 있어서 보통 닿지 않는다) */
export const MAX_BEATS = 45;
/** 무한 모드: 이음매로 돌아가는 시간이 필요해서 돌발 사망과 제한 박자를 늦춘다. */
export const MOBIUS_SUDDEN_DEATH_BEAT = 28;
export const MOBIUS_MAX_BEATS = 53;
/** 밑면에서 이만큼 박자를 보내면 웜홀이 열린다. (규칙서의 10턴을 전투 길이에 맞춰 줄인 값) */
export const WORMHOLE_BEATS = 4;
/** 한 쪽에 동시에 있을 수 있는 폰 분신 수 */
export const CLONE_CAP = 4;
export { ABILITIES };

export function createCombat(boards: [Placement[], Placement[]], tiles: ResourceTile[] = [], options: CombatOptions = {}): CombatState {
  const mobius = options.mobius === true;
  const defIds: [string[], string[]] = [boards[0].map((p) => p.defId), boards[1].map((p) => p.defId)];
  const synergies: [string[], string[]] = [activeSynergies(defIds[0]), activeSynergies(defIds[1])];
  const state: CombatState = {
    mobius,
    suddenBeat: mobius ? MOBIUS_SUDDEN_DEATH_BEAT : SUDDEN_DEATH_BEAT,
    maxBeats: mobius ? MOBIUS_MAX_BEATS : MAX_BEATS,
    beat: 0,
    units: [],
    nextUnitNumber: 1,
    synergies,
    bonuses: [combineBonuses(synergies[0]), combineBonuses(synergies[1])],
    knightBoostUntil: [0, 0],
    hits: [],
    events: [],
    finished: false,
    winner: null,
    survivors: [0, 0],
    tiles: tiles.map((t) => ({ ...t, mined: false })),
    mines: [],
    goldBonus: [0, 0],
  };
  for (const seat of [0, 1] as const) {
    for (const placement of boards[seat]) {
      const def = unitDef(placement.defId);
      if (!def) throw new Error(`알 수 없는 캐릭터: ${placement.defId}`);
      const { x, y } = absolutePosition(seat, placement.col, placement.row);
      const k = placement.star === 2 ? STAR2_STATS : 1;
      const pawnHp = def.piece === "pawn" ? state.bonuses[seat].pawnHp : 1;
      const weapon = placement.weapon ?? null;
      const parsed = weapon ? parseWeapon(weapon) : null;
      const parts = parsed?.parts ?? [];
      const power = parsed?.power ?? 1;
      // 무기 효과는 낀 기본 무기마다 power배로 더한다. (기본 1, ★2 1.5, 융합 0.75씩)
      const atkMult = parts.reduce((m, id) => m * (1 + ((WEAPON_ATK[id] ?? 1) - 1) * power), 1);
      const maxHp = def.hp * k * pawnHp * (parts.includes("titanium-shield") ? 1 + 0.15 * power : 1);
      const unit = createUnit(state, {
        defId: def.id, seat, star: placement.star, x, y, hp: maxHp, maxHp, atk: def.atk * k * atkMult,
        energyMax: def.passive ? null : ENERGY_MAX[def.cost], piece: def.piece, summon: false, weapon,
      });
      if (parts.includes("titanium-shield")) unit.dmgMult = 1 - 0.1 * power;
      if (parts.includes("bit-dagger")) unit.energyMult = 1 + 0.35 * power;
      if (parts.includes("ancient-staff")) {
        unit.shield = maxHp * 0.25 * power;
        unit.shieldUntilBeat = 5;
      }
    }
  }
  // 처음부터 자원 칸 위에 서 있는 기물은 0박자에 바로 캔다.
  mineTiles(state);
  return state;
}

const alive = (state: CombatState, seat: Seat): number => state.units.filter((u) => u.alive && u.seat === seat).length;
const realAlive = (state: CombatState, seat: Seat): number => state.units.filter((u) => u.alive && u.seat === seat && !u.summon).length;

/** 행동 순서: 박자가 짝수면 seat 0부터, 홀수면 seat 1부터. (한쪽이 항상 먼저 움직이는 이점을 없앤다) */
function actingOrder(state: CombatState): CombatUnit[] {
  const first: Seat = state.beat % 2 === 0 ? 0 : 1;
  return state.units
    .filter((u) => u.alive)
    .sort((a, b) => (a.seat === b.seat ? a.id.localeCompare(b.id, "en", { numeric: true }) : a.seat === first ? -1 : 1));
}

/** 가장 체력이 낮은 적, 같으면 가까운 적, 같으면 id. 도발한 적이 닿으면 그 적이 우선. */
function pickTarget(state: CombatState, unit: CombatUnit, reachable: CombatUnit[]): CombatUnit | undefined {
  const taunters = reachable.filter((e) => hasEffect(e, "taunt", state.beat));
  const pool = taunters.length > 0 ? taunters : reachable;
  const tie = comparePerspective(unit);
  return [...pool].sort((a, b) => a.hp - b.hp || chebyshev(unit, a) - chebyshev(unit, b) || tie(a, b))[0];
}

/** 이동할 칸: 가장 가까운 적과의 거리가 가장 줄어드는 칸. 줄어들지 않으면 움직이지 않는다. 같은 면의 적이 있으면 그 적만, 없으면 다른 면의 적을 쫓아 이음매로 간다. */
function pickMove(state: CombatState, unit: CombatUnit): Cell | undefined {
  const all = allEnemiesOf(state, unit);
  if (all.length === 0) return undefined;
  // 폰은 길이 열려 있으면 언제나 앞으로 나아간다. (상대 끝줄에 닿으면 승급해야 하니까)
  if (unit.piece === "pawn") return moveDestinations(state, unit)[0];
  const same = all.filter((e) => e.face === unit.face);
  // 무한 모드: 유령은 같은 면의 적이 없으면 웜홀이 열릴 때까지 제자리에서 기다린다. (이음매로 되돌아가면 측면 기습이 사라진다)
  if (state.mobius && unit.face === 1 && same.length === 0 && unit.g < WORMHOLE_BEATS) return undefined;
  if (state.mobius && unit.face === 0 && same.length > 0 && canFlank(unit)) {
    const flank = pickFlankMove(state, unit, same);
    if (flank) return flank;
  }
  const foes = same.length > 0 ? same : all;
  const distance = (c: Cell) => Math.min(...foes.map((e) => distanceBetween(c, e)));
  const current = distance({ x: unit.x, y: unit.y, face: unit.face });
  let best: (Cell & { d: number }) | undefined;
  for (const dest of moveDestinations(state, unit)) {
    const d = distance(dest);
    // 가까워지는 칸 > (같으면) 더 앞으로 > (같으면) 내 시점에서 더 왼쪽. 거울 대칭이라 어느 seat도 유리하지 않다.
    const better =
      !best ||
      d < best.d ||
      (d === best.d && (dest.y - best.y) * forward(unit.seat) > 0) ||
      (d === best.d && dest.y === best.y && perspective(unit, dest).x < perspective(unit, best).x);
    if (better) best = { ...dest, d };
  }
  return best && best.d < current ? best : undefined;
}

/** 이음매를 건너는 길이 걸어가는 길보다 이만큼 이상 짧을 때만 측면 기습을 한다. */
const FLANK_GAIN = 1;
/** 이음매로 돌아 들어가는 측면 기습을 하는 역할 */
const FLANK_ROLES: ReadonlySet<string> = new Set(["암살", "기동"]);

/** 측면 기습을 하는 기물: 역할이 암살·기동이거나, 멀리까지 한 번에 움직이는 나이트·퀸이다. */
const canFlank = (unit: CombatUnit): boolean => FLANK_ROLES.has(unitDef(unit.defId)?.role ?? "") || unit.piece === "knight" || unit.piece === "queen" || unit.piece === "rook" || unit.piece === "bishop";

/** 이음매를 건너서 가려고 할 때의 거리: 앞면 칸이면 이음매까지 돌아가는 거리, 이미 건너온 밑면 칸이면 적이 선 칸까지의 실제 거리다. */
function flankDistance(cell: Cell, foe: CombatUnit): number {
  return cell.face === 0 ? distanceBetween(cell, { x: foe.x, y: foe.y, face: 1 }) : chebyshev(cell, foe);
}

/**
 * 무한 모드의 측면 기습: 이음매를 지나 적 뒷줄 쪽 밑면으로 건너가는 길이 걸어서 가는 길보다 확실히 짧으면 그쪽으로 간다.
 * 건너가서는 웜홀이 열릴 때까지 기다렸다가 적의 등 뒤에서 올라온다.
 */
function pickFlankMove(state: CombatState, unit: CombatUnit, same: CombatUnit[]): Cell | undefined {
  const tie = comparePerspective(unit);
  const target = [...same].sort((a, b) => a.hp - b.hp || tie(a, b))[0]!;
  const direct = chebyshev(unit, target);
  const here: Cell = { x: unit.x, y: unit.y, face: 0 };
  if (flankDistance(here, target) + FLANK_GAIN > direct) return undefined;
  let best: (Cell & { d: number }) | undefined;
  for (const dest of moveDestinations(state, unit)) {
    const d = flankDistance(dest, target);
    if (!best || d < best.d || (d === best.d && perspective(unit, dest).x < perspective(unit, best).x)) best = { ...dest, d };
  }
  return best && best.d < flankDistance(here, target) ? best : undefined;
}

/** 무한 모드: 웜홀이 열린 유령이 앞면으로 올라올지. 지금 밑면에서 칠 수 없고, 올라가면 칠 수 있거나 밑면에 적이 없을 때 올라온다. */
function wantsSurface(state: CombatState, unit: CombatUnit): boolean {
  if (!state.mobius || unit.face !== 1 || unit.g < WORMHOLE_BEATS || unitAt(state, unit.x, unit.y, 0)) return false;
  const foesFront = state.units.filter((u) => u.alive && u.team !== unit.team && u.face === 0);
  if (foesFront.length === 0) return false;
  if (attackableEnemies(state, unit).length > 0) return false;
  // 석화한 분신이나 웜홀이 열린 채로 오래 기다린 유령은 칠 수 있는지와 상관없이 올라온다. (올라와서 걸어가며 싸운다)
  if (unit.stoned || unit.g >= WORMHOLE_BEATS + 3) return true;
  const foesBack = state.units.filter((u) => u.alive && u.team !== unit.team && u.face === 1);
  if (foesBack.length === 0) return true;
  unit.face = 0;
  const canHit = attackableEnemies(state, unit).length > 0;
  unit.face = 1;
  return canHit;
}

/**
 * 무한 모드의 폰: 같은 면에 적이 있으면 그 적을 쫓는다. 적이 뒤에 있으면 방향을 돌리고(끝줄까지 가지 않는다),
 * 앞으로 가는 것이 가까워지지 않으면 옆으로 한 칸 비켜 간다. (그렇지 않으면 폰만 남은 판에서 서로 만나지 못한다)
 * 같은 면에 적이 없을 때만 끝줄에서 U턴하며 일주한다.
 */
function pickPawnChase(state: CombatState, unit: CombatUnit, same: CombatUnit[]): Cell | undefined {
  const tie = comparePerspective(unit);
  const target = [...same].sort((a, b) => chebyshev(unit, a) - chebyshev(unit, b) || a.hp - b.hp || tie(a, b))[0]!;
  if (target.y !== unit.y && Math.sign(target.y - unit.y) !== unit.dir) {
    unit.dir = unit.dir === 1 ? -1 : 1;
    // 돌아서니 바로 칠 수 있으면, 이번 박자는 돌아서는 데 쓰고 다음 박자에 친다. (그냥 지나쳐 가면 서로 등지고 영영 못 친다)
    if (attackableEnemies(state, unit).length > 0) return undefined;
  }
  const here: Cell = { x: unit.x, y: unit.y, face: unit.face };
  // 한 칸씩 앞이나 옆으로만 가니까, 가로·세로 거리의 합(맨해튼)이 줄어드는 쪽으로 간다. (체비쇼프 거리는 대각선 위치에서 줄지 않는다)
  const manhattan = (c: { x: number; y: number }) => Math.abs(c.x - target.x) + Math.abs(c.y - target.y);
  const current = manhattan(unit);
  const options: Array<Cell | undefined> = [stepCell(state, here, 0, unit.dir)];
  const sideways = [-1, 1].sort((a, b) => Math.abs(unit.x + a - target.x) - Math.abs(unit.x + b - target.x));
  for (const dx of sideways) options.push(stepCell(state, here, dx, 0));
  for (const c of options) {
    if (!c || c.face !== unit.face || unitAt(state, c.x, c.y, c.face)) continue;
    if (manhattan(c) < current) return { x: c.x, y: c.y, face: c.face };
  }
  return undefined;
}

/** 폰 분신: 일주를 마친 폰이 같은 칸 밑면이 비어 있으면 복제를 남긴다. 분신이 너무 많으면 만들지 않는다. */
function spawnClone(state: CombatState, body: CombatUnit): void {
  if (body.summon || body.face !== 0 || unitAt(state, body.x, body.y, 1)) return;
  if (state.units.filter((u) => u.alive && u.seat === body.seat && u.cloneOf !== null).length >= CLONE_CAP) return;
  const clone = createUnit(state, {
    defId: body.defId, seat: body.seat, face: 1, star: body.star, x: body.x, y: body.y, hp: body.hp, maxHp: body.maxHp, atk: body.atk,
    energyMax: null, piece: "pawn", summon: true, dir: body.dir, cloneOf: body.id, ghosted: true,
  });
  pushEvent(state, { type: "clone", unitId: body.id, targetId: clone.id });
}

/** 무한 모드의 폰: 끝줄에서 U턴한다. 앞면에서 U턴 두 번이면 일주 한 번이고 분신이 생긴다. 밑면의 고스트 폰은 U턴 대신 석화한다. */
function pawnTurn(state: CombatState, unit: CombatUnit): void {
  if (unit.face === 1 && (unit.ghosted || unit.cloneOf !== null)) {
    unit.stoned = true;
    pushEvent(state, { type: "stone", unitId: unit.id });
    return;
  }
  unit.dir = unit.dir === 1 ? -1 : 1;
  pushEvent(state, { type: "uturn", unitId: unit.id });
  if (unit.face === 0) {
    unit.u += 1;
    if (unit.u >= 2) {
      unit.u = 0;
      unit.c += 1;
      pushEvent(state, { type: "lap", unitId: unit.id });
      spawnClone(state, unit);
    }
  }
}

function checkPromotion(state: CombatState, unit: CombatUnit): void {
  if (state.mobius || unit.piece !== "pawn" || unit.summon) return; // 무한 모드의 폰은 승급하지 않는다
  const lastRow = unit.seat === 0 ? 0 : BOARD_SIZE - 1;
  if (unit.y === lastRow) {
    unit.piece = "queen";
    unit.promoted = true;
    pushEvent(state, { type: "promote", unitId: unit.id });
  }
}

function applyHits(state: CombatState): void {
  for (const hit of state.hits) {
    const target = state.units.find((u) => u.id === hit.targetId);
    if (!target || !target.alive) continue;
    // 안키오의 날개 쌍검: 공격과 능력을 4번에 1번 피한다
    if ((hit.kind === "attack" || hit.kind === "ability") && hasWeapon(target, "ankio-twinblades") && proc(target, "dodge", 0.25 * target.weaponPower)) continue;
    let amount = hit.kind === "true" ? hit.amount : hit.amount * damageTakenMultiplier(state, target);
    if (target.shield > 0 && target.shieldUntilBeat >= state.beat && hit.kind !== "true") {
      const absorbed = Math.min(target.shield, amount);
      target.shield -= absorbed;
      amount -= absorbed;
    }
    target.hp -= amount;
    if (hit.kind === "attack" || hit.kind === "ability") {
      if (target.energyMax !== null) target.energy += BEAT_ENERGY_HURT * target.energyMult;
    }
    target.lastHitBy = hit.sourceId;
    // 어둠의 낫: 준 피해의 25% 흡혈
    if (hit.sourceId && amount > 0) {
      const source = state.units.find((u) => u.id === hit.sourceId);
      if (source && source.alive && hasWeapon(source, "dark-scythe")) source.hp = Math.min(source.maxHp, source.hp + amount * 0.35 * source.weaponPower);
    }
  }
  state.hits = [];
}

function resolveDeaths(state: CombatState): void {
  const dead = state.units.filter((u) => u.alive && u.hp <= 0);
  // 연동: 본체가 쓰러지면 그 본체의 분신도 모두 사라진다.
  for (let i = 0; i < dead.length; i++) {
    for (const clone of state.units.filter((u) => u.alive && u.cloneOf === dead[i]!.id && !dead.includes(u))) {
      clone.hp = 0;
      dead.push(clone);
    }
  }
  for (const unit of dead) {
    unit.alive = false;
    unit.hp = 0;
    pushEvent(state, { type: "death", unitId: unit.id });
  }
  for (const unit of dead) {
    const by = unit.lastHitBy;
    const killer = by ? state.units.find((u) => u.id === by && u.alive) : undefined;
    if (killer) {
      onKill(state, killer);
      // 에드코인 슬링: 처치할 때마다 골드 +1 (라운드당 최대 3)
      if (hasWeapon(killer, "edcoin-sling") && (killer.procs.gold ?? 0) < Math.max(1, Math.round(3 * killer.weaponPower))) {
        killer.procs.gold = (killer.procs.gold ?? 0) + 1;
        state.goldBonus[killer.seat] += 1;
      }
    }
    onDeath(state, unit);
  }
}

/** 공격할 때 터지는 무기 효과들. 낀 기본 무기마다 따로 계산하고, 확률은 무기 효과 배율(power)만큼 곱한다. */
function weaponOnAttack(state: CombatState, unit: CombatUnit, target: CombatUnit, atk: number): void {
  const power = unit.weaponPower;
  for (const part of unit.weaponParts) {
    switch (part) {
      case "clawstone-axe":
        // 5번 공격에 한 번 3초 출혈
        if (proc(unit, `${part}:bleed`, 0.2 * power)) addEffect(target, { type: "dot", value: atk * 0.25, untilBeat: state.beat + 3 });
        break;
      case "edmium-blade":
        if (proc(unit, `${part}:aspd`, 0.25 * power)) queueHit(state, { targetId: target.id, amount: atk, sourceId: unit.id, kind: "attack" });
        break;
      case "ankio-twinblades":
        if (proc(unit, `${part}:aspd`, 0.15 * power)) queueHit(state, { targetId: target.id, amount: atk, sourceId: unit.id, kind: "attack" });
        break;
      case "redocean-trident": {
        // 맞힌 적과 인접한 적 1명(체력이 낮은 쪽)에게 40%
        const next = enemiesOf(state, unit)
          .filter((e) => e.id !== target.id && chebyshev(e, target) === 1)
          .sort((a, b) => a.hp - b.hp || a.id.localeCompare(b.id, "en", { numeric: true }))[0];
        if (next) queueHit(state, { targetId: next.id, amount: atk * 0.4 * power, sourceId: unit.id, kind: "attack" });
        break;
      }
      case "chaos-staff":
        if (proc(unit, `${part}:chaos`, 0.34 * power)) {
          const turn = unit.procs[`${part}:turn`] ?? 0;
          unit.procs[`${part}:turn`] = turn + 1;
          if (turn % 3 === 0) addEffect(target, { type: "stun", value: 0, untilBeat: state.beat + 1 });
          else if (turn % 3 === 1) addEffect(target, { type: "root", value: 0, untilBeat: state.beat + 3 });
          else addEffect(target, { type: "dmgTaken", value: 1 + 0.2 * power, untilBeat: state.beat + 3 });
        }
        break;
      default:
        break;
    }
  }
}

/** 자원 칸 위에 서 있는 기물이 재료를 캔다. 같은 박자에 둘이 서 있으면 둘 다 얻는다. 칸은 사라진다. */
function mineTiles(state: CombatState): void {
  state.tiles.forEach((tile, index) => {
    if (tile.mined) return;
    const miners = state.units.filter((u) => u.alive && !u.summon && u.face === 0 && u.x === tile.x && u.y === tile.y);
    if (miners.length === 0) return;
    tile.mined = true;
    const seats = [...new Set(miners.map((u) => u.seat))].sort();
    for (const seat of seats) {
      state.mines.push({ beat: state.beat, tile: index, seat });
      const miner = miners.find((u) => u.seat === seat)!;
      pushEvent(state, { type: "mine", unitId: miner.id, targetId: String(index), text: tile.material });
    }
  });
}

/** 한 박자를 진행한다. */
export function stepCombat(state: CombatState): void {
  if (state.finished) return;
  state.beat += 1;

  // 끝난 효과와 보호막을 치운다.
  for (const u of state.units) {
    u.effects = u.effects.filter((e) => e.untilBeat >= state.beat);
    if (u.shield > 0 && u.shieldUntilBeat < state.beat) u.shield = 0;
  }

  // 돌발 사망: 점점 커지는 고정 피해
  if (state.beat >= state.suddenBeat) {
    if (state.beat === state.suddenBeat) pushEvent(state, { type: "suddenDeath" });
    for (const u of state.units.filter((x) => x.alive)) {
      queueHit(state, { targetId: u.id, amount: u.maxHp * 0.02 * (state.beat - state.suddenBeat + 1), sourceId: null, kind: "true" });
    }
  }
  // 지속 피해
  for (const u of state.units.filter((x) => x.alive)) {
    for (const e of u.effects) if (e.type === "dot") queueHit(state, { targetId: u.id, amount: e.value, sourceId: null, kind: "ability" });
  }

  // 모든 기물이 "박자 시작 때의 판"을 보고 동시에 행동한다. 그래서 먼저 움직이는 쪽이 유리하지 않다.
  const order = actingOrder(state);
  const first: Seat = state.beat % 2 === 0 ? 0 : 1;

  // 1) 에너지가 가득 찬 기물은 능력을 발동한다. (이번 박자의 행동)
  const casters = new Set<string>();
  for (const unit of order) {
    if (!unit.alive || hasEffect(unit, "stun", state.beat)) continue;
    if (unit.energyMax !== null && unit.energy >= unit.energyMax) {
      unit.energy = 0;
      castAbility(state, unit);
      casters.add(unit.id);
      checkPromotion(state, unit);
    }
  }

  // 2) 나머지는 공격할 수 있으면 공격하고, 아니면 이동할 칸을 정한다. (이동은 아직 하지 않는다)
  //    무한 모드에서는 웜홀이 열린 유령이 앞면으로 올라오거나, 폰이 끝줄에서 U턴하는 것도 이번 박자의 행동이다.
  const moves: Array<{ unit: CombatUnit; dest: Cell; surface: boolean }> = [];
  for (const unit of order) {
    if (!unit.alive || casters.has(unit.id) || hasEffect(unit, "stun", state.beat)) continue;
    if (wantsSurface(state, unit)) {
      moves.push({ unit, dest: { x: unit.x, y: unit.y, face: 0 }, surface: true });
      continue;
    }
    if (unit.stoned) continue;
    const target = pickTarget(state, unit, attackableEnemies(state, unit));
    if (target) {
      const atk = effectiveAtk(state, unit);
      queueHit(state, { targetId: target.id, amount: atk, sourceId: unit.id, kind: "attack" });
      if (unit.energyMax !== null) unit.energy += BEAT_ENERGY_ATTACK * state.bonuses[unit.seat].energyGain * unit.energyMult;
      pushEvent(state, { type: "attack", unitId: unit.id, targetId: target.id });
      if (unit.weapon) weaponOnAttack(state, unit, target, atk);
    } else if (!hasEffect(unit, "root", state.beat)) {
      if (state.mobius && unit.piece === "pawn") {
        const same = enemiesOf(state, unit);
        if (same.length > 0) {
          const chase = pickPawnChase(state, unit, same);
          if (chase) moves.push({ unit, dest: chase, surface: false });
          continue;
        }
        if (!stepCell(state, { x: unit.x, y: unit.y, face: unit.face }, 0, unit.dir)) {
          pawnTurn(state, unit);
          continue;
        }
      }
      const dest = pickMove(state, unit);
      if (dest) moves.push({ unit, dest, surface: false });
    }
  }

  // 3) 이동: 같은 칸으로 가려 하면 체력이 많은 쪽이 가고, 같으면 이번 박자에 먼저 움직이는 쪽이 간다.
  //    비어 있던 칸으로만 갈 수 있다(같은 박자에 누가 비운 칸으로는 못 간다). 칸은 면마다 따로 센다.
  const occupied = new Set(state.units.filter((u) => u.alive).map((u) => `${u.x},${u.y},${u.face}`));
  moves.sort((a, b) => b.unit.hp - a.unit.hp || (a.unit.seat === first ? -1 : 1) - (b.unit.seat === first ? -1 : 1));
  for (const { unit, dest, surface } of moves) {
    const key = `${dest.x},${dest.y},${dest.face}`;
    if (occupied.has(key)) continue;
    occupied.add(key);
    const changed = dest.face !== unit.face;
    unit.x = dest.x;
    unit.y = dest.y;
    if (changed) {
      unit.face = dest.face;
      if (dest.face === 0) {
        unit.g = 0; // 앞면으로 돌아오면 게이지는 0
        unit.cloneOf = null; // 앞면으로 올라온 분신은 실체화해서 연동이 풀린다
        unit.stoned = false;
        if (unit.piece === "pawn" && (unit.y === 0 || unit.y === BOARD_SIZE - 1)) unit.dir = unit.y === 0 ? 1 : -1; // 가장자리에서 올라오면 안쪽으로 걷는다
      } else if (unit.piece === "pawn" && unit.c >= 1) {
        unit.ghosted = true; // 일주를 마친 폰이 밑면으로 가면 고스트화
      }
      pushEvent(state, { type: surface ? "surface" : "ghost", unitId: unit.id });
    }
    if (unit.piece === "knight") registerLeap(state, unit);
    checkPromotion(state, unit);
  }
  // 밑면에서 보낸 박자 수: 이번 박자에 도착했어도 1이다.
  if (state.mobius) for (const u of state.units) if (u.alive && u.face === 1) u.g += 1;

  mineTiles(state);
  applyHits(state);
  resolveDeaths(state);

  const a = alive(state, 0);
  const b = alive(state, 1);
  if (a === 0 || b === 0 || state.beat >= state.maxBeats) {
    state.finished = true;
    state.survivors = [realAlive(state, 0), realAlive(state, 1)];
    // 비트코인 대검: 살아남으면 골드 +2
    for (const u of state.units) if (u.alive && !u.summon && hasWeapon(u, "bitcoin-greatsword")) state.goldBonus[u.seat] += Math.round(2 * u.weaponPower);
    if (a === 0 && b === 0) state.winner = null;
    else if (a === 0) state.winner = 1;
    else if (b === 0) state.winner = 0;
    else {
      const ratio = (seat: Seat) => state.units.filter((u) => u.alive && u.seat === seat).reduce((s, u) => s + u.hp / u.maxHp, 0);
      state.winner = ratio(0) === ratio(1) ? null : ratio(0) > ratio(1) ? 0 : 1;
    }
    pushEvent(state, { type: "end", text: String(state.winner) });
  }
}

/** 끝날 때까지 돌리고 결과를 돌려준다. */
export function runCombat(boards: [Placement[], Placement[]], tiles: ResourceTile[] = [], options: CombatOptions = {}): CombatResult {
  const state = createCombat(boards, tiles, options);
  while (!state.finished) stepCombat(state);
  return { winner: state.winner, survivors: state.survivors, beats: state.beat, suddenDeath: state.beat >= state.suddenBeat };
}

export { neutralBonus };


/** 클라이언트가 전투를 그대로 재생할 수 있게 박자마다 상태를 기록한 결과. 좌표는 판의 절대 좌표(seat 0이 아래)다. */
export interface RecordedUnit {
  defId: string;
  seat: Seat;
  star: 1 | 2;
  maxHp: number;
  summon: boolean;
  weapon: string | null;
}

/** [x, y, hp, energy, shield, flags] 박자 k의 상태. flags: 1=살아 있음, 2=승급, 4=밑면(유령), 8 이상=속성 게이지 g(flags>>3, 최대 31). 아직 생기지 않은 소환수는 없다(배열이 짧다). */
export type FrameUnit = [number, number, number, number, number, number];

/** [박자, 종류, 행동한 기물 번호, 대상 기물 번호(없으면 -1), 능력 id] 종류: attack | ability | death | promote | move */
export type RecordedEvent = [number, string, number, number, string];

export interface CombatRecording {
  result: CombatResult;
  units: RecordedUnit[];
  /** frames[0]은 시작 모습, frames[k]는 k번째 박자가 끝난 모습 */
  frames: FrameUnit[][];
  events: RecordedEvent[];
  /** 자원 칸(판의 절대 좌표)과 채굴 기록: [박자, 칸 번호, seat] */
  tiles: ResourceTile[];
  mines: Array<[number, number, Seat]>;
  /** 무기로 번 골드 */
  goldBonus: [number, number];
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

function snapshotFrame(state: CombatState): FrameUnit[] {
  return state.units.map((u) => [u.x, u.y, Math.max(0, r1(u.hp)), r1(u.energy), r1(u.shield), (u.alive ? 1 : 0) | (u.promoted ? 2 : 0) | (u.face === 1 ? 4 : 0) | (Math.min(31, u.g) << 3)]);
}

/** 끝까지 돌리면서 박자마다 기록한다. 결과는 runCombat과 같다. */
export function recordCombat(boards: [Placement[], Placement[]], tiles: ResourceTile[] = [], options: CombatOptions = {}): CombatRecording {
  const state = createCombat(boards, tiles, options);
  const frames: FrameUnit[][] = [snapshotFrame(state)];
  while (!state.finished) {
    stepCombat(state);
    frames.push(snapshotFrame(state));
  }
  const index = new Map(state.units.map((u, i) => [u.id, i]));
  const events: RecordedEvent[] = [];
  for (const e of state.events) {
    if (e.type === "suddenDeath" || e.type === "end") continue;
    // 채굴 이벤트의 대상 칸은 기물이 아니라 칸 번호다.
    const target = e.type === "mine" ? Number(e.targetId) : (index.get(e.targetId ?? "") ?? -1);
    events.push([e.beat, e.type, index.get(e.unitId ?? "") ?? -1, target, e.text ?? ""]);
  }
  return {
    result: { winner: state.winner, survivors: state.survivors, beats: state.beat, suddenDeath: state.beat >= state.suddenBeat },
    units: state.units.map((u) => ({ defId: u.defId, seat: u.seat, star: u.star, maxHp: Math.round(u.maxHp), summon: u.summon, weapon: u.weapon })),
    frames,
    events,
    tiles: tiles.map((t) => ({ ...t })),
    mines: state.mines.map((m) => [m.beat, m.tile, m.seat] as [number, number, Seat]),
    goldBonus: [...state.goldBonus] as [number, number],
  };
}
