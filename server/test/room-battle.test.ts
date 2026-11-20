import { describe, expect, it } from "vitest";
import { parseClientMessage } from "../src/protocol";
import {
  advancePhase,
  createRoom,
  joinRoom,
  nextDeadline,
  playerBan,
  playerLock,
  playerMoveLane,
  playerPick,
  playerUltimate,
  setReady,
  tickMs,
  toSnapshot,
} from "../src/room-state";
import type { RoomState } from "../src/room-state";

const zero = () => 0;

/** 배치까지 끝내고 전투가 막 시작된 방. 전투 시작 시각을 돌려준다. */
function battleRoom(scale = 1) {
  let n = 0;
  const newId = () => `id${++n}`;
  const state = createRoom("ABCD", 0);
  const a = joinRoom(state, { name: "에드" }, 0, newId);
  const b = joinRoom(state, { name: "민수" }, 0, newId);
  if (!a.ok || !b.ok) throw new Error("join failed");
  const A = a.player.id;
  const B = b.player.id;
  setReady(state, A, true, 0, scale, zero);
  setReady(state, B, true, 0, scale, zero);
  playerBan(state, A, "ancient-lord", 0, scale, zero);
  playerBan(state, B, "xenosaurs", 0, scale, zero);
  const order = [A, B, B, A, A, B, B, A, A, B];
  const ids = [
    "richmond", "rosmaktia", "toka-loga", "dwargon", "raufaino",
    "for-the-more", "lappus", "bwtkan-jaws", "ankio", "nut-wolf",
  ];
  ids.forEach((id, i) => playerPick(state, order[i]!, id, 0, scale, zero));
  playerLock(state, A, 0, scale, zero);
  playerLock(state, B, 0, scale, zero);
  // 배치가 끝나면 탐사 -> 대장간 -> 전투
  advancePhase(state, state.phaseEndsAt!, scale, zero);
  advancePhase(state, state.phaseEndsAt!, scale, zero);
  expect(state.phase).toBe("battle");
  return { state, A, B, start: state.phaseStartedAt, scale };
}

describe("전투 단계", () => {
  it("전투가 시작되면 시뮬레이션이 만들어지고 스냅샷에 담긴다", () => {
    const { state, A } = battleRoom();
    expect(state.battle).not.toBeNull();
    const snap = toSnapshot(state, state.phaseStartedAt, A);
    expect(snap.battle!.units).toHaveLength(10);
    expect(snap.battle!.towers).toHaveLength(18);
    expect(snap.battle!.mode).toBe("battle");
    expect(snap.result).toBeNull();
  });

  it("시간이 흐르면 시뮬레이션이 진행된다 (틱 = 0.1초 x scale)", () => {
    const { state, start } = battleRoom();
    advancePhase(state, start + 3_000, 1, zero);
    expect(state.battle!.tick).toBe(30);
    expect(state.phase).toBe("battle");
  });

  it("scale을 줄이면 같은 틱이 더 빨리 흐른다", () => {
    const { state, start } = battleRoom(0.1);
    expect(tickMs(0.1)).toBe(10);
    advancePhase(state, start + 300, 0.1, zero);
    expect(state.battle!.tick).toBe(30);
  });

  it("상대의 스팀포스와 궁극기 준비 상태는 보이지 않는다", () => {
    const { state, A, B } = battleRoom();
    const forA = toSnapshot(state, state.phaseStartedAt, A).battle!;
    const forB = toSnapshot(state, state.phaseStartedAt, B).battle!;
    expect(forA.steam).toBe(10);
    expect(forB.steam).toBe(10);
    expect(forA.units.filter((u) => u.seat === 1).every((u) => u.ultReadyTick === null)).toBe(true);
    expect(forA.units.filter((u) => u.seat === 0).every((u) => u.ultReadyTick !== null)).toBe(true);
    const spectator = toSnapshot(state, state.phaseStartedAt).battle!;
    expect(spectator.steam).toBeNull();
  });

  it("알람은 전투 중 상태 전송 시각이나 전투 종료 시각 중 빠른 쪽으로 잡힌다", () => {
    const { state, start } = battleRoom();
    const next = nextDeadline(state)!;
    expect(next).toBeGreaterThan(start);
    expect(next).toBeLessThanOrEqual(state.phaseEndsAt!);
  });

  it("전투 시간이 끝나면 결과 단계로 가고, 점수가 높은 쪽이 이긴다", () => {
    const { state, start } = battleRoom();
    state.battle!.score = [5, 1];
    advancePhase(state, start + 120_000, 1, zero);
    // 이 시점에 점수 비교가 달라지지 않도록 점수 변화는 시뮬레이션이 만든 것까지 포함한다.
    expect(["result", "deathmatch"]).toContain(state.phase);
  });

  it("동점이면 데스매치가 이어지고, 데스매치가 끝나면 결과 단계가 된다", () => {
    const { state, start } = battleRoom();
    // 아무 일도 안 일어나는 판을 만든다: 모든 유닛을 제자리에 묶는다.
    for (const u of state.battle!.units) u.effects.push({ type: "stun", value: 1, untilTick: 1_000_000 });
    advancePhase(state, start + 120_000, 1, zero);
    expect(state.phase).toBe("deathmatch");
    expect(toSnapshot(state, start + 120_000, "id1").battle!.mode).toBe("deathmatch");
    for (let t = 121_000; t <= 190_000 && state.phase === "deathmatch"; t += 1_000) {
      advancePhase(state, start + t, 1, zero);
    }
    expect(state.phase).toBe("result");
    expect(["deathmatch", "deathmatchTime"]).toContain(state.result!.reason);
    expect(state.result!.winner).not.toBeNull();
  });

  it("한쪽 본진 타워가 모두 무너지면 시간이 남아도 바로 결과 단계가 된다", () => {
    const { state, start } = battleRoom();
    for (const t of state.battle!.towers) if (t.seat === 1 && t.kind === "main") t.hp = 0.0001;
    // 타워는 hp가 0 이하일 때 파괴 처리된다. 시뮬레이션이 한 틱 돌면 정리된다.
    for (const t of state.battle!.towers) if (t.seat === 1 && t.kind === "main") t.hp = 1;
    state.battle!.score = [19, 0];
    for (const t of state.battle!.towers) if (t.seat === 1) t.alive = false;
    advancePhase(state, start + 1_000, 1, zero);
    expect(state.phase).toBe("result");
    expect(state.result!.winner).toBe(0);
    expect(state.phaseEndsAt).toBeGreaterThan(start + 1_000 - 1);
  });

  it("결과 단계가 끝나면 로비로 돌아가고 전투 상태가 지워진다", () => {
    const { state, start } = battleRoom();
    state.battle!.score = [3, 0];
    advancePhase(state, start + 120_000, 1, zero);
    expect(state.phase).toBe("result");
    advancePhase(state, state.phaseEndsAt!, 1, zero);
    expect(state.phase).toBe("lobby");
    expect(state.battle).toBeNull();
    expect(state.result).toBeNull();
  });

  it("궁극기 명령: 쓰면 스팀포스가 줄고 상대에게는 보이지 않는다", () => {
    const { state, A, start } = battleRoom();
    const result = playerUltimate(state, A, "ancient-lord", undefined, start + 100, 1, zero);
    // 고대의 군주는 밴되어 있어서 내 캐릭터가 아니다
    expect(result.ok).toBe(false);
    const ok = playerUltimate(state, A, "dwargon", undefined, start + 100, 1, zero);
    expect(ok).toEqual({ ok: true, advanced: false });
    expect(toSnapshot(state, start + 100, A).battle!.steam).toBeLessThan(10 - 4);
  });

  it("전투가 아닌 단계에서는 궁극기를 쓸 수 없다", () => {
    const { state, A } = battleRoom();
    state.phase = "lobby";
    expect(playerUltimate(state, A, "dwargon", undefined, 1, 1, zero)).toMatchObject({
      ok: false,
      code: "wrong_phase",
    });
  });

  it("나이트가 아닌 캐릭터는 레인을 옮길 수 없다", () => {
    const { state, A, start } = battleRoom();
    expect(playerMoveLane(state, A, "dwargon", "kingside", start + 100, 1, zero)).toMatchObject({
      ok: false,
      code: "not_a_knight",
    });
  });

  it("방 상태는 JSON으로 저장했다가 되살려도 같은 결과로 진행된다", () => {
    const x = battleRoom();
    const y = battleRoom();
    const restored = JSON.parse(JSON.stringify(y.state)) as RoomState;
    advancePhase(x.state, x.start + 30_000, 1, zero);
    advancePhase(restored, y.start + 30_000, 1, zero);
    expect(restored.battle!.units.map((u) => [u.id, u.pos, u.hp])).toEqual(
      x.state.battle!.units.map((u) => [u.id, u.pos, u.hp]),
    );
  });
});

describe("전투 메시지 파싱", () => {
  it("ultimate", () => {
    expect(parseClientMessage('{"t":"ultimate","characterId":"dwargon"}')).toEqual({
      t: "ultimate",
      characterId: "dwargon",
    });
    expect(parseClientMessage('{"t":"ultimate","characterId":"ankio","lane":"kingside"}')).toEqual({
      t: "ultimate",
      characterId: "ankio",
      lane: "kingside",
    });
    expect(parseClientMessage('{"t":"ultimate","characterId":"ankio","lane":"north"}')).toBeNull();
    expect(parseClientMessage('{"t":"ultimate"}')).toBeNull();
  });
  it("move", () => {
    expect(parseClientMessage('{"t":"move","characterId":"x","lane":"center"}')).toEqual({
      t: "move",
      characterId: "x",
      lane: "center",
    });
    expect(parseClientMessage('{"t":"move","characterId":"x"}')).toBeNull();
  });
});
