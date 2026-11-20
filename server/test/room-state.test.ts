import { describe, expect, it } from "vitest";
import { PHASE_ORDER, PHASE_SECONDS, nextPhase } from "../src/phases";
import {
  LOBBY_GRACE_MS,
  ROOM_IDLE_MS,
  advancePhase,
  createRoom,
  isExpired,
  joinRoom,
  nextDeadline,
  pruneLobby,
  sanitizeName,
  setDisconnected,
  setReady,
  toSnapshot,
} from "../src/room-state";
import type { RoomState } from "../src/room-state";

function idFactory() {
  let n = 0;
  return () => `id${++n}`;
}

function roomWithTwoPlayers(now = 1_000) {
  const newId = idFactory();
  const state = createRoom("ABCD", now);
  const a = joinRoom(state, { name: "에드" }, now, newId);
  const b = joinRoom(state, { name: "민수" }, now, newId);
  if (!a.ok || !b.ok) throw new Error("join failed");
  return { state, a: a.player, b: b.player, newId };
}

function startGame(state: RoomState, aId: string, bId: string, now: number, scale = 1) {
  setReady(state, aId, true, now, scale);
  return setReady(state, bId, true, now, scale);
}

describe("phases", () => {
  it("한 판은 총 240초이고 순서가 기획서와 같다", () => {
    expect(PHASE_ORDER).toEqual(["ban", "draft", "placement", "explore", "forge", "battle", "result"]);
    const total = PHASE_ORDER.reduce((sum, phase) => sum + PHASE_SECONDS[phase], 0);
    expect(total).toBe(240);
    expect(PHASE_SECONDS.battle).toBe(120);
  });

  it("result 다음에는 로비로 돌아간다", () => {
    expect(nextPhase("lobby")).toBe("ban");
    expect(nextPhase("result")).toBe("lobby");
  });
});

describe("joinRoom", () => {
  it("먼저 들어온 사람이 seat 0, 다음이 seat 1", () => {
    const { a, b } = roomWithTwoPlayers();
    expect([a.seat, b.seat]).toEqual([0, 1]);
  });

  it("세 번째 사람은 방이 가득 찼다는 오류를 받는다", () => {
    const { state, newId } = roomWithTwoPlayers();
    const third = joinRoom(state, { name: "셋째" }, 2_000, newId);
    expect(third).toMatchObject({ ok: false, code: "room_full" });
  });

  it("token이 맞으면 같은 자리로 재접속한다", () => {
    const { state, a } = roomWithTwoPlayers();
    setDisconnected(state, a.id, 2_000);
    const again = joinRoom(state, { name: "다른이름", token: a.token }, 3_000, idFactory());
    expect(again).toMatchObject({ ok: true, reconnected: true });
    expect(state.players).toHaveLength(2);
    expect(state.players.find((p) => p.id === a.id)).toMatchObject({
      connected: true,
      disconnectedAt: null,
      name: "에드", // 재접속으로 이름이 바뀌지 않는다
    });
  });

  it("게임이 시작된 뒤 새로 들어오려는 사람은 거절되지만 재접속은 된다", () => {
    const { state, a, b } = roomWithTwoPlayers();
    startGame(state, a.id, b.id, 2_000);
    expect(joinRoom(state, { name: "구경꾼" }, 2_500, idFactory())).toMatchObject({
      ok: false,
      code: "game_in_progress",
    });
    setDisconnected(state, a.id, 3_000);
    expect(joinRoom(state, { name: "", token: a.token }, 3_500, idFactory())).toMatchObject({
      ok: true,
      reconnected: true,
    });
  });

  it("빈 자리는 seat가 비어 있는 쪽으로 채운다", () => {
    const { state, a, newId } = roomWithTwoPlayers();
    state.players = state.players.filter((p) => p.id !== a.id); // seat 0이 나감
    const c = joinRoom(state, { name: "새로" }, 5_000, newId);
    expect(c).toMatchObject({ ok: true });
    if (c.ok) expect(c.player.seat).toBe(0);
  });
});

describe("sanitizeName", () => {
  it("공백을 다듬고 16자로 자르고, 비면 Player", () => {
    expect(sanitizeName("  에드  ")).toBe("에드");
    expect(sanitizeName("a".repeat(40))).toHaveLength(16);
    expect(sanitizeName("   ")).toBe("Player");
    expect(sanitizeName("a\u0000b\nc")).toBe("abc");
  });
});

describe("setReady / 게임 시작", () => {
  it("한 명만 준비하면 시작하지 않는다", () => {
    const { state, a } = roomWithTwoPlayers();
    expect(setReady(state, a.id, true, 2_000)).toEqual({ ok: true, started: false });
    expect(state.phase).toBe("lobby");
  });

  it("두 명이 모두 준비하면 ban 단계가 시작되고 10초 타이머가 걸린다", () => {
    const { state, a, b } = roomWithTwoPlayers();
    expect(startGame(state, a.id, b.id, 2_000)).toEqual({ ok: true, started: true });
    expect(state.phase).toBe("ban");
    expect(state.phaseStartedAt).toBe(2_000);
    expect(state.phaseEndsAt).toBe(2_000 + 10_000);
  });

  it("준비를 취소하면 다시 시작되지 않는다", () => {
    const { state, a, b } = roomWithTwoPlayers();
    setReady(state, a.id, true, 2_000);
    setReady(state, a.id, false, 2_100);
    expect(setReady(state, b.id, true, 2_200)).toEqual({ ok: true, started: false });
  });

  it("끊긴 사람이 있으면 준비해도 시작하지 않는다", () => {
    const { state, a, b } = roomWithTwoPlayers();
    setReady(state, a.id, true, 2_000);
    setDisconnected(state, a.id, 2_100); // 끊기면 준비도 풀린다
    expect(setReady(state, b.id, true, 2_200)).toEqual({ ok: true, started: false });
  });

  it("게임 중에는 준비할 수 없다", () => {
    const { state, a, b } = roomWithTwoPlayers();
    startGame(state, a.id, b.id, 2_000);
    expect(setReady(state, a.id, false, 3_000)).toMatchObject({ ok: false, code: "not_in_lobby" });
  });

  it("PHASE_SCALE로 시간을 줄일 수 있다", () => {
    const { state, a, b } = roomWithTwoPlayers();
    startGame(state, a.id, b.id, 2_000, 0.1);
    expect(state.phaseEndsAt).toBe(2_000 + 1_000);
  });
});

describe("advancePhase", () => {
  it("시간이 되기 전에는 넘기지 않는다", () => {
    const { state, a, b } = roomWithTwoPlayers();
    startGame(state, a.id, b.id, 2_000);
    expect(advancePhase(state, 11_999)).toBe(false);
    expect(state.phase).toBe("ban");
  });

  it("단계를 순서대로 지나 result 뒤에 로비로 돌아가고 준비가 풀린다", () => {
    const { state, a, b } = roomWithTwoPlayers();
    startGame(state, a.id, b.id, 0);
    const seen: string[] = [state.phase];
    let now = 0;
    while (state.phase !== "lobby") {
      now = state.phaseEndsAt!;
      expect(advancePhase(state, now)).toBe(true);
      seen.push(state.phase);
    }
    expect(seen).toEqual([...PHASE_ORDER, "lobby"]);
    expect(now).toBe(240_000);
    expect(state.phaseEndsAt).toBeNull();
    expect(state.players.every((p) => !p.ready)).toBe(true);
  });

  it("서버가 늦게 깨어나도 밀린 단계를 따라잡고 각 단계 시작 시각이 이어진다", () => {
    const { state, a, b } = roomWithTwoPlayers();
    startGame(state, a.id, b.id, 0);
    // ban(10s) + draft(40s) + placement(20s) = 70초가 지난 시점에 한꺼번에 깨어남
    advancePhase(state, 75_000);
    expect(state.phase).toBe("explore");
    expect(state.phaseStartedAt).toBe(70_000);
    expect(state.phaseEndsAt).toBe(90_000);
  });

  it("타이머가 없는 로비에서는 아무 일도 없다", () => {
    const { state } = roomWithTwoPlayers();
    expect(advancePhase(state, 999_999)).toBe(false);
  });
});

describe("연결 끊김과 정리", () => {
  it("로비에서 유예 시간이 지나면 끊긴 사람을 내보낸다", () => {
    const { state, a } = roomWithTwoPlayers();
    setDisconnected(state, a.id, 10_000);
    expect(pruneLobby(state, 10_000 + LOBBY_GRACE_MS - 1)).toBe(false);
    expect(pruneLobby(state, 10_000 + LOBBY_GRACE_MS)).toBe(true);
    expect(state.players.map((p) => p.name)).toEqual(["민수"]);
  });

  it("게임 중에는 끊겨도 자리를 유지한다", () => {
    const { state, a, b } = roomWithTwoPlayers();
    startGame(state, a.id, b.id, 0);
    setDisconnected(state, a.id, 1_000);
    expect(pruneLobby(state, 1_000 + LOBBY_GRACE_MS * 10)).toBe(false);
    expect(state.players).toHaveLength(2);
  });

  it("아무도 접속해 있지 않은 채 오래되면 만료된다", () => {
    const { state, a, b } = roomWithTwoPlayers();
    setDisconnected(state, a.id, 5_000);
    expect(isExpired(state, 5_000 + ROOM_IDLE_MS)).toBe(false); // b가 아직 접속 중
    setDisconnected(state, b.id, 6_000);
    expect(isExpired(state, 6_000 + ROOM_IDLE_MS - 1)).toBe(false);
    expect(isExpired(state, 6_000 + ROOM_IDLE_MS)).toBe(true);
  });

  it("만들기만 하고 아무도 안 들어온 방도 만료된다", () => {
    const state = createRoom("WXYZ", 0);
    expect(isExpired(state, ROOM_IDLE_MS)).toBe(true);
  });
});

describe("nextDeadline", () => {
  it("게임 중에는 단계 종료 시각", () => {
    const { state, a, b } = roomWithTwoPlayers();
    startGame(state, a.id, b.id, 2_000);
    expect(nextDeadline(state)).toBe(12_000);
  });

  it("로비에서 접속해 있으면 할 일이 없다", () => {
    const { state } = roomWithTwoPlayers();
    expect(nextDeadline(state)).toBeNull();
  });

  it("로비에서 끊긴 사람이 있으면 유예 만료 시각", () => {
    const { state, a } = roomWithTwoPlayers();
    setDisconnected(state, a.id, 4_000);
    expect(nextDeadline(state)).toBe(4_000 + LOBBY_GRACE_MS);
  });

  it("모두 끊기면 방치 만료 시각도 후보가 된다", () => {
    const state = createRoom("WXYZ", 100);
    expect(nextDeadline(state)).toBe(100 + ROOM_IDLE_MS);
  });
});

describe("toSnapshot", () => {
  it("token 같은 비밀 값은 포함하지 않는다", () => {
    const { state } = roomWithTwoPlayers();
    const snapshot = toSnapshot(state, 5_000);
    expect(snapshot.serverTime).toBe(5_000);
    expect(JSON.stringify(snapshot)).not.toContain("token");
    expect(snapshot.players[0]).toEqual({
      id: "id1",
      name: "에드",
      seat: 0,
      connected: true,
      ready: false,
    });
  });
});
