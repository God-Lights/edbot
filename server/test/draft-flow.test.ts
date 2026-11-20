import { describe, expect, it } from "vitest";
import { draftTurnMs } from "../src/room-state";
import {
  advancePhase,
  createRoom,
  joinRoom,
  nextDeadline,
  playerBan,
  playerLock,
  playerPick,
  playerPlace,
  setReady,
  toSnapshot,
} from "../src/room-state";
import type { RoomState } from "../src/room-state";

const zero = () => 0; // 선공은 seat 0, 자동으로 뽑을 때는 남은 캐릭터 중 맨 앞

/** 두 명이 들어와 준비한 방. 0ms에 게임이 시작되어 ban 단계다. */
function startedRoom(scale = 1) {
  let n = 0;
  const newId = () => `id${++n}`;
  const state = createRoom("ABCD", 0);
  const a = joinRoom(state, { name: "에드" }, 0, newId);
  const b = joinRoom(state, { name: "민수" }, 0, newId);
  if (!a.ok || !b.ok) throw new Error("join failed");
  setReady(state, a.player.id, true, 0, scale, zero);
  setReady(state, b.player.id, true, 0, scale, zero);
  return { state, a: a.player.id, b: b.player.id };
}

function bothBan(state: RoomState, a: string, b: string, now: number, scale = 1) {
  playerBan(state, a, "ancient-lord", now, scale, zero);
  return playerBan(state, b, "xenosaurs", now, scale, zero);
}

/** 선공 seat 0 기준 드래프트를 전부 직접 뽑는다. 남은 캐릭터는 richmond부터 nut-wolf까지 10명. */
function pickAll(state: RoomState, a: string, b: string, now: number, scale = 1) {
  const order = [a, b, b, a, a, b, b, a, a, b];
  const ids = [
    "richmond", "rosmaktia", "toka-loga", "dwargon", "raufaino",
    "for-the-more", "lappus", "bwtkan-jaws", "ankio", "nut-wolf",
  ];
  ids.forEach((id, i) => {
    const result = playerPick(state, order[i]!, id, now, scale, zero);
    expect(result.ok, `${i}번째 뽑기(${id})`).toBe(true);
  });
}

describe("게임 시작", () => {
  it("준비하면 ban 단계가 되고 선공이 정해진다", () => {
    const { state } = startedRoom();
    expect(state.phase).toBe("ban");
    expect(state.game).not.toBeNull();
    expect(state.game!.firstPicker).toBe(0); // rng가 0이면 seat 0
  });

  it("rng에 따라 선공이 달라진다", () => {
    let n = 0;
    const newId = () => `id${++n}`;
    const state = createRoom("ABCD", 0);
    const a = joinRoom(state, { name: "a" }, 0, newId);
    const b = joinRoom(state, { name: "b" }, 0, newId);
    if (!a.ok || !b.ok) throw new Error();
    setReady(state, a.player.id, true, 0, 1, () => 0.9);
    setReady(state, b.player.id, true, 0, 1, () => 0.9);
    expect(state.game!.firstPicker).toBe(1);
  });
});

describe("밴 단계", () => {
  it("둘 다 정하면 시간이 남아도 바로 드래프트가 시작된다", () => {
    const { state, a, b } = startedRoom();
    expect(playerBan(state, a, "ancient-lord", 2_000, 1, zero)).toEqual({ ok: true, advanced: false });
    expect(state.phase).toBe("ban");
    expect(playerBan(state, b, "xenosaurs", 3_000, 1, zero)).toEqual({ ok: true, advanced: true });
    expect(state.phase).toBe("draft");
    expect(state.phaseStartedAt).toBe(3_000);
    expect(state.phaseEndsAt).toBe(43_000);
    expect(state.game!.turnEndsAt).toBe(7_000); // 첫 차례 4초
  });

  it("같은 캐릭터를 서로 밴해도 된다", () => {
    const { state, a, b } = startedRoom();
    playerBan(state, a, "richmond", 1_000, 1, zero);
    playerBan(state, b, "richmond", 1_000, 1, zero);
    expect(state.phase).toBe("draft");
  });

  it("한 번 정한 밴은 바꿀 수 없다", () => {
    const { state, a } = startedRoom();
    playerBan(state, a, "richmond", 1_000, 1, zero);
    expect(playerBan(state, a, "lappus", 1_500, 1, zero)).toMatchObject({ ok: false, code: "already_done" });
  });

  it("시간이 끝나면 밴 없이 넘어간다", () => {
    const { state } = startedRoom();
    advancePhase(state, 10_000, 1, zero);
    expect(state.phase).toBe("draft");
    expect(state.game!.bans).toEqual([null, null]);
    expect(state.game!.banLocked).toEqual([true, true]);
    expect(state.phaseStartedAt).toBe(10_000);
  });

  it("한 명만 정하고 시간이 끝나면 그 밴만 적용된다", () => {
    const { state, a } = startedRoom();
    playerBan(state, a, "richmond", 5_000, 1, zero);
    advancePhase(state, 10_000, 1, zero);
    expect(state.game!.bans).toEqual(["richmond", null]);
  });

  it("없는 캐릭터와 다른 단계의 행동은 거절한다", () => {
    const { state, a } = startedRoom();
    expect(playerBan(state, a, "nobody", 1_000, 1, zero)).toMatchObject({ ok: false, code: "unknown_character" });
    expect(playerPick(state, a, "richmond", 1_000, 1, zero)).toMatchObject({ ok: false, code: "wrong_phase" });
    expect(playerLock(state, a, 1_000, 1, zero)).toMatchObject({ ok: false, code: "wrong_phase" });
    expect(playerBan(state, "ghost", "richmond", 1_000, 1, zero)).toMatchObject({ ok: false });
  });
});

describe("드래프트 단계", () => {
  it("차례대로 뽑고 10명을 다 뽑으면 바로 배치로 간다", () => {
    const { state, a, b } = startedRoom();
    bothBan(state, a, b, 3_000);
    pickAll(state, a, b, 5_000);

    expect(state.phase).toBe("placement");
    expect(state.phaseStartedAt).toBe(5_000);
    expect(state.phaseEndsAt).toBe(25_000);
    // 순서: 선공 1, 후공 2, 선공 2, 후공 2, 선공 2, 후공 1
    expect(state.game!.picks[0]).toEqual(["richmond", "dwargon", "raufaino", "bwtkan-jaws", "ankio"]);
    expect(state.game!.picks[1]).toEqual(["rosmaktia", "toka-loga", "for-the-more", "lappus", "nut-wolf"]);
    expect(state.game!.turnEndsAt).toBeNull();
  });

  it("내 차례가 아니거나 밴된 캐릭터는 거절한다", () => {
    const { state, a, b } = startedRoom();
    bothBan(state, a, b, 3_000);
    expect(playerPick(state, b, "richmond", 4_000, 1, zero)).toMatchObject({ ok: false, code: "not_your_turn" });
    expect(playerPick(state, a, "ancient-lord", 4_000, 1, zero)).toMatchObject({
      ok: false,
      code: "character_unavailable",
    });
  });

  it("차례 시간이 지나면 그 사람 대신 남은 캐릭터 중 하나가 뽑힌다", () => {
    const { state, a, b } = startedRoom();
    bothBan(state, a, b, 3_000); // 첫 차례는 7_000까지
    expect(advancePhase(state, 6_999, 1, zero)).toBe(false);
    expect(advancePhase(state, 7_000, 1, zero)).toBe(true);
    expect(state.game!.picks[0]).toEqual(["richmond"]);
    expect(state.game!.turnEndsAt).toBe(11_000); // 다음 차례는 그 시각부터 4초
    expect(state.phase).toBe("draft");
  });

  it("아무도 뽑지 않아도 4초씩 10번, 40초 뒤에 배치로 간다", () => {
    const { state, a, b } = startedRoom();
    bothBan(state, a, b, 3_000);
    advancePhase(state, 3_000 + 40_000 - 1, 1, zero);
    expect(state.phase).toBe("draft");
    advancePhase(state, 3_000 + 40_000, 1, zero);
    expect(state.phase).toBe("placement");
    expect(state.phaseStartedAt).toBe(43_000);
    const all = [...state.game!.picks[0], ...state.game!.picks[1]];
    expect(new Set(all).size).toBe(10);
    expect(all).not.toContain("ancient-lord");
  });

  it("뽑으면 다음 차례 타이머가 그 순간부터 새로 걸리고, 알람은 그 시각이다", () => {
    const { state, a, b } = startedRoom();
    bothBan(state, a, b, 3_000);
    playerPick(state, a, "richmond", 4_000, 1, zero);
    expect(state.game!.turnEndsAt).toBe(8_000);
    expect(nextDeadline(state)).toBe(8_000); // 단계 종료(43_000)보다 빠른 차례 종료 시각
  });

  it("서버가 한참 늦게 깨어나도 밀린 차례를 순서대로 모두 처리한다", () => {
    const { state, a, b } = startedRoom();
    bothBan(state, a, b, 3_000);
    advancePhase(state, 3_000 + 40_000 + 5_000 + 30_000, 1, zero);
    // 드래프트(3_000~43_000) 뒤 배치(43_000~63_000) 뒤 탐사(63_000~83_000)
    expect(state.phase).toBe("explore");
    expect(state.phaseStartedAt).toBe(63_000);
  });

  it("PHASE_SCALE에 맞춰 차례 시간도 줄어든다", () => {
    expect(draftTurnMs(1)).toBe(4_000);
    expect(draftTurnMs(0.05)).toBe(200);
    const { state, a, b } = startedRoom(0.05);
    bothBan(state, a, b, 100, 0.05);
    expect(state.game!.turnEndsAt).toBe(300);
  });
});

describe("배치 단계", () => {
  function placementRoom() {
    const { state, a, b } = startedRoom();
    bothBan(state, a, b, 3_000);
    pickAll(state, a, b, 5_000);
    return { state, a, b };
  }

  it("둘 다 확정하면 시간이 남아도 바로 탐사로 간다", () => {
    const { state, a, b } = placementRoom();
    expect(playerPlace(state, a, "richmond", "queenside", 6_000, 1, zero)).toEqual({ ok: true, advanced: false });
    expect(playerLock(state, a, 7_000, 1, zero)).toEqual({ ok: true, advanced: false });
    expect(state.phase).toBe("placement");
    expect(playerLock(state, b, 8_000, 1, zero)).toEqual({ ok: true, advanced: true });
    expect(state.phase).toBe("explore");
    expect(state.phaseStartedAt).toBe(8_000);
    expect(state.game!.lanes[0].richmond).toBe("queenside");
  });

  it("시간이 끝나면 못 정한 캐릭터는 기물별 기본 레인으로 간다", () => {
    const { state } = placementRoom();
    advancePhase(state, 25_000, 1, zero);
    expect(state.phase).toBe("explore");
    const lanes = state.game!.lanes;
    expect(Object.keys(lanes[0])).toHaveLength(5);
    expect(Object.keys(lanes[1])).toHaveLength(5);
    expect(lanes[0].dwargon).toBe("kingside"); // 룩
    expect(lanes[1]["for-the-more"]).toBe("center"); // 비숍
  });

  it("상대 캐릭터는 배치할 수 없고 확정한 뒤에는 바꿀 수 없다", () => {
    const { state, a } = placementRoom();
    expect(playerPlace(state, a, "rosmaktia", "center", 6_000, 1, zero)).toMatchObject({
      ok: false,
      code: "not_your_character",
    });
    playerLock(state, a, 6_500, 1, zero);
    expect(playerPlace(state, a, "richmond", "center", 7_000, 1, zero)).toMatchObject({
      ok: false,
      code: "already_done",
    });
  });
});

describe("상대에게 숨기는 정보", () => {
  it("밴 단계에서는 내 밴만 보이고 상대는 정했는지만 보인다", () => {
    const { state, a, b } = startedRoom();
    playerBan(state, a, "richmond", 1_000, 1, zero);

    const forA = toSnapshot(state, 2_000, a).game!;
    expect(forA.bans[0]).toEqual({ locked: true, characterId: "richmond" });
    expect(forA.bans[1]).toEqual({ locked: false, characterId: null });

    const forB = toSnapshot(state, 2_000, b).game!;
    expect(forB.bans[0]).toEqual({ locked: true, characterId: null }); // 정했다는 것만
    expect(forB.bans[1]).toEqual({ locked: false, characterId: null });
    expect(JSON.stringify(forB)).not.toContain("richmond");
  });

  it("밴 단계가 끝나면 둘 다 공개된다", () => {
    const { state, a, b } = startedRoom();
    bothBan(state, a, b, 3_000);
    const forB = toSnapshot(state, 4_000, b).game!;
    expect(forB.bans[0].characterId).toBe("ancient-lord");
    expect(forB.bans[1].characterId).toBe("xenosaurs");
  });

  it("뽑은 캐릭터는 바로 모두에게 공개되고 현재 차례가 보인다", () => {
    const { state, a, b } = startedRoom();
    bothBan(state, a, b, 3_000);
    playerPick(state, a, "richmond", 4_000, 1, zero);
    const forB = toSnapshot(state, 4_500, b).game!;
    expect(forB.picks[0]).toEqual(["richmond"]);
    expect(forB.turnSeat).toBe(1);
    expect(forB.turnEndsAt).toBe(8_000);
    expect(forB.firstPicker).toBe(0);
    expect(forB.pickOrder).toEqual([0, 1, 1, 0, 0, 1, 1, 0, 0, 1]);
  });

  it("레인 배치는 내 것만 보이고, 전투가 시작되면 둘 다 공개된다", () => {
    const { state, a, b } = startedRoom();
    bothBan(state, a, b, 3_000);
    pickAll(state, a, b, 5_000);
    playerPlace(state, a, "richmond", "queenside", 6_000, 1, zero);
    playerPlace(state, b, "rosmaktia", "kingside", 6_000, 1, zero);

    const forA = toSnapshot(state, 7_000, a).game!;
    expect(forA.lanes[0]?.richmond).toBe("queenside");
    expect(forA.lanes[1]).toBeNull();
    const forB = toSnapshot(state, 7_000, b).game!;
    expect(forB.lanes[0]).toBeNull();
    expect(forB.lanes[1]?.rosmaktia).toBe("kingside");

    // 탐사와 대장간 단계에서도 숨겨진다
    playerLock(state, a, 8_000, 1, zero);
    playerLock(state, b, 8_000, 1, zero);
    expect(state.phase).toBe("explore");
    expect(toSnapshot(state, 8_500, a).game!.lanes[1]).toBeNull();
    advancePhase(state, 28_000, 1, zero); // 탐사 종료
    expect(state.phase).toBe("forge");
    expect(toSnapshot(state, 28_500, a).game!.lanes[1]).toBeNull();

    // 전투가 시작되는 순간 공개
    advancePhase(state, 48_000, 1, zero);
    expect(state.phase).toBe("battle");
    const revealed = toSnapshot(state, 48_500, a).game!;
    expect(revealed.lanes[0]).not.toBeNull();
    expect(revealed.lanes[1]).not.toBeNull();
    expect(Object.keys(revealed.lanes[1]!)).toHaveLength(5);
  });

  it("관전자나 알 수 없는 사람에게는 어느 쪽 정보도 숨겨진다", () => {
    const { state, a, b } = startedRoom();
    playerBan(state, a, "richmond", 1_000, 1, zero);
    const anon = toSnapshot(state, 2_000).game!;
    expect(anon.bans[0].characterId).toBeNull();
    expect(anon.bans[1].characterId).toBeNull();
    void b;
  });
});

describe("판이 끝나면", () => {
  it("로비로 돌아가고 밴, 드래프트, 배치가 모두 사라진다", () => {
    const { state } = startedRoom();
    // 모두 아무것도 하지 않고 전 단계를 시간으로 통과한다: 240초
    advancePhase(state, 240_000, 1, zero);
    expect(state.phase).toBe("lobby");
    expect(state.game).toBeNull();
    expect(toSnapshot(state, 240_000).game).toBeNull();
    expect(state.players.every((p) => !p.ready)).toBe(true);
  });

  it("아무것도 하지 않아도 총 시간은 240초 그대로다", () => {
    const { state } = startedRoom();
    advancePhase(state, 239_999, 1, zero);
    expect(state.phase).toBe("result");
    advancePhase(state, 240_000, 1, zero);
    expect(state.phase).toBe("lobby");
  });

  it("다시 시작하면 새 선공과 빈 상태의 게임이 만들어진다", () => {
    const { state, a, b } = startedRoom();
    advancePhase(state, 240_000, 1, zero);
    let flip = 0.9;
    setReady(state, a, true, 241_000, 1, () => flip);
    setReady(state, b, true, 241_000, 1, () => flip);
    expect(state.phase).toBe("ban");
    expect(state.game!.firstPicker).toBe(1);
    expect(state.game!.picks).toEqual([[], []]);
    expect(state.game!.bans).toEqual([null, null]);
    flip = 0;
  });
});
