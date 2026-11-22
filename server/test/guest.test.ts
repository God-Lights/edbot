import { describe, expect, it } from "vitest";
import { GUEST_HEADER, guestUserId, parseGuest, wsAccess } from "../src/guest";
import { LIVE_TTL_MS, LiveBoard } from "../src/liveboard";
import type { LiveRoom } from "../src/liveboard";
import { createRoom, joinRoom, setReady, takeMatchRecord } from "../src/room-state";
import { runChessBot } from "../src/bot";
import { advancePhase } from "../src/room-state";

describe("게스트 로그인 (학번 + 이름)", () => {
  it("숫자 4~10자리 학번과 이름이 있어야 한다", () => {
    expect(parseGuest("20211", "홍길동")).toEqual({ studentId: "20211", name: "홍길동" });
    expect(parseGuest(" 20211 ", " 길동 ")).toEqual({ studentId: "20211", name: "길동" });
    for (const bad of [["", "a"], ["123", "a"], ["12345678901", "a"], ["20211a", "a"], ["2021 1", "a"], [null, "a"], ["20211", ""], ["20211", "  "], ["20211", null]] as const) {
      expect(parseGuest(bad[0], bad[1]), JSON.stringify(bad)).toBeNull();
    }
    expect(parseGuest("20211", "Player")?.name).toBe("Player"); // 이름이 진짜 Player인 경우는 허용
    expect(parseGuest("20211", "가".repeat(30))?.name).toHaveLength(16);
    expect(parseGuest("20211", "a\u0000b")?.name).toBe("ab");
  });

  it("게스트의 사용자 id는 학번으로 정해져서, 같은 학번은 같은 사람이다", () => {
    expect(guestUserId({ studentId: "20211", name: "가" })).toBe(guestUserId({ studentId: "20211", name: "나" }));
    expect(guestUserId({ studentId: "20211", name: "가" })).not.toBe(guestUserId({ studentId: "20212", name: "가" }));
    expect(GUEST_HEADER).toBe("x-edbot-guest");
  });

  const guest = { studentId: "20211", name: "홍길동" };
  it("접속 권한: GL 로그인은 언제나, 게스트는 관전을 뺀 입장만, 둘 다 없으면 로그인 검사에 따라", () => {
    expect(wsAccess({ authRequired: true, hasGlUser: true, guest: null, spectate: false })).toEqual({ ok: true, kind: "gl" });
    expect(wsAccess({ authRequired: true, hasGlUser: true, guest, spectate: true })).toEqual({ ok: true, kind: "gl" });
    expect(wsAccess({ authRequired: true, hasGlUser: false, guest, spectate: false })).toEqual({ ok: true, kind: "guest" });
    // 게스트는 관전할 수 없다 (관전 목록은 GL 로그인 안에 있다)
    expect(wsAccess({ authRequired: true, hasGlUser: false, guest, spectate: true })).toEqual({ ok: false, error: "unauthorized" });
    expect(wsAccess({ authRequired: true, hasGlUser: false, guest: null, spectate: false })).toEqual({ ok: false, error: "unauthorized" });
    // 로그인 검사를 끈 개발 서버
    expect(wsAccess({ authRequired: false, hasGlUser: false, guest: null, spectate: false })).toEqual({ ok: true, kind: "open" });
  });
});

describe("게스트 방", () => {
  const room = (guestRoom: boolean) => createRoom("GEST", 0, false, "chess", false, guestRoom, "발표자");

  it("게스트는 학번 id로 앉고, 같은 학번이 다시 들어오면 같은 자리로 돌아온다", () => {
    const state = room(true);
    let n = 0;
    const a = joinRoom(state, { name: "홍길동", userId: guestUserId({ studentId: "20211", name: "홍길동" }), guestId: "20211" }, 0, () => `id${++n}`);
    if (!a.ok) throw new Error("join");
    expect(a.player.guestId).toBe("20211");
    expect(state.hostName).toBe("발표자");
    const again = joinRoom(state, { name: "다른이름", userId: "guest:20211", guestId: "20211" }, 10, () => `id${++n}`);
    if (!again.ok) throw new Error("rejoin");
    expect(again.reconnected).toBe(true);
    expect(again.player.id).toBe(a.player.id);
    const b = joinRoom(state, { name: "김철수", userId: "guest:20212", guestId: "20212" }, 20, () => `id${++n}`);
    if (!b.ok) throw new Error("join2");
    expect(b.player.seat).toBe(1);
  });

  it("게스트 방은 판이 끝나도 전적으로 남기지 않는다 (일반 방은 남긴다)", () => {
    for (const guestRoom of [true, false]) {
      const state = room(guestRoom);
      let n = 0;
      const ids: string[] = [];
      for (const [i, name] of ["가", "나"].entries()) {
        const r = joinRoom(state, { name, userId: `guest:2021${i}`, guestId: `2021${i}` }, 0, () => `id${++n}`);
        if (!r.ok) throw new Error("join");
        r.player.bot = true;
        ids.push(r.player.id);
      }
      let s = 9;
      const rng = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
      for (const id of ids) setReady(state, id, true, 0, 1, rng);
      let now = 0, guard = 0;
      while (state.phase !== "result" && guard++ < 300) {
        for (const id of ids) runChessBot(state, id, now, 1, rng);
        now = Math.max(now + 1000, (state.phaseEndsAt ?? now) + 1);
        advancePhase(state, now, 1, rng);
      }
      expect(state.phase).toBe("result");
      expect(takeMatchRecord(state, now) === null).toBe(guestRoom);
    }
  });
});

describe("관전 목록", () => {
  const live = (code: string, updatedAt: number): LiveRoom => ({
    code, host: "발표자", players: [{ name: "가", studentId: "20211", connected: true }, { name: "나", studentId: "20212", connected: true }],
    phase: "prep", round: 1, maxRounds: 8, hps: [30, 30], updatedAt,
  });

  it("최근에 바뀐 방이 위에 오고, 같은 방은 갱신되며, 지울 수 있다", () => {
    const board = new LiveBoard();
    board.upsert(live("AAAA", 100));
    board.upsert(live("BBBB", 300));
    board.upsert({ ...live("AAAA", 200), round: 3 });
    const list = board.list(400);
    expect(list.map((r) => r.code)).toEqual(["BBBB", "AAAA"]);
    expect(list[1]!.round).toBe(3);
    expect(board.remove("BBBB")).toBe(true);
    expect(board.remove("BBBB")).toBe(false);
  });

  it("오래 갱신되지 않은 방은 목록에서 사라진다", () => {
    const board = new LiveBoard();
    board.upsert(live("OLD1", 0));
    board.upsert(live("NEW1", LIVE_TTL_MS));
    expect(board.list(LIVE_TTL_MS + 1).map((r) => r.code)).toEqual(["NEW1"]);
  });
});
