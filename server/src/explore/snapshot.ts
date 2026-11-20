// 탐사 상태를 보는 사람에 맞춰 줄인다. 상대의 자원, 행동, 매복은 보이지 않는다.

import type { ExploreSnapshot, Seat } from "../protocol";
import { GAUGE_MAX, GAUGE_REGEN_TICKS, TICKS_PER_SECOND } from "./explore";
import type { ExploreState } from "./explore";

export function toExploreSnapshot(state: ExploreState, viewerSeat: Seat | null): ExploreSnapshot {
  const seat = viewerSeat;
  const rival: Seat | null = seat === null ? null : seat === 0 ? 1 : 0;

  const tiles = state.tiles.map((tile, index) => {
    const known = seat !== null && state.known[seat][index]!;
    const mineGather = seat === null ? undefined : state.gathers.find((g) => g.seat === seat && g.tile === index);
    const mineAmbush = seat === null ? undefined : state.ambushes.find((a) => a.seat === seat && a.tile === index);
    const scouted = seat !== null && state.scouted[seat].includes(index);
    const enemyAmbush =
      scouted && rival !== null && state.ambushes.some((a) => a.seat === rival && a.tile === index);
    return {
      index,
      known,
      kind: known ? tile.kind : null,
      depleted: known && (tile.depletedUntil !== null || tile.spent),
      respawnInTicks:
        known && tile.depletedUntil !== null ? Math.max(0, tile.depletedUntil - state.tick) : null,
      myGatherInTicks: mineGather ? Math.max(0, mineGather.completeTick - state.tick) : null,
      myAmbushInTicks: mineAmbush ? Math.max(0, mineAmbush.expiresTick - state.tick) : null,
      enemyAmbush,
    };
  });

  const resources = seat === null ? null : { ...state.resources[seat] };
  const progress = seat === null ? 0 : state.gaugeProgress[seat];
  return {
    tick: state.tick,
    ticksPerSecond: TICKS_PER_SECOND,
    gauge: seat === null ? 0 : state.gauge[seat],
    gaugeMax: GAUGE_MAX,
    /** 다음 게이지가 찰 때까지 남은 틱. 가득 차 있으면 null. */
    gaugeNextInTicks: seat === null || state.gauge[seat] >= GAUGE_MAX ? null : GAUGE_REGEN_TICKS - progress,
    tiles,
    resources,
    events:
      seat === null
        ? []
        : state.events
            .filter((e) => e.seat === seat)
            .slice(-20)
            .map((e) => ({
              seq: e.seq,
              tick: e.tick,
              type: e.type,
              tile: e.tile,
              gain: e.gain ?? null,
              detail: e.detail ?? null,
            })),
  };
}
