// 밴 -> 드래프트 -> 배치 규칙. Cloudflare에 의존하지 않는 순수 함수만 둔다.
// 방 전체의 흐름(단계 전환, 타이머)은 room-state.ts가 맡고, 여기서는 "한 판 안의 선택"만 다룬다.

import { CHARACTERS, characterById, defaultLaneFor } from "./characters";
import type { ErrorCode, Lane, Seat } from "./protocol";

export const PICKS_PER_TEAM = 5;
export const TOTAL_PICKS = PICKS_PER_TEAM * 2;

export interface GameState {
  /** 드래프트에서 먼저 뽑는 seat (선공). */
  firstPicker: Seat;
  /** seat별 밴. 정하지 못했으면 null. */
  bans: [string | null, string | null];
  /** seat별로 밴을 정했는지. 밴 단계가 끝나면 못 한 사람도 true가 된다. */
  banLocked: [boolean, boolean];
  /** 뽑는 순서 전체 (10개). */
  pickOrder: Seat[];
  /** seat별로 뽑은 캐릭터 id (뽑은 순서). */
  picks: [string[], string[]];
  /** 지금 차례가 끝나는 서버 시각. 드래프트가 아니거나 다 뽑았으면 null. */
  turnEndsAt: number | null;
  /** seat별 캐릭터 id -> 레인. */
  lanes: [Record<string, Lane>, Record<string, Lane>];
  placementLocked: [boolean, boolean];
}

export type ActionResult = { ok: true } | { ok: false; code: ErrorCode; message: string };

const fail = (code: ErrorCode, message: string): ActionResult => ({ ok: false, code, message });

export function otherSeat(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

/**
 * 스네이크 드래프트 순서. 선공 1명, 후공 2명, 선공 2명, 후공 2명, 선공 2명, 후공 1명.
 * 합치면 양쪽 모두 5명이다.
 */
export function snakeOrder(first: Seat): Seat[] {
  const second = otherSeat(first);
  return [first, second, second, first, first, second, second, first, first, second];
}

export function createGame(firstPicker: Seat): GameState {
  return {
    firstPicker,
    bans: [null, null],
    banLocked: [false, false],
    pickOrder: snakeOrder(firstPicker),
    picks: [[], []],
    turnEndsAt: null,
    lanes: [{}, {}],
    placementLocked: [false, false],
  };
}

// ---- 밴 ----

/** 밴을 한 번 정한다. 바꿀 수 없다. */
export function submitBan(game: GameState, seat: Seat, characterId: string): ActionResult {
  if (!characterById(characterId)) return fail("unknown_character", "없는 캐릭터다.");
  if (game.banLocked[seat]) return fail("already_done", "이미 밴을 정했다.");
  game.bans[seat] = characterId;
  game.banLocked[seat] = true;
  return { ok: true };
}

/** 밴 시간이 끝났을 때. 정하지 못한 사람은 밴 없이 넘어간다. */
export function lockBans(game: GameState): void {
  game.banLocked = [true, true];
}

export function areBansDone(game: GameState): boolean {
  return game.banLocked[0] && game.banLocked[1];
}

/** 밴된 캐릭터 id (중복 없이). */
export function bannedIds(game: GameState): string[] {
  const ids = game.bans.filter((id): id is string => id !== null);
  return [...new Set(ids)];
}

// ---- 드래프트 ----

export function pickedIds(game: GameState): string[] {
  return [...game.picks[0], ...game.picks[1]];
}

export function pickCount(game: GameState): number {
  return game.picks[0].length + game.picks[1].length;
}

export function isDraftComplete(game: GameState): boolean {
  return pickCount(game) >= TOTAL_PICKS;
}

/** 지금 뽑을 차례인 seat. 다 뽑았으면 null. */
export function currentTurnSeat(game: GameState): Seat | null {
  return game.pickOrder[pickCount(game)] ?? null;
}

/** 아직 뽑을 수 있는 캐릭터 id. 데이터 파일의 순서를 유지한다. */
export function availableIds(game: GameState): string[] {
  const unavailable = new Set([...bannedIds(game), ...pickedIds(game)]);
  return CHARACTERS.filter((c) => !unavailable.has(c.id)).map((c) => c.id);
}

/** 첫 차례를 시작한다. */
export function startDraft(game: GameState, now: number, turnMs: number): void {
  game.turnEndsAt = isDraftComplete(game) ? null : now + turnMs;
}

/** 내 차례에 캐릭터를 뽑는다. 다음 차례의 타이머가 바로 시작된다. */
export function submitPick(
  game: GameState,
  seat: Seat,
  characterId: string,
  now: number,
  turnMs: number,
): ActionResult {
  if (!characterById(characterId)) return fail("unknown_character", "없는 캐릭터다.");
  if (currentTurnSeat(game) !== seat) return fail("not_your_turn", "네 차례가 아니다.");
  if (!availableIds(game).includes(characterId)) {
    return fail("character_unavailable", "이미 밴되었거나 뽑힌 캐릭터다.");
  }
  applyPick(game, seat, characterId, now, turnMs);
  return { ok: true };
}

function applyPick(game: GameState, seat: Seat, characterId: string, now: number, turnMs: number): void {
  game.picks[seat].push(characterId);
  game.turnEndsAt = isDraftComplete(game) ? null : now + turnMs;
}

function randomAvailable(game: GameState, rng: () => number): string | null {
  const available = availableIds(game);
  if (available.length === 0) return null;
  return available[Math.min(available.length - 1, Math.floor(rng() * available.length))] ?? null;
}

/** 차례 시간이 지났을 때, 지금 차례인 사람 대신 남은 캐릭터 중 하나를 무작위로 뽑는다. */
export function autoPick(game: GameState, now: number, turnMs: number, rng: () => number): string | null {
  const seat = currentTurnSeat(game);
  if (seat === null) return null;
  const id = randomAvailable(game, rng);
  if (id === null) return null;
  applyPick(game, seat, id, now, turnMs);
  return id;
}

/** 드래프트 단계가 끝났는데 덜 뽑았다면 남은 차례를 모두 무작위로 채운다. */
export function fillDraft(game: GameState, rng: () => number): void {
  while (!isDraftComplete(game)) {
    if (autoPick(game, 0, 0, rng) === null) break; // 풀이 바닥났다 (밴이 정상이라면 일어나지 않는다)
  }
  game.turnEndsAt = null;
}

// ---- 배치 ----

/** 내 캐릭터 하나의 레인을 정한다. 확정하기 전에는 몇 번이든 바꿀 수 있다. */
export function submitPlacement(
  game: GameState,
  seat: Seat,
  characterId: string,
  lane: Lane,
): ActionResult {
  if (!game.picks[seat].includes(characterId)) {
    return fail("not_your_character", "내 팀에 없는 캐릭터다.");
  }
  if (game.placementLocked[seat]) return fail("already_done", "이미 배치를 확정했다.");
  game.lanes[seat][characterId] = lane;
  return { ok: true };
}

/** 레인을 정하지 못한 캐릭터를 기물별 기본 레인으로 보낸다. */
export function fillPlacement(game: GameState, seat: Seat): void {
  for (const id of game.picks[seat]) {
    if (!game.lanes[seat][id]) game.lanes[seat][id] = defaultLaneFor(id);
  }
}

/** 배치를 확정한다. 정하지 않은 캐릭터는 기본 레인으로 간다. */
export function lockPlacement(game: GameState, seat: Seat): ActionResult {
  if (game.placementLocked[seat]) return fail("already_done", "이미 배치를 확정했다.");
  fillPlacement(game, seat);
  game.placementLocked[seat] = true;
  return { ok: true };
}

/** 배치 시간이 끝났을 때. 아직 확정하지 않은 사람도 현재 배치대로 확정한다. */
export function lockAllPlacements(game: GameState): void {
  for (const seat of [0, 1] as const) {
    fillPlacement(game, seat);
    game.placementLocked[seat] = true;
  }
}

export function arePlacementsDone(game: GameState): boolean {
  return game.placementLocked[0] && game.placementLocked[1];
}
