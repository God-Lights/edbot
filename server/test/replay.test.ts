import { describe, expect, it } from "vitest";
import { runChessBot } from "../src/bot";
import { getRecentMatches, getReplay, matchIdOf, recordMatch, saveReplay } from "../src/ranking/store";
import { advancePhase, buildReplay, createRoom, joinRoom, setReady, takeMatchRecord, toSnapshot } from "../src/room-state";
import { createTestD1 } from "./helpers/d1";

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function playFullGame(seed: number) {
  let n = 0;
  const state = createRoom("RPLY", 0, false, "chess", false);
  const rng = seeded(seed);
  const ids: string[] = [];
  for (const [name, userId] of [["에드", "u-ed"], ["민수", "u-min"]] as const) {
    const r = joinRoom(state, { name, userId }, 0, () => `id${++n}`);
    if (!r.ok) throw new Error("join");
    ids.push(r.player.id);
  }
  for (const id of ids) setReady(state, id, true, 0, 1, rng);
  let now = 0, guard = 0;
  while (state.phase !== "result" && guard++ < 300) {
    for (const id of ids) runChessBot(state, id, now, 1, rng);
    now = Math.max(now + 1000, (state.phaseEndsAt ?? now) + 1);
    advancePhase(state, now, 1, rng);
  }
  return { state, now };
}

describe("다시 보기", () => {
  it("라운드마다 전투 기록이 쌓이고, 다시 보기 데이터에 이름과 결과가 담긴다", () => {
    const { state } = playFullGame(3);
    const chess = state.chess!;
    expect(chess.history.length).toBe(chess.round);
    expect(chess.history.map((h) => h.round)).toEqual(chess.history.map((_, i) => i + 1));
    const first = chess.history[0]!;
    expect(first.frames.length).toBe(first.beats + 1);
    expect(first.boards).toHaveLength(2);
    const replay = JSON.parse(buildReplay(state)!);
    expect(replay.version).toBe(1);
    expect(replay.players.map((p: { name: string }) => p.name)).toEqual(["에드", "민수"]);
    expect(replay.rounds).toHaveLength(chess.round);
    expect(replay.result.reason).toBeDefined();
  });

  it("결과가 나오기 전에는 다시 보기 데이터가 없다", () => {
    const state = createRoom("RPLY", 0, false, "chess", false);
    expect(buildReplay(state)).toBeNull();
  });

  it("D1에 저장하고 불러온다. 같은 판은 한 번만 저장되고, 전적 목록에 판 id가 있다", async () => {
    const db = createTestD1();
    const { state, now } = playFullGame(4);
    const match = takeMatchRecord(state, now)!;
    expect(await recordMatch(db, match)).not.toBeNull();
    const id = matchIdOf(match.roomCode, match.startedAt);
    const data = buildReplay(state)!;
    await saveReplay(db, id, data, 1);
    await saveReplay(db, id, "덮어쓰면 안 된다", 2);
    expect(await getReplay(db, id)).toBe(data);
    expect(await getReplay(db, "없는-판")).toBeNull();
    const [recent] = await getRecentMatches(db, "u-ed", 5);
    expect(recent!.id).toBe(id);
  });

  it("관전자도 볼 수 있는 공개 정보: 체력(hps)은 있고 상점·판은 없다", () => {
    const { state } = playFullGame(5);
    const spectator = toSnapshot(state, 0, undefined).chess!;
    expect(spectator.hps).toHaveLength(2);
    expect(spectator.me).toBeNull();
    expect(spectator.opponent).toBeNull();
  });
});
