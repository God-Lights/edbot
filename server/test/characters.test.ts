import { describe, expect, it } from "vitest";
import { CHARACTERS, DEFAULT_LANE_BY_PIECE, characterById, defaultLaneFor } from "../src/characters";
import { LANES } from "../src/protocol";
import type { Piece } from "../src/protocol";

describe("캐릭터 데이터", () => {
  it("12명이고 id와 이름이 겹치지 않는다", () => {
    expect(CHARACTERS).toHaveLength(12);
    expect(new Set(CHARACTERS.map((c) => c.id)).size).toBe(12);
    expect(new Set(CHARACTERS.map((c) => c.nameKo)).size).toBe(12);
    expect(new Set(CHARACTERS.map((c) => c.nameEn)).size).toBe(12);
  });

  it("id는 소문자와 '-'만 쓴다", () => {
    for (const c of CHARACTERS) expect(c.id).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it("기물 6종이 각각 2명이다", () => {
    const pieces: Piece[] = ["king", "queen", "rook", "bishop", "knight", "pawn"];
    for (const piece of pieces) {
      expect(CHARACTERS.filter((c) => c.piece === piece)).toHaveLength(2);
    }
  });

  it("능력치가 올바른 값이다", () => {
    for (const c of CHARACTERS) {
      expect(c.hp).toBeGreaterThan(0);
      expect(c.attack).toBeGreaterThan(0);
      expect(["slow", "normal", "fast", "veryFast"]).toContain(c.speed);
      expect(["melee", "mid", "long"]).toContain(c.range);
    }
  });

  it("기획서의 이름과 기물 배정", () => {
    expect(characterById("ancient-lord")).toMatchObject({ nameKo: "에이션트 로드", piece: "king" });
    expect(characterById("richmond")).toMatchObject({ nameKo: "리치몬드", piece: "king" });
    expect(characterById("toka-loga")).toMatchObject({ nameKo: "토카로가", piece: "queen" });
    expect(characterById("xenosaurs")).toMatchObject({ nameKo: "제노사우로스", piece: "pawn" });
    expect(characterById("없는-캐릭터")).toBeUndefined();
  });

  it("기본 레인: 룩은 킹사이드, 비숍은 센터, 모든 기물이 유효한 레인", () => {
    expect(defaultLaneFor("dwargon")).toBe("kingside");
    expect(defaultLaneFor("lappus")).toBe("center");
    for (const lane of Object.values(DEFAULT_LANE_BY_PIECE)) expect(LANES).toContain(lane);
    // 모르는 id는 센터
    expect(defaultLaneFor("nobody")).toBe("center");
  });
});
