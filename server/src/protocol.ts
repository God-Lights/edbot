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
  | "result";

export type ErrorCode =
  | "bad_message"
  | "room_not_found"
  | "room_full"
  | "game_in_progress"
  | "not_in_lobby";

export interface PublicPlayer {
  id: string;
  name: string;
  /** 0 또는 1. 먼저 들어온 사람이 0. */
  seat: 0 | 1;
  connected: boolean;
  ready: boolean;
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
}

// ---- 클라이언트 -> 서버 ----

export type ClientMessage =
  | { t: "ready"; ready: boolean }
  | { t: "ping"; ts: number };

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
    default:
      return null;
  }
}
