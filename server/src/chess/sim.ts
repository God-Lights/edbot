// 체스판 자동 전투 시뮬레이션. 1초(한 박자)마다 모든 기물이 한 번씩 행동한다.
// 같은 배치면 언제나 같은 결과다(난수 없음). 규칙: docs/DESIGN-autochess.md 5장.

import { ABILITIES, castAbility, onDeath, onKill, registerLeap } from "./abilities";
import {
  absolutePosition, attackableEnemies, chebyshev, comparePerspective, enemiesOf, forward, moveDestinations, perspective,
} from "./board";
import {
  BEAT_ENERGY_ATTACK, BEAT_ENERGY_HURT, createUnit, damageTakenMultiplier, effectiveAtk, hasEffect, pushEvent, queueHit,
} from "./core";
import { ENERGY_MAX, STAR2_STATS, unitDef } from "./roster";
import { activeSynergies, combineBonuses, neutralBonus } from "./synergy";
import { BOARD_SIZE } from "./types";
import type { CombatResult, CombatState, CombatUnit, Placement, Seat } from "./types";

/** 이 박자부터 모든 기물이 점점 커지는 피해를 받는다(돌발 사망). */
export const SUDDEN_DEATH_BEAT = 20;
/** 이 박자에 끝나지 않으면 남은 체력 비율로 승부를 가린다. (돌발 사망이 있어서 보통 닿지 않는다) */
export const MAX_BEATS = 45;
export { ABILITIES };

export function createCombat(boards: [Placement[], Placement[]]): CombatState {
  const defIds: [string[], string[]] = [boards[0].map((p) => p.defId), boards[1].map((p) => p.defId)];
  const synergies: [string[], string[]] = [activeSynergies(defIds[0]), activeSynergies(defIds[1])];
  const state: CombatState = {
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
  };
  for (const seat of [0, 1] as const) {
    for (const placement of boards[seat]) {
      const def = unitDef(placement.defId);
      if (!def) throw new Error(`알 수 없는 캐릭터: ${placement.defId}`);
      const { x, y } = absolutePosition(seat, placement.col, placement.row);
      const k = placement.star === 2 ? STAR2_STATS : 1;
      const pawnHp = def.piece === "pawn" ? state.bonuses[seat].pawnHp : 1;
      const maxHp = def.hp * k * pawnHp;
      createUnit(state, {
        defId: def.id, seat, star: placement.star, x, y, hp: maxHp, maxHp, atk: def.atk * k,
        energyMax: def.passive ? null : ENERGY_MAX[def.cost], piece: def.piece, summon: false,
      });
    }
  }
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

/** 이동할 칸: 가장 가까운 적과의 거리가 가장 줄어드는 칸. 줄어들지 않으면 움직이지 않는다. */
function pickMove(state: CombatState, unit: CombatUnit): { x: number; y: number } | undefined {
  const foes = enemiesOf(state, unit);
  if (foes.length === 0) return undefined;
  // 폰은 길이 열려 있으면 언제나 앞으로 나아간다. (상대 끝줄에 닿으면 승급해야 하니까)
  if (unit.piece === "pawn") return moveDestinations(state, unit)[0];
  const distance = (x: number, y: number) => Math.min(...foes.map((e) => chebyshev({ x, y }, e)));
  const current = distance(unit.x, unit.y);
  let best: { x: number; y: number; d: number } | undefined;
  for (const dest of moveDestinations(state, unit)) {
    const d = distance(dest.x, dest.y);
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

function checkPromotion(state: CombatState, unit: CombatUnit): void {
  if (unit.piece !== "pawn" || unit.summon) return;
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
    let amount = hit.kind === "true" ? hit.amount : hit.amount * damageTakenMultiplier(state, target);
    if (target.shield > 0 && target.shieldUntilBeat >= state.beat && hit.kind !== "true") {
      const absorbed = Math.min(target.shield, amount);
      target.shield -= absorbed;
      amount -= absorbed;
    }
    target.hp -= amount;
    if (hit.kind === "attack" || hit.kind === "ability") {
      if (target.energyMax !== null) target.energy += BEAT_ENERGY_HURT;
    }
    target.lastHitBy = hit.sourceId;
  }
  state.hits = [];
}

function resolveDeaths(state: CombatState): void {
  const dead = state.units.filter((u) => u.alive && u.hp <= 0);
  for (const unit of dead) {
    unit.alive = false;
    unit.hp = 0;
    pushEvent(state, { type: "death", unitId: unit.id });
  }
  for (const unit of dead) {
    const by = unit.lastHitBy;
    const killer = by ? state.units.find((u) => u.id === by && u.alive) : undefined;
    if (killer) onKill(state, killer);
    onDeath(state, unit);
  }
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
  if (state.beat >= SUDDEN_DEATH_BEAT) {
    if (state.beat === SUDDEN_DEATH_BEAT) pushEvent(state, { type: "suddenDeath" });
    for (const u of state.units.filter((x) => x.alive)) {
      queueHit(state, { targetId: u.id, amount: u.maxHp * 0.02 * (state.beat - SUDDEN_DEATH_BEAT + 1), sourceId: null, kind: "true" });
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
  const moves: Array<{ unit: CombatUnit; dest: { x: number; y: number } }> = [];
  for (const unit of order) {
    if (!unit.alive || casters.has(unit.id) || hasEffect(unit, "stun", state.beat)) continue;
    const target = pickTarget(state, unit, attackableEnemies(state, unit));
    if (target) {
      queueHit(state, { targetId: target.id, amount: effectiveAtk(state, unit), sourceId: unit.id, kind: "attack" });
      if (unit.energyMax !== null) unit.energy += BEAT_ENERGY_ATTACK * state.bonuses[unit.seat].energyGain;
      pushEvent(state, { type: "attack", unitId: unit.id, targetId: target.id });
    } else if (!hasEffect(unit, "root", state.beat)) {
      const dest = pickMove(state, unit);
      if (dest) moves.push({ unit, dest });
    }
  }

  // 3) 이동: 같은 칸으로 가려 하면 체력이 많은 쪽이 가고, 같으면 이번 박자에 먼저 움직이는 쪽이 간다.
  //    비어 있던 칸으로만 갈 수 있다(같은 박자에 누가 비운 칸으로는 못 간다).
  const occupied = new Set(state.units.filter((u) => u.alive).map((u) => `${u.x},${u.y}`));
  moves.sort((a, b) => b.unit.hp - a.unit.hp || (a.unit.seat === first ? -1 : 1) - (b.unit.seat === first ? -1 : 1));
  for (const { unit, dest } of moves) {
    const key = `${dest.x},${dest.y}`;
    if (occupied.has(key)) continue;
    occupied.add(key);
    unit.x = dest.x;
    unit.y = dest.y;
    if (unit.piece === "knight") registerLeap(state, unit);
    checkPromotion(state, unit);
  }

  applyHits(state);
  resolveDeaths(state);

  const a = alive(state, 0);
  const b = alive(state, 1);
  if (a === 0 || b === 0 || state.beat >= MAX_BEATS) {
    state.finished = true;
    state.survivors = [realAlive(state, 0), realAlive(state, 1)];
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
export function runCombat(boards: [Placement[], Placement[]]): CombatResult {
  const state = createCombat(boards);
  while (!state.finished) stepCombat(state);
  return { winner: state.winner, survivors: state.survivors, beats: state.beat, suddenDeath: state.beat >= SUDDEN_DEATH_BEAT };
}

export { neutralBonus };


/** 클라이언트가 전투를 그대로 재생할 수 있게 박자마다 상태를 기록한 결과. 좌표는 판의 절대 좌표(seat 0이 아래)다. */
export interface RecordedUnit {
  defId: string;
  seat: Seat;
  star: 1 | 2;
  maxHp: number;
  summon: boolean;
}

/** [x, y, hp, energy, shield, flags(1=살아 있음, 2=승급)] 박자 k의 상태. 아직 생기지 않은 소환수는 없다(배열이 짧다). */
export type FrameUnit = [number, number, number, number, number, number];

/** [박자, 종류, 행동한 기물 번호, 대상 기물 번호(없으면 -1), 능력 id] 종류: attack | ability | death | promote | move */
export type RecordedEvent = [number, string, number, number, string];

export interface CombatRecording {
  result: CombatResult;
  units: RecordedUnit[];
  /** frames[0]은 시작 모습, frames[k]는 k번째 박자가 끝난 모습 */
  frames: FrameUnit[][];
  events: RecordedEvent[];
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

function snapshotFrame(state: CombatState): FrameUnit[] {
  return state.units.map((u) => [u.x, u.y, Math.max(0, r1(u.hp)), r1(u.energy), r1(u.shield), (u.alive ? 1 : 0) | (u.promoted ? 2 : 0)]);
}

/** 끝까지 돌리면서 박자마다 기록한다. 결과는 runCombat과 같다. */
export function recordCombat(boards: [Placement[], Placement[]]): CombatRecording {
  const state = createCombat(boards);
  const frames: FrameUnit[][] = [snapshotFrame(state)];
  while (!state.finished) {
    stepCombat(state);
    frames.push(snapshotFrame(state));
  }
  const index = new Map(state.units.map((u, i) => [u.id, i]));
  const events: RecordedEvent[] = [];
  for (const e of state.events) {
    if (e.type === "suddenDeath" || e.type === "end") continue;
    events.push([e.beat, e.type, index.get(e.unitId ?? "") ?? -1, index.get(e.targetId ?? "") ?? -1, e.text ?? ""]);
  }
  return {
    result: { winner: state.winner, survivors: state.survivors, beats: state.beat, suddenDeath: state.beat >= SUDDEN_DEATH_BEAT },
    units: state.units.map((u) => ({ defId: u.defId, seat: u.seat, star: u.star, maxHp: Math.round(u.maxHp), summon: u.summon })),
    frames,
    events,
  };
}
