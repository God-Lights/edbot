import { describe, expect, it } from "vitest";
import { runChessBot } from "../src/bot";
import {
  addBotIfNeeded, advancePhase, createRoom, joinRoom, nextDeadline, playerChess, playerSurrender, setReady, takeMatchRecord, toSnapshot,
} from "../src/room-state";
import type { RoomState } from "../src/room-state";
import { MAX_ROUNDS } from "../src/chess/game";

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function chessRoom(testMatch = true, ids: [string?, string?] = ["u1", "u2"]) {
  let n = 0;
  const state = createRoom("ADMN", 0, testMatch, "chess");
  const a = joinRoom(state, { name: "에드", userId: ids[0] }, 0, () => `id${++n}`);
  if (!a.ok) throw new Error("join");
  let b: string | null = null;
  if (testMatch) addBotIfNeeded(state);
  else {
    const r = joinRoom(state, { name: "상대", userId: ids[1] }, 0, () => `id${++n}`);
    if (!r.ok) throw new Error("join2");
    b = r.player.id;
  }
  return { state, a: a.player.id, b };
}

function start(state: RoomState, ids: string[], rng: () => number) {
  for (const id of ids) setReady(state, id, true, 0, 1, rng);
}

describe("체스 방: 시작", () => {
  it("둘 다 준비하면 1라운드 준비 단계가 시작된다", () => {
    const { state, a, b } = chessRoom(false);
    const rng = seeded(1);
    setReady(state, a, true, 0, 1, rng);
    expect(state.phase).toBe("lobby");
    setReady(state, b!, true, 0, 1, rng);
    expect(state.phase).toBe("prep");
    expect(state.chess?.round).toBe(1);
    expect(state.phaseEndsAt).toBeGreaterThan(0);
    expect(nextDeadline(state)).toBe(state.phaseEndsAt);
  });

  it("스냅샷: 준비 중에는 상대의 상점과 판을 숨기고 내 것은 보인다", () => {
    const { state, a, b } = chessRoom(false);
    start(state, [a, b!], seeded(2));
    playerChess(state, a, { t: "buy", slot: 0 }, 1000);
    const mine = toSnapshot(state, 1000, a).chess!;
    const theirs = toSnapshot(state, 1000, b!).chess!;
    expect(mine.me?.shop.filter(Boolean).length).toBeGreaterThan(0);
    expect(JSON.stringify(theirs)).not.toContain(state.chess!.players[0].bench[0]!.uid);
    expect(mine.combat).toBeNull();
  });
});

describe("체스 방: 행동과 전투", () => {
  it("준비를 안 끝내도 시간이 되면 전투로 가고, 전투 시간이 지나면 다음 라운드로 간다", () => {
    const { state, a, b } = chessRoom(false);
    start(state, [a, b!], seeded(3));
    const end = state.phaseEndsAt!;
    advancePhase(state, end + 1, 1, seeded(3));
    expect(state.phase).toBe("combat");
    const snap = toSnapshot(state, end + 1, a).chess!;
    expect(snap.combat).not.toBeNull();
    advancePhase(state, state.phaseEndsAt! + 1, 1, seeded(3));
    expect(state.phase).toBe("prep");
    expect(state.chess!.round).toBe(2);
  });

  it("둘 다 `준비 끝`을 누르면 기다리지 않고 바로 전투", () => {
    const { state, a, b } = chessRoom(false);
    start(state, [a, b!], seeded(4));
    expect(playerChess(state, a, { t: "done" }, 5, 1, seeded(4))).toMatchObject({ ok: true, advanced: false });
    expect(state.phase).toBe("prep");
    expect(playerChess(state, b!, { t: "done" }, 6, 1, seeded(4))).toMatchObject({ ok: true, advanced: true });
    expect(state.phase).toBe("combat");
  });

  it("전투 중에는 사고팔 수 없다", () => {
    const { state, a, b } = chessRoom(false);
    start(state, [a, b!], seeded(5));
    playerChess(state, a, { t: "done" }, 5);
    playerChess(state, b!, { t: "done" }, 6);
    const r = playerChess(state, a, { t: "buy", slot: 0 }, 7);
    expect(r.ok).toBe(false);
  });

  it("잘못된 행동은 코드와 함께 거절된다", () => {
    const { state, a, b } = chessRoom(false);
    start(state, [a, b!], seeded(6));
    expect(playerChess(state, a, { t: "buy", slot: 99 }, 1)).toMatchObject({ ok: false, code: "invalid_slot" });
    expect(playerChess(state, a, { t: "sell", uid: "x" }, 1)).toMatchObject({ ok: false, code: "unit_not_found" });
  });
});

describe("체스 방: 항복", () => {
  it("준비 중 항복하면 상대가 바로 이기고 결과 화면이 된다", () => {
    const { state, a, b } = chessRoom(false);
    start(state, [a, b!], seeded(7));
    expect(playerSurrender(state, a, 10, 1, seeded(7))).toMatchObject({ ok: true });
    expect(state.phase).toBe("result");
    expect(state.result).toMatchObject({ winner: 1, reason: "surrender" });
  });

  it("전투 중 항복도 바로 된다", () => {
    const { state, a, b } = chessRoom(false);
    start(state, [a, b!], seeded(8));
    playerChess(state, a, { t: "done" }, 5);
    playerChess(state, b!, { t: "done" }, 6);
    expect(state.phase).toBe("combat");
    playerSurrender(state, b!, 7, 1, seeded(8));
    expect(state.result).toMatchObject({ winner: 0, reason: "surrender" });
  });

  it("끝난 뒤에는 항복할 수 없다", () => {
    const { state, a, b } = chessRoom(false);
    start(state, [a, b!], seeded(9));
    playerSurrender(state, a, 10);
    expect(playerSurrender(state, b!, 11)).toMatchObject({ ok: false });
  });
});

describe("체스 방: 전체 게임", () => {
  it("봇과 사람(봇처럼 행동)이 끝까지 플레이하면 결과가 나오고 로비로 돌아온다", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const { state, a } = chessRoom(true);
      const bot = state.players.find((p) => p.bot)!.id;
      const rng = seeded(seed);
      let now = 0;
      runChessBot(state, bot, now, 1, rng);
      setReady(state, a, true, now, 1, rng);
      expect(state.phase).toBe("prep");
      let guard = 0;
      while (state.phase !== "result" && guard++ < 200) {
        runChessBot(state, bot, now, 1, rng);
        runChessBot(state, a, now, 1, rng); // 사람 쪽도 같은 로직으로 대신 플레이
        now = Math.max(now + 1000, (state.phaseEndsAt ?? now) + 1);
        advancePhase(state, now, 1, rng);
      }
      expect(state.phase).toBe("result");
      expect(state.result).not.toBeNull();
      expect(state.chess!.round).toBeLessThanOrEqual(MAX_ROUNDS);
      // 봇이 낀 판은 전적에 남기지 않는다
      expect(takeMatchRecord(state, now)).toBeNull();
    }
  });

  it("사람 둘이 GL 계정으로 끝까지 하면 전적(선택한 캐릭터 포함)이 만들어진다", () => {
    const { state, a, b } = chessRoom(false);
    const rng = seeded(11);
    start(state, [a, b!], rng);
    let now = 0;
    let guard = 0;
    while (state.phase !== "result" && guard++ < 200) {
      runChessBot(state, a, now, 1, rng);
      runChessBot(state, b!, now, 1, rng);
      now = Math.max(now + 1000, (state.phaseEndsAt ?? now) + 1);
      advancePhase(state, now, 1, rng);
    }
    expect(state.phase).toBe("result");
    const rec = takeMatchRecord(state, now);
    expect(rec).not.toBeNull();
    expect(rec!.users.map((u) => u.userId)).toEqual(["u1", "u2"]);
    expect(rec!.picks).toHaveLength(2);
    expect(takeMatchRecord(state, now)).toBeNull(); // 한 번만
  });
});
