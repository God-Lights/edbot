import { describe, expect, it } from "vitest";
import { MemoryRankingStore } from "../src/ranking/memory-store";
import { d1RankingStore } from "../src/ranking/store";
import type { MatchInput, RankingStore } from "../src/ranking/store";
import { createRoom, joinRoom, takeMatchRecord } from "../src/room-state";
import { createTestD1 } from "./helpers/d1";

// 전적 저장소는 구현이 여럿이다(D1, 메모리, 로컬 서버의 JSON 파일). 모두 같은 시험을 통과해야 한다.
const stores: Array<[string, () => RankingStore]> = [
  ["D1", () => d1RankingStore(createTestD1())],
  ["메모리", () => new MemoryRankingStore()],
];

const match = (over: Partial<MatchInput> = {}): MatchInput => ({
  roomCode: "ABCD",
  startedAt: 1_000,
  endedAt: 241_000,
  users: [
    { userId: "u-ed", nickname: "에드" },
    { userId: "u-min", nickname: "민수" },
  ],
  winnerSeat: 0,
  reason: "hp",
  score: [17, 3],
  kills: [4, 2],
  picks: [["dwargon", "lappus"], ["ankio", "nut-wolf"]],
  ...over,
});

describe.each(stores)("전적 저장소: %s", (_name, make) => {
  it("처음 하는 두 사람은 1000에서 시작해 이긴 쪽이 오르고 진 쪽이 내린다", async () => {
    const s = make();
    expect(await s.recordMatch(match())).toEqual([{ before: 1000, after: 1020 }, { before: 1000, after: 980 }]);
    expect(await s.getPlayerStats("u-ed")).toMatchObject({ rating: 1020, games: 1, wins: 1, losses: 0, rank: 1 });
    expect(await s.getPlayerStats("u-min")).toMatchObject({ rating: 980, games: 1, wins: 0, losses: 1, rank: 2 });
    expect(await s.getPlayerStats("u-none")).toBeNull();
  });

  it("같은 판은 두 번 저장하지 않는다", async () => {
    const s = make();
    await s.recordMatch(match());
    expect(await s.recordMatch(match())).toBeNull();
    expect((await s.getPlayerStats("u-ed"))!.games).toBe(1);
    expect(await s.recordMatch(match({ startedAt: 2_000 }))).not.toBeNull();
    expect((await s.getPlayerStats("u-ed"))!.games).toBe(2);
  });

  it("무승부, 닉네임 갱신", async () => {
    const s = make();
    await s.recordMatch(match({ winnerSeat: null }));
    expect(await s.getPlayerStats("u-ed")).toMatchObject({ rating: 1000, draws: 1, wins: 0, losses: 0 });
    expect((await s.getRecentMatches("u-ed", 5))[0]!.result).toBe("draw");
    await s.recordMatch(match({ startedAt: 5_000, users: [{ userId: "u-ed", nickname: "에드2" }, { userId: "u-min", nickname: "민수" }] }));
    expect((await s.getPlayerStats("u-ed"))!.nickname).toBe("에드2");
  });

  it("순위: 레이팅 -> 판수 -> 먼저 도달한 쪽, 개수 제한, 내 줄 표시", async () => {
    const s = make();
    await s.recordMatch(match({ startedAt: 1, endedAt: 10, users: [{ userId: "a", nickname: "A" }, { userId: "b", nickname: "B" }], winnerSeat: 0 }));
    await s.recordMatch(match({ startedAt: 2, endedAt: 20, users: [{ userId: "c", nickname: "C" }, { userId: "d", nickname: "D" }], winnerSeat: 0 }));
    // a와 c는 같은 레이팅(1020), b와 d는 같은 레이팅(980). 판수도 같으니 먼저 도달한 쪽(a, b)이 위
    const board = await s.getLeaderboard(10, "c");
    expect(board.map((e) => e.nickname)).toEqual(["A", "C", "B", "D"]);
    expect(board.map((e) => e.rank)).toEqual([1, 2, 3, 4]);
    expect(board.find((e) => e.isMe)!.nickname).toBe("C");
    expect((await s.getLeaderboard(2, null)).length).toBe(2);
    expect((await s.getLeaderboard(2, null)).every((e) => !e.isMe)).toBe(true);
    expect((await s.getPlayerStats("c"))!.rank).toBe(2);
  });

  it("최근 판: 최신순, 내 쪽 기준, 상대 이름과 뽑은 캐릭터", async () => {
    const s = make();
    await s.recordMatch(match({ startedAt: 1, endedAt: 100 }));
    await s.recordMatch(match({ startedAt: 2, endedAt: 300, winnerSeat: 1, score: [2, 9], kills: [1, 5] }));
    const mine = await s.getRecentMatches("u-ed", 10);
    expect(mine.map((m) => m.endedAt)).toEqual([300, 100]);
    expect(mine[0]).toMatchObject({ result: "loss", opponent: "민수", score: [2, 9], kills: [1, 5], picks: ["dwargon", "lappus"], opponentPicks: ["ankio", "nut-wolf"] });
    const theirs = await s.getRecentMatches("u-min", 10);
    expect(theirs[0]).toMatchObject({ result: "win", opponent: "에드", score: [9, 2], picks: ["ankio", "nut-wolf"] });
    expect((await s.getRecentMatches("u-ed", 1)).length).toBe(1);
    expect(await s.getRecentMatches("u-none", 5)).toEqual([]);
  });

  it("다시 보기: 한 번만 저장하고 그대로 돌려준다", async () => {
    const s = make();
    expect(await s.getReplay("ABCD:1000")).toBeNull();
    await s.saveReplay("ABCD:1000", '{"version":1}', 5);
    await s.saveReplay("ABCD:1000", '{"version":2}', 6);
    expect(await s.getReplay("ABCD:1000")).toBe('{"version":1}');
  });
});

describe("메모리 저장소: 내보내기와 합치기", () => {
  it("내보낸 것을 빈 저장소에 합치면 같은 결과가 나온다", async () => {
    const a = new MemoryRankingStore();
    await a.recordMatch(match());
    await a.recordMatch(match({ startedAt: 2_000, endedAt: 300_000, winnerSeat: 1 }));
    await a.saveReplay("ABCD:1000", "{}", 1);
    const data = a.exportData();
    expect(data.schemaVersion).toBe(1);
    expect(data.matches[0]!.id).toBe("ABCD:1000");
    const b = new MemoryRankingStore();
    expect(b.mergeData(JSON.parse(JSON.stringify(data)))).toEqual({ players: 2, matches: 2, replays: 1 });
    expect(await b.getLeaderboard(10, null)).toEqual(await a.getLeaderboard(10, null));
    expect(await b.getRecentMatches("u-ed", 10)).toEqual(await a.getRecentMatches("u-ed", 10));
  });

  it("이미 있는 것은 덮어쓰지 않고 없는 것만 넣는다", async () => {
    const a = new MemoryRankingStore();
    await a.recordMatch(match());
    const b = new MemoryRankingStore();
    await b.recordMatch(match({ startedAt: 9_000, endedAt: 9_500 })); // 다른 판, 같은 사람들
    const added = b.mergeData(a.exportData());
    expect(added).toEqual({ players: 0, matches: 1, replays: 0 }); // 선수는 이미 있어서 그대로
    expect((await b.getRecentMatches("u-ed", 10)).length).toBe(2);
    expect(b.mergeData(a.exportData())).toEqual({ players: 0, matches: 0, replays: 0 }); // 두 번 합쳐도 그대로
  });
});

describe("이름으로 남기는 전적 (로컬 서버)", () => {
  function finishedRoom(names: [string, string], opts: { testMatch?: boolean } = {}) {
    const state = createRoom("ABCD", 0, opts.testMatch ?? false, "chess");
    joinRoom(state, { name: names[0] }, 0, () => "p1");
    joinRoom(state, { name: names[1] }, 0, () => "p2");
    state.phase = "result";
    state.matchStartedAt = 1;
    state.result = { winner: 0, reason: "hp", score: [20, 0], kills: [3, 1], ratings: null } as never;
    state.chess = { players: [{ board: [], bench: [] }, { board: [], bench: [] }] } as never;
    return state;
  }

  it("GL 계정이 없으면 기본은 기록하지 않는다 (운영)", () => {
    expect(takeMatchRecord(finishedRoom(["에드", "민수"]), 5)).toBeNull();
  });

  it("anonymous면 이름으로 기록한다 (대소문자·앞뒤 공백은 같은 사람)", () => {
    const m = takeMatchRecord(finishedRoom(["에드", " Min "]), 5, true);
    expect(m!.users.map((u) => u.userId)).toEqual(["name:에드", "name:min"]);
    expect(m!.users.map((u) => u.nickname)).toEqual(["에드", "Min"]); // 입장할 때 앞뒤 공백은 이미 정리된다
  });

  it("이름이 같은 두 사람, 테스트 방(봇)은 기록하지 않는다", () => {
    expect(takeMatchRecord(finishedRoom(["같음", "같음"]), 5, true)).toBeNull();
    expect(takeMatchRecord(finishedRoom(["에드", "민수"], { testMatch: true }), 5, true)).toBeNull();
  });
});
