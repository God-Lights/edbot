// 클라이언트(Unity)와 서버가 주고받는 메시지 정의.
// 모든 메시지는 JSON 문자열이고, `t` 필드로 종류를 구분한다.

export type Phase =
  | "lobby"
  | "ban"
  | "draft"
  | "placement"
  | "explore"
  | "forge"
  | "battle"
  | "deathmatch"
  | "result";

/** 세 레인. 킹사이드는 체스에서 킹이 서 있는 쪽이다. */
export const LANES = ["queenside", "center", "kingside"] as const;
export type Lane = (typeof LANES)[number];

export function isLane(value: unknown): value is Lane {
  return typeof value === "string" && (LANES as readonly string[]).includes(value);
}

export type Piece = "king" | "queen" | "rook" | "bishop" | "knight" | "pawn";
export type Seat = 0 | 1;

export type ErrorCode =
  | "bad_message"
  | "room_not_found"
  | "room_full"
  | "game_in_progress"
  | "not_in_lobby"
  // ---- 밴, 드래프트, 배치 ----
  | "wrong_phase" // 지금 단계에서는 할 수 없는 행동
  | "unknown_character"
  | "character_unavailable" // 이미 밴되었거나 뽑힌 캐릭터
  | "not_your_turn"
  | "already_done" // 이미 밴했거나 배치를 확정함
  | "not_your_character" // 내 팀에 없는 캐릭터
  | "invalid_lane"
  // ---- 전투 ----
  | "unit_dead"
  | "unit_disabled" // 기절 등으로 행동할 수 없다
  | "not_implemented"
  | "on_cooldown"
  | "not_enough_steam"
  | "no_target"
  | "not_a_knight";

export interface PublicPlayer {
  id: string;
  name: string;
  /** 0 또는 1. 먼저 들어온 사람이 0. */
  seat: Seat;
  connected: boolean;
  ready: boolean;
}

/** 한 사람의 밴 상태. */
export interface BanSnapshot {
  /** 밴을 정했다(밴 시간이 끝나면 못 한 사람도 true). */
  locked: boolean;
  /** 밴한 캐릭터. 밴 단계 중에는 내 것만 보이고 상대 것은 null, 단계가 끝나면 둘 다 보인다. */
  characterId: string | null;
}

/** 밴, 드래프트, 배치의 진행 상황. 게임이 시작되면 생기고 로비로 돌아가면 사라진다. */
export interface GameSnapshot {
  /** 드래프트에서 먼저 뽑는 사람의 seat (선공). 후공 팀은 이후 규칙에서 보정을 받는다. */
  firstPicker: Seat;
  /** seat 순서로 [seat 0, seat 1]. */
  bans: [BanSnapshot, BanSnapshot];
  /** 뽑는 순서 전체 (스네이크). 앞에서부터 pickCount개는 이미 뽑았다. */
  pickOrder: Seat[];
  /** seat 순서로, 뽑은 순서대로의 캐릭터 id. 드래프트 결과는 모두에게 공개된다. */
  picks: [string[], string[]];
  /** 드래프트 중 지금 뽑을 차례인 seat. 드래프트가 아니면 null. */
  turnSeat: Seat | null;
  /** 이번 차례가 끝나는 서버 시각(ms). 시간이 지나면 서버가 알아서 뽑는다. */
  turnEndsAt: number | null;
  /**
   * seat 순서로, 캐릭터 id -> 레인. 내 것은 항상 보이고 상대 것은 전투가 시작될 때까지 null.
   */
  lanes: [Partial<Record<string, Lane>> | null, Partial<Record<string, Lane>> | null];
  /** 배치를 확정했는지 (확정 여부는 상대에게도 보인다). */
  placementLocked: [boolean, boolean];
}

export interface UnitSnapshot {
  id: string;
  characterId: string;
  seat: Seat;
  lane: Lane;
  /** 레인 위의 위치 0~100. seat 0의 본진이 0, seat 1의 본진이 100. */
  pos: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** 죽어 있다면 되살아날 때까지 남은 틱. */
  respawnInTicks: number | null;
  shield: number;
  promoted: boolean;
  summon: boolean;
  /** 걸려 있는 효과 이름들 (stun, slow, dot ...). */
  effects: string[];
  /** 궁극기를 다시 쓸 수 있게 되는 틱. 내 유닛에게만 들어 있다. */
  ultReadyTick: number | null;
  /** 나이트의 레인 이동을 다시 쓸 수 있게 되는 틱. 내 유닛에게만 들어 있다. */
  laneMoveReadyTick: number | null;
}

export interface TowerSnapshot {
  id: string;
  seat: Seat;
  lane: Lane;
  kind: "guard" | "main";
  pos: number;
  hp: number;
  maxHp: number;
  alive: boolean;
}

export interface BattleEventSnapshot {
  seq: number;
  tick: number;
  type: string;
  seat: Seat | null;
  unitId: string | null;
  targetId: string | null;
  text: string | null;
}

export interface BattleSnapshot {
  mode: "battle" | "deathmatch";
  /** 전투 시작부터 센 틱. 1초 = 10틱. */
  tick: number;
  ticksPerSecond: number;
  score: [number, number];
  kills: [number, number];
  /** 내 스팀포스. 구경꾼이면 null. 상대의 스팀포스는 보이지 않는다. */
  steam: number | null;
  towers: TowerSnapshot[];
  units: UnitSnapshot[];
  /** 성채 같은 벽, 샘 같은 구역의 위치. */
  walls: Array<{ lane: Lane; pos: number; seat: Seat }>;
  wells: Array<{ lane: Lane; pos: number; seat: Seat }>;
  /** 최근 이벤트. seq가 이미 본 것보다 큰 것만 처리하면 된다. */
  events: BattleEventSnapshot[];
}

export interface ResultSnapshot {
  winner: Seat | null;
  /** towers | time | deathmatch | deathmatchTime */
  reason: string;
  score: [number, number];
  kills: [number, number];
}

export interface RoomSnapshot {
  code: string;
  phase: Phase;
  phaseStartedAt: number;
  /** 현재 단계가 끝나는 서버 시각(ms). 로비처럼 타이머가 없으면 null. */
  phaseEndsAt: number | null;
  /** 이 스냅샷을 만든 서버 시각(ms). 클라이언트는 이 값으로 시계 차이를 보정한다. */
  serverTime: number;
  players: PublicPlayer[];
  /** 로비에서는 null. */
  game: GameSnapshot | null;
  /** 전투와 데스매치 중에만 있다. */
  battle: BattleSnapshot | null;
  /** 결과 단계에서만 있다. */
  result: ResultSnapshot | null;
}

// ---- 클라이언트 -> 서버 ----

export type ClientMessage =
  | { t: "ready"; ready: boolean }
  | { t: "ping"; ts: number }
  /** 밴 단계에서 캐릭터 1명을 금지한다. 한 번 하면 바꿀 수 없다. */
  | { t: "ban"; characterId: string }
  /** 드래프트에서 내 차례에 캐릭터 1명을 뽑는다. */
  | { t: "pick"; characterId: string }
  /** 배치 단계에서 내 캐릭터 한 명의 레인을 정한다. 확정하기 전에는 다시 바꿀 수 있다. */
  | { t: "place"; characterId: string; lane: Lane }
  /** 배치를 확정한다. 정하지 않은 캐릭터는 기본 레인으로 간다. 둘 다 확정하면 바로 다음 단계로 간다. */
  | { t: "lock" }
  /** 전투 중 궁극기를 쓴다. 스팀포스 5가 든다. 안키오는 갈 레인(lane)을 같이 보낸다. */
  | { t: "ultimate"; characterId: string; lane?: Lane }
  /** 전투 중 나이트가 다른 레인으로 옮겨 간다. */
  | { t: "move"; characterId: string; lane: Lane };

// ---- 서버 -> 클라이언트 ----

export type ServerMessage =
  | {
      t: "welcome";
      playerId: string;
      /** 재접속할 때 `?token=` 으로 다시 보내는 값. 다른 사람에게 보여주면 안 된다. */
      token: string;
      room: RoomSnapshot;
    }
  | { t: "state"; room: RoomSnapshot }
  | { t: "pong"; ts: number; serverTime: number }
  | { t: "error"; code: ErrorCode; message: string };

const MAX_ID_LENGTH = 64;

function characterId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH ? value : null;
}

/** 들어온 문자열을 검증해서 ClientMessage로 바꾼다. 형식이 틀리면 null. */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== "string" || raw.length > 4096) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const msg = data as Record<string, unknown>;
  switch (msg.t) {
    case "ready":
      return typeof msg.ready === "boolean" ? { t: "ready", ready: msg.ready } : null;
    case "ping":
      return typeof msg.ts === "number" && Number.isFinite(msg.ts)
        ? { t: "ping", ts: msg.ts }
        : null;
    case "ban":
    case "pick": {
      const id = characterId(msg.characterId);
      return id ? { t: msg.t, characterId: id } : null;
    }
    case "place": {
      const id = characterId(msg.characterId);
      return id && isLane(msg.lane) ? { t: "place", characterId: id, lane: msg.lane } : null;
    }
    case "lock":
      return { t: "lock" };
    case "ultimate": {
      const id = characterId(msg.characterId);
      if (!id) return null;
      if (msg.lane === undefined || msg.lane === null) return { t: "ultimate", characterId: id };
      return isLane(msg.lane) ? { t: "ultimate", characterId: id, lane: msg.lane } : null;
    }
    case "move": {
      const id = characterId(msg.characterId);
      return id && isLane(msg.lane) ? { t: "move", characterId: id, lane: msg.lane } : null;
    }
    default:
      return null;
  }
}
