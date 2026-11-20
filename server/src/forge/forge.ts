// 대장간: 상점(광석 구매), 재련(철괴), 조합(무기), 장착. 자원은 탐사(ExploreState.resources)와 공유한다.
// Cloudflare에 의존하지 않는 순수 규칙이다. 시간은 탐사와 같은 틱(0.1초)이다.

import type { Seat } from "../protocol";
import { WEAPONS, weaponById } from "./weapons";
import type { MaterialKey } from "./weapons";

export const TICKS_PER_SECOND = 10;
const secs = (s: number): number => Math.round(s * TICKS_PER_SECOND);

export const STEAM_MAX = 10;
export const STEAM_PER_SECOND = 0.5;
export const ORE_PRICE = 4;
export const RICHMOND_DISCOUNT = 0.25;
export const SMELTER_COUNT = 2;
export const SMELT_TALENT = 2;
export const SMELT_STEAM = 3;
export const SMELT_TICKS = secs(15);
export const EQUIP_TICKS = secs(3);
export const MAX_BUY_AT_ONCE = 5;

export interface Smelting {
  finishTick: number;
}

export interface Equipping {
  weaponId: string;
  finishTick: number;
}

export interface ForgeEvent {
  seq: number;
  tick: number;
  seat: Seat;
  type: "smelted" | "equipped" | "equipFailed";
  detail?: string;
}

/** 탐사 자원 중 대장간이 쓰는 부분. */
export interface ForgeResources {
  talent: number;
  branch: number;
  stone: number;
  ore: number;
  ironIngot: number;
  rare: number;
  blueprints: number;
}

export interface ForgeState {
  /** 전투가 시작되기 전의 스팀포스. 전투가 시작되면 전투의 스팀포스를 쓴다. */
  steam: [number, number];
  steamActive: boolean;
  smelters: [Array<Smelting | null>, Array<Smelting | null>];
  inventory: [Record<string, number>, Record<string, number>];
  /** 캐릭터 id -> 끼고 있는 무기 id. */
  equipped: [Record<string, string>, Record<string, string>];
  equipping: [Record<string, Equipping>, Record<string, Equipping>];
  /** 리치몬드가 있는 팀은 상점 가격이 25% 싸다. */
  discount: [boolean, boolean];
  events: ForgeEvent[];
  nextEventSeq: number;
}

export type ForgeFailureCode =
  | "wrong_phase"
  | "not_enough_talent"
  | "not_enough_steam"
  | "not_enough_materials"
  | "no_free_smelter"
  | "unknown_weapon"
  | "no_weapon"
  | "not_your_character"
  | "not_in_zone"
  | "already_equipping"
  | "already_equipped"
  | "invalid_quantity";

export type ForgeResult = { ok: true } | { ok: false; code: ForgeFailureCode };
const fail = (code: ForgeFailureCode): ForgeResult => ({ ok: false, code });

export function createForge(teams: [string[], string[]]): ForgeState {
  const empty = (): Array<Smelting | null> => Array.from({ length: SMELTER_COUNT }, () => null);
  return {
    steam: [STEAM_MAX, STEAM_MAX],
    steamActive: true,
    smelters: [empty(), empty()],
    inventory: [{}, {}],
    equipped: [{}, {}],
    equipping: [{}, {}],
    discount: [teams[0].includes("richmond"), teams[1].includes("richmond")],
    events: [],
    nextEventSeq: 1,
  };
}

export function orePrice(forge: ForgeState, seat: Seat): number {
  return forge.discount[seat] ? Math.round(ORE_PRICE * (1 - RICHMOND_DISCOUNT)) : ORE_PRICE;
}

function emit(forge: ForgeState, tick: number, seat: Seat, type: ForgeEvent["type"], detail?: string): void {
  forge.events.push({ seq: forge.nextEventSeq++, tick, seat, type, detail });
  if (forge.events.length > 40) forge.events.splice(0, forge.events.length - 40);
}

/** 전투 전의 스팀포스 회복과 재련 완료. 한 틱 진행한다. */
export function stepForge(forge: ForgeState, resources: [ForgeResources, ForgeResources], tick: number): void {
  if (forge.steamActive) {
    for (const seat of [0, 1] as const) {
      forge.steam[seat] = Math.min(STEAM_MAX, forge.steam[seat] + STEAM_PER_SECOND / TICKS_PER_SECOND);
    }
  }
  for (const seat of [0, 1] as const) {
    forge.smelters[seat] = forge.smelters[seat].map((job) => {
      if (job && job.finishTick <= tick) {
        resources[seat].ironIngot += 1;
        emit(forge, tick, seat, "smelted");
        return null;
      }
      return job;
    });
  }
}

/** 스팀포스를 쓴다. 전투 중에는 전투의 스팀포스를 쓰므로 호출하는 쪽이 pool을 넘긴다. */
export type SteamPool = { get(seat: Seat): number; spend(seat: Seat, amount: number): void };

export function buyOre(forge: ForgeState, resources: ForgeResources, seat: Seat, quantity: number): ForgeResult {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_BUY_AT_ONCE) return fail("invalid_quantity");
  const cost = orePrice(forge, seat) * quantity;
  if (resources.talent < cost) return fail("not_enough_talent");
  resources.talent -= cost;
  resources.ore += quantity;
  return { ok: true };
}

export function startSmelting(
  forge: ForgeState,
  resources: ForgeResources,
  steam: SteamPool,
  seat: Seat,
  tick: number,
): ForgeResult {
  const slot = forge.smelters[seat].findIndex((job) => job === null);
  if (slot < 0) return fail("no_free_smelter");
  if (resources.ore < 1) return fail("not_enough_materials");
  if (resources.talent < SMELT_TALENT) return fail("not_enough_talent");
  if (steam.get(seat) < SMELT_STEAM) return fail("not_enough_steam");
  resources.ore -= 1;
  resources.talent -= SMELT_TALENT;
  steam.spend(seat, SMELT_STEAM);
  forge.smelters[seat][slot] = { finishTick: tick + SMELT_TICKS };
  return { ok: true };
}

/** 재료를 합쳐 무기를 즉시 만든다. */
export function craftWeapon(forge: ForgeState, resources: ForgeResources, seat: Seat, weaponId: string): ForgeResult {
  const weapon = weaponById(weaponId);
  if (!weapon) return fail("unknown_weapon");
  for (const key of Object.keys(weapon.recipe) as MaterialKey[]) {
    if (resources[key] < (weapon.recipe[key] ?? 0)) return fail("not_enough_materials");
  }
  for (const key of Object.keys(weapon.recipe) as MaterialKey[]) resources[key] -= weapon.recipe[key] ?? 0;
  forge.inventory[seat][weaponId] = (forge.inventory[seat][weaponId] ?? 0) + 1;
  return { ok: true };
}

/**
 * 무기를 끼우기 시작한다 (3초). 무기는 인벤토리에서 빠지고, 끝나면 이전 무기가 인벤토리로 돌아온다.
 * inZone: 이 캐릭터가 본진이나 아군 가드 타워 범위 안에 있는가.
 */
export function startEquip(
  forge: ForgeState,
  seat: Seat,
  teamIds: string[],
  characterId: string,
  weaponId: string,
  tick: number,
  inZone: boolean,
): ForgeResult {
  if (!teamIds.includes(characterId)) return fail("not_your_character");
  if (!weaponById(weaponId)) return fail("unknown_weapon");
  if ((forge.inventory[seat][weaponId] ?? 0) < 1) return fail("no_weapon");
  if (forge.equipping[seat][characterId]) return fail("already_equipping");
  if (forge.equipped[seat][characterId] === weaponId) return fail("already_equipped");
  if (!inZone) return fail("not_in_zone");
  forge.inventory[seat][weaponId] = (forge.inventory[seat][weaponId] ?? 0) - 1;
  forge.equipping[seat][characterId] = { weaponId, finishTick: tick + EQUIP_TICKS };
  return { ok: true };
}

export interface EquipCompletion {
  seat: Seat;
  characterId: string;
  weaponId: string;
}

/**
 * 끝난 장착을 처리한다. 끼우는 동안 정비 구간을 벗어났으면(canEquip=false) 취소하고 무기를 돌려준다.
 * 적용된 장착을 돌려준다.
 */
export function finishEquips(
  forge: ForgeState,
  tick: number,
  canEquip: (seat: Seat, characterId: string) => boolean,
): EquipCompletion[] {
  const done: EquipCompletion[] = [];
  for (const seat of [0, 1] as const) {
    for (const characterId of Object.keys(forge.equipping[seat])) {
      const job = forge.equipping[seat][characterId]!;
      if (job.finishTick > tick) continue;
      delete forge.equipping[seat][characterId];
      if (!canEquip(seat, characterId)) {
        forge.inventory[seat][job.weaponId] = (forge.inventory[seat][job.weaponId] ?? 0) + 1;
        emit(forge, tick, seat, "equipFailed", characterId);
        continue;
      }
      const previous = forge.equipped[seat][characterId];
      if (previous) forge.inventory[seat][previous] = (forge.inventory[seat][previous] ?? 0) + 1;
      forge.equipped[seat][characterId] = job.weaponId;
      emit(forge, tick, seat, "equipped", characterId + ":" + job.weaponId);
      done.push({ seat, characterId, weaponId: job.weaponId });
    }
  }
  return done;
}

/** 리치몬드의 황금 계약: 진행 중인 재련을 모두 ticks만큼 단축한다. */
export function hasten(forge: ForgeState, seat: Seat, ticks: number): void {
  forge.smelters[seat] = forge.smelters[seat].map((job) => (job ? { finishTick: job.finishTick - ticks } : job));
}

export const WEAPON_IDS: readonly string[] = WEAPONS.map((w) => w.id);
