import { describe, expect, it } from "vitest";
import { parseClientMessage } from "../src/protocol";
import {
  advancePhase,
  createRoom,
  joinRoom,
  nextDeadline,
  playerBan,
  playerExplore,
  playerLock,
  playerPick,
  setReady,
  toSnapshot,
} from "../src/room-state";

const zero = () => 0;

function toPlacementEnd() {
  let n = 0;
  const newId = () => `id${++n}`;
  const state = createRoom("ABCD", 0);
  const a = joinRoom(state, { name: "에드" }, 0, newId);
  const b = joinRoom(state, { name: "민수" }, 0, newId);
  if (!a.ok || !b.ok) throw new Error("join");
  const A = a.player.id;
  const B = b.player.id;
  setReady(state, A, true, 0, 1, zero);
  setReady(state, B, true, 0, 1, zero);
  playerBan(state, A, "ancient-lord", 0, 1, zero);
  playerBan(state, B, "xenosaurs", 0, 1, zero);
  const order = [A, B, B, A, A, B, B, A, A, B];
  const ids = ["richmond", "rosmaktia", "toka-loga", "dwargon", "raufaino", "for-the-more", "lappus", "bwtkan-jaws", "ankio", "nut-wolf"];
  ids.forEach((id, i) => playerPick(state, order[i]!, id, 0, 1, zero));
  return { state, A, B };
}

function exploreRoom() {
  const r = toPlacementEnd();
  playerLock(r.state, r.A, 0, 1, zero);
  playerLock(r.state, r.B, 0, 1, zero);
  expect(r.state.phase).toBe("explore");
  return { ...r, start: r.state.phaseStartedAt };
}

describe("탐사 단계", () => {
  it("배치 단계에서는 탐사할 수 없다", () => {
    const { state, A } = toPlacementEnd();
    expect(state.phase).toBe("placement");
    expect(playerExplore(state, A, "scout", 0, 100, 1, zero)).toMatchObject({ ok: false, code: "wrong_phase" });
  });

  it("탐사 단계가 시작되면 지도가 생기고 내 정보만 담긴 스냅샷이 간다", () => {
    const { state, A, B, start } = exploreRoom();
    const forA = toSnapshot(state, start, A).explore!;
    expect(forA.tiles).toHaveLength(16);
    expect(forA.gauge).toBe(3);
    expect(forA.resources!.talent).toBe(15);
    expect(forA.tiles.filter((t) => !t.known)).toHaveLength(6);
    expect(toSnapshot(state, start, B).explore!.tiles.map((t) => t.kind)).toEqual(forA.tiles.map((t) => t.kind));
  });

  it("행동을 보내면 처리되고 게이지가 줄며, 실패하면 오류 코드를 준다", () => {
    const { state, A, start } = exploreRoom();
    const tile = toSnapshot(state, start, A).explore!.tiles.find((t) => t.known && t.kind === "tree")!;
    expect(playerExplore(state, A, "gather", tile.index, start + 100, 1, zero)).toEqual({ ok: true, advanced: false });
    const after = toSnapshot(state, start + 100, A).explore!;
    expect(after.gauge).toBe(2);
    expect(after.tiles[tile.index]!.myGatherInTicks).toBeGreaterThan(0);
    expect(playerExplore(state, A, "gather", tile.index, start + 200, 1, zero)).toMatchObject({ ok: false, code: "tile_busy" });
    expect(playerExplore(state, A, "gather", 99, start + 200, 1, zero)).toMatchObject({ ok: false, code: "invalid_tile" });
  });

  it("시간이 지나면 채집이 끝나 자원이 늘어난다", () => {
    const { state, A, start } = exploreRoom();
    const tile = toSnapshot(state, start, A).explore!.tiles.find((t) => t.known && t.kind === "tree")!;
    playerExplore(state, A, "gather", tile.index, start, 1, zero);
    advancePhase(state, start + 3_500, 1, zero);
    expect(toSnapshot(state, start + 3_500, A).explore!.resources!.branch).toBe(5);
  });

  it("대장간과 전투 중에도 탐사가 계속 흐르고 행동할 수 있다", () => {
    const { state, A, start } = exploreRoom();
    advancePhase(state, start + 20_000, 1, zero);
    expect(state.phase).toBe("forge");
    expect(playerExplore(state, A, "scout", state.explore!.fog.indexOf(true), start + 21_000, 1, zero)).toEqual({ ok: true, advanced: false });
    advancePhase(state, start + 40_000, 1, zero);
    expect(state.phase).toBe("battle");
    const talentBefore = state.explore!.resources[0].talent;
    advancePhase(state, start + 60_000, 1, zero);
    expect(state.explore!.resources[0].talent).toBeGreaterThan(talentBefore); // 10초마다 지급
    expect(state.explore!.tick).toBe(Math.round(60_000 / 100));
    expect(playerExplore(state, A, "ambush", 0, start + 60_000, 1, zero)).toEqual({ ok: true, advanced: false });
  });

  it("탐사 중에는 상태 전송용 알람이 잡힌다", () => {
    const { state, start } = exploreRoom();
    const next = nextDeadline(state)!;
    expect(next).toBeGreaterThan(start);
    expect(next).toBeLessThan(state.phaseEndsAt!);
  });

  it("처치하면 탈런트 +2를 받는다", () => {
    const { state, A, start } = exploreRoom();
    advancePhase(state, start + 40_000, 1, zero); // 전투 시작
    expect(state.phase).toBe("battle");
    const before = state.explore!.resources[0].talent;
    state.battle!.events.push({ seq: 9999, tick: 1, type: "kill", seat: 0 });
    advancePhase(state, start + 40_200, 1, zero);
    // 처치 이벤트는 다음 틱에서 반영된다.
    expect(state.explore!.resources[0].talent).toBeGreaterThanOrEqual(before + 2);
    expect(A).toBeTruthy();
  });

  it("방이 로비로 돌아가면 탐사 상태가 지워진다", () => {
    const { state, start } = exploreRoom();
    advancePhase(state, start + 400_000, 1, zero);
    expect(state.phase).toBe("lobby");
    expect(state.explore).toBeNull();
  });

  it("JSON으로 저장했다가 되살려도 계속 진행된다", () => {
    const { state, start } = exploreRoom();
    const restored = JSON.parse(JSON.stringify(state)) as typeof state;
    advancePhase(state, start + 10_000, 1, zero);
    advancePhase(restored, start + 10_000, 1, zero);
    expect(restored.explore!.resources).toEqual(state.explore!.resources);
  });
});

describe("explore 메시지 파싱", () => {
  it("올바른 메시지만 받는다", () => {
    expect(parseClientMessage('{"t":"explore","action":"gather","tile":5}')).toEqual({ t: "explore", action: "gather", tile: 5 });
    expect(parseClientMessage('{"t":"explore","action":"scout","tile":0}')).toEqual({ t: "explore", action: "scout", tile: 0 });
    for (const bad of [
      '{"t":"explore","action":"dig","tile":5}',
      '{"t":"explore","action":"gather","tile":16}',
      '{"t":"explore","action":"gather","tile":-1}',
      '{"t":"explore","action":"gather","tile":1.5}',
      '{"t":"explore","action":"gather"}',
    ]) {
      expect(parseClientMessage(bad), bad).toBeNull();
    }
  });
});
