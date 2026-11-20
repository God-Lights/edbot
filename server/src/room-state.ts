// 방 하나의 상태와 규칙. Cloudflare에 의존하지 않는 순수 함수만 둔다.
// (Durable Object인 room.ts는 이 함수들을 불러서 저장·전송만 맡는다.)

import {
  TOTAL_PICKS,
  areBansDone,
  arePlacementsDone,
  autoPick,
  createGame,
  currentTurnSeat,
  fillDraft,
  isDraftComplete,
  lockAllPlacements,
  lockBans,
  lockPlacement,
  startDraft,
  submitBan,
  submitPick,
  submitPlacement,
} from "./game";
import type { ActionResult, GameState } from "./game";
import { isTimedPhase, nextPhase, phaseDurationMs } from "./phases";
import type {
  BanSnapshot,
  ErrorCode,
  GameSnapshot,
  Lane,
  Phase,
  PublicPlayer,
  RoomSnapshot,
  Seat,
} from "./protocol";

export const MAX_PLAYERS = 2;
export const MAX_NAME_LENGTH = 16;
/** 로비에서 연결이 끊긴 사람을 이 시간 뒤에 내보낸다. (그 안에 token으로 재접속하면 유지) */
export const LOBBY_GRACE_MS = 30_000;
/** 아무도 접속해 있지 않은 방을 이 시간 뒤에 지운다. */
export const ROOM_IDLE_MS = 10 * 60_000;

export interface PlayerState {
  id: string;
  token: string;
  name: string;
  seat: Seat;
  connected: boolean;
  ready: boolean;
  disconnectedAt: number | null;
}

export interface RoomState {
  code: string;
  phase: Phase;
  phaseStartedAt: number;
  phaseEndsAt: number | null;
  players: PlayerState[];
  /** 밴, 드래프트, 배치 상태. 로비에서는 null. */
  game: GameState | null;
  createdAt: number;
  lastActiveAt: number;
}

type Failure = { ok: false; code: ErrorCode; message: string };

export function createRoom(code: string, now: number): RoomState {
  return {
    code,
    phase: "lobby",
    phaseStartedAt: now,
    phaseEndsAt: null,
    players: [],
    game: null,
    createdAt: now,
    lastActiveAt: now,
  };
}

export function sanitizeName(raw: string): string {
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_NAME_LENGTH);
  return name.length > 0 ? name : "Player";
}

export type JoinResult =
  | { ok: true; player: PlayerState; reconnected: boolean }
  | Failure;

/**
 * 방에 들어온다.
 * - token이 맞으면 기존 자리로 재접속 (게임 중에도 가능).
 * - 새 사람은 로비에서만, 빈자리가 있을 때만 들어올 수 있다.
 */
export function joinRoom(
  state: RoomState,
  request: { name: string; token?: string },
  now: number,
  newId: () => string,
): JoinResult {
  if (request.token) {
    const existing = state.players.find((p) => p.token === request.token);
    if (existing) {
      existing.connected = true;
      existing.disconnectedAt = null;
      state.lastActiveAt = now;
      return { ok: true, player: existing, reconnected: true };
    }
  }

  if (state.phase !== "lobby") {
    return { ok: false, code: "game_in_progress", message: "이미 게임이 진행 중인 방이다." };
  }
  if (state.players.length >= MAX_PLAYERS) {
    return { ok: false, code: "room_full", message: "방이 가득 찼다." };
  }

  const taken = new Set(state.players.map((p) => p.seat));
  const seat: Seat = taken.has(0) ? 1 : 0;
  const player: PlayerState = {
    id: newId(),
    token: newId(),
    name: sanitizeName(request.name),
    seat,
    connected: true,
    ready: false,
    disconnectedAt: null,
  };
  state.players.push(player);
  state.players.sort((a, b) => a.seat - b.seat);
  state.lastActiveAt = now;
  return { ok: true, player, reconnected: false };
}

/** 소켓이 모두 끊겼을 때 부른다. 게임 중에는 자리를 유지하고, 로비에서는 유예 시간 뒤에 내보낸다. */
export function setDisconnected(state: RoomState, playerId: string, now: number): void {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || !player.connected) return;
  player.connected = false;
  player.disconnectedAt = now;
  player.ready = false;
  state.lastActiveAt = now;
}

export type ReadyResult = { ok: true; started: boolean } | Failure;

/** 로비에서 준비 상태를 바꾼다. 두 사람이 모두 접속해 있고 준비하면 게임이 시작된다. */
export function setReady(
  state: RoomState,
  playerId: string,
  ready: boolean,
  now: number,
  scale = 1,
  rng: () => number = Math.random,
): ReadyResult {
  if (state.phase !== "lobby") {
    return { ok: false, code: "not_in_lobby", message: "로비에서만 준비할 수 있다." };
  }
  const player = state.players.find((p) => p.id === playerId);
  if (!player) {
    return { ok: false, code: "bad_message", message: "방에 없는 플레이어다." };
  }
  player.ready = ready;
  state.lastActiveAt = now;

  const everyoneReady =
    state.players.length === MAX_PLAYERS && state.players.every((p) => p.connected && p.ready);
  if (everyoneReady) {
    enterPhase(state, nextPhase("lobby"), now, scale, rng);
    return { ok: true, started: true };
  }
  return { ok: true, started: false };
}

// ---- 단계 전환 ----

/** 드래프트 한 차례의 제한 시간. 드래프트 단계 시간을 뽑는 횟수로 나눈다. (40초 / 10 = 4초) */
export function draftTurnMs(scale = 1): number {
  return Math.floor(phaseDurationMs("draft", scale) / TOTAL_PICKS);
}

function enterPhase(
  state: RoomState,
  phase: Phase,
  startedAt: number,
  scale: number,
  rng: () => number,
): void {
  state.phase = phase;
  state.phaseStartedAt = startedAt;
  state.phaseEndsAt = isTimedPhase(phase) ? startedAt + phaseDurationMs(phase, scale) : null;

  if (phase === "lobby") {
    // 한 판이 끝나고 돌아온 로비. 다시 하려면 새로 준비해야 한다.
    state.game = null;
    for (const p of state.players) p.ready = false;
  } else if (phase === "ban") {
    state.game = createGame(rng() < 0.5 ? 0 : 1); // 선공은 무작위
  } else if (phase === "draft" && state.game) {
    startDraft(state.game, startedAt, draftTurnMs(scale));
  }
}

/** 단계를 떠나기 전에 정리한다. 하지 못한 선택은 기본값으로 채운다. */
function leavePhase(state: RoomState, rng: () => number): void {
  const game = state.game;
  if (!game) return;
  switch (state.phase) {
    case "ban":
      lockBans(game); // 못 정한 사람은 밴 없이 넘어간다
      break;
    case "draft":
      fillDraft(game, rng); // 남은 차례는 남은 캐릭터 중 무작위
      break;
    case "placement":
      lockAllPlacements(game); // 못 정한 캐릭터는 기물별 기본 레인
      break;
  }
}

function moveToNext(state: RoomState, at: number, scale: number, rng: () => number): void {
  leavePhase(state, rng);
  enterPhase(state, nextPhase(state.phase), at, scale, rng);
}

/** 모두가 할 일을 끝냈으면 시간이 남아도 바로 다음 단계로 간다. */
function advanceIfDone(state: RoomState, now: number, scale: number, rng: () => number): boolean {
  const game = state.game;
  if (!game) return false;
  const done =
    (state.phase === "ban" && areBansDone(game)) ||
    (state.phase === "draft" && isDraftComplete(game)) ||
    (state.phase === "placement" && arePlacementsDone(game));
  if (!done) return false;
  moveToNext(state, now, scale, rng);
  return true;
}

/**
 * 시간이 된 일을 처리한다. 두 종류다.
 * - 드래프트의 한 차례가 끝났다 -> 그 사람 대신 무작위로 뽑는다 (다 뽑았으면 다음 단계)
 * - 단계 시간이 끝났다 -> 하지 못한 선택을 기본값으로 채우고 다음 단계
 *
 * 서버가 늦게 깨어나도 밀린 일이 한 번에 몰리지 않도록, 각 일이 있어야 했던 시각을 기준으로
 * 순서대로 처리한다. 바뀐 게 있으면 true.
 */
export function advancePhase(
  state: RoomState,
  now: number,
  scale = 1,
  rng: () => number = Math.random,
): boolean {
  let changed = false;
  for (;;) {
    const game = state.game;
    const turnDue =
      state.phase === "draft" && game && game.turnEndsAt !== null ? game.turnEndsAt : Infinity;
    const phaseDue = state.phaseEndsAt ?? Infinity;
    const due = Math.min(turnDue, phaseDue);
    if (due > now) break;

    changed = true;
    if (game && turnDue <= phaseDue) {
      if (autoPick(game, due, draftTurnMs(scale), rng) === null) fillDraft(game, rng);
      if (isDraftComplete(game)) moveToNext(state, due, scale, rng);
    } else {
      moveToNext(state, due, scale, rng);
    }
  }
  if (changed) state.lastActiveAt = Math.max(state.lastActiveAt, now);
  return changed;
}

// ---- 플레이어의 선택 (밴, 뽑기, 배치) ----

export type ActionOutcome = { ok: true; advanced: boolean } | Failure;

const WRONG_PHASE: Failure = {
  ok: false,
  code: "wrong_phase",
  message: "지금 단계에서는 할 수 없다.",
};

function runAction(
  state: RoomState,
  playerId: string,
  expected: Phase,
  now: number,
  scale: number,
  rng: () => number,
  act: (game: GameState, seat: Seat) => ActionResult,
): ActionOutcome {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, code: "bad_message", message: "방에 없는 플레이어다." };
  if (state.phase !== expected || !state.game) return WRONG_PHASE;

  const result = act(state.game, player.seat);
  if (!result.ok) return result;
  state.lastActiveAt = now;
  return { ok: true, advanced: advanceIfDone(state, now, scale, rng) };
}

/** 밴 단계에서 캐릭터 1명을 금지한다. 둘 다 정하면 시간이 남아도 바로 드래프트로 간다. */
export function playerBan(
  state: RoomState,
  playerId: string,
  characterId: string,
  now: number,
  scale = 1,
  rng: () => number = Math.random,
): ActionOutcome {
  return runAction(state, playerId, "ban", now, scale, rng, (game, seat) =>
    submitBan(game, seat, characterId),
  );
}

/** 드래프트에서 내 차례에 캐릭터를 뽑는다. 10명을 다 뽑으면 바로 배치로 간다. */
export function playerPick(
  state: RoomState,
  playerId: string,
  characterId: string,
  now: number,
  scale = 1,
  rng: () => number = Math.random,
): ActionOutcome {
  return runAction(state, playerId, "draft", now, scale, rng, (game, seat) =>
    submitPick(game, seat, characterId, now, draftTurnMs(scale)),
  );
}

/** 배치 단계에서 내 캐릭터 하나의 레인을 정한다. */
export function playerPlace(
  state: RoomState,
  playerId: string,
  characterId: string,
  lane: Lane,
  now: number,
  scale = 1,
  rng: () => number = Math.random,
): ActionOutcome {
  return runAction(state, playerId, "placement", now, scale, rng, (game, seat) =>
    submitPlacement(game, seat, characterId, lane),
  );
}

/** 배치를 확정한다. 둘 다 확정하면 시간이 남아도 바로 다음 단계로 간다. */
export function playerLock(
  state: RoomState,
  playerId: string,
  now: number,
  scale = 1,
  rng: () => number = Math.random,
): ActionOutcome {
  return runAction(state, playerId, "placement", now, scale, rng, (game, seat) =>
    lockPlacement(game, seat),
  );
}

// ---- 정리와 알람 ----

/** 로비에서 유예 시간이 지난 끊긴 플레이어를 내보낸다. 바뀐 게 있으면 true. */
export function pruneLobby(state: RoomState, now: number): boolean {
  if (state.phase !== "lobby") return false;
  const before = state.players.length;
  state.players = state.players.filter(
    (p) => p.connected || p.disconnectedAt === null || now - p.disconnectedAt < LOBBY_GRACE_MS,
  );
  return state.players.length !== before;
}

/** 아무도 접속하지 않은 채 오래 방치된 방인가. */
export function isExpired(state: RoomState, now: number): boolean {
  const anyoneConnected = state.players.some((p) => p.connected);
  return !anyoneConnected && now - state.lastActiveAt >= ROOM_IDLE_MS;
}

/** 서버가 다음에 깨어나야 하는 시각(알람). 할 일이 없으면 null. */
export function nextDeadline(state: RoomState): number | null {
  const candidates: number[] = [];
  if (state.phaseEndsAt !== null) candidates.push(state.phaseEndsAt);
  if (state.phase === "draft" && state.game && state.game.turnEndsAt !== null) {
    candidates.push(state.game.turnEndsAt);
  }
  if (state.phase === "lobby") {
    for (const p of state.players) {
      if (!p.connected && p.disconnectedAt !== null) {
        candidates.push(p.disconnectedAt + LOBBY_GRACE_MS);
      }
    }
  }
  if (!state.players.some((p) => p.connected)) {
    candidates.push(state.lastActiveAt + ROOM_IDLE_MS);
  }
  return candidates.length > 0 ? Math.min(...candidates) : null;
}

// ---- 클라이언트에게 보여 줄 상태 ----

export function toPublicPlayer(player: PlayerState): PublicPlayer {
  return {
    id: player.id,
    name: player.name,
    seat: player.seat,
    connected: player.connected,
    ready: player.ready,
  };
}

/**
 * 밴과 배치는 상대에게 숨겨야 해서 보는 사람마다 다르게 만든다.
 * - 밴: 밴 단계가 끝나기 전에는 상대가 무엇을 밴했는지 모른다 (정했는지만 안다).
 * - 레인 배치: 전투가 시작되기 전에는 상대의 배치를 모른다.
 * - 드래프트 결과(뽑은 캐릭터)는 뽑는 즉시 모두에게 공개된다.
 */
export function toGameSnapshot(state: RoomState, viewerSeat: Seat | null): GameSnapshot | null {
  const game = state.game;
  if (!game) return null;

  const bansRevealed = state.phase !== "ban";
  const lanesRevealed = state.phase === "battle" || state.phase === "result";
  const inDraft = state.phase === "draft";

  const ban = (seat: Seat): BanSnapshot => ({
    locked: game.banLocked[seat],
    characterId: bansRevealed || seat === viewerSeat ? game.bans[seat] : null,
  });
  const lanes = (seat: Seat) =>
    lanesRevealed || seat === viewerSeat ? { ...game.lanes[seat] } : null;

  return {
    firstPicker: game.firstPicker,
    bans: [ban(0), ban(1)],
    pickOrder: [...game.pickOrder],
    picks: [[...game.picks[0]], [...game.picks[1]]],
    turnSeat: inDraft ? currentTurnSeat(game) : null,
    turnEndsAt: inDraft ? game.turnEndsAt : null,
    lanes: [lanes(0), lanes(1)],
    placementLocked: [game.placementLocked[0], game.placementLocked[1]],
  };
}

/** 클라이언트에게 보낼 공개 상태. token 같은 비밀 값은 넣지 않는다. */
export function toSnapshot(state: RoomState, now: number, viewerId?: string): RoomSnapshot {
  const viewer = viewerId ? state.players.find((p) => p.id === viewerId) : undefined;
  return {
    code: state.code,
    phase: state.phase,
    phaseStartedAt: state.phaseStartedAt,
    phaseEndsAt: state.phaseEndsAt,
    serverTime: now,
    players: state.players.map(toPublicPlayer),
    game: toGameSnapshot(state, viewer ? viewer.seat : null),
  };
}
