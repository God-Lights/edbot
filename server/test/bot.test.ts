import { describe, expect, it } from "vitest";
import { runBotUntilIdle } from "../src/bot";
import { availableIds, currentTurnSeat } from "../src/game";
import {
  addBotIfNeeded,
  advancePhase,
  createRoom,
  isExpired,
  joinRoom,
  playerBan,
  playerLock,
  playerPick,
  pruneLobby,
  setReady,
  takeMatchRecord,
  toSnapshot,
} from "../src/room-state";
import type { RoomState } from "../src/room-state";

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function testRoom(userId: string | undefined = "u-human") {
  let n = 0;
  const state = createRoom("ADMN", 0, true);
  const joined = joinRoom(state, { name: "에드", userId }, 0, () => `id${++n}`);
  if (!joined.ok) throw new Error("join");
  return { state, human: joined.player.id };
}

describe("테스트 대전 봇", () => {
  it("사람이 혼자 들어오면 빈 자리에 봇이 앉고, 로비에서 바로 준비한다", () => {
    const { state } = testRoom();
    expect(addBotIfNeeded(state)).toBe(true);
    expect(addBotIfNeeded(state)).toBe(false); // 두 번 앉지 않는다
    expect(state.players.map((p) => [p.seat, !!p.bot])).toEqual([[0, false], [1, true]]);
    expect(runBotUntilIdle(state, 0, 1, seeded(1))).toBe(true);
    expect(state.players.find((p) => p.bot)!.ready).toBe(true);
    expect(state.phase).toBe("lobby"); // 사람이 준비하기 전에는 시작하지 않는다
  });

  it("일반 방에는 봇이 앉지 않는다", () => {
    let n = 0;
    const state = createRoom("ABCD", 0);
    joinRoom(state, { name: "에드" }, 0, () => `id${++n}`);
    expect(addBotIfNeeded(state)).toBe(false);
    expect(runBotUntilIdle(state, 0, 1, seeded(1))).toBe(false);
  });

  it("봇은 접속이 끊기거나 방치 판정에 영향을 주지 않는다", () => {
    const { state, human } = testRoom();
    addBotIfNeeded(state);
    state.players.find((p) => p.id === human)!.connected = false;
    expect(isExpired(state, 11 * 60_000)).toBe(true); // 사람이 없으면 봇만 있어도 방치된 방
    expect(pruneLobby(state, 999_999)).toBe(false);
    expect(state.players.some((p) => p.bot)).toBe(true);
  });

  it("사람이 떠난 뒤 새로 들어오면 봇은 그대로 두고 자리를 잡는다", () => {
    const { state, human } = testRoom();
    addBotIfNeeded(state);
    state.players = state.players.filter((p) => p.id !== human); // 유예 시간이 지나 내보내짐
    let n = 100;
    const second = joinRoom(state, { name: "민수", userId: "u2" }, 5, () => `id${++n}`);
    expect(second.ok).toBe(true);
    expect(addBotIfNeeded(state)).toBe(false);
    expect(state.players).toHaveLength(2);
  });

  it("한 판을 끝까지 진행한다: 밴, 드래프트, 배치, 탐사, 대장간, 전투, 결과", () => {
    const rng = seeded(7);
    const scale = 0.05; // 한 판을 12초 안에
    const { state, human } = testRoom();
    addBotIfNeeded(state);
    runBotUntilIdle(state, 0, scale, rng);
    setReady(state, human, true, 0, scale, rng);
    expect(state.phase).toBe("ban");

    const seen = new Set<string>();
    let now = 0;
    for (let step = 0; step < 4000 && state.phase !== "lobby"; step++) {
      now += 25;
      seen.add(state.phase);
      const game = state.game;
      // 사람 쪽 행동: 밴, 뽑기, 배치 확정만 한다. (나머지는 시간이 지나면 서버가 기본값으로 채운다)
      if (game && state.phase === "ban" && !game.banLocked[0]) playerBan(state, human, "ancient-lord", now, scale, rng);
      if (game && state.phase === "draft" && currentTurnSeat(game) === 0) {
        playerPick(state, human, availableIds(game)[0]!, now, scale, rng);
      }
      if (game && state.phase === "placement" && !game.placementLocked[0]) playerLock(state, human, now, scale, rng);
      advancePhase(state, now, scale, rng);
      runBotUntilIdle(state, now, scale, rng);
    }

    expect(state.phase).toBe("lobby");
    expect([...seen]).toEqual(expect.arrayContaining(["ban", "draft", "placement", "explore", "forge", "battle"]));
    // 로비로 돌아오면 준비가 풀리지만 봇은 바로 다시 준비한다. (사람이 준비하면 다음 판이 시작된다)
    expect(state.players.find((p) => p.bot)!.ready).toBe(true);
    expect(state.players.find((p) => !p.bot)!.ready).toBe(false);
  });

  it("봇과의 판은 레이팅 없는 게임 기록으로만 남긴다", () => {
    const { state } = testRoom("u-human");
    addBotIfNeeded(state);
    state.phase = "result";
    state.game = { picks: [["dwargon"], ["ankio"]] } as never;
    state.result = { ratings: [null, null], winner: 0, reason: "time", score: [3, 1], kills: [1, 0] };
    const rec = takeMatchRecord(state, 1);
    expect(rec?.rated).toBe(false);
    expect(rec?.users.map((u) => u.userId)).toEqual(["u-human", "bot:테스트 봇"]);
    // 사람 쪽에 계정(또는 로컬 서버의 이름)이 없으면 남기지 않는다
    const anon = testRoom("");
    addBotIfNeeded(anon.state);
    anon.state.phase = "result";
    anon.state.game = { picks: [["dwargon"], ["ankio"]] } as never;
    anon.state.result = { ratings: [null, null], winner: 0, reason: "time", score: [3, 1], kills: [1, 0] };
    expect(takeMatchRecord(anon.state, 1)).toBeNull();
  });

  it("봇은 사람이 보는 스냅샷에서 다른 플레이어와 똑같이 보인다 (이름만 다름)", () => {
    const { state, human } = testRoom();
    addBotIfNeeded(state);
    const snap = toSnapshot(state, 0, human);
    expect(snap.players).toHaveLength(2);
    expect(snap.players[1]).toMatchObject({ name: "테스트 봇", connected: true });
    expect(JSON.stringify(snap)).not.toContain("bot-token");
  });
});

describe("봇의 행동 범위", () => {
  it("봇은 규칙을 어기지 않는다: 사람이 쓰는 함수로만 행동한다 (밴이 겹쳐도 오류 없이 진행)", () => {
    const rng = seeded(3);
    const { state, human } = testRoom();
    addBotIfNeeded(state);
    runBotUntilIdle(state, 0, 1, rng);
    setReady(state, human, true, 0, 1, rng);
    playerBan(state, human, "ancient-lord", 1, 1, rng);
    runBotUntilIdle(state, 1, 1, rng);
    const game = (state as RoomState).game!;
    expect(game.banLocked).toEqual([true, true]);
  });
});
