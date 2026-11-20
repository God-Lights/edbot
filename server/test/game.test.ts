import { describe, expect, it } from "vitest";
import { CHARACTERS } from "../src/characters";
import {
  TOTAL_PICKS,
  arePlacementsDone,
  areBansDone,
  autoPick,
  availableIds,
  bannedIds,
  createGame,
  currentTurnSeat,
  fillDraft,
  fillPlacement,
  isDraftComplete,
  lockAllPlacements,
  lockBans,
  lockPlacement,
  pickCount,
  snakeOrder,
  startDraft,
  submitBan,
  submitPick,
  submitPlacement,
} from "../src/game";

const TURN = 4_000;
const first = () => 0; // rng가 항상 0이면 남은 캐릭터 중 맨 앞을 고른다

describe("snakeOrder", () => {
  it("선공 1, 후공 2, 선공 2, 후공 2, 선공 2, 후공 1", () => {
    expect(snakeOrder(0)).toEqual([0, 1, 1, 0, 0, 1, 1, 0, 0, 1]);
    expect(snakeOrder(1)).toEqual([1, 0, 0, 1, 1, 0, 0, 1, 1, 0]);
  });

  it("양쪽이 5번씩 뽑는다", () => {
    for (const f of [0, 1] as const) {
      const order = snakeOrder(f);
      expect(order).toHaveLength(TOTAL_PICKS);
      expect(order.filter((s) => s === 0)).toHaveLength(5);
      expect(order.filter((s) => s === 1)).toHaveLength(5);
    }
  });
});

describe("밴", () => {
  it("없는 캐릭터는 거절한다", () => {
    expect(submitBan(createGame(0), 0, "nobody")).toMatchObject({ ok: false, code: "unknown_character" });
  });

  it("한 번 정하면 바꿀 수 없다", () => {
    const game = createGame(0);
    expect(submitBan(game, 0, "richmond")).toEqual({ ok: true });
    expect(submitBan(game, 0, "lappus")).toMatchObject({ ok: false, code: "already_done" });
    expect(game.bans[0]).toBe("richmond");
  });

  it("둘 다 정하면 끝난다", () => {
    const game = createGame(0);
    submitBan(game, 0, "richmond");
    expect(areBansDone(game)).toBe(false);
    submitBan(game, 1, "lappus");
    expect(areBansDone(game)).toBe(true);
  });

  it("같은 캐릭터를 둘 다 밴하면 하나로 센다", () => {
    const game = createGame(0);
    submitBan(game, 0, "richmond");
    submitBan(game, 1, "richmond");
    expect(bannedIds(game)).toEqual(["richmond"]);
    expect(availableIds(game)).toHaveLength(11);
  });

  it("시간이 끝나면 못 정한 사람은 밴 없이 확정된다", () => {
    const game = createGame(0);
    submitBan(game, 0, "richmond");
    lockBans(game);
    expect(areBansDone(game)).toBe(true);
    expect(game.bans).toEqual(["richmond", null]);
    expect(availableIds(game)).toHaveLength(11);
  });
});

describe("드래프트", () => {
  function draftingGame() {
    const game = createGame(0);
    submitBan(game, 0, "ancient-lord");
    submitBan(game, 1, "xenosaurs");
    startDraft(game, 10_000, TURN);
    return game;
  }

  it("시작하면 첫 차례와 제한 시간이 정해진다", () => {
    const game = draftingGame();
    expect(currentTurnSeat(game)).toBe(0);
    expect(game.turnEndsAt).toBe(14_000);
    expect(availableIds(game)).toHaveLength(10);
  });

  it("내 차례가 아니면 뽑을 수 없다", () => {
    const game = draftingGame();
    expect(submitPick(game, 1, "richmond", 11_000, TURN)).toMatchObject({ ok: false, code: "not_your_turn" });
  });

  it("밴되었거나 이미 뽑힌 캐릭터는 뽑을 수 없다", () => {
    const game = draftingGame();
    expect(submitPick(game, 0, "ancient-lord", 11_000, TURN)).toMatchObject({
      ok: false,
      code: "character_unavailable",
    });
    expect(submitPick(game, 0, "richmond", 11_000, TURN)).toEqual({ ok: true });
    expect(submitPick(game, 1, "richmond", 11_500, TURN)).toMatchObject({
      ok: false,
      code: "character_unavailable",
    });
    expect(submitPick(game, 1, "nobody", 11_500, TURN)).toMatchObject({ ok: false, code: "unknown_character" });
  });

  it("뽑는 즉시 다음 차례가 시작되고 타이머가 새로 걸린다", () => {
    const game = draftingGame();
    submitPick(game, 0, "richmond", 11_000, TURN);
    expect(currentTurnSeat(game)).toBe(1);
    expect(game.turnEndsAt).toBe(15_000);
    submitPick(game, 1, "rosmaktia", 11_100, TURN);
    expect(currentTurnSeat(game)).toBe(1); // 후공은 연달아 2명
    expect(game.turnEndsAt).toBe(15_100);
  });

  it("10명을 다 뽑으면 끝나고 타이머가 멈춘다", () => {
    const game = draftingGame();
    const ids = availableIds(game);
    ids.forEach((id, i) => {
      const seat = currentTurnSeat(game)!;
      expect(submitPick(game, seat, id, 11_000 + i, TURN)).toEqual({ ok: true });
    });
    expect(isDraftComplete(game)).toBe(true);
    expect(currentTurnSeat(game)).toBeNull();
    expect(game.turnEndsAt).toBeNull();
    expect(game.picks[0]).toHaveLength(5);
    expect(game.picks[1]).toHaveLength(5);
  });

  it("차례 시간이 지나면 남은 캐릭터 중 하나를 대신 뽑는다", () => {
    const game = draftingGame();
    const id = autoPick(game, 14_000, TURN, first);
    expect(id).toBe("richmond"); // 밴된 ancient-lord를 빼고 맨 앞
    expect(game.picks[0]).toEqual(["richmond"]);
    expect(game.turnEndsAt).toBe(18_000);
  });

  it("무작위 선택은 rng 값에 따라 달라진다", () => {
    const game = draftingGame();
    const id = autoPick(game, 14_000, TURN, () => 0.999);
    expect(id).toBe("nut-wolf"); // 남은 10명 중 마지막
  });

  it("단계가 끝나면 남은 차례를 모두 채운다 (중복 없이, 밴 제외)", () => {
    const game = draftingGame();
    submitPick(game, 0, "richmond", 11_000, TURN);
    fillDraft(game, Math.random);
    expect(isDraftComplete(game)).toBe(true);
    const all = [...game.picks[0], ...game.picks[1]];
    expect(new Set(all).size).toBe(10);
    expect(all).not.toContain("ancient-lord");
    expect(all).not.toContain("xenosaurs");
    expect(game.picks[0][0]).toBe("richmond");
    expect(game.turnEndsAt).toBeNull();
  });

  it("밴 없이 시작하면 12명 중 10명을 뽑는다", () => {
    const game = createGame(1);
    lockBans(game);
    startDraft(game, 0, TURN);
    expect(availableIds(game)).toHaveLength(CHARACTERS.length);
    fillDraft(game, Math.random);
    expect(pickCount(game)).toBe(10);
    expect(currentTurnSeat(game)).toBeNull();
  });
});

describe("배치", () => {
  function placementGame() {
    const game = createGame(0);
    lockBans(game);
    startDraft(game, 0, TURN);
    fillDraft(game, first);
    return game; // 선공 seat 0 기준으로 picks가 채워졌다
  }

  it("내 팀의 캐릭터만 배치할 수 있다", () => {
    const game = placementGame();
    const mine = game.picks[0][0]!;
    const theirs = game.picks[1][0]!;
    expect(submitPlacement(game, 0, mine, "kingside")).toEqual({ ok: true });
    expect(submitPlacement(game, 0, theirs, "kingside")).toMatchObject({ ok: false, code: "not_your_character" });
  });

  it("확정하기 전에는 바꿀 수 있고, 확정한 뒤에는 바꿀 수 없다", () => {
    const game = placementGame();
    const id = game.picks[0][0]!;
    submitPlacement(game, 0, id, "kingside");
    submitPlacement(game, 0, id, "queenside");
    expect(game.lanes[0][id]).toBe("queenside");

    expect(lockPlacement(game, 0)).toEqual({ ok: true });
    expect(submitPlacement(game, 0, id, "center")).toMatchObject({ ok: false, code: "already_done" });
    expect(lockPlacement(game, 0)).toMatchObject({ ok: false, code: "already_done" });
    expect(game.lanes[0][id]).toBe("queenside");
  });

  it("확정하면 정하지 않은 캐릭터는 기물별 기본 레인으로 간다", () => {
    const game = placementGame();
    lockPlacement(game, 0);
    expect(Object.keys(game.lanes[0])).toHaveLength(5);
    // 룩은 킹사이드, 비숍은 센터
    for (const id of game.picks[0]) {
      if (id === "dwargon" || id === "raufaino") expect(game.lanes[0][id]).toBe("kingside");
      if (id === "lappus" || id === "for-the-more") expect(game.lanes[0][id]).toBe("center");
    }
  });

  it("직접 정한 레인은 기본값으로 덮어쓰지 않는다", () => {
    const game = placementGame();
    const id = game.picks[0][0]!;
    submitPlacement(game, 0, id, "queenside");
    fillPlacement(game, 0);
    expect(game.lanes[0][id]).toBe("queenside");
  });

  it("둘 다 확정하면 끝난다", () => {
    const game = placementGame();
    lockPlacement(game, 0);
    expect(arePlacementsDone(game)).toBe(false);
    lockPlacement(game, 1);
    expect(arePlacementsDone(game)).toBe(true);
  });

  it("시간이 끝나면 확정하지 않은 사람도 현재 배치대로 확정된다", () => {
    const game = placementGame();
    lockAllPlacements(game);
    expect(arePlacementsDone(game)).toBe(true);
    expect(Object.keys(game.lanes[0])).toHaveLength(5);
    expect(Object.keys(game.lanes[1])).toHaveLength(5);
  });
});
