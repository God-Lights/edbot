import { describe, expect, it } from "vitest";
import {
  AMBUSH_TICKS,
  GATHER_TICKS,
  GAUGE_MAX,
  GAUGE_REGEN_TICKS,
  INCOME_INTERVAL_TICKS,
  MAP_SIZE,
  START_BRANCH,
  START_TALENT,
  TILE_RESPAWN_TICKS,
  awardKill,
  createExplore,
  startAmbush,
  startGather,
  startScout,
  stepExplore,
} from "../src/explore/explore";
import type { ExploreState, TileKind } from "../src/explore/explore";
import { toExploreSnapshot } from "../src/explore/snapshot";

const NEUTRAL = ["nut-wolf", "xenosaurs", "nut-wolf", "xenosaurs", "nut-wolf"]; // 폰만: 특성 없음

function make(a: string[] = NEUTRAL, b: string[] = NEUTRAL, seed = 1, secondPicker: 0 | 1 = 1): ExploreState {
  return createExplore({ seed, teams: [a, b], secondPicker });
}
const run = (s: ExploreState, ticks: number) => {
  for (let i = 0; i < ticks; i++) stepExplore(s);
};
/** 지정한 칸을 원하는 종류로 바꾸고 둘 다 아는 칸으로 만든다. */
function setTile(s: ExploreState, index: number, kind: TileKind) {
  s.tiles[index] = { kind, depletedUntil: null, spent: false };
  s.fog[index] = false;
  s.known[0][index] = true;
  s.known[1][index] = true;
}

describe("지도", () => {
  it("16칸이고 종류 수가 정해진 대로이며, 같은 시드면 같은 지도다", () => {
    const s = make();
    expect(s.tiles).toHaveLength(MAP_SIZE);
    const count = (k: TileKind) => s.tiles.filter((t) => t.kind === k).length;
    expect([count("tree"), count("rock"), count("ore"), count("chest"), count("empty")]).toEqual([4, 3, 2, 2, 5]);
    expect(s.fog.filter(Boolean)).toHaveLength(6);
    expect(make(NEUTRAL, NEUTRAL, 7).tiles).toEqual(make(NEUTRAL, NEUTRAL, 7).tiles);
    expect(make(NEUTRAL, NEUTRAL, 7).tiles).not.toEqual(make(NEUTRAL, NEUTRAL, 8).tiles);
  });

  it("안개가 아닌 칸은 양쪽이 알고, 안개 칸은 아무도 모른다", () => {
    const s = make();
    s.fog.forEach((fog, i) => {
      expect(s.known[0][i]).toBe(!fog);
      expect(s.known[1][i]).toBe(!fog);
    });
  });

  it("시작 자원과 행동 게이지", () => {
    const s = make();
    expect(s.gauge).toEqual([GAUGE_MAX, GAUGE_MAX]);
    expect(s.resources[0].talent).toBe(START_TALENT);
    expect(s.resources[0].branch).toBe(START_BRANCH);
    expect(s.resources[1].stone).toBe(3);
  });
});

describe("행동 게이지", () => {
  it("행동마다 1을 쓰고, 0이면 할 수 없고, 12초마다 1씩 찬다", () => {
    const s = make();
    setTile(s, 0, "tree");
    setTile(s, 1, "tree");
    setTile(s, 2, "tree");
    setTile(s, 3, "tree");
    expect(startGather(s, 0, 0)).toEqual({ ok: true });
    expect(startGather(s, 0, 1)).toEqual({ ok: true });
    expect(startGather(s, 0, 2)).toEqual({ ok: true });
    expect(s.gauge[0]).toBe(0);
    expect(startGather(s, 0, 3)).toEqual({ ok: false, code: "no_action_gauge" });
    run(s, GAUGE_REGEN_TICKS - 1);
    expect(s.gauge[0]).toBe(0);
    run(s, 1);
    expect(s.gauge[0]).toBe(1);
    expect(s.gauge[1]).toBe(GAUGE_MAX); // 상대 게이지는 영향 없음
  });

  it("가득 차 있으면 더 차지 않는다", () => {
    const s = make();
    run(s, GAUGE_REGEN_TICKS * 3);
    expect(s.gauge[0]).toBe(GAUGE_MAX);
  });

  it("잘못된 칸이나 같은 칸에서의 중복 행동은 거절하고 게이지를 쓰지 않는다", () => {
    const s = make();
    setTile(s, 5, "rock");
    expect(startGather(s, 0, 16)).toEqual({ ok: false, code: "invalid_tile" });
    expect(startGather(s, 0, -1)).toEqual({ ok: false, code: "invalid_tile" });
    startGather(s, 0, 5);
    expect(startGather(s, 0, 5)).toEqual({ ok: false, code: "tile_busy" });
    expect(startAmbush(s, 0, 5)).toEqual({ ok: false, code: "tile_busy" });
    expect(s.gauge[0]).toBe(2);
  });

  it("빈 땅은 채집할 수 없다 (아는 칸일 때)", () => {
    const s = make();
    setTile(s, 4, "empty");
    expect(startGather(s, 0, 4)).toEqual({ ok: false, code: "nothing_to_gather" });
    expect(s.gauge[0]).toBe(GAUGE_MAX);
  });
});

describe("채집", () => {
  it("3초 뒤에 자원을 얻고 칸이 비었다가 25초 뒤에 다시 생긴다", () => {
    const s = make();
    setTile(s, 0, "tree");
    startGather(s, 0, 0);
    run(s, GATHER_TICKS - 1);
    expect(s.resources[0].branch).toBe(START_BRANCH);
    run(s, 1);
    expect(s.resources[0].branch).toBe(START_BRANCH + 2);
    expect(s.tiles[0]!.depletedUntil).not.toBeNull();
    expect(startGather(s, 1, 0)).toEqual({ ok: false, code: "nothing_to_gather" });
    run(s, TILE_RESPAWN_TICKS);
    expect(s.tiles[0]!.depletedUntil).toBeNull();
    expect(startGather(s, 1, 0)).toEqual({ ok: true });
  });

  it("종류마다 얻는 자원이 다르다", () => {
    const s = make();
    setTile(s, 0, "rock");
    setTile(s, 1, "ore");
    startGather(s, 0, 0);
    startGather(s, 0, 1);
    run(s, GATHER_TICKS);
    expect(s.resources[0].stone).toBe(3 + 2);
    expect(s.resources[0].ore).toBe(1);
  });

  it("탐사 특성: 룩은 돌·광석 +1, 비숍은 나뭇가지 +1", () => {
    const s = make(["dwargon", "bwtkan-jaws", "lappus", "nut-wolf", "xenosaurs"]); // 룩, 나이트, 비숍, 폰, 폰
    setTile(s, 0, "rock");
    setTile(s, 1, "tree");
    setTile(s, 2, "ore");
    startGather(s, 0, 0);
    startGather(s, 0, 1);
    startGather(s, 0, 2);
    run(s, GATHER_TICKS);
    expect(s.resources[0].stone).toBe(3 + 2 + 1);
    expect(s.resources[0].branch).toBe(3 + 2 + 1);
    expect(s.resources[0].ore).toBe(1 + 1);
  });

  it("안개 칸은 채집을 마치면 정체를 알게 되고, 빈 땅이었다면 아무것도 못 얻는다", () => {
    const s = make();
    s.tiles[3] = { kind: "empty", depletedUntil: null, spent: false };
    s.fog[3] = true;
    s.known[0][3] = false;
    expect(startGather(s, 0, 3)).toEqual({ ok: true });
    run(s, GATHER_TICKS);
    expect(s.known[0][3]).toBe(true);
    expect(s.resources[0].branch).toBe(START_BRANCH);
    expect(toExploreSnapshot(s, 0).events.at(-1)!.type).toBe("empty");
  });
});

describe("같은 칸을 둘 다 채집", () => {
  it("반씩 나눠 갖고, 홀수 몫은 후공 팀에게 간다 (특성이 같을 때)", () => {
    const s = make(NEUTRAL, NEUTRAL, 1, 1);
    setTile(s, 0, "ore"); // 광석 1개
    startGather(s, 0, 0);
    run(s, 5);
    startGather(s, 1, 0);
    run(s, GATHER_TICKS);
    // 먼저 시작한 쪽이 끝나는 순간 상대의 채집도 같이 끝난다. 광석 1개는 후공(seat 1)이 가진다.
    expect(s.resources[0].ore).toBe(0);
    expect(s.resources[1].ore).toBe(1);
    expect(s.gathers).toHaveLength(0);
  });

  it("짝수 몫은 정확히 반씩", () => {
    const s = make();
    setTile(s, 0, "tree"); // 2개
    startGather(s, 0, 0);
    startGather(s, 1, 0);
    run(s, GATHER_TICKS);
    expect(s.resources[0].branch).toBe(START_BRANCH + 1);
    expect(s.resources[1].branch).toBe(START_BRANCH + 1);
  });

  it("홀수 몫은 채집 특성이 높은 쪽이 가진다", () => {
    const s = make(NEUTRAL, ["dwargon", "raufaino", "nut-wolf", "xenosaurs", "nut-wolf"], 1, 0);
    setTile(s, 0, "ore");
    startGather(s, 0, 0);
    startGather(s, 1, 0);
    run(s, GATHER_TICKS);
    // 후공은 seat 0이지만 seat 1에 룩이 2명이라 특성이 높다. 나눌 때 1개는 seat 1에게, 특성 보너스 +2도 seat 1.
    expect(s.resources[1].ore).toBe(1 + 2);
    expect(s.resources[0].ore).toBe(0);
  });
});

describe("매복", () => {
  it("채집이 끝나는 순간 매복한 쪽이 자원을 가지고 채집한 쪽은 못 얻는다", () => {
    const s = make();
    setTile(s, 0, "tree");
    startAmbush(s, 1, 0);
    startGather(s, 0, 0);
    run(s, GATHER_TICKS);
    expect(s.resources[0].branch).toBe(START_BRANCH);
    expect(s.resources[1].branch).toBe(START_BRANCH + 2);
    expect(s.ambushes).toHaveLength(0);
    const victim = toExploreSnapshot(s, 0).events.map((e) => e.type);
    expect(victim).toContain("stolen");
    expect(toExploreSnapshot(s, 1).events.map((e) => e.type)).toContain("ambushHit");
  });

  it("나이트가 있으면 빼앗는 양이 +1", () => {
    const s = make(NEUTRAL, ["ankio", "nut-wolf", "xenosaurs", "nut-wolf", "xenosaurs"]);
    setTile(s, 0, "tree");
    startAmbush(s, 1, 0);
    startGather(s, 0, 0);
    run(s, GATHER_TICKS);
    expect(s.resources[1].branch).toBe(START_BRANCH + 2 + 1);
  });

  it("10초 안에 아무도 오지 않으면 사라지고 행동이 낭비된다", () => {
    const s = make();
    startAmbush(s, 0, 2);
    run(s, AMBUSH_TICKS - 1);
    expect(s.ambushes).toHaveLength(1);
    run(s, 1);
    expect(s.ambushes).toHaveLength(0);
    expect(s.gauge[0]).toBe(GAUGE_MAX - 1);
    expect(toExploreSnapshot(s, 0).events.at(-1)!.type).toBe("ambushExpired");
  });

  it("양쪽이 같은 칸을 매복하면 서로 무효가 된다", () => {
    const s = make();
    startAmbush(s, 0, 2);
    startAmbush(s, 1, 2);
    expect(s.ambushes).toHaveLength(0);
    expect(s.gauge).toEqual([GAUGE_MAX - 1, GAUGE_MAX - 1]);
  });

  it("매복 뒤에 채집이 끝난 뒤 시작한 채집(매복이 이미 사라짐)은 영향이 없다", () => {
    const s = make();
    setTile(s, 0, "tree");
    startAmbush(s, 1, 0);
    run(s, AMBUSH_TICKS);
    startGather(s, 0, 0);
    run(s, GATHER_TICKS);
    expect(s.resources[0].branch).toBe(START_BRANCH + 2);
  });
});

describe("정찰", () => {
  function fogged(s: ExploreState, index: number, kind: TileKind) {
    s.tiles[index] = { kind, depletedUntil: null, spent: false };
    s.fog[index] = true;
    s.known[0][index] = false;
    s.known[1][index] = false;
  }

  it("안개 칸의 정체를 나에게만 알려 준다", () => {
    const s = make();
    fogged(s, 6, "chest");
    expect(startScout(s, 0, 6)).toEqual({ ok: true });
    expect(toExploreSnapshot(s, 0).tiles[6]!.kind).toBe("chest");
    expect(toExploreSnapshot(s, 1).tiles[6]!.kind).toBeNull();
  });

  it("이미 아는 칸은 정찰할 수 없다", () => {
    const s = make();
    setTile(s, 1, "tree");
    expect(startScout(s, 0, 1)).toEqual({ ok: false, code: "already_known" });
    expect(s.gauge[0]).toBe(GAUGE_MAX);
  });

  it("정찰한 칸에 상대 매복이 있으면 보이고, 사라지면 안 보인다", () => {
    const s = make();
    fogged(s, 6, "tree");
    startAmbush(s, 1, 6);
    startScout(s, 0, 6);
    expect(toExploreSnapshot(s, 0).tiles[6]!.enemyAmbush).toBe(true);
    expect(toExploreSnapshot(s, 0).events.at(-1)!.detail).toBe("tree,ambush");
    run(s, AMBUSH_TICKS);
    expect(toExploreSnapshot(s, 0).tiles[6]!.enemyAmbush).toBe(false);
  });

  it("매복은 정찰하지 않으면 상대에게 전혀 보이지 않는다", () => {
    const s = make();
    startAmbush(s, 1, 2);
    expect(JSON.stringify(toExploreSnapshot(s, 0))).not.toContain('"myAmbushInTicks":100');
    expect(toExploreSnapshot(s, 0).tiles[2]!.enemyAmbush).toBe(false);
    expect(toExploreSnapshot(s, 1).tiles[2]!.myAmbushInTicks).toBe(AMBUSH_TICKS);
  });

  it("퀸이 있으면 안개 칸을 하나 더 확인한다", () => {
    const s = make(["rosmaktia", "nut-wolf", "xenosaurs", "nut-wolf", "xenosaurs"]);
    const foggy = s.fog.map((f, i) => (f ? i : -1)).filter((i) => i >= 0);
    startScout(s, 0, foggy[0]!);
    const revealed = foggy.filter((i) => s.known[0][i]);
    expect(revealed).toHaveLength(2);
    expect(foggy.filter((i) => s.known[1][i])).toHaveLength(0);
  });
});

describe("보물상자", () => {
  it("한 번 열면 빈 땅이 되고 다시 생기지 않는다", () => {
    const s = make();
    setTile(s, 0, "chest");
    startGather(s, 0, 0);
    run(s, GATHER_TICKS);
    expect(s.tiles[0]!.kind).toBe("empty");
    run(s, TILE_RESPAWN_TICKS * 2);
    expect(startGather(s, 1, 0)).toEqual({ ok: false, code: "nothing_to_gather" });
  });

  it("희귀 재료, 설계도, 함정이 나온다 (시드마다 다름)", () => {
    const seen = { rare: 0, blueprints: 0, trap: 0 };
    for (let seed = 1; seed <= 200; seed++) {
      const s = make(NEUTRAL, NEUTRAL, seed);
      setTile(s, 0, "chest");
      startGather(s, 0, 0);
      run(s, GATHER_TICKS);
      const r = s.resources[0];
      if (r.rare > 0) seen.rare++;
      else if (r.blueprints > 0) seen.blueprints++;
      else if (r.talent < START_TALENT) seen.trap++;
    }
    expect(seen.rare).toBeGreaterThan(40);
    expect(seen.blueprints).toBeGreaterThan(40);
    expect(seen.trap).toBeGreaterThan(15);
    expect(seen.trap).toBeLessThan(70);
  });

  it("함정은 탈런트를 잃게 하지만 0 밑으로 내려가지 않는다", () => {
    const s = make();
    s.resources[0].talent = 1;
    setTile(s, 0, "chest");
    for (let seed = 0; seed < 200; seed++) {
      s.rngState = seed;
      s.tiles[0] = { kind: "chest", depletedUntil: null, spent: false };
      s.gathers = [];
      startGather(s, 0, 0);
      s.gauge[0] = GAUGE_MAX;
      run(s, GATHER_TICKS);
      expect(s.resources[0].talent).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("탈런트", () => {
  it("10초마다 +2, 킹이 있으면 킹마다 +1", () => {
    const s = make(["ancient-lord", "richmond", "nut-wolf", "nut-wolf", "xenosaurs"], NEUTRAL);
    run(s, INCOME_INTERVAL_TICKS);
    expect(s.resources[0].talent).toBe(START_TALENT + 2 + 2);
    expect(s.resources[1].talent).toBe(START_TALENT + 2);
  });

  it("처치하면 +2", () => {
    const s = make();
    awardKill(s, 1);
    expect(s.resources[1].talent).toBe(START_TALENT + 2);
  });
});

describe("보이는 정보", () => {
  it("상대의 자원은 스냅샷에 없다", () => {
    const s = make();
    s.resources[1].rare = 7;
    expect(toExploreSnapshot(s, 0).resources!.rare).toBe(0);
    expect(toExploreSnapshot(s, 1).resources!.rare).toBe(7);
    expect(toExploreSnapshot(s, null).resources).toBeNull();
  });

  it("내 행동 진행 상태만 보인다", () => {
    const s = make();
    setTile(s, 0, "tree");
    startGather(s, 1, 0);
    expect(toExploreSnapshot(s, 0).tiles[0]!.myGatherInTicks).toBeNull();
    expect(toExploreSnapshot(s, 1).tiles[0]!.myGatherInTicks).toBe(GATHER_TICKS);
  });

  it("JSON으로 저장했다가 되살려도 같은 결과로 진행된다", () => {
    const a = make();
    const b = JSON.parse(JSON.stringify(a)) as ExploreState;
    setTile(a, 0, "chest");
    setTile(b, 0, "chest");
    startGather(a, 0, 0);
    startGather(b, 0, 0);
    run(a, 200);
    run(b, 200);
    expect(b.resources).toEqual(a.resources);
  });
});
