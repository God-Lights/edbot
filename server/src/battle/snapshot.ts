// 전투 상태를 클라이언트에게 보낼 형태로 줄인다. 상대의 스팀포스와 궁극기 준비 상태는 숨긴다.

import type { BattleSnapshot, Seat, TowerSnapshot, UnitSnapshot } from "../protocol";
import { TICKS_PER_SECOND } from "./core";
import type { BattleState } from "./core";

const RECENT_EVENTS = 40;
const round1 = (n: number): number => Math.round(n * 10) / 10;

export function toBattleSnapshot(state: BattleState, viewerSeat: Seat | null): BattleSnapshot {
  const units: UnitSnapshot[] = state.units.map((u) => {
    const mine = viewerSeat !== null && u.seat === viewerSeat;
    return {
      id: u.id,
      characterId: u.characterId,
      seat: u.seat,
      lane: u.lane,
      pos: round1(u.pos),
      hp: Math.round(u.hp),
      maxHp: Math.round(u.maxHp),
      alive: u.alive,
      respawnInTicks:
        !u.alive && u.respawnAtTick !== null ? Math.max(0, u.respawnAtTick - state.tick) : null,
      shield: Math.round(u.shield),
      promoted: u.promoted,
      summon: u.summon !== null,
      effects: [...new Set(u.effects.map((e) => e.type))],
      ultReadyTick: mine ? u.ultReadyTick : null,
      laneMoveReadyTick: mine ? u.laneMoveReadyTick : null,
    };
  });
  const towers: TowerSnapshot[] = state.towers.map((t) => ({
    id: t.id,
    seat: t.seat,
    lane: t.lane,
    kind: t.kind,
    pos: t.pos,
    hp: Math.round(t.hp),
    maxHp: Math.round(t.maxHp),
    alive: t.alive,
  }));
  return {
    mode: state.mode,
    tick: state.tick,
    ticksPerSecond: TICKS_PER_SECOND,
    score: [state.score[0], state.score[1]],
    kills: [state.kills[0], state.kills[1]],
    steam: viewerSeat === null ? null : Math.round(state.steam[viewerSeat] * 10) / 10,
    towers,
    units,
    walls: state.walls.map((w) => ({ lane: w.lane, pos: round1(w.pos), seat: w.seat })),
    wells: state.wells.map((w) => ({ lane: w.lane, pos: round1(w.pos), seat: w.seat })),
    events: state.events.slice(-RECENT_EVENTS).map((e) => ({
      seq: e.seq,
      tick: e.tick,
      type: e.type,
      seat: e.seat ?? null,
      unitId: e.unitId ?? null,
      targetId: e.targetId ?? null,
      text: e.text ?? null,
    })),
  };
}
