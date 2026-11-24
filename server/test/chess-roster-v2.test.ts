// 설정 v2로 추가한 캐릭터의 능력: 신덱스(나열), 소버녀(충성), 자바(불길), 파이(음파)
import { describe, expect, it } from "vitest";
import { castAbility } from "../src/chess/abilities";
import { createCombat } from "../src/chess/sim";
import { unitDef } from "../src/chess/roster";
import type { Placement } from "../src/chess/types";

const p = (defId: string, col: number, row: number): Placement => ({ defId, star: 1, col, row });
const hpLoss = (before: Map<string, number>, state: ReturnType<typeof createCombat>) =>
  state.units.filter((u) => u.seat === 1).map((u) => (before.get(u.id) ?? 0) - u.hp);

function cast(defId: string, enemies: Placement[], allies: Placement[] = []) {
  const state = createCombat([[p(defId, 3, 0), ...allies], enemies]);
  const caster = state.units.find((u) => u.defId === defId && u.seat === 0)!;
  const before = new Map(state.units.map((u) => [u.id, u.hp]));
  castAbility(state, caster);
  // 피해는 다음 처리 때 들어가므로 쌓인 hit을 직접 본다
  return { state, caster, before, hits: state.hits };
}

describe("설정 v2 캐릭터", () => {
  it("모두 상점에 나온다 (진화 전용이 아니다)", () => {
    for (const id of ["syndex", "sovereign", "java", "pi"]) expect(unitDef(id)?.evolveOnly ?? false, id).toBe(false);
  });

  it("신덱스: 적이 가장 많은 가로줄의 적 모두를 친다", () => {
    // 상대 앞줄(row 0)에 셋, 뒷줄(row 3)에 하나
    const { hits, state } = cast("syndex", [p("relic", 0, 0), p("relic", 2, 0), p("relic", 5, 0), p("relic", 4, 3)]);
    const targets = new Set(hits.map((h) => h.targetId));
    const rowOf = (id: string) => state.units.find((u) => u.id === id)!.y;
    expect(targets.size).toBe(3);
    expect(new Set([...targets].map(rowOf)).size).toBe(1);
  });

  it("소버녀: 가장 다친 아군에게 보호막, 자신은 도발", () => {
    const { state, caster } = cast("sovereign", [p("relic", 3, 0)], [p("nut-wolf", 0, 1), p("felis", 6, 1)]);
    const wolf = state.units.find((u) => u.defId === "nut-wolf")!;
    wolf.hp = 1; // 다시 시전해서 다친 아군을 고르게 한다
    castAbility(state, caster);
    expect(wolf.shield).toBeGreaterThan(0);
    expect(caster.effects.some((e) => e.type === "taunt")).toBe(true);
  });

  it("자바: 모인 적 3x3에 피해와 화상", () => {
    const { hits, state } = cast("java", [p("relic", 3, 1), p("relic", 4, 1), p("relic", 3, 2), p("relic", 0, 3)]);
    expect(new Set(hits.map((h) => h.targetId)).size).toBe(3);
    expect(state.units.filter((u) => u.seat === 1 && u.effects.some((e) => e.type === "dot")).length).toBe(3);
  });

  it("파이: 최대 4명에게 튕기며 피해가 줄어든다", () => {
    const { hits } = cast("pi", [p("relic", 0, 0), p("relic", 2, 0), p("relic", 4, 0), p("relic", 6, 0), p("relic", 7, 3)]);
    expect(hits).toHaveLength(4);
    expect(new Set(hits.map((h) => h.targetId)).size).toBe(4);
    const amounts = hits.map((h) => h.amount);
    for (let i = 1; i < amounts.length; i++) expect(amounts[i]!).toBeLessThan(amounts[i - 1]!);
  });
});
