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
import type { MatchInput } from "./ranking/store";
import { createBattle, TICKS_PER_SECOND } from "./battle/core";
import type { BattleState } from "./battle/core";
import { activeSynergyIds } from "./synergy";
import {
  boardPlacements, bothDone, buy, concedeGame, createChessGame, deploy, finalRoster, finishRound, prepSeconds, reroll,
  runRoundCombat, sell, setDone, startRound, toBench, COMBAT_LINGER_SECONDS,
} from "./chess/game";
import type { ChessGame, ChessResult } from "./chess/game";
import { toChessSnapshot } from "./chess/snapshot";
import { toBattleSnapshot } from "./battle/snapshot";
import { awardKill, createExplore, startAmbush, startGather, startScout, stepExplore } from "./explore/explore";
import type { ExploreState } from "./explore/explore";
import { toExploreSnapshot } from "./explore/snapshot";
import { buyOre, craftWeapon, finishEquips, hasten, startEquip, startSmelting } from "./forge/forge";
import type { ForgeResult, SteamPool } from "./forge/forge";
import { toForgeSnapshot } from "./forge/snapshot";
import { computeMods } from "./battle/abilities";
import { basePosition, inAlliedZone, unitById } from "./battle/core";
import { concede, finishByTime, moveLane, startDeathmatch, stepBattle, useUltimate } from "./battle/sim";
import { isTimedPhase, nextPhase, phaseDurationMs } from "./phases";
import type {
  BanSnapshot,
  ExploreAction,
  ForgeCommand,
  ErrorCode,
  GameSnapshot,
  Lane,
  Phase,
  PublicPlayer,
  ResultSnapshot,
  RoomSnapshot,
  Seat,
} from "./protocol";

export const MAX_PLAYERS = 2;
export const MAX_NAME_LENGTH = 16;
/** 로비에서 연결이 끊긴 사람을 이 시간 뒤에 내보낸다. (그 안에 token으로 재접속하면 유지) */
export const LOBBY_GRACE_MS = 30_000;
/** 아무도 접속해 있지 않은 방을 이 시간 뒤에 지운다. */
export const ROOM_IDLE_MS = 10 * 60_000;

export type RoomMode = "lanes" | "chess";

export interface PlayerState {
  id: string;
  token: string;
  name: string;
  /** GL Account 사용자 id (UUID). 로그인 없이 개발할 때는 없다. */
  userId?: string;
  /** 테스트 대전(ADMN)의 상대 봇. 접속 상태와 로비 유예 시간의 영향을 받지 않는다. */
  bot?: boolean;
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
  /** 전투와 데스매치의 시뮬레이션. 그 외에는 null. */
  battle: BattleState | null;
  /** 체스판 자동 전투 상태(chess 모드). 준비 단계부터 판이 끝날 때까지. */
  chess: ChessGame | null;
  /** 탐사 지도와 자원. 탐사 단계부터 판이 끝날 때까지. 그 외에는 null. */
  explore: ExploreState | null;
  /** 탐사가 여기까지 진행됐다는 서버 시각(ms). 틱 하나는 tickMs. */
  exploreClock: number;
  /** 킬 보상을 이미 준 전투 이벤트 번호. */
  killsAwardedSeq: number;
  /** 시뮬레이션이 여기까지 진행됐다는 서버 시각(ms). 틱 하나는 tickMs. */
  battleClock: number;
  /** 다음에 상태를 보내려고 깨어날 시각(ms). */
  battleSyncAt: number;
  result: ResultSnapshot | null;
  /** 이 판이 시작된 서버 시각(ms). 전적을 저장할 때 판을 가리키는 키의 일부. */
  matchStartedAt: number;
  /** 전적을 저장했는가(또는 저장할 필요가 없다고 판단했는가). */
  recorded: boolean;
  /** 테스트 대전 방(코드 ADMN)이다. 혼자 들어오면 봇이 상대를 맡는다. */
  testMatch: boolean;
  /** lanes: 옛 레인 타워 게임, chess: 체스판 자동 전투 */
  mode: RoomMode;
  createdAt: number;
  lastActiveAt: number;
}

type Failure = { ok: false; code: ErrorCode; message: string };

export function createRoom(code: string, now: number, testMatch = false, mode: RoomMode = "lanes"): RoomState {
  return {
    code,
    phase: "lobby",
    phaseStartedAt: now,
    phaseEndsAt: null,
    players: [],
    game: null,
    battle: null,
    chess: null,
    explore: null,
    exploreClock: now,
    killsAwardedSeq: 0,
    battleClock: now,
    battleSyncAt: now,
    result: null,
    matchStartedAt: now,
    recorded: false,
    testMatch,
    mode,
    createdAt: now,
    lastActiveAt: now,
  };
}

export const BOT_ID = "bot";
export const BOT_NAME = "테스트 봇";

/** 테스트 대전 방에 사람이 혼자면 비어 있는 자리에 봇을 앉힌다. 이미 있으면 아무것도 하지 않는다. */
export function addBotIfNeeded(state: RoomState): boolean {
  if (!state.testMatch || state.players.some((p) => p.bot) || state.players.length !== 1) return false;
  const taken = new Set(state.players.map((p) => p.seat));
  state.players.push({
    id: BOT_ID,
    token: "bot-token",
    name: BOT_NAME,
    seat: taken.has(0) ? 1 : 0,
    connected: true,
    ready: false,
    disconnectedAt: null,
    bot: true,
  });
  state.players.sort((a, b) => a.seat - b.seat);
  return true;
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
  request: { name: string; token?: string; userId?: string },
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

  if (request.userId) {
    // 같은 GL 계정이면 토큰을 잃어버려도(다른 기기 등) 원래 자리로 돌아온다.
    const same = state.players.find((p) => p.userId === request.userId);
    if (same) {
      same.connected = true;
      same.disconnectedAt = null;
      state.lastActiveAt = now;
      return { ok: true, player: same, reconnected: true };
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
    userId: request.userId,
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
    enterPhase(state, state.mode === "chess" ? "prep" : nextPhase("lobby"), now, scale, rng);
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
    state.battle = null;
    state.chess = null;
    state.explore = null;
    state.result = null;
    for (const p of state.players) p.ready = false;
  } else if (phase === "prep") {
    if (!state.chess) {
      state.chess = createChessGame(Math.floor(rng() * 0x7fffffff));
      state.matchStartedAt = startedAt;
      state.recorded = false;
    }
    startRound(state.chess);
    state.phaseEndsAt = startedAt + Math.round(prepSeconds(state.chess.round) * 1000 * scale);
  } else if (phase === "combat" && state.chess) {
    const combat = runRoundCombat(state.chess);
    state.phaseEndsAt = startedAt + Math.round((combat.result.beats + COMBAT_LINGER_SECONDS) * 1000 * scale);
  } else if (phase === "ban") {
    state.game = createGame(rng() < 0.5 ? 0 : 1); // 선공은 무작위
    state.matchStartedAt = startedAt;
    state.recorded = false;
  } else if (phase === "draft" && state.game) {
    startDraft(state.game, startedAt, draftTurnMs(scale));
  } else if (phase === "explore" && state.game) {
    state.explore = createExplore({
      seed: Math.floor(rng() * 0x7fffffff),
      teams: [[...state.game.picks[0]], [...state.game.picks[1]]],
      secondPicker: state.game.firstPicker === 0 ? 1 : 0,
    });
    state.exploreClock = startedAt;
    state.killsAwardedSeq = 0;
    state.battleSyncAt = startedAt + battleSyncMs(scale);
  } else if (phase === "forge") {
    state.battleSyncAt = startedAt + battleSyncMs(scale);
  } else if (phase === "battle" && state.game) {
    state.battle = createBattle(battleSetup(state.game, state.explore));
    if (state.explore) state.explore.forge.steamActive = false; // 이제부터 스팀포스는 전투가 관리한다
    state.battleClock = startedAt;
    state.battleSyncAt = startedAt + battleSyncMs(scale);
  } else if (phase === "deathmatch") {
    state.battleSyncAt = startedAt + battleSyncMs(scale);
  }
}

/** 시뮬레이션 틱 하나에 해당하는 서버 시간. 1틱 = 0.1초 (PHASE_SCALE을 곱한다). */
export function tickMs(scale = 1): number {
  return Math.max(1, Math.round((1000 / TICKS_PER_SECOND) * scale));
}

/** 전투 중 클라이언트에 상태를 보내는 간격. */
export function battleSyncMs(scale = 1): number {
  return Math.max(tickMs(scale), Math.round(250 * scale));
}

function battleSetup(game: GameState, explore: ExploreState | null) {
  const team = (seat: Seat) =>
    game.picks[seat].map((characterId) => ({
      characterId,
      lane: game.lanes[seat][characterId] ?? ("center" as Lane),
      weapon: explore?.forge.equipped[seat][characterId] ?? null,
    }));
  // 후공 팀은 동률일 때 이기는 보정을 받는다.
  return {
    teams: [team(0), team(1)] as [ReturnType<typeof team>, ReturnType<typeof team>],
    steam: explore ? ([explore.forge.steam[0], explore.forge.steam[1]] as [number, number]) : undefined,
    secondPicker: (game.firstPicker === 0 ? 1 : 0) as Seat,
  };
}

/** 전투가 끝났을 때 결과를 정리하고 다음 단계로 간다. 동점이면 데스매치. */
function settleBattle(state: RoomState, at: number, scale: number, rng: () => number): void {
  const battle = state.battle;
  if (!battle || !battle.finished) return;
  if (battle.mode === "battle" && battle.winner === null) {
    startDeathmatch(battle);
    enterPhase(state, "deathmatch", at, scale, rng);
    return;
  }
  state.result = {
    ratings: [null, null],
    winner: battle.winner,
    reason: battle.reason ?? "time",
    score: [battle.score[0], battle.score[1]],
    kills: [battle.kills[0], battle.kills[1]],
  };
  enterPhase(state, "result", at, scale, rng);
}

/** 탐사를 until(서버 시각)까지 진행한다. 탐사는 탐사·대장간·전투·데스매치 동안 계속 흐른다. */
function runExploreTo(state: RoomState, until: number, scale: number): void {
  const explore = state.explore;
  if (!explore) return;
  const step = tickMs(scale);
  while (state.exploreClock + step <= until) {
    state.exploreClock += step;
    stepExplore(explore);
    completeEquips(state);
  }
}

/** 이 캐릭터에게 지금 무기를 끼울 수 있는가: 본진이나 아군 가드 타워 범위 안이어야 한다. (전투 전에는 어디서나) */
function canEquipNow(state: RoomState, seat: Seat, characterId: string): boolean {
  const battle = state.battle;
  if (!battle) return true;
  const unit = unitById(battle, `${seat}:${characterId}`);
  if (!unit || !unit.alive) return true; // 쓰러진 캐릭터는 곧 본진에서 되살아난다
  return Math.abs(unit.pos - basePosition(seat)) <= 12 || inAlliedZone(battle, unit);
}

/** 끝난 장착을 처리하고, 이미 시작된 전투의 캐릭터에게 무기를 끼운다. */
function completeEquips(state: RoomState): void {
  const explore = state.explore;
  if (!explore) return;
  const done = finishEquips(explore.forge, explore.tick, (seat, id) => canEquipNow(state, seat, id));
  for (const { seat, characterId, weaponId } of done) {
    const unit = state.battle ? unitById(state.battle, `${seat}:${characterId}`) : undefined;
    if (unit && state.battle) {
      unit.weapon = weaponId;
      unit.mods = computeMods(state.battle, unit);
    }
  }
}

/** 전투가 쓰고 얻은 탈런트와 재련 단축을 탐사 자원에 반영한다. */
function syncBattleOut(state: RoomState): void {
  const battle = state.battle;
  const explore = state.explore;
  if (!battle || !explore) return;
  for (const seat of [0, 1] as const) {
    if (battle.talentDelta[seat] !== 0) {
      explore.resources[seat].talent = Math.max(0, explore.resources[seat].talent + battle.talentDelta[seat]);
      battle.talentDelta[seat] = 0;
    }
    if (battle.smeltHaste[seat] > 0) {
      hasten(explore.forge, seat, battle.smeltHaste[seat]);
      battle.smeltHaste[seat] = 0;
    }
    battle.talent[seat] = explore.resources[seat].talent;
  }
}

/** 새로 일어난 처치에 탈런트를 준다. */
function awardKills(state: RoomState): void {
  if (!state.explore || !state.battle) return;
  for (const event of state.battle.events) {
    if (event.seq <= state.killsAwardedSeq) continue;
    if (event.type === "kill" && event.seat !== undefined) awardKill(state.explore, event.seat);
    state.killsAwardedSeq = event.seq;
  }
}

/** 체스판 게임이 끝났다: 결과를 정리하고 결과 단계로 간다. */
function finishChess(state: RoomState, at: number, scale: number, rng: () => number): void {
  const chess = state.chess;
  if (!chess || !chess.over) return;
  state.result = {
    ratings: [null, null],
    winner: chess.over.winner,
    reason: chess.over.reason,
    score: [Math.max(0, chess.players[0].hp), Math.max(0, chess.players[1].hp)],
    kills: [chess.roundWins[0], chess.roundWins[1]],
  };
  enterPhase(state, "result", at, scale, rng);
}

/**
 * 체스판 자동 전투의 준비·전투 단계를 시간에 맞춰 진행한다.
 * - 준비: 둘 다 끝냈거나 시간이 되면 전투를 계산해서 전투 단계로
 * - 전투: 시간이 되면 체력을 깎고, 끝났으면 결과 단계, 아니면 다음 라운드 준비
 * - 연결이 30초 넘게 끊긴 사람이 있으면 기권패
 */
function advanceChess(state: RoomState, now: number, scale: number, rng: () => number): "changed" | "idle" {
  const chess = state.chess!;
  const forfeiter = chess.over ? null : forfeitSeat(state, now, scale);
  if (forfeiter !== null) {
    concedeGame(chess, forfeiter, "forfeit");
    finishChess(state, now, scale, rng);
    return "changed";
  }
  const due = state.phaseEndsAt ?? Infinity;
  if (state.phase === "prep") {
    const early = bothDone(chess);
    if (!early && due > now) return "idle";
    enterPhase(state, "combat", early ? now : due, scale, rng);
    return "changed";
  }
  if (due > now) return "idle";
  finishRound(chess);
  if (chess.over) finishChess(state, due, scale, rng);
  else enterPhase(state, "prep", due, scale, rng);
  return "changed";
}

/** 전투 중 연결이 이만큼(ms) 끊겨 있으면 기권패로 본다. (PHASE_SCALE을 곱한다) */
export const FORFEIT_MS = 30_000;

/** 연결이 FORFEIT_MS 넘게 끊긴 사람이 있으면 그 seat. 둘 다면 먼저 끊긴 쪽. 봇은 끊기지 않는다. */
function forfeitSeat(state: RoomState, now: number, scale: number): Seat | null {
  const limit = Math.round(FORFEIT_MS * scale);
  const gone = state.players
    .filter((p) => !p.bot && !p.connected && p.disconnectedAt !== null && now - p.disconnectedAt >= limit)
    .sort((a, b) => (a.disconnectedAt ?? 0) - (b.disconnectedAt ?? 0));
  return gone[0]?.seat ?? null;
}

/** 시뮬레이션을 until(서버 시각)까지 진행한다. 중간에 끝나면 결과를 정리하고 true. */
function runBattleTo(state: RoomState, until: number, scale: number, rng: () => number): boolean {
  const battle = state.battle;
  if (!battle) return false;
  const step = tickMs(scale);
  while (!battle.finished && state.battleClock + step <= until) {
    state.battleClock += step;
    syncBattleOut(state); // 탐사 쪽에서 바뀐 탈런트를 전투가 볼 수 있게 맞춘다
    stepBattle(battle);
    awardKills(state);
    syncBattleOut(state);
  }
  if (battle.finished) {
    settleBattle(state, state.battleClock, scale, rng);
    return true;
  }
  return false;
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
    if (state.chess && (state.phase === "prep" || state.phase === "combat")) {
      const outcome = advanceChess(state, now, scale, rng);
      if (outcome === "changed") {
        changed = true;
        continue;
      }
      break;
    }
    const inBattle = state.phase === "battle" || state.phase === "deathmatch";
    if (inBattle && state.battle) {
      const end = state.phaseEndsAt ?? Infinity;
      const before = state.phase;
      runExploreTo(state, Math.min(now, end), scale);
      const finishedEarly = runBattleTo(state, Math.min(now, end), scale, rng);
      if (finishedEarly || state.phase !== before) {
        changed = true;
        continue;
      }
      const forfeiter = state.battle.finished ? null : forfeitSeat(state, now, scale);
      if (forfeiter !== null) {
        // 연결이 30초 넘게 끊긴 사람은 기권패 (점수는 그대로)
        concede(state.battle, forfeiter, "forfeit");
        settleBattle(state, now, scale, rng);
        changed = true;
        continue;
      }
      if (end <= now) {
        // 시간 종료: 전투는 점수, 데스매치는 남은 체력으로 승부를 가른다.
        finishByTime(state.battle);
        settleBattle(state, end, scale, rng);
        changed = true;
        continue;
      }
      if (now >= state.battleSyncAt) {
        state.battleSyncAt = now + battleSyncMs(scale);
        changed = true;
      }
      break;
    }
    const turnDue =
      state.phase === "draft" && game && game.turnEndsAt !== null ? game.turnEndsAt : Infinity;
    const phaseDue = state.phaseEndsAt ?? Infinity;
    const due = Math.min(turnDue, phaseDue);
    const exploring = state.explore !== null && (state.phase === "explore" || state.phase === "forge");
    if (exploring) runExploreTo(state, Math.min(due, now), scale);
    if (due > now) {
      if (exploring && now >= state.battleSyncAt) {
        state.battleSyncAt = now + battleSyncMs(scale);
        changed = true;
      }
      break;
    }

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

// ---- 전투 중의 선택 ----

const COMMAND_MESSAGES: Record<string, string> = {
  wrong_phase: "지금은 할 수 없다.",
  not_your_character: "내 캐릭터가 아니다.",
  unit_dead: "쓰러진 캐릭터다.",
  unit_disabled: "움직일 수 없는 상태다.",
  not_implemented: "아직 쓸 수 없는 궁극기다.",
  on_cooldown: "아직 쓸 수 없다. (재사용 대기)",
  not_enough_steam: "스팀포스가 부족하다.",
  no_target: "대상이 없다.",
  invalid_lane: "갈 수 없는 레인이다.",
  not_a_knight: "나이트만 레인을 옮길 수 있다.",
  invalid_tile: "없는 칸이다.",
  no_action_gauge: "행동 게이지가 부족하다.",
  tile_busy: "이미 그 칸에서 행동 중이다.",
  nothing_to_gather: "채집할 게 없는 칸이다.",
  already_known: "이미 알고 있는 칸이다.",
  not_enough_talent: "탈런트가 부족하다.",
  not_enough_materials: "재료가 부족하다.",
  no_free_smelter: "빈 재련대가 없다.",
  unknown_weapon: "없는 무기다.",
  no_weapon: "그 무기를 가지고 있지 않다.",
  not_in_zone: "본진이나 아군 가드 타워 근처에서만 장착할 수 있다.",
  already_equipping: "이미 무기를 끼우는 중이다.",
  already_equipped: "이미 끼고 있는 무기다.",
  invalid_quantity: "살 수 있는 개수가 아니다.",
};

function runBattleCommand(
  state: RoomState,
  playerId: string,
  now: number,
  scale: number,
  rng: () => number,
  act: (battle: BattleState, seat: Seat) => { ok: true } | { ok: false; code: string },
): ActionOutcome {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, code: "bad_message", message: "방에 없는 플레이어다." };
  // 명령이 들어온 시각까지 시뮬레이션을 먼저 진행해서, 그 순간의 상태에서 판정한다.
  advancePhase(state, now, scale, rng);
  if ((state.phase !== "battle" && state.phase !== "deathmatch") || !state.battle) return WRONG_PHASE;
  state.battle.talent[player.seat] = state.explore?.resources[player.seat].talent ?? 0;
  const result = act(state.battle, player.seat);
  syncBattleOut(state);
  if (!result.ok) {
    return { ok: false, code: result.code as ErrorCode, message: COMMAND_MESSAGES[result.code] ?? "할 수 없다." };
  }
  state.lastActiveAt = now;
  return { ok: true, advanced: false };
}

function steamPool(state: RoomState): SteamPool {
  const forge = state.explore!.forge;
  const battle = state.battle;
  if (battle && !forge.steamActive) {
    return { get: (seat) => battle.steam[seat], spend: (seat, n) => void (battle.steam[seat] -= n) };
  }
  return { get: (seat) => forge.steam[seat], spend: (seat, n) => void (forge.steam[seat] -= n) };
}

/** 대장간 명령: 광석 구입, 재련, 조합, 장착. 탐사·대장간·전투·데스매치 중에 할 수 있다. */
export function playerForge(
  state: RoomState,
  playerId: string,
  command: ForgeCommand,
  now: number,
  scale = 1,
  rng: () => number = Math.random,
): ActionOutcome {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, code: "bad_message", message: "방에 없는 플레이어다." };
  advancePhase(state, now, scale, rng);
  const active = ["explore", "forge", "battle", "deathmatch"].includes(state.phase);
  const explore = state.explore;
  if (!active || !explore || !state.game) return WRONG_PHASE;
  const seat = player.seat;
  syncBattleOut(state);
  const resources = explore.resources[seat];

  let result: ForgeResult;
  switch (command.action) {
    case "buy":
      result = buyOre(explore.forge, resources, seat, command.quantity);
      break;
    case "smelt":
      result = startSmelting(explore.forge, resources, steamPool(state), seat, explore.tick);
      break;
    case "craft":
      result = craftWeapon(explore.forge, resources, seat, command.weaponId);
      break;
    case "equip":
      result = startEquip(
        explore.forge,
        seat,
        state.game.picks[seat],
        command.characterId,
        command.weaponId,
        explore.tick,
        canEquipNow(state, seat, command.characterId),
      );
      break;
  }
  if (!result.ok) {
    return { ok: false, code: result.code as ErrorCode, message: COMMAND_MESSAGES[result.code] ?? "할 수 없다." };
  }
  if (state.battle) state.battle.talent[seat] = resources.talent;
  state.lastActiveAt = now;
  return { ok: true, advanced: false };
}

/** 탐사 행동. 탐사·대장간·전투·데스매치 중에 할 수 있다. */
export function playerExplore(
  state: RoomState,
  playerId: string,
  action: ExploreAction,
  tile: number,
  now: number,
  scale = 1,
  rng: () => number = Math.random,
): ActionOutcome {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, code: "bad_message", message: "방에 없는 플레이어다." };
  advancePhase(state, now, scale, rng); // 그 순간까지 탐사를 먼저 진행한다
  const active = ["explore", "forge", "battle", "deathmatch"].includes(state.phase);
  if (!active || !state.explore) return WRONG_PHASE;
  const act = action === "gather" ? startGather : action === "ambush" ? startAmbush : startScout;
  const result = act(state.explore, player.seat, tile);
  if (!result.ok) {
    return { ok: false, code: result.code as ErrorCode, message: COMMAND_MESSAGES[result.code] ?? "할 수 없다." };
  }
  state.lastActiveAt = now;
  return { ok: true, advanced: false };
}

const CHESS_MESSAGES: Record<string, string> = {
  invalid_slot: "없는 상점 칸이다.",
  shop_empty: "이미 산 칸이다.",
  not_enough_gold: "골드가 부족하다.",
  bench_full: "대기석이 가득 찼다.",
  unit_not_found: "그 기물이 없다.",
  invalid_cell: "놓을 수 없는 칸이다.",
  deploy_full: "판에 올릴 수 있는 기물 수를 넘었다.",
};

export type ChessCommand =
  | { t: "buy"; slot: number }
  | { t: "sell"; uid: string }
  | { t: "reroll" }
  | { t: "deploy"; uid: string; col: number; row: number }
  | { t: "bench"; uid: string }
  | { t: "done" };

/** 체스판 자동 전투의 준비 단계 행동: 사기, 팔기, 새로고침, 놓기, 내리기, 준비 끝. */
export function playerChess(
  state: RoomState,
  playerId: string,
  command: ChessCommand,
  now: number,
  scale = 1,
  rng: () => number = Math.random,
): ActionOutcome {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, code: "bad_message", message: "방에 없는 플레이어다." };
  advancePhase(state, now, scale, rng); // 시간이 지나 단계가 바뀌었을 수 있다
  const chess = state.chess;
  if (!chess || state.phase !== "prep") return WRONG_PHASE;
  const seat = player.seat;

  let result: ChessResult;
  switch (command.t) {
    case "buy": result = buy(chess, seat, command.slot); break;
    case "sell": result = sell(chess, seat, command.uid); break;
    case "reroll": result = reroll(chess, seat); break;
    case "deploy": result = deploy(chess, seat, command.uid, command.col, command.row); break;
    case "bench": result = toBench(chess, seat, command.uid); break;
    case "done":
      setDone(chess, seat, true);
      result = { ok: true };
      break;
  }
  if (!result.ok) {
    return { ok: false, code: result.code as ErrorCode, message: CHESS_MESSAGES[result.code] ?? "할 수 없다." };
  }
  state.lastActiveAt = now;
  const advanced = advancePhase(state, now, scale, rng); // 둘 다 끝냈으면 바로 전투로
  return { ok: true, advanced };
}

/** 항복한다. 전투와 데스매치 중 언제든 할 수 있고, 상대가 바로 이긴다. */
export function playerSurrender(
  state: RoomState,
  playerId: string,
  now: number,
  scale = 1,
  rng: () => number = Math.random,
): ActionOutcome {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, code: "bad_message", message: "방에 없는 플레이어다." };
  advancePhase(state, now, scale, rng); // 그 순간까지 먼저 진행한다 (이미 끝났을 수도 있다)
  if (state.chess && (state.phase === "prep" || state.phase === "combat") && !state.chess.over) {
    concedeGame(state.chess, player.seat, "surrender");
    finishChess(state, now, scale, rng);
    state.lastActiveAt = now;
    return { ok: true, advanced: true };
  }
  if ((state.phase !== "battle" && state.phase !== "deathmatch") || !state.battle || state.battle.finished) return WRONG_PHASE;
  concede(state.battle, player.seat, "surrender");
  settleBattle(state, now, scale, rng);
  state.lastActiveAt = now;
  return { ok: true, advanced: true };
}

/** 궁극기를 쓴다. 안키오는 갈 레인도 보낸다. */
export function playerUltimate(
  state: RoomState,
  playerId: string,
  characterId: string,
  lane: Lane | undefined,
  now: number,
  scale = 1,
  rng: () => number = Math.random,
): ActionOutcome {
  return runBattleCommand(state, playerId, now, scale, rng, (battle, seat) =>
    useUltimate(battle, seat, characterId, lane),
  );
}

/** 나이트가 다른 레인으로 옮겨 간다. */
export function playerMoveLane(
  state: RoomState,
  playerId: string,
  characterId: string,
  lane: Lane,
  now: number,
  scale = 1,
  rng: () => number = Math.random,
): ActionOutcome {
  return runBattleCommand(state, playerId, now, scale, rng, (battle, seat) =>
    moveLane(battle, seat, characterId, lane),
  );
}

// ---- 전적 ----

/**
 * 끝난 판을 전적으로 남길 수 있으면 저장할 내용을 만든다.
 * 두 사람 모두 GL 계정으로 로그인한 판만 기록하고(개발 서버의 익명 판은 기록하지 않는다), 한 번만 만든다.
 */
export function takeMatchRecord(state: RoomState, now: number): MatchInput | null {
  if (state.recorded || state.phase !== "result" || !state.result || !(state.game || state.chess)) return null;
  state.recorded = true; // 저장이 실패해도 같은 판을 반복해서 시도하지 않는다
  const [a, b] = [0, 1].map((seat) => state.players.find((p) => p.seat === seat));
  if (!a?.userId || !b?.userId || a.userId === b.userId) return null;
  return {
    roomCode: state.code,
    startedAt: state.matchStartedAt,
    endedAt: now,
    users: [
      { userId: a.userId, nickname: a.name },
      { userId: b.userId, nickname: b.name },
    ],
    winnerSeat: state.result.winner === null ? null : (state.result.winner as 0 | 1),
    reason: state.result.reason,
    score: [state.result.score[0] ?? 0, state.result.score[1] ?? 0],
    kills: [state.result.kills[0] ?? 0, state.result.kills[1] ?? 0],
    picks: state.chess
      ? [finalRoster(state.chess.players[0]), finalRoster(state.chess.players[1])]
      : [[...state.game!.picks[0]], [...state.game!.picks[1]]],
  };
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
  const anyoneConnected = state.players.some((p) => p.connected && !p.bot);
  return !anyoneConnected && now - state.lastActiveAt >= ROOM_IDLE_MS;
}

/** 서버가 다음에 깨어나야 하는 시각(알람). 할 일이 없으면 null. */
export function nextDeadline(state: RoomState): number | null {
  const candidates: number[] = [];
  if (state.phaseEndsAt !== null) candidates.push(state.phaseEndsAt);
  if (state.phase === "draft" && state.game && state.game.turnEndsAt !== null) {
    candidates.push(state.game.turnEndsAt);
  }
  const syncing =
    ((state.phase === "battle" || state.phase === "deathmatch") && state.battle !== null) ||
    ((state.phase === "explore" || state.phase === "forge") && state.explore !== null);
  if (syncing) candidates.push(state.battleSyncAt);
  if (state.phase === "lobby") {
    for (const p of state.players) {
      if (!p.connected && p.disconnectedAt !== null) {
        candidates.push(p.disconnectedAt + LOBBY_GRACE_MS);
      }
    }
  }
  if (!state.players.some((p) => p.connected && !p.bot)) {
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
  const lanesRevealed =
    state.phase === "battle" || state.phase === "deathmatch" || state.phase === "result";
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
    synergies: [activeSynergyIds(game.picks[0]), activeSynergyIds(game.picks[1])],
  };
}

function viewerSteam(state: RoomState, seat: Seat | null): number {
  if (seat === null || !state.explore) return 0;
  const forge = state.explore.forge;
  return state.battle && !forge.steamActive ? state.battle.steam[seat] : forge.steam[seat];
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
    battle: state.battle ? toBattleSnapshot(state.battle, viewer ? viewer.seat : null) : null,
    chess: state.chess ? toChessSnapshot(state.chess, viewer ? viewer.seat : null, state.phase === "combat" || state.phase === "result") : null,
    explore: state.explore ? toExploreSnapshot(state.explore, viewer ? viewer.seat : null) : null,
    forge: state.explore ? toForgeSnapshot(state.explore.forge, state.explore.tick, viewer ? viewer.seat : null, viewerSteam(state, viewer ? viewer.seat : null)) : null,
    result: state.result,
  };
}
