// 대장간 상태를 보는 사람에 맞춰 줄인다. 상대의 재료, 무기, 재련은 보이지 않는다.

import type { ForgeSnapshot, Seat } from "../protocol";
import { STEAM_MAX, TICKS_PER_SECOND, orePrice } from "./forge";
import type { ForgeState } from "./forge";

export function toForgeSnapshot(forge: ForgeState, tick: number, seat: Seat | null, steam: number): ForgeSnapshot {
  const mine = seat === null ? 0 : seat;
  return {
    steam: Math.round(steam * 10) / 10,
    steamMax: STEAM_MAX,
    smelters: seat === null ? [] : forge.smelters[mine].map((job) => (job ? { remainingTicks: Math.max(0, job.finishTick - tick) } : null)),
    inventory: seat === null ? {} : Object.fromEntries(Object.entries(forge.inventory[mine]).filter(([, n]) => n > 0)),
    equipped: seat === null ? {} : { ...forge.equipped[mine] },
    equipping:
      seat === null
        ? {}
        : Object.fromEntries(
            Object.entries(forge.equipping[mine]).map(([id, job]) => [
              id,
              { weaponId: job.weaponId, remainingTicks: Math.max(0, job.finishTick - tick) },
            ]),
          ),
    orePrice: orePrice(forge, mine as Seat),
    ticksPerSecond: TICKS_PER_SECOND,
    events:
      seat === null
        ? []
        : forge.events
            .filter((e) => e.seat === seat)
            .slice(-10)
            .map((e) => ({ seq: e.seq, tick: e.tick, type: e.type, detail: e.detail ?? null })),
  };
}
