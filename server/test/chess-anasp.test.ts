// 프린세스 아나스프: 전투 중 상대 끝 줄에 닿으면 그 전투 동안 퀸 아나스프가 된다 (유일하게 다른 캐릭터로 승급)
import { describe, expect, it } from "vitest";
import { checkPromotion, createCombat, recordCombat, stepCombat } from "../src/chess/sim";
import { roster, unitDef } from "../src/chess/roster";
import { createChessGame } from "../src/chess/game";
import type { Placement } from "../src/chess/types";

const p = (defId: string, col: number, row: number): Placement => ({ defId, star: 1, col, row });

describe("아나스프", () => {
  it("프린세스는 상점에 나오고, 퀸은 승급으로만 얻는다", () => {
    const princess = unitDef("princess-anasp")!;
    const queen = unitDef("queen-anasp")!;
    expect(princess.piece).toBe("pawn");
    expect(princess.promotesTo).toBe("queen-anasp");
    expect(princess.evolveOnly ?? false).toBe(false);
    expect(queen.piece).toBe("queen");
    expect(queen.evolveOnly).toBe(true);
    // 승급하는 캐릭터는 아나스프 하나뿐
    expect(roster().filter((d) => d.promotesTo).map((d) => d.id)).toEqual(["princess-anasp"]);
    const game = createChessGame(1);
    expect(game.pool["queen-anasp"] ?? 0).toBe(0);
    expect(game.pool["princess-anasp"]).toBeGreaterThan(0);
  });

  it("끝 줄에 닿으면 퀸 아나스프가 된다: 체력 비율 유지, 능력치는 퀸 기준, 에너지는 새로", () => {
    const state = createCombat([[p("princess-anasp", 3, 0)], [p("relic", 0, 0)]]);
    const unit = state.units.find((u) => u.defId === "princess-anasp")!;
    const princess = unitDef("princess-anasp")!;
    const queen = unitDef("queen-anasp")!;
    unit.hp = unit.maxHp / 2;
    unit.energy = 5;
    unit.y = 0; // 0번 자리의 상대 끝 줄
    checkPromotion(state, unit);
    expect(unit.defId).toBe("queen-anasp");
    expect(unit.baseDefId).toBe("princess-anasp");
    expect(unit.piece).toBe("queen");
    expect(unit.promoted).toBe(true);
    expect(unit.maxHp).toBeCloseTo(queen.hp, 5);
    expect(unit.hp / unit.maxHp).toBeCloseTo(0.5, 5);
    expect(unit.atk).toBeCloseTo(queen.atk, 5);
    expect(unit.energy).toBe(0);
    expect(unit.energyMax).not.toBeNull();
    expect(princess.passive).toBe(true);
    expect(state.events.some((e) => e.type === "promote" && e.unitId === unit.id && e.text === "queen-anasp")).toBe(true);
    // 한 번만
    checkPromotion(state, unit);
    expect(state.events.filter((e) => e.type === "promote").length).toBe(1);
  });

  it("다른 폰은 지금처럼 같은 캐릭터 그대로 퀸 말이 된다", () => {
    const pawn = roster().find((d) => d.piece === "pawn" && !d.promotesTo && !d.evolveOnly)!;
    const state = createCombat([[p(pawn.id, 3, 0)], [p("relic", 0, 0)]]);
    const unit = state.units.find((u) => u.defId === pawn.id)!;
    unit.y = 0;
    checkPromotion(state, unit);
    expect(unit.defId).toBe(pawn.id);
    expect(unit.piece).toBe("queen");
    expect(unit.baseDefId).toBeUndefined();
  });

  it("무한 모드에서도 걷는 방향의 끝 줄에 닿으면 승급한다 (다른 폰은 승급하지 않는다)", () => {
    const pawn = roster().find((d) => d.piece === "pawn" && !d.promotesTo)!;
    const state = createCombat([[p("princess-anasp", 3, 0), p(pawn.id, 4, 0)], [p("relic", 0, 0)]], [], { mobius: true });
    const princess = state.units.find((u) => u.defId === "princess-anasp")!;
    const other = state.units.find((u) => u.defId === pawn.id)!;
    for (const u of [princess, other]) { u.dir = 1; u.y = 7; checkPromotion(state, u); }
    expect(princess.defId).toBe("queen-anasp");
    expect(other.piece).toBe("pawn");
    // 반대 방향 끝은 아니다
    const s2 = createCombat([[p("princess-anasp", 3, 0)], [p("relic", 0, 0)]], [], { mobius: true });
    const u2 = s2.units.find((u) => u.defId === "princess-anasp")!;
    u2.dir = 1; u2.y = 0;
    checkPromotion(s2, u2);
    expect(u2.defId).toBe("princess-anasp");
  });

  it("실제 전투에서 걸어가 승급하고, 기록에는 원래 캐릭터와 승급 뒤 캐릭터가 함께 남는다", () => {
    // 프린세스 혼자 앞으로 걷게: 상대는 반대편 구석의 튼튼한 기물 하나
    const boards: [Placement[], Placement[]] = [[p("princess-anasp", 3, 0)], [p("relic", 7, 3)]];
    const state = createCombat(boards);
    let guard = 0;
    while (!state.finished && guard++ < 80 && !state.events.some((e) => e.type === "promote")) stepCombat(state);
    expect(state.events.some((e) => e.type === "promote" && e.text === "queen-anasp")).toBe(true);

    const rec = recordCombat(boards);
    const idx = rec.units.findIndex((u) => u.defId === "princess-anasp");
    expect(idx).toBeGreaterThanOrEqual(0);
    const ru = rec.units[idx]!;
    expect(ru.promotedTo).toBe("queen-anasp");
    expect(ru.maxHp).toBe(unitDef("princess-anasp")!.hp);
    expect(ru.promotedMaxHp).toBe(unitDef("queen-anasp")!.hp);
    // 프레임의 승급 표시(2)가 어느 순간부터 켜진다
    expect(rec.frames.some((f) => ((f[idx]![5] ?? 0) & 2) !== 0)).toBe(true);
  });

  it("전투가 끝나면 판 위의 기물은 다시 프린세스다 (전투 안에서만)", () => {
    const boards: [Placement[], Placement[]] = [[p("princess-anasp", 3, 0)], [p("relic", 7, 3)]];
    recordCombat(boards);
    expect(boards[0][0]!.defId).toBe("princess-anasp");
  });
});
