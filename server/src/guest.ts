// 게스트 로그인: GL 계정이 없는 사람이 학번과 이름만으로 "게스트 방"에 들어온다. 전적은 남기지 않는다.
// 게스트 방은 GL 계정으로 로그인한 사람만 만들 수 있고, 관전도 GL 로그인이 필요하다.

import { sanitizeName } from "./room-state";

/** Worker가 확인한 게스트를 방(Durable Object)에 전달하는 내부 헤더. 밖에서 온 값은 항상 지운다. */
export const GUEST_HEADER = "x-edbot-guest";

export interface GuestIdentity {
  /** 학번 (숫자 4~10자리, 예: 20211) */
  studentId: string;
  name: string;
}

const STUDENT_ID = /^\d{4,10}$/;

/** 학번과 이름이 올바르면 게스트 정보를, 아니면 null을 돌려준다. */
export function parseGuest(studentId: string | null | undefined, name: string | null | undefined): GuestIdentity | null {
  const id = (studentId ?? "").trim();
  if (!STUDENT_ID.test(id)) return null;
  const raw = (name ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!raw) return null; // 이름이 비었으면 기본 이름("Player")이 되므로 미리 거른다
  return { studentId: id, name: sanitizeName(raw) };
}

/** 방 안에서 게스트를 가리키는 사용자 id. 같은 학번이 다시 들어오면 원래 자리로 돌아온다. */
export const guestUserId = (guest: GuestIdentity): string => `guest:${guest.studentId}`;

export type WsAccess = { ok: true; kind: "gl" | "guest" | "open" } | { ok: false; error: "unauthorized" };

/**
 * 방에 WebSocket으로 들어올 수 있는가.
 * - GL 로그인: 언제나 된다. 게스트: 게스트 방일 때만(방이 확인한다). 관전은 GL 로그인이 필요하다.
 * - 로그인 검사를 끈 개발 서버(authRequired=false)는 누구나 들어온다.
 */
export function wsAccess(input: { authRequired: boolean; hasGlUser: boolean; guest: GuestIdentity | null; spectate: boolean }): WsAccess {
  if (input.hasGlUser) return { ok: true, kind: "gl" };
  if (input.guest && !input.spectate) return { ok: true, kind: "guest" };
  return input.authRequired ? { ok: false, error: "unauthorized" } : { ok: true, kind: "open" };
}
