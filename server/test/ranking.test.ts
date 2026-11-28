import { describe, expect, it } from "vitest";
import { K_PROVISIONAL, K_STANDARD, START_RATING, expectedScore, kFactor, nextRating } from "../src/ranking/elo";
import { d1RankingStore, getLeaderboard, getPlayerStats, getRecentMatches, recordMatch } from "../src/ranking/store";
import { MemoryRankingStore } from "../src/ranking/memory-store";
import type { MatchInput } from "../src/ranking/store";
import { createRoom, joinRoom, takeMatchRecord } from "../src/room-state";
import { createTestD1 } from "./helpers/d1";

describe("Elo", () => {
  it("같은 레이팅이면 기대 승률 50%", () => {
    expect(expectedScore(1000, 1000)).toBe(0.5);
    expect(expectedScore(1400, 1000)).toBeGreaterThan(0.9);
  });
  it("처음 10판은 K가 크다", () => {
    expect(kFactor(0)).toBe(K_PROVISIONAL);
    expect(kFactor(9)).toBe(K_PROVISIONAL);
    expect(kFactor(10)).toBe(K_STANDARD);
  });
  it("동률끼리 이기면 K/2만큼 오르고 지면 그만큼 내린다", () => {
    expect(nextRating(1000, 1000, 1, 0)).toBe(1020);
    expect(nextRating(1000, 1000, 0, 0)).toBe(980);
    expect(nextRating(1000, 1000, 0.5, 0)).toBe(1000);
  });
  it("약한 쪽이 강한 쪽을 이기면 더 많이 오른다", () => {
    const upset = nextRating(1000, 1400, 1, 20) - 1000;
    const expected = nextRating(1000, 1000, 1, 20) - 1000;
    expect(upset).toBeGreaterThan(expected);
  });
});

const match = (over: Partial<MatchInput> = {}): MatchInput => ({
  roomCode: "ABCD",
  startedAt: 1_000,
  endedAt: 241_000,
  users: [
    { userId: "u-ed", nickname: "에드" },
    { userId: "u-min", nickname: "민수" },
  ],
  winnerSeat: 0,
  reason: "towers",
  score: [17, 3],
  kills: [4, 2],
  picks: [["dwargon", "lappus"], ["ankio", "nut-wolf"]],
  ...over,
});

describe("전적 저장", () => {
  it("처음 하는 두 사람은 1000에서 시작해 이긴 쪽이 오르고 진 쪽이 내린다", async () => {
    const db = createTestD1();
    const ratings = await recordMatch(db, match());
    expect(ratings).toEqual([
      { before: START_RATING, after: 1020 },
      { before: START_RATING, after: 980 },
    ]);
    expect(await getPlayerStats(db, "u-ed")).toMatchObject({ rating: 1020, games: 1, wins: 1, losses: 0, rank: 1 });
    expect(await getPlayerStats(db, "u-min")).toMatchObject({ rating: 980, games: 1, wins: 0, losses: 1, rank: 2 });
  });

  it("같은 판(방 코드와 시작 시각)은 두 번 저장하지 않는다", async () => {
    const db = createTestD1();
    await recordMatch(db, match());
    expect(await recordMatch(db, match())).toBeNull();
    expect((await getPlayerStats(db, "u-ed"))!.games).toBe(1);
    expect(await recordMatch(db, match({ startedAt: 2_000 }))).not.toBeNull();
    expect((await getPlayerStats(db, "u-ed"))!.games).toBe(2);
  });

  it("무승부는 둘 다 draws가 늘고 같은 레이팅이면 변하지 않는다", async () => {
    const db = createTestD1();
    await recordMatch(db, match({ winnerSeat: null }));
    expect(await getPlayerStats(db, "u-ed")).toMatchObject({ rating: 1000, draws: 1, wins: 0, losses: 0 });
    expect((await getRecentMatches(db, "u-ed", 5))[0]!.result).toBe("draw");
  });

  it("닉네임이 바뀌면 최근 닉네임으로 갱신된다", async () => {
    const db = createTestD1();
    await recordMatch(db, match());
    await recordMatch(db, match({ startedAt: 5_000, users: [{ userId: "u-ed", nickname: "에드2" }, { userId: "u-min", nickname: "민수" }] }));
    expect((await getPlayerStats(db, "u-ed"))!.nickname).toBe("에드2");
  });

  it("저장 도중 오류가 나면 일부만 저장되지 않는다 (배치는 한 덩어리)", async () => {
    const db = createTestD1();
    await expect(recordMatch(db, match({ users: [{ userId: "u-ed", nickname: "a" }, { userId: null as unknown as string, nickname: "b" }] }))).rejects.toThrow();
    expect(await getPlayerStats(db, "u-ed")).toBeNull();
  });
});

describe("랭킹과 내 전적", () => {
  async function seeded() {
    const db = createTestD1();
    await recordMatch(db, match({ startedAt: 1, users: [{ userId: "a", nickname: "A" }, { userId: "b", nickname: "B" }], winnerSeat: 0 }));
    await recordMatch(db, match({ startedAt: 2, users: [{ userId: "a", nickname: "A" }, { userId: "c", nickname: "C" }], winnerSeat: 0 }));
    await recordMatch(db, match({ startedAt: 3, users: [{ userId: "b", nickname: "B" }, { userId: "c", nickname: "C" }], winnerSeat: 1 }));
    return db;
  }

  it("레이팅 순으로 정렬하고 내 줄에 isMe가 붙는다", async () => {
    const db = await seeded();
    const board = await getLeaderboard(db, 10, "c");
    expect(board.map((e) => e.nickname)).toEqual(["A", "C", "B"].sort((x, y) => board.findIndex((e) => e.nickname === x) - board.findIndex((e) => e.nickname === y)));
    expect(board[0]!.rank).toBe(1);
    expect(board.map((e) => e.rating)).toEqual([...board.map((e) => e.rating)].sort((x, y) => y - x));
    expect(board.filter((e) => e.isMe).map((e) => e.nickname)).toEqual(["C"]);
    expect(board[0]).not.toHaveProperty("user_id");
    expect(JSON.stringify(board)).not.toContain('"userId"');
  });

  it("limit을 지킨다", async () => {
    const db = await seeded();
    expect(await getLeaderboard(db, 2, null)).toHaveLength(2);
    expect(await getLeaderboard(db, 0, null)).toHaveLength(1); // 최소 1
  });

  it("내 순위는 나보다 위인 사람 수 + 1", async () => {
    const db = await seeded();
    const ranks = await Promise.all(["a", "b", "c"].map(async (id) => (await getPlayerStats(db, id))!.rank));
    expect([...ranks].sort()).toEqual([1, 2, 3]);
    expect(await getPlayerStats(db, "nobody")).toBeNull();
  });

  it("최근 전적은 내 쪽 기준으로 돌려준다", async () => {
    const db = await seeded();
    const matches = await getRecentMatches(db, "b", 10);
    expect(matches).toHaveLength(2);
    const first = matches[0]!; // 가장 최근 = startedAt 3 (b가 seat 0, 졌다)
    expect(first.result).toBe("loss");
    expect(first.opponent).toBe("C");
    expect(first.score).toEqual([17, 3]);
    expect(first.ratingAfter).toBeLessThan(first.ratingBefore);
    const older = matches[1]!;
    expect(older.result).toBe("loss"); // b는 seat 1로 첫 판에서 졌다
    expect(older.score).toEqual([3, 17]);
    expect(older.picks).toEqual(["ankio", "nut-wolf"]);
    expect(older.opponentPicks).toEqual(["dwargon", "lappus"]);
  });
});

describe("방에서 전적 만들기", () => {
  function finishedRoom(userIds: [string | undefined, string | undefined]) {
    let n = 0;
    const state = createRoom("ABCD", 0);
    joinRoom(state, { name: "에드", userId: userIds[0] }, 0, () => `id${++n}`);
    joinRoom(state, { name: "민수", userId: userIds[1] }, 0, () => `id${++n}`);
    state.phase = "result";
    state.game = { picks: [["dwargon"], ["ankio"]] } as never;
    state.result = { ratings: [null, null], winner: 1, reason: "time", score: [3, 8], kills: [1, 2] };
    state.matchStartedAt = 77;
    return state;
  }

  it("둘 다 로그인한 판은 한 번만 기록할 내용을 만든다", () => {
    const state = finishedRoom(["u1", "u2"]);
    const record = takeMatchRecord(state, 999)!;
    expect(record).toMatchObject({ roomCode: "ABCD", startedAt: 77, endedAt: 999, winnerSeat: 1, reason: "time" });
    expect(record.users.map((u) => u.userId)).toEqual(["u1", "u2"]);
    expect(takeMatchRecord(state, 1000)).toBeNull();
  });

  it("로그인하지 않은 판이나 같은 계정끼리의 판은 기록하지 않는다", () => {
    expect(takeMatchRecord(finishedRoom(["u1", undefined]), 1)).toBeNull();
    expect(takeMatchRecord(finishedRoom([undefined, undefined]), 1)).toBeNull();
    expect(takeMatchRecord(finishedRoom(["u1", "u1"]), 1)).toBeNull();
  });

  it("결과 단계가 아니면 만들지 않는다", () => {
    const state = finishedRoom(["u1", "u2"]);
    state.phase = "battle";
    expect(takeMatchRecord(state, 1)).toBeNull();
  });
});

describe("봇과 한 판: 레이팅 없는 게임 기록", () => {
  const botGame = (startedAt: number) => ({
    roomCode: "ADMN", startedAt, endedAt: startedAt + 100,
    users: [{ userId: "u-ed", nickname: "에드" }, { userId: "bot:테스트 봇", nickname: "테스트 봇" }] as [{ userId: string; nickname: string }, { userId: string; nickname: string }],
    winnerSeat: 0 as const, reason: "wins", score: [5, 2] as [number, number], kills: [5, 2] as [number, number],
    picks: [["relic"], ["dwargon"]] as [string[], string[]], rated: false,
  });

  for (const [name, make] of [["D1", () => d1RankingStore(createTestD1())], ["메모리", () => new MemoryRankingStore()]] as const) {
    it(`${name}: 레이팅·승패 수·순위는 그대로, 내 최근 판에는 나온다`, async () => {
      const store = make();
      const changes = await store.recordMatch(botGame(1));
      expect(changes).toEqual([{ before: 1000, after: 1000 }, { before: 1000, after: 1000 }]);
      expect(await store.getPlayerStats("u-ed")).toBeNull();
      expect(await store.getLeaderboard(10, null)).toEqual([]);
      const recent = await store.getRecentMatches("u-ed", 10);
      expect(recent).toHaveLength(1);
      expect(recent[0]).toMatchObject({ opponent: "테스트 봇", result: "win", rated: false, score: [5, 2], ratingBefore: 1000, ratingAfter: 1000 });
      expect(await store.recordMatch(botGame(1))).toBeNull(); // 같은 판은 한 번만
    });
  }
});
