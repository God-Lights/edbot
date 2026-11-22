import { describe, expect, it } from "vitest";
import { attackableEnemies, distanceBetween, enemiesOf, moveDestinations, stepCell } from "../src/chess/board";
import { CODE_ALPHABET, CODE_LENGTH, RESERVED_CODES } from "../src/codes";
import { makeRng, placeTeam, randomTeam } from "../src/chess/balance";
import { addEffect, createUnit } from "../src/chess/core";
import {
  CLONE_CAP, MAX_BEATS, MOBIUS_MAX_BEATS, MOBIUS_SUDDEN_DEATH_BEAT, SUDDEN_DEATH_BEAT, WORMHOLE_BEATS, createCombat, recordCombat, runCombat, stepCombat,
} from "../src/chess/sim";
import type { CombatState, CombatUnit, Face, Piece, Seat } from "../src/chess/types";

/** 무한 모드 빈 판에 기물을 직접 놓는다. */
function arena(mobius = true): CombatState {
  return createCombat([[], []], [], { mobius });
}
function put(state: CombatState, u: { seat: Seat; piece: Piece; x: number; y: number; face?: Face; hp?: number; atk?: number }): CombatUnit {
  return createUnit(state, {
    defId: "nut-wolf", seat: u.seat, star: 1, x: u.x, y: u.y, face: u.face ?? 0, hp: u.hp ?? 1000, maxHp: u.hp ?? 1000, atk: u.atk ?? 50,
    energyMax: null, piece: u.piece, summon: false,
  });
}
const squares = (list: Array<{ x: number; y: number; face?: number }>) => list.map((p) => `${p.x},${p.y},${p.face ?? 0}`).sort();

describe("이음매", () => {
  it("가로 가장자리를 넘으면 반대편 열로 가고 랭크가 뒤집히고 면이 바뀐다", () => {
    const s = arena();
    expect(stepCell(s, { x: 7, y: 3, face: 0 }, 1, 0)).toMatchObject({ x: 0, y: 4, face: 1 });
    expect(stepCell(s, { x: 0, y: 2, face: 1 }, -1, 0)).toMatchObject({ x: 7, y: 5, face: 0 });
    expect(stepCell(s, { x: 3, y: 0, face: 0 }, 0, -1)).toBeUndefined(); // 세로 가장자리는 이어지지 않는다
  });
  it("일반 규칙에서는 가장자리가 막혀 있다", () => {
    expect(stepCell(arena(false), { x: 7, y: 3, face: 0 }, 1, 0)).toBeUndefined();
  });
  it("룩은 이음매를 지나 면이 바뀐 칸까지 간다", () => {
    const s = arena();
    const rook = put(s, { seat: 0, piece: "rook", x: 6, y: 3 });
    expect(squares(moveDestinations(s, rook))).toContain("0,4,1"); // (7,3)을 지나 (0,4)로, 밑면
    expect(squares(moveDestinations(s, rook))).toContain("7,3,0");
    expect(squares(moveDestinations(s, rook))).not.toContain("0,3,0"); // 같은 면 같은 y로는 못 간다
  });
  it("비숍은 이음매를 지나면 대각선 방향이 이어진다", () => {
    const s = arena();
    const bishop = put(s, { seat: 0, piece: "bishop", x: 6, y: 3 });
    // (6,3) -> (7,2) -> 이음매 너머 (0,6), 면이 바뀐다
    expect(squares(moveDestinations(s, bishop))).toContain("0,6,1");
    // (7,4) -> 이음매 너머 (0,2). 이어서 같은 쪽으로 가면 진행 방향이 뒤집혀 (1,1)이 아니라 (1,3)이 된다
    expect(squares(moveDestinations(s, bishop))).toContain("0,2,1");
    expect(squares(moveDestinations(s, bishop))).toContain("1,1,1");
  });
  it("나이트 점프가 이음매를 넘는다", () => {
    const s = arena();
    const knight = put(s, { seat: 0, piece: "knight", x: 7, y: 3 });
    expect(squares(moveDestinations(s, knight))).toContain("1,3,1"); // (+2,+1) -> (9,4) -> (1, 7-4)
    expect(squares(moveDestinations(s, knight))).toContain("0,6,1"); // (+1,-2) -> (8,1) -> (0, 7-1)
  });
  it("일반 규칙에서는 이동·공격 결과가 예전과 같다", () => {
    const s = arena(false);
    const rook = put(s, { seat: 0, piece: "rook", x: 6, y: 3 });
    expect(squares(moveDestinations(s, rook)).every((q) => q.endsWith(",0"))).toBe(true);
    expect(squares(moveDestinations(s, rook))).not.toContain("0,4,1");
  });
});

describe("앞면과 밑면", () => {
  it("다른 면의 기물은 같은 칸에 겹쳐 있어도 서로 길을 막지도 닿지도 않는다", () => {
    const s = arena();
    const rook = put(s, { seat: 0, piece: "rook", x: 3, y: 3 });
    put(s, { seat: 1, piece: "pawn", x: 3, y: 1, face: 1 }); // 유령
    put(s, { seat: 1, piece: "pawn", x: 3, y: 2, face: 1 });
    expect(attackableEnemies(s, rook)).toHaveLength(0);
    expect(squares(moveDestinations(s, rook))).toContain("3,1,0"); // 유령 둘을 통과
    expect(enemiesOf(s, rook)).toHaveLength(0);
  });
  it("같은 칸에 앞면 기물과 밑면 기물이 함께 있을 수 있다", () => {
    const s = arena();
    put(s, { seat: 0, piece: "king", x: 2, y: 2 });
    put(s, { seat: 1, piece: "king", x: 2, y: 2, face: 1 });
    expect(s.units.filter((u) => u.x === 2 && u.y === 2)).toHaveLength(2);
  });
  it("같은 면이면 닿고, 다른 면까지의 거리는 이음매를 지나는 거리다", () => {
    expect(distanceBetween({ x: 0, y: 3, face: 0 }, { x: 5, y: 3, face: 0 })).toBe(5);
    expect(distanceBetween({ x: 0, y: 3, face: 0 }, { x: 7, y: 4, face: 1 })).toBe(1); // 이음매 바로 건너편
    expect(distanceBetween({ x: 3, y: 3, face: 0 }, { x: 3, y: 3, face: 1 })).toBeGreaterThan(3);
  });
  it("공격은 이음매 너머 칸의 기물에도 닿는다", () => {
    const s = arena();
    const rook = put(s, { seat: 0, piece: "rook", x: 2, y: 4 });
    const foe = put(s, { seat: 1, piece: "king", x: 7, y: 3, face: 1 }); // (2,4)->(1)->(0)->이음매 (7,3), 밑면
    expect(attackableEnemies(s, rook)).toEqual([foe]);
  });
  it("앞면 기물은 밑면 적 쪽으로 이음매를 지나 면을 바꿔 만나러 간다", () => {
    const s = arena();
    const rook = put(s, { seat: 0, piece: "rook", x: 1, y: 4 });
    put(s, { seat: 1, piece: "king", x: 4, y: 3, face: 1, hp: 1e9, atk: 0 });
    for (let i = 0; i < 5 && rook.face === 0; i++) stepCombat(s);
    expect(rook.face).toBe(1);
    expect(s.events.some((e) => e.type === "ghost" && e.unitId === rook.id)).toBe(true);
  });
});

describe("웜홀", () => {
  it(`밑면에서 ${WORMHOLE_BEATS}박자를 보내면 열리고, 앞면 적이 닿으면 올라온다`, () => {
    const s = arena();
    const ghost = put(s, { seat: 0, piece: "king", x: 3, y: 4, face: 1 });
    const foe = put(s, { seat: 1, piece: "king", x: 3, y: 3 }); // 앞면 적, 칸 (3,3)
    addEffect(foe, { type: "root", value: 1, untilBeat: 99 });
    addEffect(ghost, { type: "root", value: 1, untilBeat: 99 }); // 이음매로 걸어가지 않고 웜홀만 쓰게 묶어 둔다
    // 유령이 앞면 적 옆에 있다: 밑면에는 적이 없고 웜홀은 아직 닫혀 있다
    for (let i = 0; i < WORMHOLE_BEATS - 1; i++) {
      stepCombat(s);
      expect(ghost.face).toBe(1);
    }
    expect(ghost.g).toBe(WORMHOLE_BEATS - 1);
    stepCombat(s); // g가 4가 된 뒤 다음 박자
    stepCombat(s);
    expect(ghost.face).toBe(0);
    expect(ghost.g).toBe(0);
    expect(s.events.some((e) => e.type === "surface" && e.unitId === ghost.id)).toBe(true);
  });
  it("올라올 칸 앞면이 차 있으면 올라오지 못한다", () => {
    const s = arena();
    const ghost = put(s, { seat: 0, piece: "king", x: 3, y: 4, face: 1, hp: 100000 });
    put(s, { seat: 1, piece: "king", x: 4, y: 3, hp: 100000 });
    put(s, { seat: 0, piece: "pawn", x: 3, y: 4, face: 0, hp: 100000 }); // 같은 칸 앞면을 아군이 차지
    ghost.g = 10;
    stepCombat(s);
    expect(ghost.face).toBe(1);
  });
  it("앞면으로 돌아오면 게이지가 0이다", () => {
    const s = arena();
    const ghost = put(s, { seat: 0, piece: "king", x: 3, y: 4, face: 1 });
    put(s, { seat: 1, piece: "king", x: 3, y: 3 });
    ghost.g = 9;
    stepCombat(s);
    expect(ghost.g === 0 && ghost.face === 0).toBe(true);
  });
});

describe("폰", () => {
  it("무한 모드에서는 승급하지 않고 끝줄에서 U턴한다", () => {
    const s = arena();
    const pawn = put(s, { seat: 0, piece: "pawn", x: 3, y: 1 });
    put(s, { seat: 1, piece: "king", x: 7, y: 7, hp: 100000, atk: 0 });
    stepCombat(s); // (3,0)
    expect(pawn.y).toBe(0);
    expect(pawn.piece).toBe("pawn");
    stepCombat(s); // 끝줄: U턴
    expect(pawn.dir).toBe(1);
    expect(pawn.u).toBe(1);
    stepCombat(s);
    expect(pawn.y).toBe(1);
  });
  it("앞면에서 U턴을 두 번 하면 일주 완료, 같은 칸 밑면에 분신이 생기고 본체가 죽으면 분신이 사라진다", () => {
    const s = arena();
    const pawn = put(s, { seat: 0, piece: "pawn", x: 3, y: 1, hp: 100000 });
    pawn.dir = -1;
    put(s, { seat: 1, piece: "king", x: 7, y: 7, hp: 100000, atk: 0 });
    // 위 끝(y=0)에서 U턴, 아래 끝(y=7)까지 가서 U턴 -> 일주
    for (let i = 0; i < 20 && pawn.c === 0; i++) stepCombat(s);
    expect(pawn.c).toBe(1);
    const clone = s.units.find((u) => u.cloneOf === pawn.id);
    expect(clone).toBeDefined();
    expect(clone).toMatchObject({ face: 1, summon: true, x: pawn.x, y: pawn.y });
    expect(s.events.some((e) => e.type === "lap")).toBe(true);
    // 본체가 쓰러지면 분신도 사라진다
    pawn.hp = 0;
    stepCombat(s);
    expect(pawn.alive).toBe(false);
    expect(clone!.alive).toBe(false);
  });
  it("분신이 죽어도 본체는 무사하다", () => {
    const s = arena();
    const body = put(s, { seat: 0, piece: "pawn", x: 2, y: 2, hp: 100000 });
    const clone = createUnit(s, { defId: "nut-wolf", seat: 0, face: 1, star: 1, x: 2, y: 2, hp: 5, maxHp: 5, atk: 1, energyMax: null, piece: "pawn", summon: true, cloneOf: body.id, ghosted: true });
    put(s, { seat: 1, piece: "king", x: 7, y: 7, hp: 100000, atk: 0 });
    clone.hp = 0;
    stepCombat(s);
    expect(clone.alive).toBe(false);
    expect(body.alive).toBe(true);
  });
  it("밑면의 분신은 가장자리에서 석화해 움직이지도 공격하지도 못한다", () => {
    const s = arena();
    const body = put(s, { seat: 0, piece: "pawn", x: 2, y: 5, hp: 100000 });
    const clone = createUnit(s, { defId: "nut-wolf", seat: 0, face: 1, star: 1, x: 2, y: 0, hp: 50, maxHp: 50, atk: 99, energyMax: null, piece: "pawn", summon: true, cloneOf: body.id, ghosted: true });
    clone.dir = -1;
    put(s, { seat: 1, piece: "king", x: 3, y: 1, face: 1, hp: 100000, atk: 0 });
    stepCombat(s);
    expect(clone.stoned).toBe(true);
    const foe = s.units.find((u) => u.seat === 1)!;
    const before = foe.hp;
    stepCombat(s);
    expect(foe.hp).toBe(before); // 석화한 폰은 공격하지 못한다
    expect(clone.y).toBe(0);
  });
  it(`분신은 한 쪽에 최대 ${CLONE_CAP}개`, () => {
    const s = arena();
    put(s, { seat: 1, piece: "king", x: 7, y: 0, hp: 1e9, atk: 0 });
    const pawns = [0, 1, 2, 3, 4, 5].map((x) => put(s, { seat: 0, piece: "pawn", x, y: 3, hp: 1e9, atk: 0 }));
    for (const p of pawns) p.u = 1; // 다음 U턴이 일주 완료
    for (let i = 0; i < 30; i++) stepCombat(s);
    expect(s.units.filter((u) => u.alive && u.seat === 0 && u.cloneOf !== null).length).toBeLessThanOrEqual(CLONE_CAP);
  });
});

describe("무한 모드 전투", () => {
  const boards = () => {
    const rng = makeRng(7);
    return [placeTeam(randomTeam(rng, 14, 6)), placeTeam(randomTeam(rng, 14, 6))] as [ReturnType<typeof placeTeam>, ReturnType<typeof placeTeam>];
  };
  it("같은 배치면 언제나 같은 결과다", () => {
    const b = boards();
    expect(runCombat(b, [], { mobius: true })).toEqual(runCombat(b, [], { mobius: true }));
    const r1 = recordCombat(b, [], { mobius: true });
    const r2 = recordCombat(b, [], { mobius: true });
    expect(r1.frames).toEqual(r2.frames);
  });
  it("돌발 사망과 제한 박자가 일반 규칙보다 늦다", () => {
    expect(MOBIUS_SUDDEN_DEATH_BEAT).toBeGreaterThan(SUDDEN_DEATH_BEAT);
    expect(MOBIUS_MAX_BEATS).toBeGreaterThan(MAX_BEATS);
    expect(createCombat([[], []], [], { mobius: true }).suddenBeat).toBe(MOBIUS_SUDDEN_DEATH_BEAT);
    expect(createCombat([[], []]).suddenBeat).toBe(SUDDEN_DEATH_BEAT);
  });
  it("무작위 배치 200판이 모두 제한 박자 안에 끝난다", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rng = makeRng(seed);
      const r = runCombat([placeTeam(randomTeam(rng, 14, 6)), placeTeam(randomTeam(rng, 14, 6))], [], { mobius: true });
      expect(r.beats).toBeLessThanOrEqual(MOBIUS_MAX_BEATS);
    }
  });
  it("기록 프레임에 면과 게이지가 들어간다", () => {
    let ghostSeen = false;
    for (let seed = 1; seed <= 60 && !ghostSeen; seed++) {
      const rng = makeRng(seed);
      const rec = recordCombat([placeTeam(randomTeam(rng, 14, 6)), placeTeam(randomTeam(rng, 14, 6))], [], { mobius: true });
      ghostSeen = rec.frames.some((f) => f.some((u) => (u[5] & 4) === 4));
      if (ghostSeen) expect(rec.events.some((e) => e[1] === "ghost")).toBe(true);
    }
    expect(ghostSeen).toBe(true);
  });
  it("일반 규칙의 기록에는 밑면 표시가 없다", () => {
    const rng = makeRng(3);
    const rec = recordCombat([placeTeam(randomTeam(rng, 14, 6)), placeTeam(randomTeam(rng, 14, 6))]);
    expect(rec.frames.every((f) => f.every((u) => (u[5] & 0xfc) === 0))).toBe(true);
  });
});

describe("무한 모드 방과 게임", () => {
  it("게임 상태와 스냅샷에 무한 모드가 표시된다", async () => {
    const { createChessGame } = await import("../src/chess/game");
    const { toChessSnapshot } = await import("../src/chess/snapshot");
    const game = createChessGame(1, false, true);
    expect(game.mobius).toBe(true);
    expect(toChessSnapshot(game, 0, false).mobius).toBe(true);
    expect(toChessSnapshot(createChessGame(1), 0, false).mobius).toBe(false);
  });
  it("전투 기록이 무한 모드 규칙으로 만들어진다", async () => {
    const { createChessGame, runRoundCombat } = await import("../src/chess/game");
    for (const mobius of [false, true]) {
      const game = createChessGame(3, false, mobius);
      for (const seat of [0, 1] as const) game.players[seat].board.push({ uid: `s${seat}`, defId: "nut-wolf", star: 1, col: 3, row: 0 });
      const record = runRoundCombat(game);
      expect(record.result.suddenDeath).toBe(false);
      expect(record.frames.length).toBeGreaterThan(1);
    }
  });
  it("방 만들기: 무한 모드 옵션이 상태에 저장된다", async () => {
    const { createRoom } = await import("../src/room-state");
    expect(createRoom("ABCD", 0, false, "chess", false, false, "", "", true).mobius).toBe(true);
    expect(createRoom("ABCD", 0, false, "chess").mobius).toBe(false);
  });
});

describe("테스트 방 코드", () => {
  it("예약된 코드는 모두 방 코드에 쓰는 글자만 쓴다 (아니면 접속할 수 없다)", () => {
    for (const code of RESERVED_CODES) {
      expect(code).toHaveLength(CODE_LENGTH);
      for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
    }
  });
});
