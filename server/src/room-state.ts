// 방 하나의 상태와 규칙. Cloudflare에 의존하지 않는 순수 함수만 둔다.
// (Durable Object인 room.ts는 이 함수들을 불러서 저장·전송만 맡는다.)

import { isTimedPhase, nextPhase, phaseDurationMs } from "./phases";
import type { ErrorCode, Phase, PublicPlayer, RoomSnapshot } from "./protocol";

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
  seat: 0 | 1;
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
  const seat: 0 | 1 = taken.has(0) ? 1 : 0;
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
    enterPhase(state, nextPhase("lobby"), now, scale);
    return { ok: true, started: true };
  }
  return { ok: true, started: false };
}

function enterPhase(state: RoomState, phase: Phase, now: number, scale: number): void {
  state.phase = phase;
  state.phaseStartedAt = now;
  state.phaseEndsAt = isTimedPhase(phase) ? now + phaseDurationMs(phase, scale) : null;
  if (phase === "lobby") {
    // 한 판이 끝나고 돌아온 로비. 다시 하려면 새로 준비해야 한다.
    for (const p of state.players) p.ready = false;
  }
}

/**
 * 시간이 다 된 단계를 다음 단계로 넘긴다. 서버가 늦게 깨어나도 밀린 단계가 한 번에
 * 몰아서 지나가지 않도록, 새 단계의 시작 시각은 이전 단계가 끝났어야 할 시각으로 잡는다.
 */
export function advancePhase(state: RoomState, now: number, scale = 1): boolean {
  if (state.phaseEndsAt === null || now < state.phaseEndsAt) return false;
  const startedAt = state.phaseEndsAt;
  enterPhase(state, nextPhase(state.phase), startedAt, scale);
  // 이미 다음 단계 시간도 지났다면 계속 넘긴다 (알람이 한참 늦은 경우).
  while (state.phaseEndsAt !== null && now >= state.phaseEndsAt) {
    enterPhase(state, nextPhase(state.phase), state.phaseEndsAt, scale);
  }
  state.lastActiveAt = Math.max(state.lastActiveAt, now);
  return true;
}

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

export function toPublicPlayer(player: PlayerState): PublicPlayer {
  return {
    id: player.id,
    name: player.name,
    seat: player.seat,
    connected: player.connected,
    ready: player.ready,
  };
}

/** 클라이언트에게 보낼 공개 상태. token 같은 비밀 값은 넣지 않는다. */
export function toSnapshot(state: RoomState, now: number): RoomSnapshot {
  return {
    code: state.code,
    phase: state.phase,
    phaseStartedAt: state.phaseStartedAt,
    phaseEndsAt: state.phaseEndsAt,
    serverTime: now,
    players: state.players.map(toPublicPlayer),
  };
}
