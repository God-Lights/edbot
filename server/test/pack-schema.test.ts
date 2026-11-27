import { describe, expect, it } from "vitest";
import { packSchema, validatePack } from "../src/chess/pack-schema";
import examplePack from "../packs/example-pack.json";

describe("팩 개발 위키용 값 (/api/packs/schema)", () => {
  it("검사 규칙과 같은 값을 준다", () => {
    const s = packSchema();
    expect(s.apiVersion).toBe(1);
    expect(s.abilities.map((a) => a.id)).toContain("shield-wall");
    expect(s.abilities.find((a) => a.id === "spore")?.passive).toBe(true);
    // 공식 캐릭터가 쓰는 능력이면 예가 있다
    expect(s.abilities.find((a) => a.id === "clone")?.examples.length).toBeGreaterThan(0);
    expect(s.roles.map((r) => r.id)).toContain("탱커");
    expect(s.pieces.map((p) => p.id).sort()).toEqual(["bishop", "king", "knight", "pawn", "queen", "rook"]);
    expect(s.base.map((b) => b.cost)).toEqual([1, 2, 3, 4]);
    expect(s.rules.find((r) => r.key === "rerollCost")).toEqual({ key: "rerollCost", min: 0, max: 10, official: 2 });
    expect(s.sounds).toContain("roundWin");
    expect(s.colors).toContain("cost5");
    expect(s.units.find((u) => u.id === "dwargon")?.nameKo).toBeTruthy();
    expect(s.materials.every((m) => s.weapons.some((w) => w.id === m.weapon))).toBe(true);
  });
});

describe("팩 검사기 (/api/packs/validate)", () => {
  it("예시 팩은 통과하고 요약을 준다", () => {
    const r = validatePack(examplePack);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pack.id).toBe("example");
    expect(r.pack.kind).toBe("plugin");
    expect(r.ruleset).toMatch(/^custom-/);
    expect(r.pack.summary?.units).toEqual(["example:moon-guard", "example:star-hunter"]);
  });

  it("틀린 곳을 경로와 함께 알려 준다", () => {
    const r = validatePack({ apiVersion: 1, id: "bad", name: "x", version: "1", units: [{ id: "a", nameKo: "가", piece: "dragon", faction: "f", cost: 5, role: "탱커", ability: "nope", abilityText: "t" }] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const text = r.errors.join("\n");
    expect(text).toContain("units[0].piece");
    expect(text).toContain("units[0].cost");
    expect(text).toContain("units[0].ability");
  });

  it("리소스만 있으면 규칙은 공식 그대로", () => {
    const r = validatePack({ apiVersion: 1, id: "skin", name: "스킨", version: "1", resources: { colors: { gold: "#112233" } } });
    expect(r.ok && r.pack.kind).toBe("resource");
    expect(r.ok && r.ruleset).toBe("official");
  });
});
